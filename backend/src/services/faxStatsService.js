const fs = require('fs');
const csv = require('csv-parser');
const { getPool, isConfigured } = require('../../config/db');

const VALID_SOURCES = new Set(['sheets', 'csv', 'manual']);

// --------------------------------------------
// 集計
// --------------------------------------------
async function listStats({ from, to, pcNumber } = {}) {
  const pool = getPool();
  if (!pool) return [];
  const where = [];
  const params = [];
  if (from)     { where.push('stat_date >= ?'); params.push(from); }
  if (to)       { where.push('stat_date <= ?'); params.push(to); }
  if (pcNumber) { where.push('pc_number = ?');  params.push(pcNumber); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows] = await pool.query(
    `SELECT id, stat_date, pc_number, sent_count, success_count, error_count,
            busy_count, no_answer_count, invalid_count, source, synced_at
       FROM fax_send_stats
       ${whereSql}
       ORDER BY stat_date DESC, CAST(REGEXP_REPLACE(pc_number, '[^0-9]', '') AS UNSIGNED) ASC, pc_number ASC
       LIMIT 1000`,
    params
  );
  return rows;
}

async function getDailySummary({ from, to } = {}) {
  const pool = getPool();
  if (!pool) return [];
  const where = [];
  const params = [];
  if (from) { where.push('stat_date >= ?'); params.push(from); }
  if (to)   { where.push('stat_date <= ?'); params.push(to); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  // sent_count = 成功送信数, 試行数 = sent + error, error率 = error / (sent + error)
  const [rows] = await pool.query(
    `SELECT stat_date,
            SUM(sent_count)      AS sent,
            SUM(error_count)     AS errors,
            ROUND(SUM(error_count) / NULLIF(SUM(sent_count) + SUM(error_count), 0) * 100, 2) AS error_rate
       FROM fax_send_stats
       ${whereSql}
       GROUP BY stat_date
       ORDER BY stat_date DESC
       LIMIT 90`,
    params
  );
  return rows;
}

async function getPcSummary({ from, to } = {}) {
  const pool = getPool();
  if (!pool) return [];
  const where = [];
  const params = [];
  if (from) { where.push('stat_date >= ?'); params.push(from); }
  if (to)   { where.push('stat_date <= ?'); params.push(to); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  // sent_count = 成功送信数, 試行数 = sent + error
  const [rows] = await pool.query(
    `SELECT pc_number,
            SUM(sent_count)      AS sent,
            SUM(error_count)     AS errors,
            ROUND(SUM(error_count) / NULLIF(SUM(sent_count) + SUM(error_count), 0) * 100, 2) AS error_rate
       FROM fax_send_stats
       ${whereSql}
       GROUP BY pc_number
       ORDER BY CAST(REGEXP_REPLACE(pc_number, '[^0-9]', '') AS UNSIGNED) ASC, pc_number ASC`,
    params
  );
  return rows;
}

// --------------------------------------------
// 設定
// --------------------------------------------
async function getConfig() {
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.query(`SELECT * FROM sheets_config WHERE id = 1 LIMIT 1`);
  return rows[0] || { id: 1, sheet_id: null, sheet_range: 'Sheet1!A:H', last_sync_status: 'never' };
}

async function updateConfig({ sheet_id, sheet_range }) {
  const pool = getPool();
  if (!pool) throw new Error('DB未設定');
  await pool.query(
    `INSERT INTO sheets_config (id, sheet_id, sheet_range)
     VALUES (1, ?, ?)
     ON DUPLICATE KEY UPDATE sheet_id = VALUES(sheet_id), sheet_range = VALUES(sheet_range)`,
    [sheet_id || null, sheet_range || 'Sheet1!A:H']
  );
  return getConfig();
}

// --------------------------------------------
// 取込: 行配列を upsert
// --------------------------------------------
function normalizeRow(row, source) {
  // row: { stat_date, pc_number, sent, success, error, busy, no_answer, invalid }
  return {
    stat_date: row.stat_date,
    pc_number: row.pc_number,
    sent_count:      Number(row.sent || row.sent_count || 0)        || 0,
    success_count:   Number(row.success || row.success_count || 0)  || 0,
    error_count:     Number(row.error || row.error_count || 0)      || 0,
    busy_count:      Number(row.busy || row.busy_count || 0)        || 0,
    no_answer_count: Number(row.no_answer || row.no_answer_count || 0) || 0,
    invalid_count:   Number(row.invalid || row.invalid_count || 0)  || 0,
    source: source || 'manual',
  };
}

async function upsertRows(rows, source = 'manual') {
  if (!isConfigured()) {
    const err = new Error('DBが未設定です'); err.status = 500; err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  if (!VALID_SOURCES.has(source)) source = 'manual';

  const valid = rows
    .map((r) => normalizeRow(r, source))
    .filter((r) => r.stat_date && r.pc_number);

  const pool = getPool();
  const conn = await pool.getConnection();
  const stats = { inserted: 0, updated: 0, skipped: rows.length - valid.length };
  try {
    for (const r of valid) {
      const [result] = await conn.query(
        `INSERT INTO fax_send_stats
           (stat_date, pc_number, sent_count, success_count, error_count,
            busy_count, no_answer_count, invalid_count, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           sent_count      = VALUES(sent_count),
           success_count   = VALUES(success_count),
           error_count     = VALUES(error_count),
           busy_count      = VALUES(busy_count),
           no_answer_count = VALUES(no_answer_count),
           invalid_count   = VALUES(invalid_count),
           source          = VALUES(source),
           synced_at       = CURRENT_TIMESTAMP`,
        [r.stat_date, r.pc_number, r.sent_count, r.success_count, r.error_count,
         r.busy_count, r.no_answer_count, r.invalid_count, r.source]
      );
      // affectedRows: 新規=1, 更新=2 (変更あり), マッチ無変更=0
      if (result.affectedRows === 1) stats.inserted++;
      else if (result.affectedRows >= 2) stats.updated++;
    }
  } finally {
    conn.release();
  }
  return stats;
}

// --------------------------------------------
// CSV取込
// --------------------------------------------
const CSV_MAPPING = {
  '日付': 'stat_date', 'date': 'stat_date', 'stat_date': 'stat_date',
  'PC': 'pc_number', 'pc_number': 'pc_number', 'PC番号': 'pc_number',
  '送信数': 'sent', 'sent': 'sent', '送信': 'sent',
  '成功': 'success', 'success': 'success',
  'エラー': 'error', 'error': 'error',
  '話中': 'busy', 'busy': 'busy',
  '応答なし': 'no_answer', 'no_answer': 'no_answer',
  '番号無効': 'invalid', 'invalid': 'invalid',
};

function csvRowToRecord(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const key = CSV_MAPPING[k] || CSV_MAPPING[k?.trim()];
    if (!key) continue;
    if (key === 'stat_date') {
      // 2026-05-15, 2026/5/15, 5/15
      const s = String(v).trim();
      const m1 = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
      if (m1) out[key] = `${m1[1]}-${String(m1[2]).padStart(2, '0')}-${String(m1[3]).padStart(2, '0')}`;
    } else if (key === 'pc_number') {
      out[key] = String(v).trim();
    } else {
      out[key] = Number(String(v).replace(/[^0-9.-]/g, '')) || 0;
    }
  }
  return out;
}

async function importCsv(filePath, _originalName) {
  const rows = [];
  let totalRows = 0;
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        totalRows++;
        const r = csvRowToRecord(row);
        if (r.stat_date && r.pc_number) rows.push(r);
      })
      .on('end', resolve)
      .on('error', reject);
  });
  const stats = await upsertRows(rows, 'csv');
  return { totalRows, validRows: rows.length, ...stats };
}

