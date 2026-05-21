-- ============================================
-- FAX CRM - 初期スキーマ (MySQL 8)
-- ============================================
-- 機能ごとに段階的に追加。各テーブルは CREATE TABLE IF NOT EXISTS なので
-- 既存DBにそのまま再適用しても安全。
-- ============================================
SET NAMES utf8mb4;

-- --------------------------------------------
-- 顧客マスタ (約90万件想定)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS customers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL,
  fax_number VARCHAR(32) NOT NULL,
  phone_number VARCHAR(32) DEFAULT NULL,
  industry VARCHAR(100) DEFAULT NULL,
  prefecture VARCHAR(20) DEFAULT NULL,
  city VARCHAR(100) DEFAULT NULL,
  address TEXT DEFAULT NULL,
  postal_code VARCHAR(10) DEFAULT NULL,
  url VARCHAR(500) DEFAULT NULL,
  employee_count INT DEFAULT NULL,
  representative VARCHAR(100) DEFAULT NULL,
  note TEXT DEFAULT NULL,

  -- 集計キャッシュ (送信のたび更新する想定。受電報告実装時にトリガで保守)
  send_count INT NOT NULL DEFAULT 0,
  last_sent_at DATETIME DEFAULT NULL,
  last_pc_number VARCHAR(20) DEFAULT NULL,
  last_result VARCHAR(40) DEFAULT NULL,
  response_count INT NOT NULL DEFAULT 0,
  is_blacklisted TINYINT(1) NOT NULL DEFAULT 0,
  blacklisted_reason VARCHAR(255) DEFAULT NULL,

  source_file VARCHAR(255) DEFAULT NULL,
  imported_at DATETIME DEFAULT NULL,

  -- 外部システム連携 (callcenter-ai-system との顧客マッピング)
  external_callcenter_id INT UNSIGNED DEFAULT NULL
    COMMENT 'callcenter-ai-system 側の companies.id',

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_customers_fax (fax_number),
  UNIQUE KEY uk_customers_external_callcenter (external_callcenter_id),
  INDEX idx_customers_industry (industry),
  INDEX idx_customers_prefecture (prefecture),
  INDEX idx_customers_industry_pref (industry, prefecture),
  INDEX idx_customers_send_priority (send_count, last_sent_at),
  INDEX idx_customers_blacklist (is_blacklisted),
  INDEX idx_customers_company_name (company_name)
) ENGINE=InnoDB COMMENT='顧客マスタ';

-- --------------------------------------------
-- 全チャネル横断のタッチポイントイベント (共通イベントハブ)
-- 詳細仕様: docs/SHARED_CUSTOMER_MASTER.md
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS contact_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  channel ENUM('fax', 'call', 'email', 'sns', 'meeting', 'other') NOT NULL,
  event_type VARCHAR(40) NOT NULL COMMENT '例: send / response_inquiry / outbound / no_answer',
  occurred_at DATETIME NOT NULL,
  source_system ENUM('fax-crm', 'callcenter-ai', 'manual') NOT NULL DEFAULT 'fax-crm',
  source_event_id BIGINT UNSIGNED DEFAULT NULL COMMENT '元システムでのイベントID(重複防止)',
  operator_name VARCHAR(100) DEFAULT NULL,
  pc_number VARCHAR(20) DEFAULT NULL,
  manuscript_id INT UNSIGNED DEFAULT NULL,
  manuscript_folder_date DATE DEFAULT NULL,
  manuscript_slot TINYINT UNSIGNED DEFAULT NULL,
  result_label VARCHAR(40) DEFAULT NULL,
  memo TEXT DEFAULT NULL,
  raw_payload JSON DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ce_customer_occurred (customer_id, occurred_at DESC),
  INDEX idx_ce_channel_occurred (channel, occurred_at DESC),
  UNIQUE KEY uk_ce_source_dedup (source_system, source_event_id),
  CONSTRAINT fk_ce_customer FOREIGN KEY (customer_id)
    REFERENCES customers(id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='全チャネル横断のタッチポイントイベント';

-- --------------------------------------------
-- 原稿管理 (Drive上の 2026/0501/{1..22} 構造をDBで管理)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS manuscripts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  folder_date DATE NOT NULL COMMENT '原稿の日付フォルダ (例: 2026-05-01)',
  slot_number TINYINT UNSIGNED NOT NULL COMMENT '1〜23 のスロット番号',
  title VARCHAR(255) DEFAULT NULL,
  drive_folder_id VARCHAR(100) DEFAULT NULL,
  drive_folder_url VARCHAR(500) DEFAULT NULL,
  thumbnail_url VARCHAR(500) DEFAULT NULL,
  memo TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_manuscripts_date_slot (folder_date, slot_number),
  INDEX idx_manuscripts_date (folder_date)
) ENGINE=InnoDB COMMENT='原稿(日付別×23スロット)';

