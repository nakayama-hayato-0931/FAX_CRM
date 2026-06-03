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

/**
 * 同一 caller_number の通話に「2ヶ月クールダウン」を適用して count 対象を絞る。
 *   rows は { caller_number, date_time } を含み caller_number, date_time 昇順 で来る前提。
 *   仕様: 直近 count した通話日から 2ヶ月 (DATE_ADD INTERVAL 2 MONTH 相当) は カウントしない。
 *         次回 count 可能日 = (前回 count 日 + 2ヶ月)。 比較は >= 。
 *   例: 1/1 → count (cooldown終了 = 3/1)
 *       2/28 → 3/1 未満 → skip
 *       3/1  → 3/1 以上 → count (cooldown終了 = 5/1)
 *       4/1 → 5/1 未満 → skip
 *       5/1 → 5/1 以上 → count
 * 戻り値: { 'YYYY-MM-01': count, ... }
 */
function applyCooldownDedup(rows) {
  const monthCounts = {};
  let currentCaller = null;
  let cooldownEndMs = null;
  for (const r of rows) {
    if (r.caller_number !== currentCaller) {
      currentCaller = r.caller_number;
      cooldownEndMs = null;
    }
    const dt = r.date_time instanceof Date ? r.date_time : new Date(r.date_time);
    if (cooldownEndMs === null || dt.getTime() >= cooldownEndMs) {
      const monthKey =
        `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-01`;
      monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;
      const next = new Date(dt);
      next.setMonth(next.getMonth() + 2);
      cooldownEndMs = next.getTime();
    }
  }
  return monthCounts;
}

async function getZpPickedCountsByMonth(pool) {
  const [rows] = await pool.query(
    `SELECT caller_number, date_time
       FROM zp_recordings
      WHERE direction = '着信'
        AND REPLACE(callee_name, ' ', '') IN (
          'グーナビ0120FDM', 'グーナビFAX', 'グーナビ在庫速報',
          'グーナビ代表番号', '特定技能グーナビ'
        )
        AND caller_name REGEXP '^[0-9]+$'
        AND caller_number IS NOT NULL AND caller_number <> ''
        AND caller_number <> 'anonymous'
      ORDER BY caller_number, date_time`
  );
  return applyCooldownDedup(rows);
}

async function getZpMissedCountsByMonth(pool) {
  const [rows] = await pool.query(
    `SELECT caller_number, date_time
       FROM zp_missed_calls
      WHERE callee_number IN (
        '+81120743142', '+81120905389', '+81120961610',
        '+81120966791', '+81366941346', '+81366941311',
        '+81120549547'
      )
      AND (accepted_by_name IS NULL OR accepted_by_name = '')
      AND caller_number IS NOT NULL AND caller_number <> ''
      AND caller_number <> 'Anonymous'
      ORDER BY caller_number, date_time`
  );
  return applyCooldownDedup(rows);
}

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
  // 受電数 手動入力列 (NULL = 自動集計を使う / 数値 = 手動上書き)
  await ensureManualIncomingColumns(pool);
}

