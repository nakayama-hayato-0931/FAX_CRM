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
  sheet_id VARCHAR(100) DEFAULT NULL COMMENT 'FAX送信実績 スプレッドシートID',
  sheet_range VARCHAR(100) DEFAULT 'A1:ZZ500' COMMENT 'FAX送信実績 読み取り範囲',
  -- 案件(ビザ申請 進捗)シート用
  projects_sheet_id VARCHAR(100) DEFAULT NULL COMMENT '案件シート スプレッドシートID',
  projects_sheet_name VARCHAR(100) DEFAULT 'ビザ申請 進捗' COMMENT '案件シート名(タブ名)',
  projects_sheet_range VARCHAR(100) DEFAULT 'A1:CZ5000' COMMENT '案件シート 読み取り範囲',
  projects_last_synced_at DATETIME DEFAULT NULL,
  projects_last_sync_status ENUM('ok','error','never') NOT NULL DEFAULT 'never',
  projects_last_sync_message TEXT DEFAULT NULL,
  last_synced_at DATETIME DEFAULT NULL,
  last_sync_status ENUM('ok','error','never') NOT NULL DEFAULT 'never',
  last_sync_message TEXT DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_sheets_config_singleton CHECK (id = 1)
) ENGINE=InnoDB COMMENT='Google Sheets 連携設定 (シングルトン)';

-- --------------------------------------------
-- 委託(外注)FAX送信の月別実績
-- 自社FAX以外で送信を依頼している分のコストと送信数を手動入力
-- CPA View で in-house(自社) と合算
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS outsourced_fax_records (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  report_month DATE NOT NULL COMMENT '対象月の月初日(YYYY-MM-01)。year_month は MySQL 予約語のため別名',
  vendor_name VARCHAR(100) DEFAULT NULL COMMENT '委託先名(任意メモ)',
  send_count INT NOT NULL DEFAULT 0,
  cost BIGINT NOT NULL DEFAULT 0,
  memo TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_outsourced_month (report_month),
  INDEX idx_outsourced_month (report_month)
) ENGINE=InnoDB COMMENT='委託(外注)FAX送信の月別実績';

-- --------------------------------------------
-- 案件マスタ (内定案件、シート『ビザ申請 進捗』から同期)
-- 抽出条件: BE列=「FAX受電」 AND J列≠「ビザ」
-- 1行 = 1案件
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS sales_projects (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- シート行を一意に特定するキー(行番号 or 求人番号+登録番号など)
  external_key VARCHAR(100) NOT NULL COMMENT 'シート行の一意キー(重複防止)',

  -- 主要日付
  offer_date DATE DEFAULT NULL COMMENT 'A列: 内定日',
  acquired_date DATE DEFAULT NULL COMMENT 'BK列: 案件取得日 (CPA月集計の基準)',

  -- 案件基本情報
  job_number VARCHAR(100) DEFAULT NULL COMMENT 'B列: 求人番号',
  company_name VARCHAR(255) DEFAULT NULL COMMENT 'BD列: 会社名',
  candidate_registration_no VARCHAR(100) DEFAULT NULL COMMENT 'G列: 内定者の登録番号',
  sales_owner VARCHAR(100) DEFAULT NULL COMMENT 'E列: 営業担当者',
  industry VARCHAR(100) DEFAULT NULL COMMENT 'CF列: 業種',

  -- 金額(円換算済、シート上の値×10000)
  first_payment BIGINT NOT NULL DEFAULT 0 COMMENT 'BI列: 初回入金(円)。取消/辞退は0',
  expected_revenue BIGINT NOT NULL DEFAULT 0 COMMENT 'BJ列: 見込売上(円)。取消/辞退は0',
  payment_actual BIGINT NOT NULL DEFAULT 0 COMMENT 'CC列: 入金実績(円)',

  -- ステータス
  status_label VARCHAR(40) DEFAULT NULL COMMENT 'J列: 取消/辞退/通常等の原文',
  is_cancelled TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'J列=取消',
  is_declined TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'J列=辞退',

  -- 取込メタ
  source_row INT DEFAULT NULL COMMENT 'シート上の行番号',
  synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_sales_projects_external (external_key),
  INDEX idx_sales_projects_acquired (acquired_date),
  INDEX idx_sales_projects_offer (offer_date),
  INDEX idx_sales_projects_industry (industry),
  INDEX idx_sales_projects_status (is_cancelled, is_declined)
) ENGINE=InnoDB COMMENT='案件マスタ(シート『ビザ申請 進捗』同期)';

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
-- データソース:
--   cost / interviews / rejects / cancels            ← performance_records (CSV)
--   sends (自社)                                     ← fax_send_stats (Sheets同期)
--   sends (委託) / cost (委託)                       ← outsourced_fax_records (手入力)
--   projects (FAXからの総案件数)                     ← sales_projects 全行 (取消/辞退含む)
--   offers (内定社数)                                ← sales_projects 全行 (取消/辞退も含めて1件としてカウント)
--   first_payment / expected_revenue                 ← sales_projects (取消/辞退の行は0で記録)
--     - 月次キーは acquired_date (案件取得日)
--   ROAS = 初回入金 / コスト合算
-- 月キー: 上記4ソースのいずれかに存在する月をすべて FULL OUTER JOIN 的に拾う
CREATE OR REPLACE VIEW v_cpa_monthly AS
SELECT
  m.month,
  COALESCE(pr.cost, 0) + COALESCE(out_.outsourced_cost, 0)        AS cost,
  COALESCE(pr.cost, 0)                                            AS in_house_cost,
  COALESCE(out_.outsourced_cost, 0)                               AS outsourced_cost,
  COALESCE(fs.sends, 0) + COALESCE(out_.outsourced_sends, 0)      AS sends,
  COALESCE(fs.sends, 0)                                           AS in_house_sends,
  COALESCE(out_.outsourced_sends, 0)                              AS outsourced_sends,
  ROUND(COALESCE(sp.projects, 0)
        / NULLIF(COALESCE(fs.sends, 0) + COALESCE(out_.outsourced_sends, 0), 0) * 100, 2)
                                                                  AS project_rate,
  COALESCE(sp.projects, 0)                                        AS projects,
  ROUND((COALESCE(pr.cost, 0) + COALESCE(out_.outsourced_cost, 0))
        / NULLIF(COALESCE(sp.projects, 0), 0))                    AS project_cpa,
  COALESCE(pr.interviews, 0)                                      AS interviews,
  ROUND((COALESCE(pr.cost, 0) + COALESCE(out_.outsourced_cost, 0))
        / NULLIF(COALESCE(pr.interviews, 0), 0))                  AS interview_cpa,
  ROUND(COALESCE(pr.interviews, 0)
        / NULLIF(COALESCE(sp.projects, 0), 0) * 100, 2)           AS interview_rate,
  COALESCE(sp.offers, 0)                                          AS offers,
  COALESCE(pr.rejects, 0)                                         AS rejects,
  COALESCE(pr.cancels, 0)                                         AS cancels,
  COALESCE(sp.first_payment, 0)                                   AS first_payment,
  COALESCE(sp.expected_revenue, 0)                                AS expected_revenue,
  ROUND(COALESCE(sp.first_payment, 0)
        / NULLIF(COALESCE(pr.cost, 0) + COALESCE(out_.outsourced_cost, 0), 0) * 100, 2)
                                                                  AS roas
