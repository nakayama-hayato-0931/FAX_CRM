const fs = require('fs');
const csv = require('csv-parser');
const { getPool, isConfigured } = require('../../config/db');

const RAW_COLUMNS = [
  'period_date', 'pc_number', 'segment',
  'cost', 'call_count', 'project_count', 'interview_count',
  'offer_count', 'reject_count', 'cancel_count',
  'first_payment', 'expected_revenue',
];

const CSV_MAPPING = {
  // 期間関連
  '期間': 'period_date',
  '月': 'period_date',
  'period': 'period_date',
  'period_date': 'period_date',
  'date': 'period_date',
  // 軸
  'PC': 'pc_number',
  'pc': 'pc_number',
  'PC番号': 'pc_number',
  'pc_number': 'pc_number',
  'セグメント': 'segment',
  'segment': 'segment',
  '業種': 'segment',
  // 数値
  'コスト': 'cost', 'cost': 'cost',
  'コール数': 'call_count', 'call_count': 'call_count',
  '送信数': 'call_count', 'FAX送信数': 'call_count', '送信': 'call_count', 'sends': 'call_count',
  '案件数': 'project_count', 'project_count': 'project_count',
  '面接数': 'interview_count', 'interview_count': 'interview_count',
  '内定': 'offer_count', 'offer_count': 'offer_count',
  '不合格': 'reject_count', 'reject_count': 'reject_count',
  'バラシ': 'cancel_count', '失注': 'cancel_count', 'バラシ/失注': 'cancel_count',
  'cancel_count': 'cancel_count',
  '初回入金': 'first_payment', 'first_payment': 'first_payment',
  '見込売上': 'expected_revenue', 'expected_revenue': 'expected_revenue',
};

function parseNum(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/[¥,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parsePeriod(v) {
  // 受け付け形式: 2026-05-01 / 2026/05 / 5月 / 2026年5月 等
  if (!v) return null;
  const s = String(v).trim();
  // YYYY-MM-DD or YYYY/MM/DD
  const m1 = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/);
  if (m1) {
    const y = m1[1];
    const mo = String(m1[2]).padStart(2, '0');
    return `${y}-${mo}-01`;
  }
  // 「2026年5月」「2026年05月」
  const m2 = s.match(/^(\d{4})年(\d{1,2})月/);
  if (m2) return `${m2[1]}-${String(m2[2]).padStart(2, '0')}-01`;
  // 「5月」 → 今年の該当月
  const m3 = s.match(/^(\d{1,2})月$/);
  if (m3) {
    const y = new Date().getFullYear();
    return `${y}-${String(m3[1]).padStart(2, '0')}-01`;
  }
  return null;
}

function rowToRecord(row) {
  const rec = {};
  for (const [k, v] of Object.entries(row)) {
    const key = CSV_MAPPING[k] || CSV_MAPPING[k?.trim()];
    if (!key) continue;
    if (key === 'period_date') rec[key] = parsePeriod(v);
    else if (key === 'pc_number' || key === 'segment') rec[key] = v ? String(v).trim() : null;
    else rec[key] = parseNum(v);
  }
  return rec;
}

async function getMonthly({ months = 12 } = {}) {
  const pool = getPool();
  if (!pool) return [];
  const [rows] = await pool.query(
    `SELECT * FROM v_cpa_monthly LIMIT ?`,
    [Math.min(Number(months) || 12, 60)]
  );
  return rows;
}

async function listDetail({ from, to, pcNumber, segment }) {
  const pool = getPool();
  if (!pool) return [];
  const where = [];
  const params = [];
  if (from) { where.push('period_date >= ?'); params.push(from); }
  if (to)   { where.push('period_date <= ?'); params.push(to); }
  if (pcNumber) { where.push('pc_number = ?'); params.push(pcNumber); }
  if (segment)  { where.push('segment = ?');   params.push(segment); }
  const sql = `SELECT * FROM performance_records
                ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                ORDER BY period_date DESC, id DESC
                LIMIT 1000`;
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function importCsv(filePath, originalName) {
  if (!isConfigured()) {
    const err = new Error('DBが未設定です。.env の DB_HOST 等を設定してください');
    err.status = 500;
    err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  const records = [];
  let totalRows = 0;
  let skipped = 0;

  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        totalRows++;
        const rec = rowToRecord(row);
        if (!rec.period_date) { skipped++; return; }
        records.push(rec);
      })
      .on('end', resolve)
      .on('error', reject);
  });

  if (!records.length) {
    return { totalRows, inserted: 0, skipped };
  }

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const placeholders = records.map(
      () => `(${RAW_COLUMNS.map(() => '?').join(',')}, ?, ?)`
    ).join(',');
    const values = [];
    for (const r of records) {
      values.push(
        r.period_date,
        r.pc_number || null,
        r.segment || null,
        r.cost || 0,
        r.call_count || 0,
        r.project_count || 0,
        r.interview_count || 0,
        r.offer_count || 0,
        r.reject_count || 0,
        r.cancel_count || 0,
        r.first_payment || 0,
        r.expected_revenue || 0,
        originalName || null,
        new Date()
      );
    }
    const cols = [...RAW_COLUMNS, 'source_file', 'imported_at'];
    await conn.query(
      `INSERT INTO performance_records (${cols.join(',')}) VALUES ${placeholders}`,
      values
    );
  } finally {
    conn.release();
  }

  return { totalRows, inserted: records.length, skipped };
}

module.exports = { getMonthly, listDetail, importCsv };
