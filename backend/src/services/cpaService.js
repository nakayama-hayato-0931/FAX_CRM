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

// sales_projects の月次集計をどの列(BK列=acquired_date / A列=offer_date)を
// 基準にするか。フロントの「ベース切替」トグル対応。
function basisColumn(basis) {
  return basis === 'offer' ? 'offer_date' : 'acquired_date';
}

/**
 * CPA 月次ロールアップ
 *   - 引数 basis: 'acquired' (BK列=案件取得日、 既定) / 'offer' (A列=内定日)
 *   - View ではなく動的SQL で sales_projects 部分の集計列を切り替える
 */
async function getMonthly({ months = 12, basis = 'acquired' } = {}) {
  const pool = getPool();
  if (!pool) return [];
  const col = basisColumn(basis);
  // 面接の月キー: acquired→NS列(acquired_date)、 offer→NM列(interview_date)
  const ivCol = basis === 'offer' ? 'interview_date' : 'acquired_date';
  const limit = Math.min(Number(months) || 12, 60);

  // sales_projects の月キーになる列を basis に応じて差し替えた SQL
  //   v_cpa_monthly View の定義と完全に揃える (cost/sends 等の組み立ては同じ)
  const sql = `
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
      COALESCE(iv.interviews, 0)                                      AS interviews,
      ROUND((COALESCE(pr.cost, 0) + COALESCE(out_.outsourced_cost, 0))
            / NULLIF(COALESCE(iv.interviews, 0), 0))                  AS interview_cpa,
      ROUND(COALESCE(iv.interviews, 0)
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
        SELECT DATE_FORMAT(period_date, '%Y-%m-01')          AS month FROM performance_records
        UNION
        SELECT DATE_FORMAT(stat_date, '%Y-%m-01')            AS month FROM fax_send_stats
        UNION
        SELECT DATE_FORMAT(report_month, '%Y-%m-01')         AS month FROM outsourced_fax_records
        UNION
        SELECT DATE_FORMAT(${col}, '%Y-%m-01')               AS month FROM sales_projects WHERE ${col} IS NOT NULL
        UNION
        SELECT DATE_FORMAT(${ivCol}, '%Y-%m-01')              AS month FROM interview_records
         WHERE ${ivCol} IS NOT NULL AND source_kind = 'FAX受電' AND interview_date <= CURDATE()
      ) u WHERE month IS NOT NULL
    ) m
    LEFT JOIN (
      SELECT DATE_FORMAT(period_date, '%Y-%m-01') AS month,
        SUM(cost) AS cost,
        SUM(reject_count) AS rejects, SUM(cancel_count) AS cancels
      FROM performance_records GROUP BY 1
    ) pr ON pr.month = m.month
    LEFT JOIN (
      SELECT DATE_FORMAT(${ivCol}, '%Y-%m-01') AS month,
        COUNT(DISTINCT COALESCE(NULLIF(job_number, ''), company_name)) AS interviews  -- 面接した会社数 (同一求人は1社カウント)
      FROM interview_records
      WHERE ${ivCol} IS NOT NULL
        AND source_kind = 'FAX受電'
        AND interview_date <= CURDATE()
      GROUP BY 1
    ) iv ON iv.month = m.month
    LEFT JOIN (
      SELECT DATE_FORMAT(stat_date, '%Y-%m-01') AS month, SUM(sent_count) AS sends
      FROM fax_send_stats GROUP BY 1
    ) fs ON fs.month = m.month
    LEFT JOIN (
      SELECT DATE_FORMAT(report_month, '%Y-%m-01') AS month,
        SUM(send_count) AS outsourced_sends, SUM(cost) AS outsourced_cost
      FROM outsourced_fax_records GROUP BY 1
    ) out_ ON out_.month = m.month
    LEFT JOIN (
      SELECT DATE_FORMAT(${col}, '%Y-%m-01') AS month,
        COUNT(*) AS projects,
        COUNT(DISTINCT COALESCE(NULLIF(job_number, ''), company_name)) AS offers,
        SUM(first_payment) AS first_payment,
        SUM(expected_revenue) AS expected_revenue
      FROM sales_projects WHERE ${col} IS NOT NULL
      GROUP BY 1
    ) sp ON sp.month = m.month
    WHERE m.month <= DATE_FORMAT(CURDATE(), '%Y-%m-01')   -- 未来月は除外 (シートに空欄日付列があっても出さない)
    ORDER BY m.month DESC
    LIMIT ?`;

  const [rows] = await pool.query(sql, [limit]);
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
