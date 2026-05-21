/**
 * 委託(外注)FAX送信の月別実績 サービス
 *   テーブル: outsourced_fax_records
 *   キー: report_month (DATE, 月初日) で UNIQUE
 *   UPSERT で「同じ月は1レコード」運用
 */
const { getPool, isConfigured } = require('../../config/db');

function normalizeMonth(input) {
  if (!input) return null;
  const s = String(input).trim();
  // 受け付け形式: 'YYYY-MM' / 'YYYY-MM-DD' / 'YYYY/MM' / 'YYYY/MM/DD'
  const m = s.match(/^(\d{4})[-\/](\d{1,2})(?:[-\/](\d{1,2}))?$/);
  if (!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-01`;
}

async function list({ from, to } = {}) {
  const pool = getPool();
  if (!pool) return [];
  const where = [];
  const params = [];
  if (from) { where.push('report_month >= ?'); params.push(normalizeMonth(from)); }
  if (to)   { where.push('report_month <= ?'); params.push(normalizeMonth(to)); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows] = await pool.query(
    `SELECT id, report_month, vendor_name, send_count, cost, memo, created_at, updated_at
       FROM outsourced_fax_records
       ${whereSql}
       ORDER BY report_month DESC`,
    params
  );
  return rows;
}

async function getByMonth(month) {
  const pool = getPool();
  if (!pool) return null;
  const normalized = normalizeMonth(month);
  if (!normalized) {
    const err = new Error('month の形式が不正(YYYY-MM 等)'); err.status = 400; err.code = 'INVALID_MONTH';
    throw err;
  }
  const [rows] = await pool.query(
    `SELECT * FROM outsourced_fax_records WHERE report_month = ? LIMIT 1`,
    [normalized]
  );
  return rows[0] || null;
}

async function upsert({ report_month, send_count, cost, vendor_name, memo }) {
  if (!isConfigured()) {
    const err = new Error('DBが未設定です'); err.status = 500; err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  const normalized = normalizeMonth(report_month);
  if (!normalized) {
    const err = new Error('report_month は YYYY-MM 形式で指定してください'); err.status = 400; err.code = 'INVALID_MONTH';
    throw err;
  }
  const sc = Math.max(Number(send_count) || 0, 0);
  const ct = Math.max(Number(cost) || 0, 0);
  const pool = getPool();
  await pool.query(
    `INSERT INTO outsourced_fax_records (report_month, vendor_name, send_count, cost, memo)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       vendor_name = VALUES(vendor_name),
       send_count  = VALUES(send_count),
       cost        = VALUES(cost),
       memo        = VALUES(memo)`,
    [normalized, vendor_name || null, sc, ct, memo || null]
  );
  return getByMonth(normalized);
}

async function remove(month) {
  if (!isConfigured()) {
    const err = new Error('DBが未設定です'); err.status = 500; err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  const normalized = normalizeMonth(month);
  if (!normalized) {
    const err = new Error('month の形式が不正'); err.status = 400; err.code = 'INVALID_MONTH';
    throw err;
  }
  const pool = getPool();
  const [result] = await pool.query(
    `DELETE FROM outsourced_fax_records WHERE report_month = ?`,
    [normalized]
  );
  return { deleted: result.affectedRows };
}

module.exports = { list, getByMonth, upsert, remove, normalizeMonth };
