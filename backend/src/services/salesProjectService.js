/**
 * 案件マスタ(sales_projects)サービス
 *   - シート『ビザ申請 進捗』から内定案件を取り込む
 *   - 抽出条件: BE列「FAX受電」 AND J列「ビザ」以外
 *   - 列マッピング:
 *       A:  内定日 (offer_date)
 *       B:  求人番号 (job_number)
 *       E:  営業担当者 (sales_owner)
 *       G:  内定者の登録番号 (candidate_registration_no)
 *       J:  ステータス (取消/辞退/ビザ/その他)
 *       BD: 会社名 (company_name)
 *       BE: 案件区分 (FAX受電 / その他)
 *       BI: 初回入金 (raw × 10000 で円)、 取消/辞退は 0
 *       BJ: 見込売上 (raw × 10000 で円)、 取消/辞退は 0
 *       BK: 案件取得日 (acquired_date、 CPA月集計の基準)
 *       CC: 入金実績 (raw × 10000 で円?)
 *       CF: 業種
 */
const fs = require('fs');
const { getPool, isConfigured } = require('../../config/db');

// 列名 → 0始まりインデックス
function colIndex(letter) {
  let n = 0;
  for (const ch of letter.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}

const COL = {
  A:  colIndex('A'),   // 0  内定日
  B:  colIndex('B'),   // 1  求人番号
  E:  colIndex('E'),   // 4  営業担当者
  G:  colIndex('G'),   // 6  登録番号
  J:  colIndex('J'),   // 9  ステータス
  BD: colIndex('BD'),  // 55 会社名
  BE: colIndex('BE'),  // 56 案件区分
  BI: colIndex('BI'),  // 60 初回入金
  BJ: colIndex('BJ'),  // 61 見込売上
  BK: colIndex('BK'),  // 62 案件取得日
  CC: colIndex('CC'),  // 80 入金実績
  CF: colIndex('CF'),  // 83 業種
};

/**
 * Excel/Google Sheets シリアル日付 → YYYY-MM-DD
 * (1899-12-30 を 0 日目とする標準仕様。faxStatsService の同名関数と同等)
 */
function excelSerialToYMD(serial) {
  const n = Math.floor(Number(serial));
  if (!Number.isFinite(n) || n <= 0) return null;
  const baseUtcMs = Date.UTC(1899, 11, 30);
  const ms = baseUtcMs + n * 86400000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateCell(v) {
  if (v === undefined || v === null || v === '') return null;
  // 1) 数値(Excel/Sheets シリアル) → 直接変換
  if (typeof v === 'number' && v > 25569 && v < 80000) {
    return excelSerialToYMD(v);
  }
  const s = String(v).trim();
  if (!s) return null;
  // 数字だけ(serial を String 化したもの)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 25569 && n < 80000) return excelSerialToYMD(n);
  }
  // 2) YYYY/M/D / YYYY-M-D / YYYY年M月D日
  let m = s.match(/^(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  // 3) M/D/YYYY (米国表記)
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  // 4) M/D (年なし → 今年扱い)
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const y = new Date().getFullYear();
    return `${y}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  }
  return null;
}

// 数値セル: 22.0 → 220000 のように ×10000 して円に
function parseMoneyTimes10000(v) {
  if (v === undefined || v === null || v === '') return 0;
  const cleaned = String(v).replace(/[¥,\s円]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000);
}

function parseInteger(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function clean(s) {
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  return t || null;
}

/**
 * シートrows → 案件レコード配列に変換
 *   rows[0] はヘッダーとして無視
 */
function parseProjectsSheet(values) {
  const projects = [];
  const stats = { totalRows: 0, kept: 0, skippedNotFax: 0, skippedVisa: 0, skippedNoKey: 0 };

  for (let r = 1; r < values.length; r++) {
    const row = values[r] || [];
    stats.totalRows++;

    const beVal = clean(row[COL.BE]);
    const jVal  = clean(row[COL.J]);

    // 条件1: BE = 「FAX受電」
    if (beVal !== 'FAX受電') { stats.skippedNotFax++; continue; }
    // 条件2: J ≠ 「ビザ」
    if (jVal === 'ビザ') { stats.skippedVisa++; continue; }

    // 一意キー: 求人番号 + 登録番号、 どちらも無ければ 行番号
    const jobNumber = clean(row[COL.B]);
    const candidateNo = clean(row[COL.G]);
    let externalKey;
    if (jobNumber && candidateNo) externalKey = `${jobNumber}_${candidateNo}`;
    else if (jobNumber) externalKey = jobNumber;
    else if (candidateNo) externalKey = candidateNo;
    else { stats.skippedNoKey++; continue; }

    // 取消/辞退の場合は金額0
    const isCancelled = jVal === '取消';
    const isDeclined = jVal === '辞退';
    const zeroMoney = isCancelled || isDeclined;

    projects.push({
      external_key: externalKey,
      offer_date: parseDateCell(row[COL.A]),
      acquired_date: parseDateCell(row[COL.BK]),
      job_number: jobNumber,
      company_name: clean(row[COL.BD]),
      candidate_registration_no: candidateNo,
      sales_owner: clean(row[COL.E]),
      industry: clean(row[COL.CF]),
      first_payment: zeroMoney ? 0 : parseMoneyTimes10000(row[COL.BI]),
      expected_revenue: zeroMoney ? 0 : parseMoneyTimes10000(row[COL.BJ]),
      payment_actual: parseMoneyTimes10000(row[COL.CC]),
      status_label: jVal,
      is_cancelled: isCancelled ? 1 : 0,
      is_declined: isDeclined ? 1 : 0,
      source_row: r + 1,  // 1-based 行番号
    });
    stats.kept++;
  }
  return { projects, stats };
}

async function upsertProjects(projects) {
  if (!isConfigured()) {
    const err = new Error('DBが未設定です'); err.status = 500; err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  if (!projects.length) return { inserted: 0, updated: 0 };

  const pool = getPool();
  const conn = await pool.getConnection();
  let inserted = 0, updated = 0;
  try {
    for (const p of projects) {
      const [result] = await conn.query(
        `INSERT INTO sales_projects (
          external_key, offer_date, acquired_date, job_number, company_name,
          candidate_registration_no, sales_owner, industry,
          first_payment, expected_revenue, payment_actual,
          status_label, is_cancelled, is_declined,
          source_row, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          offer_date = VALUES(offer_date),
          acquired_date = VALUES(acquired_date),
          job_number = VALUES(job_number),
          company_name = VALUES(company_name),
          candidate_registration_no = VALUES(candidate_registration_no),
          sales_owner = VALUES(sales_owner),
          industry = VALUES(industry),
          first_payment = VALUES(first_payment),
          expected_revenue = VALUES(expected_revenue),
          payment_actual = VALUES(payment_actual),
          status_label = VALUES(status_label),
          is_cancelled = VALUES(is_cancelled),
          is_declined = VALUES(is_declined),
          source_row = VALUES(source_row),
          synced_at = NOW()`,
        [
          p.external_key, p.offer_date, p.acquired_date, p.job_number, p.company_name,
          p.candidate_registration_no, p.sales_owner, p.industry,
          p.first_payment, p.expected_revenue, p.payment_actual,
          p.status_label, p.is_cancelled, p.is_declined,
          p.source_row,
        ]
      );
      if (result.affectedRows === 1) inserted++;
      else if (result.affectedRows >= 2) updated++;
    }
  } finally {
    conn.release();
  }
  return { inserted, updated };
}

async function getConfig() {
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.query(
    `SELECT projects_sheet_id, projects_sheet_name, projects_sheet_range,
            projects_last_synced_at, projects_last_sync_status, projects_last_sync_message
       FROM sheets_config WHERE id = 1 LIMIT 1`
  );
  return rows[0] || null;
}

async function updateConfig({ projects_sheet_id, projects_sheet_name, projects_sheet_range }) {
  const pool = getPool();
  if (!pool) throw new Error('DB未設定');
  await pool.query(
    `INSERT INTO sheets_config (id, projects_sheet_id, projects_sheet_name, projects_sheet_range)
     VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       projects_sheet_id   = VALUES(projects_sheet_id),
       projects_sheet_name = VALUES(projects_sheet_name),
       projects_sheet_range = VALUES(projects_sheet_range)`,
    [
      projects_sheet_id || null,
      projects_sheet_name || 'ビザ申請 進捗',
      projects_sheet_range || 'A1:CZ5000',
    ]
  );
  return getConfig();
}

async function markSync(status, message) {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `UPDATE sheets_config SET
       projects_last_synced_at = NOW(),
       projects_last_sync_status = ?,
       projects_last_sync_message = ?
     WHERE id = 1`,
    [status, message || null]
  );
}

async function syncFromSheets() {
  const cfg = await getConfig();
  if (!cfg?.projects_sheet_id) {
    const err = new Error('案件シートIDが未設定です。設定画面で登録してください');
    err.status = 400; err.code = 'NO_SHEET_ID';
    throw err;
  }
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath || !fs.existsSync(keyPath)) {
    const err = new Error('GOOGLE_SERVICE_ACCOUNT_KEY_PATH が未設定');
    err.status = 400; err.code = 'NO_SA_KEY';
    throw err;
  }

  let google;
  try { google = require('googleapis').google; }
  catch (_e) {
    const err = new Error('googleapis モジュール未インストール');
    err.status = 500; err.code = 'GOOGLEAPIS_MISSING';
    throw err;
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const sheetName = cfg.projects_sheet_name || 'ビザ申請 進捗';
  const rangePart = cfg.projects_sheet_range || 'A1:CZ5000';
  // 'シート名'!A1:CZ5000 の形 (日本語シート名はシングルクォートで囲む)
  const range = `'${sheetName}'!${rangePart}`;

  // UNFORMATTED_VALUE で取得 → 日付セルは Excel シリアル値で返るため
  // 「セル表示形式が "M/D" で年が見えない」問題を回避できる
  // 文字列セル(会社名・ステータス等) はそのまま文字列で返る
  let values;
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: cfg.projects_sheet_id,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    });
    values = resp.data.values || [];
  } catch (e) {
    await markSync('error', e.message);
    const err = new Error(`Sheets取得失敗: ${e.message}`);
    err.status = 502; err.code = 'SHEETS_FETCH_FAILED';
    throw err;
  }

  if (values.length < 2) {
    await markSync('error', 'シートが空、またはヘッダーのみ');
    return { totalRows: 0, kept: 0, inserted: 0, updated: 0 };
  }

  const { projects, stats } = parseProjectsSheet(values);
  const upsertResult = await upsertProjects(projects);
  const msg = `keep=${stats.kept} (notFax=${stats.skippedNotFax}, visa=${stats.skippedVisa}, noKey=${stats.skippedNoKey}) / inserted=${upsertResult.inserted}, updated=${upsertResult.updated}`;
  await markSync('ok', msg);
  return { ...stats, ...upsertResult };
}

/**
 * 案件一覧取得
 * @param {object} opts
 *   from, to         : 範囲 (YYYY-MM-DD)。 basis に応じて acquired_date / offer_date を判定列に使う
 *   month            : YYYY-MM-01 を指定すると、その月初〜翌月初未満 にショートカット
 *   basis            : 'acquired' (既定、 BK列) / 'offer' (A列)
 *   status           : 'active' = 取消/辞退を除外、 'all' = 全件、 'cancelled' = 取消のみ など
 *   limit            : 既定 200、最大 1000
 */
async function list({ from, to, month, basis = 'acquired', status, limit = 200 } = {}) {
  const pool = getPool();
  if (!pool) return [];
  const dateCol = basis === 'offer' ? 'offer_date' : 'acquired_date';
  const where = [];
  const params = [];

  if (month) {
    // YYYY-MM-01 → 当月初 <= dateCol < 翌月初
    where.push(`${dateCol} >= ?`);
    params.push(month);
    where.push(`${dateCol} < DATE_ADD(?, INTERVAL 1 MONTH)`);
    params.push(month);
  } else {
    if (from) { where.push(`${dateCol} >= ?`); params.push(from); }
    if (to)   { where.push(`${dateCol} <= ?`); params.push(to); }
  }

  if (status === 'active') {
    where.push('is_cancelled = 0 AND is_declined = 0');
  } else if (status === 'cancelled') {
    where.push('is_cancelled = 1');
  } else if (status === 'declined') {
    where.push('is_declined = 1');
  }
  // status === 'all' or undefined → 全件 (取消/辞退含む)

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows] = await pool.query(
    `SELECT
       id, external_key, offer_date, acquired_date, job_number, company_name,
       candidate_registration_no, sales_owner, industry,
       first_payment, expected_revenue, payment_actual,
       status_label, is_cancelled, is_declined, source_row
     FROM sales_projects ${whereSql}
     ORDER BY
       COALESCE(NULLIF(job_number, ''), company_name) ASC,  -- 同一求人を隣り合わせる
       ${dateCol} DESC,
       id DESC
     LIMIT ?`,
    [...params, Math.min(Number(limit) || 200, 1000)]
  );
  return rows;
}

module.exports = {
  parseProjectsSheet, upsertProjects, syncFromSheets, list,
  getConfig, updateConfig,
  COL, colIndex,
};