// cpa_monthly_costs に incoming_picked_manual / incoming_missed_manual を追加
let _manualIncomingEnsured = false;
async function ensureManualIncomingColumns(pool) {
  if (_manualIncomingEnsured) return;
  try {
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cpa_monthly_costs'
          AND COLUMN_NAME IN ('incoming_picked_manual', 'incoming_missed_manual')`
    );
    const have = new Set(cols.map((c) => c.COLUMN_NAME));
    if (!have.has('incoming_picked_manual')) {
      await pool.query(
        `ALTER TABLE cpa_monthly_costs
           ADD COLUMN incoming_picked_manual INT DEFAULT NULL
             COMMENT '受電数(受電) 手動入力 (NULL=自動集計)'`
      );
    }
    if (!have.has('incoming_missed_manual')) {
      await pool.query(
        `ALTER TABLE cpa_monthly_costs
           ADD COLUMN incoming_missed_manual INT DEFAULT NULL
             COMMENT '受電数(不在) 手動入力 (NULL=自動集計)'`
      );
    }
    _manualIncomingEnsured = true;
  } catch (e) {
    console.error('[cpaService] incoming manual 列 ensure 失敗:', e.message);
  }
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
      -- 受電数 (受電 + 不在) は JS 側で 2ヶ月クールダウン dedup を適用後に merge する。
      -- ここでは 0 で placeholder。 incoming_rate も同様に JS で計算し直す。
      -- ただし cmc.incoming_*_manual に手動入力があれば JS 側でそれを優先する。
      0                                                               AS incoming_picked,
      0                                                               AS incoming_missed,
      0                                                               AS incoming_calls,
      0                                                               AS incoming_rate,
      cmc.incoming_picked_manual                                      AS incoming_picked_manual,
      cmc.incoming_missed_manual                                      AS incoming_missed_manual,
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
        UNION
        SELECT DATE_FORMAT(date_time, '%Y-%m-01')             AS month FROM zp_recordings
         WHERE direction = '着信' AND date_time IS NOT NULL
        UNION
        SELECT DATE_FORMAT(date_time, '%Y-%m-01')             AS month FROM zp_missed_calls
         WHERE date_time IS NOT NULL
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
    -- (zp_recordings / zp_missed_calls は 2ヶ月クールダウン dedup が必要なため
    --  メインクエリから分離し、 JS 側 で applyCooldownDedup → 月別 merge する)
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

  // 受電 (zp_recordings) / 不在 (zp_missed_calls) の 2ヶ月クールダウン dedup を
  // JS 側で行い、 月別 count を rows に merge する。
  //   手動入力 (cmc.incoming_*_manual) があればそれを優先 (自動集計を上書き)
  let pickedByMonth = {};
  let missedByMonth = {};
  try {
    [pickedByMonth, missedByMonth] = await Promise.all([
      getZpPickedCountsByMonth(pool),
      getZpMissedCountsByMonth(pool),
    ]);
  } catch (e) {
    console.error('[cpaService] zp_* 受電集計 失敗:', e.message);
    // 失敗時は 自動集計 0 のまま (手動入力があればそれは効く)
  }
  for (const r of rows) {
    const mKey = (r.month instanceof Date)
      ? `${r.month.getFullYear()}-${String(r.month.getMonth() + 1).padStart(2, '0')}-01`
      : String(r.month).slice(0, 10);
    const autoPicked = pickedByMonth[mKey] || 0;
    const autoMissed = missedByMonth[mKey] || 0;
    // 手動入力 (NULL でなければ採用)
    const manualPicked = r.incoming_picked_manual;
    const manualMissed = r.incoming_missed_manual;
    const picked = manualPicked != null ? Number(manualPicked) : autoPicked;
    const missed = manualMissed != null ? Number(manualMissed) : autoMissed;
    r.incoming_picked = picked;
    r.incoming_missed = missed;
    r.incoming_calls = picked + missed;
    r.incoming_picked_is_manual = manualPicked != null ? 1 : 0;
    r.incoming_missed_is_manual = manualMissed != null ? 1 : 0;
    const denom = Number(r.sends || 0);
    r.incoming_rate = denom > 0
      ? Math.round((picked + missed) / denom * 10000) / 100
      : 0;
  }

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
    `SELECT month, in_house_cost, memo,
            incoming_picked_manual, incoming_missed_manual, updated_at
       FROM cpa_monthly_costs WHERE month = ?`,
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

/**
 * 受電数の月別 手動入力を設定。
 *   picked / missed それぞれ null を渡すと 「自動集計に戻す」 (列を NULL に)
 *   数値を渡すと 手動上書き
 */
async function setMonthlyIncoming(month, { incoming_picked_manual, incoming_missed_manual }) {
  assertMonth(month);
  const norm = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) {
      const err = new Error('受電数 は 0 以上の数値、 または空 (自動集計)'); err.status = 400; throw err;
    }
    return Math.round(n);
  };
  const picked = norm(incoming_picked_manual);
  const missed = norm(incoming_missed_manual);
  const pool = getPool();
  if (!pool) { const err = new Error('DB未設定'); err.status = 500; throw err; }
  await ensureMonthlyCostsTable();
  // 行が無いケースもあるので INSERT ... ON DUPLICATE。 in_house_cost は既存維持
  await pool.query(
    `INSERT INTO cpa_monthly_costs (month, in_house_cost, incoming_picked_manual, incoming_missed_manual)
     VALUES (?, 0, ?, ?)
     ON DUPLICATE KEY UPDATE
       incoming_picked_manual = VALUES(incoming_picked_manual),
       incoming_missed_manual = VALUES(incoming_missed_manual)`,
    [month, picked, missed]
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
  setMonthlyIncoming,
};
