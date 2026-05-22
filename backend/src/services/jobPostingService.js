/**
 * 求人情報(job_postings)サービス
 *   - シート『求人情報』から行を取り込む
 *   - 抽出条件: H列='FAX受電'  (AI='バラシ' は除外せず is_cancelled で記録)
 *   - 月キーは AJ列(案件獲得日)
 *   - 列マッピング:
 *       B (1):  営業担当 (例 「寺西 T」 → サフィックス英字を除去 → 「寺西」)
 *       C (2):  求人番号
 *       D (3):  会社名
 *       H (7):  案件区分 (FAX受電 のみ採用)
 *       I (8):  業種
 *       AI (34): バラシフラグ (値='バラシ' なら is_cancelled=1)
 *       AJ (35): 案件獲得日 (月キー)
 */
const fs = require('fs');
const { getPool, isConfigured } = require('../../config/db');

function colIndex(letter) {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const COL = {
  B:  colIndex('B'),   // 1  営業担当
  C:  colIndex('C'),   // 2  求人番号
  D:  colIndex('D'),   // 3  会社名
  H:  colIndex('H'),   // 7  案件区分
  I:  colIndex('I'),   // 8  業種
  AI: colIndex('AI'),  // 34 バラシ
  AJ: colIndex('AJ'),  // 35 案件獲得日
};

function excelSerialToYMD(serial) {
  const n = Math.floor(Number(serial));
  if (!Number.isFinite(n) || n <= 0) return null;
  const baseUtcMs = Date.UTC(1899, 11, 30);
  const ms = baseUtcMs + n * 86400000;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function parseDateCell(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number' && v > 25569 && v < 80000) return excelSerialToYMD(v);
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 25569 && n < 80000) return excelSerialToYMD(n);
  }
  let m = s.match(/^(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) return `${new Date().getFullYear()}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  return null;
}

function clean(s) {
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  return t || null;
}

// 営業担当の末尾アルファベット+スペースを除去 (例 「寺西 T」 → 「寺西」)
//   全角スペース・半角スペース両方に対応
function cleanSalesOwner(raw) {
  const t = clean(raw);
  if (!t) return null;
  return t.replace(/[\s　]+[A-Za-z]+\s*$/, '').trim() || null;
}

/**
 * シート rows → 求人レコード配列
 *   rows[0] はヘッダーとして無視
 *   抽出: H='FAX受電'
 */
function parseJobPostingsSheet(values) {
  const records = [];
  const stats = { totalRows: 0, kept: 0, skippedNotFax: 0, skippedNoKey: 0, cancelledCount: 0 };

  for (let r = 1; r < values.length; r++) {
    const row = values[r] || [];
    stats.totalRows++;

    const h = clean(row[COL.H]);
    if (h !== 'FAX受電') { stats.skippedNotFax++; continue; }

    const jobNumber = clean(row[COL.C]);
    const companyName = clean(row[COL.D]);
    let externalKey;
    if (jobNumber) externalKey = jobNumber;
    else if (companyName) externalKey = `${companyName}__r${r + 1}`;
    else { stats.skippedNoKey++; continue; }
    // 同一求人番号の重複行を許容するため row 番号も付与
    if (jobNumber) externalKey = `${jobNumber}__r${r + 1}`;

    const aiVal = clean(row[COL.AI]);
    const isCancelled = aiVal === 'バラシ' ? 1 : 0;
    if (isCancelled) stats.cancelledCount++;

    records.push({
      external_key: externalKey,
      acquired_date: parseDateCell(row[COL.AJ]),
      job_number: jobNumber,
      company_name: companyName,
      sales_owner: cleanSalesOwner(row[COL.B]),
      industry: clean(row[COL.I]),
      source_kind: h,
      status_label: aiVal,
      is_cancelled: isCancelled,
      source_row: r + 1,
    });
    stats.kept++;
  }
  return { records, stats };
}

async function upsertRecords(records) {
  if (!isConfigured()) {
    const err = new Error('DBが未設定です'); err.status = 500; throw err;
  }
  if (!records.length) return { inserted: 0, updated: 0 };
  const pool = getPool();
  const conn = await pool.getConnection();
  let inserted = 0, updated = 0;
  try {
    for (const r of records) {
      const [result] = await conn.query(
        `INSERT INTO job_postings (
          external_key, acquired_date, job_number, company_name,
          sales_owner, industry, source_kind, status_label, is_cancelled, source_row, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          acquired_date = VALUES(acquired_date),
          job_number = VALUES(job_number),
          company_name = VALUES(company_name),
          sales_owner = VALUES(sales_owner),
          industry = VALUES(industry),
          source_kind = VALUES(source_kind),
          status_label = VALUES(status_label),
          is_cancelled = VALUES(is_cancelled),
          source_row = VALUES(source_row),
          synced_at = NOW()`,
        [
          r.external_key, r.acquired_date, r.job_number, r.company_name,
          r.sales_owner, r.industry, r.source_kind, r.status_label, r.is_cancelled, r.source_row,
        ]
      );
      if (result.affectedRows === 1) inserted++;
      else if (result.affectedRows >= 2) updated++;
    }
  } finally { conn.release(); }
  return { inserted, updated };
}

async function getConfig() {
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.query(
    `SELECT jobs_sheet_id, jobs_sheet_name, jobs_sheet_range,
            jobs_last_synced_at, jobs_last_sync_status, jobs_last_sync_message
       FROM sheets_config WHERE id = 1 LIMIT 1`
  );
  return rows[0] || null;
}

async function updateConfig({ jobs_sheet_id, jobs_sheet_name, jobs_sheet_range }) {
  const pool = getPool();
  if (!pool) throw new Error('DB未設定');
  await pool.query(
    `INSERT INTO sheets_config (id, jobs_sheet_id, jobs_sheet_name, jobs_sheet_range)
     VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       jobs_sheet_id   = VALUES(jobs_sheet_id),
       jobs_sheet_name = VALUES(jobs_sheet_name),
       jobs_sheet_range = VALUES(jobs_sheet_range)`,
    [jobs_sheet_id || null, jobs_sheet_name || '求人情報', jobs_sheet_range || 'A1:BZ20000']
  );
  return getConfig();
}

async function markSync(status, message) {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `UPDATE sheets_config SET
       jobs_last_synced_at = NOW(),
       jobs_last_sync_status = ?,
       jobs_last_sync_message = ?
     WHERE id = 1`,
    [status, message || null]
  );
}

async function syncFromSheets() {
  const cfg = await getConfig();
  if (!cfg?.jobs_sheet_id) {
    const err = new Error('求人情報シートIDが未設定です。 設定画面で登録してください');
    err.status = 400; err.code = 'NO_SHEET_ID'; throw err;
  }
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath || !fs.existsSync(keyPath)) {
    const err = new Error('GOOGLE_SERVICE_ACCOUNT_KEY_PATH が未設定');
    err.status = 400; throw err;
  }
  let google;
  try { google = require('googleapis').google; }
  catch (_e) {
    const err = new Error('googleapis モジュール未インストール');
    err.status = 500; throw err;
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const sheetName = cfg.jobs_sheet_name || '求人情報';
  const rangePart = cfg.jobs_sheet_range || 'A1:BZ20000';
  const range = `'${sheetName}'!${rangePart}`;

  let values;
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: cfg.jobs_sheet_id,
      range,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    });
    values = resp.data.values || [];
  } catch (e) {
    await markSync('error', e.message);
    const err = new Error(`Sheets取得失敗: ${e.message}`);
    err.status = 502; throw err;
  }

  if (values.length < 2) {
    await markSync('error', 'シートが空、またはヘッダーのみ');
    return { totalRows: 0, kept: 0, inserted: 0, updated: 0 };
  }

  const { records, stats } = parseJobPostingsSheet(values);
  const upsertResult = await upsertRecords(records);
  const msg = `keep=${stats.kept} (notFax=${stats.skippedNotFax}, noKey=${stats.skippedNoKey}, バラシ=${stats.cancelledCount}) / inserted=${upsertResult.inserted}, updated=${upsertResult.updated}`;
  await markSync('ok', msg);
  return { ...stats, ...upsertResult };
}

/**
 * 月別の求人一覧
 *   month=YYYY-MM-01
 *   filter: 'all' (既定) | 'cancelled' (バラシのみ)
 */
async function list({ month, filter, limit = 2000 } = {}) {
  const pool = getPool();
  if (!pool) return [];
  const where = [`source_kind = 'FAX受電'`];
  const params = [];
  if (month) {
    where.push(`acquired_date >= ?`); params.push(month);
    where.push(`acquired_date < DATE_ADD(?, INTERVAL 1 MONTH)`); params.push(month);
  }
  if (filter === 'cancelled') where.push(`is_cancelled = 1`);
  const whereSql = 'WHERE ' + where.join(' AND ');
  const [rows] = await pool.query(
    `SELECT
       id, external_key, acquired_date, job_number, company_name, sales_owner,
       industry, source_kind, status_label, is_cancelled, source_row
     FROM job_postings ${whereSql}
     ORDER BY
       COALESCE(NULLIF(job_number, ''), company_name) ASC,
       acquired_date DESC, id DESC
     LIMIT ?`,
    [...params, Math.min(Number(limit) || 2000, 10000)]
  );
  return rows;
}

module.exports = {
  parseJobPostingsSheet, upsertRecords, syncFromSheets, list,
  getConfig, updateConfig, cleanSalesOwner,
  COL, colIndex,
};