-- --------------------------------------------
-- リスト抽出バッチ (Excelファイル1個に相当)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS extraction_batches (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  filter_industry VARCHAR(100) DEFAULT NULL,
  filter_prefecture VARCHAR(20) DEFAULT NULL,
  filter_recent_days INT DEFAULT NULL COMMENT '直近N日以内に送信した顧客は除外する設定',
  target_count INT NOT NULL,
  actual_count INT NOT NULL DEFAULT 0,
  pc_number VARCHAR(20) DEFAULT NULL,
  manuscript_id INT UNSIGNED DEFAULT NULL,
  drive_file_id VARCHAR(100) DEFAULT NULL,
  drive_file_url VARCHAR(500) DEFAULT NULL,
  status ENUM('draft','ready','sent','failed') NOT NULL DEFAULT 'ready',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_batches_status (status),
  INDEX idx_batches_pc (pc_number),
  INDEX idx_batches_created (created_at DESC)
) ENGINE=InnoDB COMMENT='リスト抽出バッチ';

-- --------------------------------------------
-- 抽出明細 (customer × batch)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS extraction_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  batch_id BIGINT UNSIGNED NOT NULL,
  customer_id BIGINT UNSIGNED NOT NULL,
  row_index INT NOT NULL COMMENT 'Excel内の行番号(1始まり)',
  extracted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_extraction_batch_customer (batch_id, customer_id),
  INDEX idx_extraction_customer (customer_id),
  CONSTRAINT fk_extraction_batch FOREIGN KEY (batch_id) REFERENCES extraction_batches(id) ON DELETE CASCADE,
  CONSTRAINT fk_extraction_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT
) ENGINE=InnoDB COMMENT='抽出明細';

-- --------------------------------------------
-- 受電報告 (FAX送信に対する反応の記録)
-- ※「送信結果入力」ではなく「受電報告」と呼ぶ運用ルール
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS incoming_call_reports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT UNSIGNED NOT NULL,
  batch_id BIGINT UNSIGNED DEFAULT NULL COMMENT 'どの抽出バッチ起因か',
  send_date DATE NOT NULL COMMENT '送信日',
  pc_number VARCHAR(20) NOT NULL COMMENT '送信PC番号',
  manuscript_id INT UNSIGNED DEFAULT NULL,
  manuscript_folder_date DATE DEFAULT NULL,
  manuscript_slot TINYINT UNSIGNED DEFAULT NULL,

  result ENUM(
    'no_response',         -- 受電なし(未反応)
    'response_inquiry',    -- 反応あり(問合せ)
    'response_order',      -- 反応あり(発注)
    'refusal',             -- 拒否(送るな)
    'invalid_number',      -- FAX番号無効
    'other'
  ) NOT NULL DEFAULT 'no_response',
  result_detail TEXT DEFAULT NULL,
  responded_at DATETIME DEFAULT NULL,

  recorded_by INT UNSIGNED DEFAULT NULL,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_icr_customer_date (customer_id, send_date DESC),
  INDEX idx_icr_send_date (send_date),
  INDEX idx_icr_pc_date (pc_number, send_date),
  INDEX idx_icr_result (result, send_date),
  INDEX idx_icr_batch (batch_id),
  CONSTRAINT fk_icr_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_icr_batch FOREIGN KEY (batch_id) REFERENCES extraction_batches(id) ON DELETE SET NULL,
  CONSTRAINT fk_icr_manuscript FOREIGN KEY (manuscript_id) REFERENCES manuscripts(id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='受電報告(FAX送信に対する反応の記録)';

-- --------------------------------------------
-- FAX送信実績 (スプレッドシート同期 or CSV取込)
-- 1行 = (日付 × PC) で uniq
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS fax_send_stats (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  stat_date DATE NOT NULL,
  pc_number VARCHAR(20) NOT NULL,
  sent_count INT NOT NULL DEFAULT 0 COMMENT '送信試行数',
  success_count INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,
  busy_count INT NOT NULL DEFAULT 0 COMMENT '話中',
  no_answer_count INT NOT NULL DEFAULT 0 COMMENT '応答なし',
  invalid_count INT NOT NULL DEFAULT 0 COMMENT '番号無効',
  raw_payload JSON DEFAULT NULL,
  source ENUM('sheets','csv','manual') NOT NULL DEFAULT 'sheets',
  synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_fax_stats_date_pc (stat_date, pc_number),
  INDEX idx_fax_stats_date (stat_date)
) ENGINE=InnoDB COMMENT='FAX送信実績';

-- --------------------------------------------
-- システム設定 (key-value)
-- 用途: Drive root folder ID / Auto-upload有効化 / Sheets ID 等
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
  setting_value TEXT DEFAULT NULL,
  description VARCHAR(255) DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB COMMENT='システム設定 (key-value)';

-- 初期値投入(存在しないキーのみ)
INSERT IGNORE INTO system_settings (setting_key, setting_value, description) VALUES
  ('drive_root_folder_id', NULL, 'Drive上のルートフォルダID(リスト・原稿の親)'),
  ('drive_auto_upload',    '0',  'リスト抽出時にExcelをDriveへ自動アップロード(1=ON)'),
  ('manuscript_auto_create_folders', '0', '原稿日付登録時にDriveに23フォルダを自動作成(1=ON)');

-- --------------------------------------------
-- Sheets連携設定 (シングルトン: id=1のみ)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS sheets_config (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  sheet_id VARCHAR(100) DEFAULT NULL COMMENT 'スプレッドシートID',
  sheet_range VARCHAR(100) DEFAULT 'A1:ZZ500' COMMENT '読み取り範囲(pivot形式: NO.1〜NO.23 約162行 × 日付列ZZ=2年分)',
  last_synced_at DATETIME DEFAULT NULL,
  last_sync_status ENUM('ok','error','never') NOT NULL DEFAULT 'never',
  last_sync_message TEXT DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_sheets_config_singleton CHECK (id = 1)
) ENGINE=InnoDB COMMENT='Google Sheets 連携設定 (シングルトン)';

-- 期間 × PC × セグメント の実績(CSVインポート対象)
CREATE TABLE IF NOT EXISTS performance_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  period_date DATE NOT NULL COMMENT '集計期間の月初日 (例: 2026-05-01)',
  pc_number VARCHAR(20) DEFAULT NULL,
  segment VARCHAR(100) DEFAULT NULL COMMENT '業種/地域などの分析軸',
  cost BIGINT NOT NULL DEFAULT 0,
  call_count INT NOT NULL DEFAULT 0,
  project_count INT NOT NULL DEFAULT 0 COMMENT '案件数',
  interview_count INT NOT NULL DEFAULT 0 COMMENT '面接数',
  offer_count INT NOT NULL DEFAULT 0 COMMENT '内定',
  reject_count INT NOT NULL DEFAULT 0 COMMENT '不合格',
  cancel_count INT NOT NULL DEFAULT 0 COMMENT 'バラシ/失注',
  first_payment BIGINT NOT NULL DEFAULT 0 COMMENT '初回入金',
  expected_revenue BIGINT NOT NULL DEFAULT 0 COMMENT '見込売上',
  source_file VARCHAR(255) DEFAULT NULL,
  imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_perf_period (period_date),
  INDEX idx_perf_pc (pc_number),
  INDEX idx_perf_segment (segment)
) ENGINE=InnoDB COMMENT='CPA指標の元データ(月次/PC別/セグメント別)';

