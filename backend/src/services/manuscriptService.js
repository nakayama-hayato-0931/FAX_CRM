const { getPool, isConfigured } = require('../../config/db');
const settings = require('./settingsService');
const drive = require('./driveService');

const TOTAL_SLOTS = 23;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function assertDate(date) {
  if (!DATE_RE.test(date)) {
    const err = new Error('日付は YYYY-MM-DD 形式で指定してください');
    err.status = 400; err.code = 'INVALID_DATE';
    throw err;
  }
}

async function listDates({ from, to } = {}) {
  const pool = getPool();
  if (!pool) return [];
  const where = [];
  const params = [];
  if (from) { where.push('folder_date >= ?'); params.push(from); }
  if (to)   { where.push('folder_date <= ?'); params.push(to); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows] = await pool.query(
    `SELECT folder_date,
            COUNT(*) AS slot_count,
            SUM(CASE WHEN title IS NOT NULL AND title <> '' THEN 1 ELSE 0 END) AS filled_count,
            SUM(CASE WHEN drive_folder_url IS NOT NULL AND drive_folder_url <> '' THEN 1 ELSE 0 END) AS drive_count,
            MIN(created_at) AS created_at
       FROM manuscripts
       ${whereSql}
       GROUP BY folder_date
       ORDER BY folder_date DESC
       LIMIT 365`,
    params
  );
  return rows;
}

async function getByDate(date) {
  assertDate(date);
  const pool = getPool();
  if (!pool) return [];
  const [rows] = await pool.query(
    `SELECT m.*,
            COALESCE(u.usage_count, 0) AS usage_count,
            u.distinct_pcs,
            u.distinct_industries,
            u.distinct_prefectures
       FROM manuscripts m
       LEFT JOIN (
         SELECT icr.manuscript_id,
                COUNT(*) AS usage_count,
                GROUP_CONCAT(DISTINCT icr.pc_number ORDER BY icr.pc_number SEPARATOR ',') AS distinct_pcs,
                GROUP_CONCAT(DISTINCT b.filter_industry ORDER BY b.filter_industry SEPARATOR ',') AS distinct_industries,
                GROUP_CONCAT(DISTINCT b.filter_prefecture ORDER BY b.filter_prefecture SEPARATOR ',') AS distinct_prefectures
           FROM incoming_call_reports icr
           LEFT JOIN extraction_batches b ON b.id = icr.batch_id
          WHERE icr.manuscript_id IS NOT NULL
          GROUP BY icr.manuscript_id
       ) u ON u.manuscript_id = m.id
      WHERE m.folder_date = ?
      ORDER BY m.slot_number ASC`,
    [date]
  );
  return rows;
}

/**
 * 原稿スロット 1個 の使用履歴を返す。
 *   返却例:
 *     {
 *       byPc: [{ pc_number, count, industries: [...], prefectures: [...] }, ...],
 *       byBatch: [{ batch_id, batch_name, filter_industry, filter_prefecture, pc_number, sent_count }, ...],
 *       details: [{ send_date, pc_number, batch_name, industry, prefecture, result }, ...],
 *     }
 */
async function getSlotUsage(slotId) {
  const pool = getPool();
  if (!pool) return null;

  const [slotRows] = await pool.query(`SELECT * FROM manuscripts WHERE id = ? LIMIT 1`, [slotId]);
  if (!slotRows.length) return null;
  const slot = slotRows[0];

  // PC別サマリ
  const [byPc] = await pool.query(
    `SELECT icr.pc_number,
            COUNT(*) AS count,
            GROUP_CONCAT(DISTINCT b.filter_industry SEPARATOR ',')  AS industries,
            GROUP_CONCAT(DISTINCT b.filter_prefecture SEPARATOR ',') AS prefectures,
            SUM(CASE WHEN icr.result IN ('response_inquiry','response_order') THEN 1 ELSE 0 END) AS response_count
       FROM incoming_call_reports icr
       LEFT JOIN extraction_batches b ON b.id = icr.batch_id
      WHERE icr.manuscript_id = ?
      GROUP BY icr.pc_number
      ORDER BY count DESC`,
    [slotId]
  );

  // バッチ別サマリ
  const [byBatch] = await pool.query(
    `SELECT b.id AS batch_id, b.name AS batch_name,
            b.filter_industry, b.filter_prefecture, b.pc_number,
            COUNT(*) AS sent_count,
            SUM(CASE WHEN icr.result IN ('response_inquiry','response_order') THEN 1 ELSE 0 END) AS response_count,
            MIN(icr.send_date) AS first_send,
            MAX(icr.send_date) AS last_send
       FROM incoming_call_reports icr
       LEFT JOIN extraction_batches b ON b.id = icr.batch_id
      WHERE icr.manuscript_id = ?
      GROUP BY b.id, b.name, b.filter_industry, b.filter_prefecture, b.pc_number
      ORDER BY sent_count DESC`,
    [slotId]
  );

  // 明細 (最大500件)
  const [details] = await pool.query(
    `SELECT icr.id, icr.send_date, icr.pc_number, icr.result, icr.responded_at,
            b.id AS batch_id, b.name AS batch_name,
            b.filter_industry, b.filter_prefecture,
            c.company_name, c.fax_number
       FROM incoming_call_reports icr
       LEFT JOIN extraction_batches b ON b.id = icr.batch_id
       LEFT JOIN customers c ON c.id = icr.customer_id
      WHERE icr.manuscript_id = ?
      ORDER BY icr.send_date DESC, icr.id DESC
      LIMIT 500`,
    [slotId]
  );

  return { slot, byPc, byBatch, details };
}

