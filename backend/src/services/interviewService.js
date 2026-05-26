/**
 * 面接記録(interview_records)サービス
 *   - シート『2024_面接内訳』から面接行を取り込む
 *   - 抽出条件: NR列「FAX受電」 AND NM列(面接日)<=今日
 *   - 列マッピング:
 *       NL: 営業担当 (sales_owner)
 *       NM: 面接日 (interview_date)
 *       NN: 求人番号 (job_number)
 *       NO: 企業名 (company_name)
 *       NP: 面接人数 (interview_count)
 *       NQ: 合格者数 (pass_count)
 *       NR: 案件区分 (source_kind) -- 'FAX受電' のみ採用
 *       NS: 案件獲得日 (acquired_date)
 *       NU: 業種 (industry)
 */
const fs = require('fs');
const { getPool, isConfigured } = require('../../config/db');

function colIndex(letter) {
  let n = 0;
  for (const ch of letter.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const COL = {
  NL: colIndex('NL'),   // 375 営業担当
  NM: colIndex('NM'),   // 376 面接日
  NN: colIndex('NN'),   // 377 求人番号
  NO: colIndex('NO'),   // 378 企業名
  NP: colIndex('NP'),   // 379 面接人数
  NQ: colIndex('NQ'),   // 380 合格者数
  NR: colIndex('NR'),   // 381 案件区分
  NS: colIndex('NS'),   // 382 案件獲得日
  NU: colIndex('NU'),   // 384 業種
};

// Excel/Sheets シリアル日付 → YYYY-MM-DD
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

function parseInt0(v) {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

// pass_count (NQ列) は 空欄 と 0 を区別する必要があるため
//   未入力/空文字 → null
//   数値          → 整数化
//   解釈不能      → null
function parseIntNullable(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function clean(s) {
  if (s === undefined || s === null) return null;
  const t = String(s).trim();
  return t || null;
}

/**
 * シート rows → 面接レコード配列
 *   rows[0] はヘッダーとして無視
 *   抽出: NR='FAX受電' AND NM<=今日
 */
function parseInterviewsSheet(values, opts = {}) {
  const today = opts.today || new Date();
  const todayYMD = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const records = [];
  const stats = { totalRows: 0, kept: 0, skippedNotFax: 0, skippedFutureOrNoDate: 0, skippedNoKey: 0 };

  for (let r = 1; r < values.length; r++) {
    const row = values[r] || [];
    stats.totalRows++;

    const nr = clean(row[COL.NR]);
    if (nr !== 'FAX受電') { stats.skippedNotFax++; continue; }

    const interviewDate = parseDateCell(row[COL.NM]);
    if (!interviewDate || interviewDate > todayYMD) { stats.skippedFutureOrNoDate++; continue; }

    const jobNumber = clean(row[COL.NN]);
    const companyName = clean(row[COL.NO]);
    // 一意キー: 求人番号 + 面接日 + source_row
    let externalKey;
    if (jobNumber) externalKey = `${jobNumber}__${interviewDate}__r${r + 1}`;
    else if (companyName) externalKey = `${companyName}__${interviewDate}__r${r + 1}`;
    else { stats.skippedNoKey++; continue; }

    records.push({
      external_key: externalKey,
      interview_date: interviewDate,
      acquired_date: parseDateCell(row[COL.NS]),
      job_number: jobNumber,
      company_name: companyName,
      sales_owner: clean(row[COL.NL]),
      industry: clean(row[COL.NU]),
      interview_count: parseInt0(row[COL.NP]),
      pass_count: parseIntNullable(row[COL.NQ]),
      source_kind: nr,
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
        `INSERT INTO interview_records (
          external_key, interview_date, acquired_date, job_number, company_name,
          sales_owner, industry, interview_count, pass_count, source_kind, source_row, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          interview_date = VALUES(interview_date),
          acquired_date = VALUES(acquired_date),
          job_number = VALUES(job_number),
          company_name = VALUES(company_name),
          sales_owner = VALUES(sales_owner),
          industry = VALUES(industry),
          interview_count = VALUES(interview_count),
          pass_count = VALUES(pass_count),
          source_kind = VALUES(source_kind),
          source_row = VALUES(source_row),
          synced_at = NOW()`,
        [
          r.external_key, r.interview_date, r.acquired_date, r.job_number, r.company_name,
          r.sales_owner, r.industry, r.interview_count, r.pass_count, r.source_kind, r.source_row,
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
    `SELECT interviews_sheet_id, interviews_sheet_name, interviews_sheet_range,
            interviews_last_synced_at, interviews_last_sync_status, interviews_last_sync_message
       FROM sheets_config WHERE id = 1 LIMIT 1`
  );
  return rows[0] || null;
}

async function updateConfig({ interviews_sheet_id, interviews_sheet_name, interviews_sheet_range }) {
  const pool = getPool();
  if (!pool) throw new Error('DB未設定');
  await pool.query(
    `INSERT INTO sheets_config (id, interviews_sheet_id, interviews_sheet_name, interviews_sheet_range)
     VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       interviews_sheet_id   = VALUES(interviews_sheet_id),
       interviews_sheet_name = VALUES(interviews_sheet_name),
       interviews_sheet_range = VALUES(interviews_sheet_range)`,
    [
      interviews_sheet_id || null,
      interviews_sheet_name || '2024_面接内訳',
      interviews_sheet_range || 'A1:OZ20000',
    ]
  );
  return getConfig();
}

async function markSync(status, message) {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `UPDATE sheets_config SET
       interviews_last_synced_at = NOW(),
       interviews_last_sync_status = ?,
       interviews_last_sync_message = ?
     WHERE id = 1`,
    [status, message || null]
  );
}

async function syncFromSheets() {
  const cfg = await getConfig();
  if (!cfg?.interviews_sheet_id) {
    const err = new Error('面接シートIDが未設定です。設定画面で登録してください');
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
    err.status = 500; throw err;
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const sheetName = cfg.interviews_sheet_name || '2024_面接内訳';
  const rangePart = cfg.interviews_sheet_range || 'A1:OZ20000';
  const range = `'${sheetName}'!${rangePart}`;

  let values;
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: cfg.interviews_sheet_id,
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

  const { records, stats } = parseInterviewsSheet(values);
  const upsertResult = await upsertRecords(records);
  const msg = `keep=${stats.kept} (notFax=${stats.skippedNotFax}, futureOrNoDate=${stats.skippedFutureOrNoDate}, noKey=${stats.skippedNoKey}) / inserted=${upsertResult.inserted}, updated=${upsertResult.updated}`;
  await markSync('ok', msg);
  return { ...stats, ...upsertResult };
}

/**
 * 面接一覧取得
 *   month=YYYY-MM-01, basis='acquired'|'offer'
 *   acquired → NS列(acquired_date) で月絞り
 *   offer    → NM列(interview_date) で月絞り
 *   kind:
 *     'all' (既定) → 面接が実施済の全行 (NR=FAX受電 AND 面接日≦今日)
 *     'rejects'    → 不合格判定: NQ=0 (空欄含まない) OR (NQ空欄 AND 面接日≦今日-1ヶ月)
 */
async function list({ month, basis = 'acquired', kind = 'all', limit = 1000 } = {}) {
  const pool = getPool();
  if (!pool) return [];
  const dateCol = basis === 'offer' ? 'interview_date' : 'acquired_date';
  const where = [`source_kind = 'FAX受電'`, `interview_date <= CURDATE()`];
  const params = [];
  if (month) {
    where.push(`${dateCol} >= ?`); params.push(month);
    where.push(`${dateCol} < DATE_ADD(?, INTERVAL 1 MONTH)`); params.push(month);
  }
  if (kind === 'rejects') {
    // ②NQ=0 (空欄含まない) OR ③NQ空欄 AND 面接日(NM)≦今日-1ヶ月
    where.push(`(
      pass_count = 0
      OR (pass_count IS NULL AND interview_date <= DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
    )`);
  }
  const whereSql = 'WHERE ' + where.join(' AND ');
  const [rows] = await pool.query(
    `SELECT
       id, external_key, interview_date, acquired_date, job_number, company_name,
       sales_owner, industry, interview_count, pass_count, source_kind, source_row
     FROM interview_records ${whereSql}
     ORDER BY
       COALESCE(NULLIF(job_number, ''), company_name) ASC,  -- 同一求人を隣り合わせる
       interview_date DESC,
       id DESC
     LIMIT ?`,
    [...params, Math.min(Number(limit) || 1000, 5000)]
  );
  return rows;
}

module.exports = {
  parseInterviewsSheet, upsertRecords, syncFromSheets, list,
  getConfig, updateConfig,
  COL, colIndex,
};
