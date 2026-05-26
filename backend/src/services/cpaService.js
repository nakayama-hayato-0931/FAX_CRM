const fs = require('fs');
const csv = require('csv-parser');
const { getPool, isConfigured } = require('../../config/db');
const settings = require('./settingsService');

const DEFAULT_COST_PER_FAX = 9.385423213;

async function getCostPerFax() {
  try {
    const v = await settings.get('cpa_cost_per_fax');
    const n = parseFloat(v);
    if (Number.isFinite(n) && n >= 0) return n;
  } catch (_e) { /* fall through */ }
  return DEFAULT_COST_PER_FAX;
}

/**
 * cpa_monthly_costs テーブルが無い環境 (本番が起動時マイグ前 or DB再構築直後)
 * でも getMonthly が落ちないよう、 ここで CREATE TABLE IF NOT EXISTS を流す。
 * 冪等で軽量なので、 各 getMonthly 呼び出しの先頭で呼んでも問題なし。
 */
async function ensureMonthlyCostsTable() {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS cpa_monthly_costs (
       month DATE NOT NULL PRIMARY KEY,
       in_house_cost BIGINT NOT NULL DEFAULT 0
         COMMENT '自社FAX 月別 確定版コスト (円、 手動入力)',
       memo VARCHAR(255) DEFAULT NULL,
       updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
         ON UPDATE CURRENT_TIMESTAMP
     ) ENGINE=InnoDB COMMENT='CPA 月別 確定版コスト (手動入力)'`
  );
}

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
  // 起動時マイグ未適用環境でも落ちないように、 cpa_monthly_costs を保証
  await ensureMonthlyCostsTable();
  const col = basisColumn(basis);
  // 面接の月キー: acquired→NS列(acquired_date)、 offer→NM列(interview_date)
  const ivCol = basis === 'offer' ? 'interview_date' : 'acquired_date';
  const limit = Math.min(Number(months) || 12, 60);
  const costPerFax = await getCostPerFax();
  // 自社FAX in_house_cost = 手動入力 (cmc.in_house_cost) があればそれ、
  //                          無ければ 送信数 × 単価 (端数切捨て) の 概算値
  const inHouseCostExpr = `COALESCE(
    cmc.in_house_cost,
    FLOOR(COALESCE(fs.sends, 0) * ${costPerFax})
  )`;

  // sales_projects の月キーになる列を basis に応じて差し替えた SQL
  //   v_cpa_monthly View の定義と完全に揃える (cost/sends 等の組み立ては同じ)
  const sql = `
    SELECT
      m.month,
      ${inHouseCostExpr} + COALESCE(out_.outsourced_cost, 0)         AS cost,
      ${inHouseCostExpr}                                              AS in_house_cost,
      CASE WHEN cmc.in_house_cost IS NOT NULL THEN 1 ELSE 0 END       AS in_house_cost_is_manual,
      COALESCE(out_.outsourced_cost, 0)                               AS outsourced_cost,
      COALESCE(fs.sends, 0) + COALESCE(out_.outsourced_sends, 0)      AS sends,
      COALESCE(fs.sends, 0)                                           AS in_house_sends,
      COALESCE(out_.outsourced_sends, 0)                              AS outsourced_sends,
      -- 受電数 (受電報告の件数。 算出方法は別途見直し予定 → ic サブクエリの定義を差し替えるだけでOK)
      COALESCE(ic.incoming_calls, 0)                                  AS incoming_calls,
      -- 受電率 = 受電数 / 送信数
      ROUND(COALESCE(ic.incoming_calls, 0)
            / NULLIF(COALESCE(fs.sends, 0) + COALESCE(out_.outsourced_sends, 0), 0) * 100, 2)
                                                                      AS incoming_rate,
      ROUND(COALESCE(jp.projects, 0)
            / NULLIF(COALESCE(fs.sends, 0) + COALESCE(out_.outsourced_sends, 0), 0) * 100, 2)
                                                                      AS project_rate,
      COALESCE(jp.projects, 0)                                        AS projects,
      ROUND((${inHouseCostExpr} + COALESCE(out_.outsourced_cost, 0))
            / NULLIF(COALESCE(jp.projects, 0), 0))                    AS project_cpa,
      COALESCE(iv.interviews, 0)                                      AS interviews,
      ROUND((${inHouseCostExpr} + COALESCE(out_.outsourced_cost, 0))
            / NULLIF(COALESCE(iv.interviews, 0), 0))                  AS interview_cpa,
      ROUND(COALESCE(iv.interviews, 0)
            / NULLIF(COALESCE(jp.projects, 0), 0) * 100, 2)           AS interview_rate,
      COALESCE(sp.offers, 0)                                          AS offers,
      -- 内定率 = 内定社数 / 面接数 × 100
      --   面接数 (iv.interviews) は 内定社の不足分を加算 した UNION 値なので
      --   常に 内定率 ≦ 100% が成立
      ROUND(COALESCE(sp.offers, 0)
            / NULLIF(COALESCE(iv.interviews, 0), 0) * 100, 2)         AS offer_rate,
      -- 不合格: 面接シート (interview_records) ベース
      --   NR='FAX受電' AND (NQ=0 (空欄含まない) OR (NQ空欄 AND NM日≦今日-1ヶ月))
      COALESCE(ir.rejects, 0)                                         AS rejects,
      COALESCE(jp.cancels, 0)                                         AS cancels,
      COALESCE(sp.first_payment, 0)                                   AS first_payment,
      COALESCE(sp.expected_revenue, 0)                                AS expected_revenue,
      ROUND(COALESCE(sp.first_payment, 0)
            / NULLIF(${inHouseCostExpr} + COALESCE(out_.outsourced_cost, 0), 0) * 100, 2)
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
        UNION
        SELECT DATE_FORMAT(acquired_date, '%Y-%m-01')         AS month FROM job_postings
         WHERE acquired_date IS NOT NULL AND source_kind = 'FAX受電'
        UNION
        SELECT DATE_FORMAT(send_date, '%Y-%m-01')             AS month FROM incoming_call_reports
         WHERE send_date IS NOT NULL
      ) u WHERE month IS NOT NULL
    ) m
    LEFT JOIN (
      SELECT DATE_FORMAT(period_date, '%Y-%m-01') AS month,
        SUM(cost) AS cost,
        SUM(reject_count) AS rejects
      FROM performance_records GROUP BY 1
    ) pr ON pr.month = m.month
    LEFT JOIN cpa_monthly_costs cmc ON cmc.month = m.month
    LEFT JOIN (
      -- 面接数: 面接した会社数 (同一求人は1社カウント) を 求人番号 で集計
      --   ① interview_records (FAX受電 / NM≦today / 面接人数0&合格0 除外)
      --   ② sales_projects.offers (内定はあるが面接記録に無い企業も加算)
      --   どちらの行も 求人番号 (job_number) で同一企業を判定。UNION で月×job_key を dedupe
      SELECT month, COUNT(DISTINCT job_key) AS interviews
      FROM (
        SELECT DATE_FORMAT(${ivCol}, '%Y-%m-01') AS month,
               COALESCE(NULLIF(job_number, ''), company_name) AS job_key
        FROM interview_records
        WHERE ${ivCol} IS NOT NULL
          AND source_kind = 'FAX受電'
          AND interview_date <= CURDATE()
          AND NOT (interview_count = 0 AND (pass_count = 0 OR pass_count IS NULL))
        UNION
        SELECT DATE_FORMAT(${col}, '%Y-%m-01') AS month,
               COALESCE(NULLIF(job_number, ''), company_name) AS job_key
        FROM sales_projects
        WHERE ${col} IS NOT NULL
      ) u
      WHERE month IS NOT NULL AND job_key IS NOT NULL
      GROUP BY month
    ) iv ON iv.month = m.month
    LEFT JOIN (
      -- 不合格: 不合格となった会社数 (同一求人は1社カウント、面接数と同じ COUNT(DISTINCT) ロジック)
      -- 条件: NR=FAX受電 AND (NQ=0 (空欄含まない) OR (NQ空欄 AND NM≦今日-1ヶ月))
      -- 同じノイズ行(面接人数0&合格0)は除外
      SELECT DATE_FORMAT(${ivCol}, '%Y-%m-01') AS month,
        COUNT(DISTINCT COALESCE(NULLIF(job_number, ''), company_name)) AS rejects
      FROM interview_records
      WHERE ${ivCol} IS NOT NULL
        AND source_kind = 'FAX受電'
        AND interview_date <= CURDATE()
        AND NOT (interview_count = 0 AND (pass_count = 0 OR pass_count IS NULL))
        AND (
          pass_count = 0
          OR (pass_count IS NULL AND interview_date <= DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
        )
      GROUP BY 1
    ) ir ON ir.month = m.month
    LEFT JOIN (
      SELECT DATE_FORMAT(stat_date, '%Y-%m-01') AS month, SUM(sent_count) AS sends
      FROM fax_send_stats GROUP BY 1
    ) fs ON fs.month = m.month
    LEFT JOIN (
      -- 受電数 の暫定計算: incoming_call_reports を send_date 月で COUNT
      -- TODO: 正式な算出方法が決まり次第このサブクエリの WHERE/集計を差し替える
      SELECT DATE_FORMAT(send_date, '%Y-%m-01') AS month, COUNT(*) AS incoming_calls
      FROM incoming_call_reports
      WHERE send_date IS NOT NULL
      GROUP BY 1
    ) ic ON ic.month = m.month
    LEFT JOIN (
      SELECT DATE_FORMAT(report_month, '%Y-%m-01') AS month,
        SUM(send_count) AS outsourced_sends, SUM(cost) AS outsourced_cost
      FROM outsourced_fax_records GROUP BY 1
    ) out_ ON out_.month = m.month
    LEFT JOIN (
      SELECT DATE_FORMAT(${col}, '%Y-%m-01') AS month,
        COUNT(DISTINCT COALESCE(NULLIF(job_number, ''), company_name)) AS offers,
        SUM(first_payment) AS first_payment,
        SUM(expected_revenue) AS expected_revenue
      FROM sales_projects WHERE ${col} IS NOT NULL
      GROUP BY 1
    ) sp ON sp.month = m.month
    LEFT JOIN (
      SELECT DATE_FORMAT(acquired_date, '%Y-%m-01') AS month,
        COUNT(*) AS projects,                                    -- 案件数 (求人情報シート)
        SUM(CASE WHEN is_cancelled = 1 THEN 1 ELSE 0 END) AS cancels  -- バラシ (AI='バラシ')
      FROM job_postings
      WHERE acquired_date IS NOT NULL AND source_kind = 'FAX受電'
      GROUP BY 1
    ) jp ON jp.month = m.month
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

// ============================================================
// 月別 確定版コスト (cpa_monthly_costs テーブル) の CRUD
// ============================================================

const MONTH_RE = /^\d{4}-\d{2}-01$/;
function assertMonth(month) {
  if (!MONTH_RE.test(month)) {
    const err = new Error(`month は YYYY-MM-01 形式で指定してください (got: ${month})`);
    err.status = 400; err.code = 'INVALID_MONTH';
    throw err;
  }
}

async function getMonthlyCost(month) {
  assertMonth(month);
  const pool = getPool();
  if (!pool) return null;
  await ensureMonthlyCostsTable();
  const [rows] = await pool.query(
    `SELECT month, in_house_cost, memo, updated_at FROM cpa_monthly_costs WHERE month = ?`,
    [month]
  );
  return rows[0] || null;
}

async function setMonthlyCost(month, { in_house_cost, memo }) {
  assertMonth(month);
  const cost = Number(in_house_cost);
  if (!Number.isFinite(cost) || cost < 0) {
    const err = new Error(`in_house_cost は 0 以上の数値`); err.status = 400; throw err;
  }
  const pool = getPool();
  if (!pool) { const err = new Error('DB未設定'); err.status = 500; throw err; }
  await ensureMonthlyCostsTable();
  await pool.query(
    `INSERT INTO cpa_monthly_costs (month, in_house_cost, memo)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       in_house_cost = VALUES(in_house_cost),
       memo = VALUES(memo)`,
    [month, Math.round(cost), memo || null]
  );
  return getMonthlyCost(month);
}

async function deleteMonthlyCost(month) {
  assertMonth(month);
  const pool = getPool();
  if (!pool) return false;
  await ensureMonthlyCostsTable();
  const [r] = await pool.query(`DELETE FROM cpa_monthly_costs WHERE month = ?`, [month]);
  return r.affectedRows > 0;
}

async function listMonthlyCosts() {
  const pool = getPool();
  if (!pool) return [];
  await ensureMonthlyCostsTable();
  const [rows] = await pool.query(
    `SELECT month, in_house_cost, memo, updated_at FROM cpa_monthly_costs ORDER BY month DESC`
  );
  return rows;
}

module.exports = {
  getMonthly, listDetail, importCsv,
  getCostPerFax,
  getMonthlyCost, setMonthlyCost, deleteMonthlyCost, listMonthlyCosts,
};