async function createDate(date) {
  assertDate(date);
  if (!isConfigured()) {
    const err = new Error('DBが未設定です'); err.status = 500; err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  const pool = getPool();
  const conn = await pool.getConnection();
  let createdSlots = 0;
  try {
    await conn.beginTransaction();
    const [existing] = await conn.query(
      `SELECT slot_number FROM manuscripts WHERE folder_date = ? FOR UPDATE`,
      [date]
    );
    const filled = new Set(existing.map((r) => r.slot_number));
    const toCreate = [];
    for (let i = 1; i <= TOTAL_SLOTS; i++) {
      if (!filled.has(i)) toCreate.push([date, i]);
    }
    if (toCreate.length) {
      await conn.query(
        `INSERT INTO manuscripts (folder_date, slot_number) VALUES ?`,
        [toCreate]
      );
    }
    await conn.commit();
    createdSlots = toCreate.length;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  // 設定がONなら Drive 上にも 23 フォルダを冪等に作成
  const autoCreate = await settings.get('manuscript_auto_create_folders');
  let driveResult = null;
  if (autoCreate === '1') {
    try {
      driveResult = await ensureDriveFolders(date);
    } catch (e) {
      // Drive失敗で全体を失敗させない。結果に乗せて返す
      driveResult = { ok: false, error: e.message };
    }
  }
  return { date, createdSlots, totalSlots: TOTAL_SLOTS, drive: driveResult };
}

/**
 * 指定日に対し Drive 上のフォルダ構造を冪等に作成。
 *   /<root>/<YYYY-MM-DD>/<1..23>/
 * 既に drive_folder_url が入っているスロットはスキップ。
 */
async function ensureDriveFolders(date) {
  assertDate(date);
  const rootFolderId = await settings.get('drive_root_folder_id');
  if (!rootFolderId) {
    const err = new Error('drive_root_folder_id が未設定です(設定画面で登録してください)');
    err.status = 400; err.code = 'NO_ROOT_FOLDER';
    throw err;
  }
  const dateFolder = await drive.findOrCreateFolder({ name: date, parentId: rootFolderId });

  const slots = await getByDate(date);
  const pool = getPool();
  let created = 0, skipped = 0;
  for (const slot of slots) {
    if (slot.drive_folder_url && slot.drive_folder_id) { skipped++; continue; }
    const slotName = String(slot.slot_number);
    const folder = await drive.findOrCreateFolder({ name: slotName, parentId: dateFolder.id });
    await pool.query(
      `UPDATE manuscripts SET drive_folder_id = ?, drive_folder_url = ? WHERE id = ?`,
      [folder.id, folder.webViewLink, slot.id]
    );
    if (folder.created) created++;
  }
  return {
    ok: true,
    dateFolder: { id: dateFolder.id, webViewLink: dateFolder.webViewLink, created: dateFolder.created },
    slotsCreated: created,
    slotsSkipped: skipped,
    totalSlots: slots.length,
  };
}

// ドライブ格納モーダルの入力項目: title + memo のみ
//   drive_folder_id / drive_folder_url はファイルアップ時に自動付与
//   thumbnail_url は廃止
const UPDATABLE = ['title', 'memo'];
async function updateSlot(id, body) {
  if (!isConfigured()) {
    const err = new Error('DBが未設定です'); err.status = 500; err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  const fields = [];
  const params = [];
  for (const k of UPDATABLE) {
    if (k in (body || {})) {
      fields.push(`${k} = ?`);
      params.push(body[k] === '' ? null : body[k]);
    }
  }
  if (!fields.length) return false;
  params.push(id);
  const pool = getPool();
  const [result] = await pool.query(
    `UPDATE manuscripts SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
  return result.affectedRows > 0;
}

// ============================================================
// スロット内のファイル管理 (Drive共有ドライブ にアップロード)
// ============================================================

const fs = require('fs');
const path = require('path');

/**
 * スロット用 Drive フォルダ ID を取得 (なければ作成)
 *   親 = manuscript_pdf_drive_folder_id (または drive_root_folder_id 配下に 'manuscripts/')
 *   その下に YYYY-MM-DD / slot-XX を作成
 */
async function ensureSlotDriveFolder(manuscriptId) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT id, folder_date, slot_number, drive_folder_id FROM manuscripts WHERE id = ? LIMIT 1', [manuscriptId]);
  if (!rows.length) { const e = new Error('スロットが見つかりません'); e.status = 404; throw e; }
  const slot = rows[0];
  if (slot.drive_folder_id) return slot.drive_folder_id;

  const pdfRoot = await settings.get('manuscript_pdf_drive_folder_id');
  const root    = await settings.get('drive_root_folder_id');
  let parentId = pdfRoot;
  if (!parentId && root) {
    const top = await drive.findOrCreateFolder({ name: 'manuscripts', parentId: root });
    parentId = top.id;
  }
  if (!parentId) { const e = new Error('Drive 親フォルダ未設定'); e.status = 400; throw e; }

  // YYYY-MM-DD / slot-XX
  const dateFolder = await drive.findOrCreateFolder({ name: String(slot.folder_date).slice(0, 10), parentId });
  const slotFolder = await drive.findOrCreateFolder({ name: `slot-${String(slot.slot_number).padStart(2, '0')}`, parentId: dateFolder.id });
  await pool.query('UPDATE manuscripts SET drive_folder_id = ?, drive_folder_url = ? WHERE id = ?',
    [slotFolder.id, slotFolder.webViewLink || null, manuscriptId]);
  return slotFolder.id;
}

/**
 * スロットにファイルをアップロード (multer の req.file を受け取る)
 *   kind: 'manuscript' (原稿PDF) / 'excel' (リスト) / 'other'
 */
async function uploadFileToSlot(manuscriptId, { kind, file }) {
  if (!file || !file.path) { const e = new Error('ファイル必須'); e.status = 400; throw e; }
  const parentId = await ensureSlotDriveFolder(manuscriptId);
  let driveFile;
  try {
    driveFile = await drive.uploadFile({
      filePath: file.path,
      mimeType: file.mimetype,
      name: file.originalname,
      parentId,
    });
  } finally {
    try { fs.unlinkSync(file.path); } catch (_) {}
  }
  const pool = getPool();
  const [r] = await pool.query(
    `INSERT INTO manuscript_slot_files
       (manuscript_id, kind, original_name, mime_type, size_bytes, drive_file_id, drive_url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [manuscriptId, kind || 'other', file.originalname, file.mimetype, file.size,
     driveFile.id, driveFile.webViewLink || null]
  );
  return { id: r.insertId, drive_file_id: driveFile.id, drive_url: driveFile.webViewLink };
}

async function listSlotFiles(manuscriptId) {
  const pool = getPool();
  if (!pool) return [];
  const [rows] = await pool.query(
    `SELECT id, kind, original_name, mime_type, size_bytes, drive_file_id, drive_url, uploaded_at
       FROM manuscript_slot_files WHERE manuscript_id = ? ORDER BY uploaded_at DESC, id DESC`,
    [manuscriptId]
  );
  return rows;
}

/**
 * 日付の23スロットを冪等に作成 (manuscripts テーブルへ INSERT IGNORE)
 *   既に存在するスロットは無視、 1〜23 のうち欠けているものだけ追加
 *   返り値: { date, created, totalSlots }
 */
async function ensureSlotsExist(date) {
  assertDate(date);
  const pool = getPool();
  const [existing] = await pool.query(
    'SELECT slot_number FROM manuscripts WHERE folder_date = ?',
    [date]
  );
  const have = new Set(existing.map((r) => r.slot_number));
  const toCreate = [];
  for (let i = 1; i <= TOTAL_SLOTS; i++) if (!have.has(i)) toCreate.push([date, i]);
  if (toCreate.length) {
    await pool.query('INSERT INTO manuscripts (folder_date, slot_number) VALUES ?', [toCreate]);
  }
  return { date, created: toCreate.length, totalSlots: TOTAL_SLOTS };
}

/**
 * 日付+PC番号 → 対応する manuscripts.id を取得 (なければ null)
 */
async function getSlotByDateAndPc(date, pcNumber) {
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.query(
    'SELECT id, folder_date, slot_number, drive_folder_id FROM manuscripts WHERE folder_date = ? AND slot_number = ? LIMIT 1',
    [date, pcNumber]
  );
  return rows[0] || null;
}

async function deleteSlotFile(fileId) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT drive_file_id FROM manuscript_slot_files WHERE id = ?', [fileId]);
  if (!rows.length) return false;
  if (rows[0].drive_file_id) {
    try { await drive.deleteFile(rows[0].drive_file_id); } catch (e) {
      console.error('[manuscriptSlot] Drive delete failed:', e.message);
    }
  }
  await pool.query('DELETE FROM manuscript_slot_files WHERE id = ?', [fileId]);
  return true;
}

async function deleteDate(date) {
  assertDate(date);
  const pool = getPool();
  if (!pool) return 0;
  const [result] = await pool.query(`DELETE FROM manuscripts WHERE folder_date = ?`, [date]);
  return result.affectedRows;
}

module.exports = {
  TOTAL_SLOTS,
  listDates,
  getByDate,
  createDate,
  updateSlot,
  deleteDate,
  ensureSlotDriveFolder,
  uploadFileToSlot,
  listSlotFiles,
  deleteSlotFile,
  ensureSlotsExist,
  getSlotByDateAndPc,
  ensureDriveFolders,
  getSlotUsage,
};