// --------------------------------------------
// Google Sheets 同期(オプション: googleapis 未インストールでも動くようにlazy require)
// --------------------------------------------
async function syncFromSheets() {
  const cfg = await getConfig();
  if (!cfg?.sheet_id) {
    const err = new Error('シートIDが未設定です。設定画面でシートIDを登録してください');
    err.status = 400; err.code = 'NO_SHEET_ID';
    throw err;
  }
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath || !fs.existsSync(keyPath)) {
    const err = new Error('GOOGLE_SERVICE_ACCOUNT_KEY_PATH が未設定 or ファイルなし');
    err.status = 400; err.code = 'NO_SA_KEY';
    throw err;
  }

  let google;
  try { google = require('googleapis').google; }
  catch (_e) {
    const err = new Error('googleapis モジュール未インストール。`npm install googleapis` を実行してください');
    err.status = 500; err.code = 'GOOGLEAPIS_MISSING';
    throw err;
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  // pivot形式は日付列が横に多数並ぶため、デフォルトで広めに取る
  // 行数: NO.1〜NO.23 で 23PC × 約7行/PC + ヘッダ ≒ 162行。マージン込み 500 行
  // 列数: 1日=1列、AZ(52列)だと2ヶ月分しか取れない。ZZ(702列)で約2年分の日付列に対応
  const range = cfg.sheet_range || 'A1:ZZ500';

  let values;
  try {
    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: cfg.sheet_id, range });
    values = resp.data.values || [];
  } catch (e) {
    await markSync('error', e.message);
    const err = new Error(`Sheets取得失敗: ${e.message}`);
    err.status = 502; err.code = 'SHEETS_FETCH_FAILED';
    throw err;
  }

  if (values.length < 2) {
    await markSync('error', 'シートが空、またはヘッダーのみ');
    return { totalRows: 0, validRows: 0, inserted: 0, updated: 0, skipped: 0 };
  }

  // 形式を自動判定: 1行目に「送信件数」「エラー数」のような項目名がない & 日付っぽい列があれば pivot
  const isPivot = detectPivotFormat(values);
  let rows;
  if (isPivot) {
    rows = parsePivotSheet(values);
  } else {
    const headers = values[0];
    rows = [];
    for (let i = 1; i < values.length; i++) {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = values[i][idx] ?? ''; });
      const rec = csvRowToRecord(obj);
      if (rec.stat_date && rec.pc_number) rows.push(rec);
    }
  }

  const stats = await upsertRows(rows, 'sheets');
  await markSync('ok', `${isPivot ? 'pivot' : 'flat'} / ${stats.inserted}件 新規 / ${stats.updated}件 更新`);
  return { totalRows: values.length - 1, validRows: rows.length, format: isPivot ? 'pivot' : 'flat', ...stats };
}