-- 月次ロールアップ VIEW (算出項目はここで計算)
-- 注意:
--   sends 列は fax_send_stats から取得(Google Sheets 同期)
--     - performance_records.call_count は廃止に向かう(過去データ互換のため残置)
--   ROAS は 初回入金 / コスト で計算(見込売上は参考表示のみ)
CREATE OR REPLACE VIEW v_cpa_monthly AS
SELECT
  pr.month,
  pr.cost,
  COALESCE(fs.sends, 0)                                   AS sends,
  ROUND(pr.projects / NULLIF(COALESCE(fs.sends, 0), 0) * 100, 2)
                                                          AS project_rate,
  pr.projects,
  ROUND(pr.cost / NULLIF(pr.projects, 0))                 AS project_cpa,
  pr.interviews,
  ROUND(pr.cost / NULLIF(pr.interviews, 0))               AS interview_cpa,
  ROUND(pr.interviews / NULLIF(pr.projects, 0) * 100, 2)  AS interview_rate,
  pr.offers,
  pr.rejects,
  pr.cancels,
  pr.first_payment,
  pr.expected_revenue,
  ROUND(pr.first_payment / NULLIF(pr.cost, 0) * 100, 2)   AS roas
FROM (
  SELECT
    DATE_FORMAT(period_date, '%Y-%m-01') AS month,
    SUM(cost)             AS cost,
    SUM(project_count)    AS projects,
    SUM(interview_count)  AS interviews,
    SUM(offer_count)      AS offers,
    SUM(reject_count)     AS rejects,
    SUM(cancel_count)     AS cancels,
    SUM(first_payment)    AS first_payment,
    SUM(expected_revenue) AS expected_revenue
  FROM performance_records
  GROUP BY 1
) pr
LEFT JOIN (
  SELECT
    DATE_FORMAT(stat_date, '%Y-%m-01') AS month,
    SUM(sent_count) AS sends
  FROM fax_send_stats
  GROUP BY 1
) fs ON fs.month = pr.month
ORDER BY pr.month DESC;
