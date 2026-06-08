/**
 * 担当営業 マスタ (sales_owners)。
 * 受電報告の担当営業 トグル選択 + 新規追加 に使う。
 */
const { getPool } = require('../../config/db');

// Railway デプロイ race 対策: テーブルが無ければ inline ensure
let _tableEnsured = false;
async function ensureTable(pool) {
  if (_tableEnsured) return;
  try {
    const [rows] = await pool.query(
      `SELECT TABLE_NAME FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_owners' LIMIT 1`
    );
    if (rows.length === 0) {
      await pool.query(
        `CREATE TABLE sales_owners (
           id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
           name VARCHAR(100) NOT NULL,
           is_active TINYINT(1) NOT NULL DEFAULT 1,
           sort_order INT NOT NULL DEFAULT 0,
           created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
           updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
           UNIQUE KEY uk_sales_owners_name (name),
           INDEX idx_sales_owners_active (is_active, sort_order)
         ) ENGINE=InnoDB COMMENT='担当営業 マスタ (受電報告 トグル選択)'`
      );
      // 既存 incoming_call_reports.sales_owner から初期投入
      try {
        await pool.query(
          `INSERT IGNORE INTO sales_owners (name)
           SELECT DISTINCT sales_owner FROM incoming_call_reports
            WHERE sales_owner IS NOT NULL AND sales_owner <> ''`
        );
      } catch (_e) { /* skip */ }
    }
    _tableEnsured = true;
  } catch (e) {
    console.error('[salesOwnerService] ensureTable 失敗:', e.message);
  }
}

async function list({ includeInactive = false } = {}) {
  const pool = getPool();
  if (!pool) return [];
  await ensureTable(pool);
  const where = includeInactive ? '' : 'WHERE is_active = 1';
  const [rows] = await pool.query(
    `SELECT id, name, is_active, sort_order
       FROM sales_owners
       ${where}
      ORDER BY sort_order ASC, name ASC`
  );
  return rows;
}

/**
 * 名前で取得 or 無ければ作成 (受電報告保存時の自動登録に使う)
 *   返り値: { id, name }
 */
async function findOrCreate(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  const pool = getPool();
  if (!pool) throw new Error('DB未設定');
  await ensureTable(pool);
  const [existing] = await pool.query(
    `SELECT id, name FROM sales_owners WHERE name = ? LIMIT 1`,
    [n]
  );
  if (existing.length) return existing[0];
  const [r] = await pool.query(
    `INSERT INTO sales_owners (name) VALUES (?)`,
    [n]
  );
  return { id: r.insertId, name: n };
}

async function create({ name }) {
  const n = String(name || '').trim();
  if (!n) { const e = new Error('name は必須'); e.status = 400; throw e; }
  const pool = getPool();
  if (!pool) throw new Error('DB未設定');
  await ensureTable(pool);
  try {
    const [r] = await pool.query(`INSERT INTO sales_owners (name) VALUES (?)`, [n]);
    return { id: r.insertId, name: n, is_active: 1 };
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      // 既に存在 → 既存を返す (冪等)
      const [ex] = await pool.query(`SELECT id, name, is_active FROM sales_owners WHERE name = ?`, [n]);
      if (ex.length) return ex[0];
    }
    throw e;
  }
}

async function update(id, { name, is_active, sort_order }) {
  const pool = getPool();
  if (!pool) throw new Error('DB未設定');
  await ensureTable(pool);
  const sets = [];
  const params = [];
  if (name !== undefined)       { sets.push('name = ?');       params.push(String(name).trim()); }
  if (is_active !== undefined)  { sets.push('is_active = ?');  params.push(is_active ? 1 : 0); }
  if (sort_order !== undefined) { sets.push('sort_order = ?'); params.push(Number(sort_order) || 0); }
  if (!sets.length) return false;
  params.push(id);
  const [r] = await pool.query(`UPDATE sales_owners SET ${sets.join(', ')} WHERE id = ?`, params);
  return r.affectedRows > 0;
}

async function remove(id) {
  const pool = getPool();
  if (!pool) throw new Error('DB未設定');
  await ensureTable(pool);
  const [r] = await pool.query(`DELETE FROM sales_owners WHERE id = ?`, [id]);
  return r.affectedRows > 0;
}

module.exports = { list, findOrCreate, create, update, remove };
