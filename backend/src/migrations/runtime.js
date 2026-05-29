/**
 * サーバ起動時に自動実行する スキーマ補正 マイグレーション。
 *
 * 目的:
 *   init.sql 全体を再実行できない環境 (Railway 等で 1 回 migrate を流した後の本番) でも
 *   後から追加した列や NULL 許容変更を反映できるようにする。
 *   全てのマイグレーションは INFORMATION_SCHEMA で「適用済かどうか」 をチェックして
 *   冪等になるように書く。
 */
const { getPool } = require('../../config/db');

async function colExists(pool, table, column) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function colIsNullable(pool, table, column) {
  const [rows] = await pool.query(
    `SELECT IS_NULLABLE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0 && rows[0].IS_NULLABLE === 'YES';
}

async function indexExists(pool, table, indexName) {
  const [rows] = await pool.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?
      LIMIT 1`,
    [table, indexName]
  );
  return rows.length > 0;
}

async function runStartupMigrations() {
  const pool = getPool();
  if (!pool) return { skipped: true, applied: [] };
  const applied = [];
  const failed = [];

  // ① interview_records.pass_count を NULL 許容 (空欄=NULL / 0=明示ゼロ を区別するため)
  try {
    if (await colExists(pool, 'interview_records', 'pass_count')
        && !(await colIsNullable(pool, 'interview_records', 'pass_count'))) {
      await pool.query(
        `ALTER TABLE interview_records
           MODIFY COLUMN pass_count INT DEFAULT NULL
             COMMENT 'NQ列: 合格者数 (NULL=空欄 / 0=明示ゼロ)'`
      );
      applied.push('interview_records.pass_count → NULL 許容');
    }
  } catch (e) {
    failed.push({ name: 'interview_records.pass_count nullable', error: e.message });
  }

  // ② manuscript_slot_files.manuscript_content_id 列を追加 (原稿管理から選択した時の元 ID)
  try {
    if (await colExists(pool, 'manuscript_slot_files', 'manuscript_id')
        && !(await colExists(pool, 'manuscript_slot_files', 'manuscript_content_id'))) {
      await pool.query(
        `ALTER TABLE manuscript_slot_files
           ADD COLUMN manuscript_content_id INT UNSIGNED DEFAULT NULL
             COMMENT '原稿管理(manuscript_contents.id) から選択した場合の元 ID'`
      );
      applied.push('manuscript_slot_files.manuscript_content_id 追加');
    }
    if (await colExists(pool, 'manuscript_slot_files', 'manuscript_content_id')
        && !(await indexExists(pool, 'manuscript_slot_files', 'idx_msf_content'))) {
      await pool.query(
        `ALTER TABLE manuscript_slot_files
           ADD INDEX idx_msf_content (manuscript_content_id)`
      );
      applied.push('manuscript_slot_files.idx_msf_content INDEX 追加');
    }
  } catch (e) {
    failed.push({ name: 'manuscript_slot_files.manuscript_content_id', error: e.message });
  }

  // ③ cpa_monthly_costs テーブル新設 (CPA コスト確定版手入力)
  try {
    const [tbls] = await pool.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cpa_monthly_costs' LIMIT 1`
    );
    if (tbls.length === 0) {
      await pool.query(
        `CREATE TABLE cpa_monthly_costs (
           month DATE NOT NULL PRIMARY KEY,
           in_house_cost BIGINT NOT NULL DEFAULT 0
             COMMENT '自社FAX 月別 確定版コスト (円、 手動入力)',
           memo VARCHAR(255) DEFAULT NULL,
           updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
             ON UPDATE CURRENT_TIMESTAMP
         ) ENGINE=InnoDB COMMENT='CPA 月別 確定版コスト (手動入力)'`
      );
      applied.push('cpa_monthly_costs テーブル作成');
    }
  } catch (e) {
    failed.push({ name: 'cpa_monthly_costs CREATE', error: e.message });
  }

  // ④ cpa_cost_per_fax 設定 既定値 投入
  try {
    await pool.query(
      `INSERT IGNORE INTO system_settings (setting_key, setting_value, description)
       VALUES ('cpa_cost_per_fax', '9.385423213',
               'CPA コスト概算: 送信数1通あたりのコスト (円)')`
    );
    applied.push('cpa_cost_per_fax 設定 既定値 投入 (既に存在する場合は no-op)');
  } catch (e) {
    failed.push({ name: 'cpa_cost_per_fax setting', error: e.message });
  }

  // ⑤ users テーブル (ログイン認証)
  try {
    const [tbls] = await pool.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' LIMIT 1`
    );
    if (tbls.length === 0) {
      await pool.query(
        `CREATE TABLE users (
           id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
           username VARCHAR(50) NOT NULL,
           password_hash VARCHAR(255) NOT NULL COMMENT 'bcrypt ハッシュ',
           display_name VARCHAR(100) DEFAULT NULL,
           role VARCHAR(20) NOT NULL DEFAULT 'sales' COMMENT 'admin / sales',
           is_active TINYINT(1) NOT NULL DEFAULT 1,
           last_login_at DATETIME DEFAULT NULL,
           created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
           UNIQUE KEY uk_users_username (username),
           INDEX idx_users_role (role)
         ) ENGINE=InnoDB COMMENT='ユーザー (ログイン認証)'`
      );
      applied.push('users テーブル作成');
    }
  } catch (e) {
    failed.push({ name: 'users CREATE', error: e.message });
  }

  return { applied, failed };
}

module.exports = { runStartupMigrations };