// --------------------------------------------
// Pivot形式パーサ
//   列ヘッダ: 合計, 平均, 4/30, 5/1, ... (横軸=日付)
//   セクション: 「NO.X」マーカー行で PC を切り替え
//   各PCのデータ行:
//     「送信件数」 → sent_count
//     「エラー数」 → error_count
//   不要行: 「総数」「エラー総数」「送信数合計」「合計」「平均」「空行」
// --------------------------------------------
const DATE_HEADER_RE = /^(\d{1,2})[\/\-](\d{1,2})$/;
const PIVOT_LABEL_SEND  = ['送信件数', '送信数'];
const PIVOT_LABEL_ERROR = ['エラー数', 'エラー件数'];
const PIVOT_LABEL_SKIP  = ['総数', 'エラー総数', '送信数合計', '合計', '平均', ''];
const PC_MARKER_RE = /^NO[\.\s_-]*(\d{1,3})$/i;

function detectPivotFormat(values) {
  const firstRow = (values[0] || []).map((v) => String(v || '').trim());
  // 日付ヘッダ (例: '4/30') が1つでもあれば pivot 形式とみなす
  return firstRow.some((c) => DATE_HEADER_RE.test(c));
}

function normalizeDateHeader(s, defaultYear) {
  const m = String(s || '').trim().match(DATE_HEADER_RE);
  if (!m) return null;
  const year = defaultYear || new Date().getFullYear();
  return `${year}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

function parsePivotSheet(values, opts = {}) {
  const defaultYear = opts.defaultYear || new Date().getFullYear();
  const header = (values[0] || []).map((v) => String(v || '').trim());

  // 列インデックス → 日付YYYY-MM-DD のマップ (合計/平均/空はスキップ)
  const colToDate = {};
  header.forEach((h, idx) => {
    const d = normalizeDateHeader(h, defaultYear);
    if (d) colToDate[idx] = d;
  });

  // 日次データの集計: { 'NO.x__YYYY-MM-DD': { sent_count, error_count } }
  // 構造前提:
  //   先頭ブロック (NO.X マーカー出現前) は「全体合計」のセクション → スキップ
  //   「NO.X」マーカー行で currentPc を確定
  //   以降の「送信件数」「エラー数」を currentPc に紐付け
  //   次の「NO.Y」マーカーで pcを切替
  const acc = {};
  let currentPc = null;

  for (let r = 1; r < values.length; r++) {
    const row = values[r] || [];
    const label = String(row[0] || '').trim();

    // NO.X マーカー → currentPc を更新 (次セクションの開始)
    const pcMatch = label.match(PC_MARKER_RE);
    if (pcMatch) {
      currentPc = `NO.${pcMatch[1]}`;
      continue;
    }

    // 不要ラベル
    if (PIVOT_LABEL_SKIP.includes(label)) continue;

    const isSend  = PIVOT_LABEL_SEND.includes(label);
    const isError = PIVOT_LABEL_ERROR.includes(label);
    if (!isSend && !isError) continue;

    // NO.X マーカー前は「全体合計」セクションなのでスキップ
    if (!currentPc) continue;

    for (const [colIdx, date] of Object.entries(colToDate)) {
      const raw = row[Number(colIdx)];
      if (raw === undefined || raw === null || raw === '') continue;
      const num = Number(String(raw).replace(/[^0-9.-]/g, ''));
      if (!Number.isFinite(num)) continue;
      const key = `${currentPc}__${date}`;
      if (!acc[key]) acc[key] = { stat_date: date, pc_number: currentPc, sent: 0, error: 0 };
      if (isSend)  acc[key].sent  = num;
      if (isError) acc[key].error = num;
    }
  }

  // 異常値の閾値 (各PC×日次の値として、これを超えるのは集計値や計算ミス)
  const ABNORMAL_THRESHOLD = 1000;

  return Object.values(acc)
    // 行ごと除外する条件 (送信数が信用できない場合のみ)
    //   - sent < 0 / sent > 1000 → 明らかな異常 (累計値混入など)
    //   - error > 1000 → 累計値混入の疑い、 sent も信用できない可能性が高い
    .filter((x) => {
      if (x.sent < 0) return false;
      if (x.sent > ABNORMAL_THRESHOLD) return false;
      if (x.error > ABNORMAL_THRESHOLD) return false;
      return true;
    })
    // 仕様: シートの『送信件数』は既に成功数(=エラーを引いた値)、
    //       『エラー数』は別の独立した数値。試行数 = sent + error。
    //   - error の clamp は不要 (送信数とは独立した値のため)
    //   - success_count は廃止(sent_count = 成功数のため冗長)、 互換のため sent と同値で残す
    .map((x) => {
      const error = Math.max(x.error, 0);
      return {
        stat_date: x.stat_date,
        pc_number: x.pc_number,
        sent_count: x.sent,           // 成功送信数 (シートの「送信件数」 = エラーを引いた数値)
        success_count: x.sent,        // (将来カラム廃止予定、 sent と同義)
        error_count: error,
        busy_count: 0,
        no_answer_count: 0,
        invalid_count: 0,
      };
    });
}

async function markSync(status, message) {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO sheets_config (id, last_synced_at, last_sync_status, last_sync_message)
     VALUES (1, NOW(), ?, ?)
     ON DUPLICATE KEY UPDATE
       last_synced_at = NOW(),
       last_sync_status = VALUES(last_sync_status),
       last_sync_message = VALUES(last_sync_message)`,
    [status, message || null]
  );
}

module.exports = {
  listStats, getDailySummary, getPcSummary,
  getConfig, updateConfig,
  importCsv, syncFromSheets, upsertRows,
  parsePivotSheet, detectPivotFormat,  // テスト用にも公開
};