FROM (
  SELECT DISTINCT month FROM (
    SELECT DATE_FORMAT(period_date, '%Y-%m-01')   AS month FROM performance_records
    UNION
    SELECT DATE_FORMAT(stat_date, '%Y-%m-01')     AS month FROM fax_send_stats
    UNION
    SELECT DATE_FORMAT(report_month, '%Y-%m-01')  AS month FROM outsourced_fax_records
    UNION
    SELECT DATE_FORMAT(acquired_date, '%Y-%m-01') AS month FROM sales_projects WHERE acquired_date IS NOT NULL
  ) u
  WHERE month IS NOT NULL
) m
LEFT JOIN (
  SELECT
    DATE_FORMAT(period_date, '%Y-%m-01') AS month,
    SUM(cost)             AS cost,
    SUM(interview_count)  AS interviews,
    SUM(reject_count)     AS rejects,
    SUM(cancel_count)     AS cancels
  FROM performance_records
  GROUP BY 1
) pr ON pr.month = m.month
LEFT JOIN (
  SELECT
    DATE_FORMAT(stat_date, '%Y-%m-01') AS month,
    SUM(sent_count) AS sends
  FROM fax_send_stats
  GROUP BY 1
) fs ON fs.month = m.month
LEFT JOIN (
  SELECT
    DATE_FORMAT(report_month, '%Y-%m-01') AS month,
    SUM(send_count) AS outsourced_sends,
    SUM(cost)       AS outsourced_cost
  FROM outsourced_fax_records
  GROUP BY 1
) out_ ON out_.month = m.month
LEFT JOIN (
  SELECT
    DATE_FORMAT(acquired_date, '%Y-%m-01') AS month,
    COUNT(*)              AS projects,  -- FAXからの総案件数 (取消/辞退含む全行)
    COUNT(*)              AS offers,    -- 内定社数 (取消/辞退も含む。 売上は0で計算)
    SUM(first_payment)    AS first_payment,
    SUM(expected_revenue) AS expected_revenue
  FROM sales_projects
  WHERE acquired_date IS NOT NULL
  GROUP BY 1
) sp ON sp.month = m.month
ORDER BY m.month DESC;
