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

/**
 * 面接記録を シート → DB に全リフレッシュ で同期する。
 *   旧実装は external_key に __r${row} (シート行番号) を含む UPSERT だったため、
 *   シートに行が追加/削除されると同じ論理レコードに違う external_key が発行され、
 *   ON DUPLICATE KEY UPDATE が効かず INSERT が累積していた (= 不合格件数が
 *   実際より過大になる原因)。
 *   シートが唯一の真実源なので、source_kind='FAX受電' の行を一旦全削除して
 *   渡された records だけを INSERT する。 全体を トランザクション で囲む。
 */
// 起動時 migration が走っていない環境向けに、 ここでも 1 度 schema を確認して
// pass_count が NOT NULL のままなら NULL 許容に ALTER する (冪等)。
async function ensureSchemaUpToDate(conn) {
  const [rows] = await conn.query(
    `SELECT IS_NULLABLE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'interview_records'
        AND COLUMN_NAME = 'pass_count'`
  );
  if (rows.length && rows[0].IS_NULLABLE === 'NO') {
    console.log('[interview.sync] pass_count を NULL 許容化します (ALTER 実行)');
    await conn.query(
      `ALTER TABLE interview_records
         MODIFY COLUMN pass_count INT DEFAULT NULL
           COMMENT 'NQ列: 合格者数 (NULL=空欄 / 0=明示ゼロ)'`
    );
  }
}

async function upsertRecords(records) {
  if (!isConfigured()) {
    const err = new Error('DBが未設定です'); err.status = 500; throw err;
  }
  const pool = getPool();
  const conn = await pool.getConnection();
  let inserted = 0, deleted = 0;
  try {
    // ① スキーマ確認 (pass_count NULL 許容に保証)
    await ensureSchemaUpToDate(conn);

    await conn.beginTransaction();

    // 既存 'FAX受電' レコードを全削除 (フルリフレッシュ)
    const [delResult] = await conn.query(
      `DELETE FROM interview_records WHERE source_kind = 'FAX受電'`
    );
    deleted = delResult.affectedRows || 0;

    // 新規 INSERT (チャンク 500件ずつ)
    if (records.length) {
      const CHUNK = 500;
      const cols = [
        'external_key', 'interview_date', 'acquired_date', 'job_number', 'company_name',
        'sales_owner', 'industry', 'interview_count', 'pass_count', 'source_kind', 'source_row',
        'synced_at',
      ];
      const colList = cols.join(',');
      const now = new Date();
      for (let i = 0; i < records.length; i += CHUNK) {
        const slice = records.slice(i, i + CHUNK);
        const placeholders = slice.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
        const values = [];
        for (const r of slice) {
          values.push(
            r.external_key, r.interview_date, r.acquired_date, r.job_number, r.company_name,
            r.sales_owner, r.industry, r.interview_count, r.pass_count, r.source_kind, r.source_row,
            now
          );
        }
        await conn.query(
          `INSERT INTO interview_records (${colList}) VALUES ${placeholders}`,
          values
        );
        inserted += slice.length;
      }
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally { conn.release(); }
  return { inserted, deleted, updated: 0 };  // updated は互換のため 0 で残す
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
  const msg = `keep=${stats.kept} (notFax=${stats.skippedNotFax}, futureOrNoDate=${stats.skippedFutureOrNoDate}, noKey=${stats.skippedNoKey}) / 削除=${upsertResult.deleted}, 投入=${upsertResult.inserted} (全リフレッシュ)`;
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
  // CPA 表 (面接数/不合格) と同じく、面接人数=0 AND 合格者数=0/空欄 のプレースホルダ行は除外
  where.push(`NOT (interview_count = 0 AND (pass_count = 0 OR pass_count IS NULL))`);
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

/**
 * 面接数 UNION の "内定のみ" 加算分を取得
 *   sales_projects に offer があるが、 同月の interview_records (面接条件を満たす行) に
 *   同じ 求人番号(or 企業名) が存在しないレコードを返す。
 *   CPA 表 の 面接数 が UNION で加算しているのと整合させるための モーダル表示用。
 *
 *   重要: sales_projects は同一 求人番号 に複数行 (内定者ごとに行を持つ等) があり得るため
 *   ROW_NUMBER() で 求人番号 ごとに 1 行 (= 最新内定日の行) に絞ってから返す。
 *   これで CPA の 面接数 UNION 社数 と モーダル表示 行数 が一致する。
 */
async function listOfferOnly({ month, basis = 'acquired', limit = 1000 } = {}) {
  const pool = getPool();
  if (!pool || !month) return [];
  const col   = basis === 'offer' ? 'offer_date'     : 'acquired_date';   // sales_projects 側
  const ivCol = basis === 'offer' ? 'interview_date' : 'acquired_date';   // interview_records 側
  const [rows] = await pool.query(
    `SELECT id, acquired_date, offer_date, job_number, company_name,
            sales_owner, industry, first_payment, expected_revenue,
            status_label, is_cancelled, is_declined
       FROM (
         SELECT sp.*,
                ROW_NUMBER() OVER (
                  PARTITION BY COALESCE(NULLIF(sp.job_number, ''), sp.company_name)
                  ORDER BY sp.offer_date DESC, sp.id DESC
                ) AS rn
           FROM sales_projects sp
          WHERE sp.${col} IS NOT NULL
            AND sp.${col} >= ?
            AND sp.${col} < DATE_ADD(?, INTERVAL 1 MONTH)
            AND (sp.status_label IS NULL OR sp.status_label NOT LIKE '%ビザ%')
            AND NOT EXISTS (
              SELECT 1 FROM interview_records ir
              WHERE ir.${ivCol} IS NOT NULL
                AND ir.${ivCol} >= ? AND ir.${ivCol} < DATE_ADD(?, INTERVAL 1 MONTH)
                AND ir.source_kind = 'FAX受電'
                AND ir.interview_date <= CURDATE()
                AND NOT (ir.interview_count = 0 AND (ir.pass_count = 0 OR ir.pass_count IS NULL))
                AND COALESCE(NULLIF(ir.job_number, ''), ir.company_name)
                  = COALESCE(NULLIF(sp.job_number, ''), sp.company_name)
            )
       ) ranked
      WHERE rn = 1
      ORDER BY
        COALESCE(NULLIF(job_number, ''), company_name) ASC,
        ${col} DESC, id DESC
      LIMIT ?`,
    [month, month, month, month, Math.min(Number(limit) || 1000, 5000)]
  );
  return rows;
}

module.exports = {
  parseInterviewsSheet, upsertRecords, syncFromSheets, list, listOfferOnly,
  getConfig, updateConfig,
  COL, colIndex,
};
