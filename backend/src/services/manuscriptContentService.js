/**
 * 原稿管理 (PDFベース) サービス
 *   - manuscript_contents: PDF + メタデータ (登録番号/国籍/性別/業種カテゴリ)
 *   - manuscript_content_usage: 送信日 × PC × 原稿 で 受電結果別の件数を記録
 *
 * PDF 保存先:
 *   process.env.UPLOAD_DIR (既定 ./uploads) 配下の manuscripts/<id>.pdf
 *   Railway は ephemeral なので本格運用では Drive 等の永続ストレージ推奨
 */
const fs = require('fs');
const path = require('path');
const { getPool, isConfigured } = require('../../config/db');
const settings = require('./settingsService');
const drive = require('./driveService');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads');
const PDF_SUBDIR = 'manuscripts';

/**
 * 原稿PDFを格納する Drive 親フォルダ ID を取得
 *   1) manuscript_pdf_drive_folder_id が設定済 → それを使う
 *   2) 未設定 → drive_root_folder_id 配下に 'manuscripts' フォルダを findOrCreate
 *   3) どちらも未設定 → null (= Drive 保存しない、 ローカルfallback)
 */
async function getPdfDriveFolderId() {
  const direct = await settings.get('manuscript_pdf_drive_folder_id');
  if (direct) return direct;
  const root = await settings.get('drive_root_folder_id');
  if (!root) return null;
  try {
    const folder = await drive.findOrCreateFolder({ name: 'manuscripts', parentId: root });
    return folder.id;
  } catch (e) {
    console.error('[manuscriptContent] manuscripts フォルダ作成失敗:', e.message);
    return null;
  }
}

const NATIONALITIES = ['ベトナム','ミャンマー','ネパール','モンゴル','スリランカ','バングラディシュ'];
const GENDERS = ['男','女'];
const INDUSTRY_CATEGORIES = ['飲食','製造','小売','宿泊','建設','その他'];

function ensurePdfDir() {
  const dir = path.join(UPLOAD_DIR, PDF_SUBDIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function validateEnum(value, allowed, field) {
  if (value === undefined || value === null || value === '') return null;
  if (!allowed.includes(value)) {
    const err = new Error(`${field} の値が不正: '${value}'. 許容: ${allowed.join(', ')}`);
    err.status = 400; throw err;
  }
  return value;
}

/**
 * 一覧取得 (フィルタ + ページング + usage 集計付き)
 */
/**
 * 起動時マイグレーションがまだ走っていない環境向けの 防御的スキーマ補正
 *   - manuscript_slot_files.manuscript_content_id 列が無ければ ALTER で追加
 *   冪等。1リクエストの先頭で呼んでも軽量。
 */
async function ensureSlotFilesSchema(pool) {
  const [cols] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'manuscript_slot_files'
        AND COLUMN_NAME = 'manuscript_content_id' LIMIT 1`
  );
  if (cols.length === 0) {
    console.log('[manuscriptContent] manuscript_slot_files.manuscript_content_id を追加します');
    await pool.query(
      `ALTER TABLE manuscript_slot_files
         ADD COLUMN manuscript_content_id INT UNSIGNED DEFAULT NULL
           COMMENT '原稿管理(manuscript_contents.id) から選択した場合の元 ID'`
    );
    // index も同時に
    try {
      await pool.query(
        `ALTER TABLE manuscript_slot_files ADD INDEX idx_msf_content (manuscript_content_id)`
      );
    } catch (_) { /* 既にあれば無視 */ }
  }
}

async function list(query = {}) {
  const pool = getPool();
  if (!pool) return { items: [], pagination: { total: 0, page: 1, pageSize: 50, totalPages: 0 } };
  await ensureSlotFilesSchema(pool);

  const where = [];
  const params = [];
  if (query.q) {
    where.push('(title LIKE ? OR registration_no LIKE ? OR memo LIKE ?)');
    const v = `%${query.q}%`;
    params.push(v, v, v);
  }
  if (query.nationality) { where.push('nationality = ?'); params.push(query.nationality); }
  if (query.gender)      { where.push('gender = ?');      params.push(query.gender); }
  if (query.industry)    { where.push('industry_category = ?'); params.push(query.industry); }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Number(query.pageSize) || 50, 200);
  const offset = (page - 1) * limit;

  // ドライブ格納 スロット紐づけ ベースの 自動集計
  //   sl: PC使用台数 (DISTINCT slot_number) + 最終使用日 (MAX folder_date)
  //   ll: 同スロット の Excel batches の actual_count SUM = 使用回数
  //   rr: 受電報告 全件COUNT (= 反響) + result='project' COUNT (= 案件化)
  const [rows] = await pool.query(
    `SELECT mc.*,
            COALESCE(sl.pc_count, 0)        AS usage_pc_count,        -- 使用台数
            COALESCE(ll.list_total, 0)      AS usage_list_total,      -- 使用回数 (リスト件数SUM)
            COALESCE(rr.response_total, 0)  AS usage_response_total,  -- 反響 (全結果COUNT)
            COALESCE(rr.project_total, 0)   AS usage_project_total,   -- 案件化 (result=project)
            sl.last_used_date               AS last_used_date         -- 最終使用 (MAX folder_date)
       FROM manuscript_contents mc
       LEFT JOIN (
         SELECT msf.manuscript_content_id,
                COUNT(DISTINCT m.slot_number) AS pc_count,
                MAX(m.folder_date)            AS last_used_date
           FROM manuscript_slot_files msf
           JOIN manuscripts m ON m.id = msf.manuscript_id
          WHERE msf.manuscript_content_id IS NOT NULL AND msf.kind = 'manuscript'
          GROUP BY msf.manuscript_content_id
       ) sl ON sl.manuscript_content_id = mc.id
       LEFT JOIN (
         SELECT msf.manuscript_content_id,
                COALESCE(SUM(eb.actual_count), 0) AS list_total
           FROM manuscript_slot_files msf
           JOIN manuscript_slot_files msf2
             ON msf2.manuscript_id = msf.manuscript_id AND msf2.kind = 'excel'
           JOIN extraction_batches eb
             ON eb.drive_file_id = msf2.drive_file_id
          WHERE msf.manuscript_content_id IS NOT NULL AND msf.kind = 'manuscript'
          GROUP BY msf.manuscript_content_id
       ) ll ON ll.manuscript_content_id = mc.id
       LEFT JOIN (
         SELECT msf.manuscript_content_id,
                COUNT(*)                                                    AS response_total,
                SUM(CASE WHEN icr.result = 'project' THEN 1 ELSE 0 END)     AS project_total
           FROM manuscript_slot_files msf
           JOIN incoming_call_reports icr ON icr.manuscript_id = msf.manuscript_id
          WHERE msf.manuscript_content_id IS NOT NULL AND msf.kind = 'manuscript'
          GROUP BY msf.manuscript_content_id
       ) rr ON rr.manuscript_content_id = mc.id
       ${whereSql}
       ORDER BY mc.created_at DESC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [cnt] = await pool.query(`SELECT COUNT(*) AS total FROM manuscript_contents ${whereSql}`, params);
  return { items: rows, pagination: { page, pageSize: limit, total: cnt[0].total, totalPages: Math.ceil(cnt[0].total / limit) } };
}

async function getById(id) {
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.query('SELECT * FROM manuscript_contents WHERE id = ?', [id]);
  if (!rows[0]) return null;
  const [usage] = await pool.query(
    'SELECT * FROM manuscript_content_usage WHERE manuscript_content_id = ? ORDER BY send_date DESC, pc_number',
    [id]
  );
  return { ...rows[0], usage };
}

/**
 * 新規登録 (file は multer の req.file)
 */
async function create({ title, registration_no, nationality, gender, industry_category, memo, file }) {
  if (!isConfigured()) { const e = new Error('DB未設定'); e.status = 500; throw e; }
  const pool = getPool();

  // バリデーション
  const natValid = validateEnum(nationality, NATIONALITIES, '国籍');
  const genValid = validateEnum(gender, GENDERS, '性別');
  const indValid = validateEnum(industry_category, INDUSTRY_CATEGORIES, '業種カテゴリ');
  if (!registration_no && !title && !file) {
    const e = new Error('登録番号 / タイトル / PDF のいずれかは必須');
    e.status = 400; throw e;
  }

  // 仮 INSERT (id 取得用)
  const [r1] = await pool.query(
    `INSERT INTO manuscript_contents
      (title, registration_no, nationality, gender, industry_category, memo,
       pdf_original_name, pdf_size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title || null, registration_no || null, natValid, genValid, indValid, memo || null,
      file?.originalname || null, file?.size || null,
    ]
  );
  const newId = r1.insertId;

  // PDF: 1) Drive にアップロード (設定済なら) 2) ローカルにも一旦保存 (fallback)
  if (file && file.path && fs.existsSync(file.path)) {
    const folderId = await getPdfDriveFolderId();
    const niceName = `${newId}_${file.originalname || `manuscript-${newId}.pdf`}`.replace(/[\r\n\t]/g, '');

    if (folderId) {
      // Drive に upload
      try {
        const driveFile = await drive.uploadFile({
          filePath: file.path,
          mimeType: 'application/pdf',
          name: niceName,
          parentId: folderId,
        });
        await pool.query(
          'UPDATE manuscript_contents SET pdf_drive_file_id = ?, pdf_drive_url = ? WHERE id = ?',
          [driveFile.id, driveFile.webViewLink || null, newId]
        );
        // upload 成功したらローカル一時ファイルは削除
        try { fs.unlinkSync(file.path); } catch (_) {}
      } catch (e) {
        console.error(`[manuscriptContent] Drive upload 失敗、 ローカル fallback: ${e.message}`);
        // fallback to local
        await saveLocal(pool, newId, file);
      }
    } else {
      // Drive 未設定 → ローカル保存
      await saveLocal(pool, newId, file);
    }
  }

  return getById(newId);
}

// fallback: ローカル uploads/manuscripts/<id>.pdf に保存
async function saveLocal(pool, id, file) {
  const dir = ensurePdfDir();
  const dst = path.join(dir, `${id}.pdf`);
  try {
    fs.renameSync(file.path, dst);
  } catch (_e) {
    fs.copyFileSync(file.path, dst);
    try { fs.unlinkSync(file.path); } catch (_) {}
  }
  const relPath = path.join(PDF_SUBDIR, `${id}.pdf`).replace(/\\/g, '/');
  await pool.query('UPDATE manuscript_contents SET pdf_file_path = ? WHERE id = ?', [relPath, id]);
}

async function update(id, patch) {
  const pool = getPool();
  const allowed = ['title','registration_no','nationality','gender','industry_category','memo','thumbnail_url'];
  const sets = [];
  const params = [];
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      if (k === 'nationality')        validateEnum(patch[k], NATIONALITIES, '国籍');
      if (k === 'gender')             validateEnum(patch[k], GENDERS, '性別');
      if (k === 'industry_category')  validateEnum(patch[k], INDUSTRY_CATEGORIES, '業種カテゴリ');
      sets.push(`${k} = ?`);
      params.push(patch[k] === '' ? null : patch[k]);
    }
  }
  if (sets.length === 0) return getById(id);
  params.push(id);
  await pool.query(`UPDATE manuscript_contents SET ${sets.join(', ')} WHERE id = ?`, params);
  return getById(id);
}

async function remove(id) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT pdf_file_path, pdf_drive_file_id FROM manuscript_contents WHERE id = ?', [id]);
  const r = rows[0];
  // Drive 上のファイル削除 (失敗しても DB delete は続行)
  if (r?.pdf_drive_file_id) {
    try { await drive.deleteFile(r.pdf_drive_file_id); }
    catch (e) { console.error(`[manuscriptContent] Drive delete failed: ${e.message}`); }
  }
  // ローカル fallback も削除
  if (r?.pdf_file_path) {
    const full = path.resolve(UPLOAD_DIR, r.pdf_file_path);
    try { fs.unlinkSync(full); } catch (_) {}
  }
  await pool.query('DELETE FROM manuscript_contents WHERE id = ?', [id]);
  return { ok: true };
}

/**
 * PDF ファイル取得ヘルパー
 *   - Drive 保存があれば Drive から stream を返す ({ source: 'drive', stream })
 *   - 無ければローカルファイルパスを返す ({ source: 'local', path })
 *   - どちらも無ければ null
 */
async function getPdfSource(record) {
  if (record?.pdf_drive_file_id) {
    try {
      const stream = await drive.downloadFileStream(record.pdf_drive_file_id);
      return { source: 'drive', stream };
    } catch (e) {
      console.error(`[manuscriptContent] Drive download失敗、 local fallback: ${e.message}`);
    }
  }
  if (record?.pdf_file_path) {
    const full = path.resolve(UPLOAD_DIR, record.pdf_file_path);
    if (fs.existsSync(full)) return { source: 'local', path: full };
  }
  return null;
}

// 旧API互換 (deprecated)
function getPdfPath(record) {
  if (!record?.pdf_file_path) return null;
  const full = path.resolve(UPLOAD_DIR, record.pdf_file_path);
  if (!fs.existsSync(full)) return null;
  return full;
}

// ---- 使用記録 (manuscript_content_usage) ----

async function listUsage(manuscriptContentId) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT * FROM manuscript_content_usage WHERE manuscript_content_id = ? ORDER BY send_date DESC, pc_number`,
    [manuscriptContentId]
  );
  return rows;
}

async function upsertUsage(manuscriptContentId, body = {}) {
  const pool = getPool();
  const {
    send_date, pc_number,
    sent_count = 0, no_response_count = 0, response_inquiry_count = 0,
    response_order_count = 0, refusal_count = 0, invalid_number_count = 0, other_count = 0,
    note,
  } = body;
  if (!send_date || !pc_number) {
    const e = new Error('send_date と pc_number は必須'); e.status = 400; throw e;
  }
  await pool.query(
    `INSERT INTO manuscript_content_usage (
       manuscript_content_id, send_date, pc_number,
       sent_count, no_response_count, response_inquiry_count, response_order_count,
       refusal_count, invalid_number_count, other_count, note
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       sent_count = VALUES(sent_count),
       no_response_count = VALUES(no_response_count),
       response_inquiry_count = VALUES(response_inquiry_count),
       response_order_count = VALUES(response_order_count),
       refusal_count = VALUES(refusal_count),
       invalid_number_count = VALUES(invalid_number_count),
       other_count = VALUES(other_count),
       note = VALUES(note)`,
    [
      manuscriptContentId, send_date, pc_number,
      sent_count, no_response_count, response_inquiry_count, response_order_count,
      refusal_count, invalid_number_count, other_count, note || null,
    ]
  );
  return listUsage(manuscriptContentId);
}

async function deleteUsage(usageId) {
  const pool = getPool();
  await pool.query('DELETE FROM manuscript_content_usage WHERE id = ?', [usageId]);
  return { ok: true };
}

/**
 * 原稿の 自動集計 送信使用履歴
 *   原稿が ドライブ格納 スロットに 紐づけられた (manuscript_slot_files.kind='manuscript'
 *   + manuscript_content_id=?) 各スロット を行単位として:
 *     - 格納日 (uploaded_at) / PC (slot_number) / 地域 (同スロットの Excel batch の filter_prefecture)
 *     - 反応 (incoming_call_reports カウント) / 案件化 (result='project' カウント)
 *   を集計して返す。
 */
async function getStorageHistory(manuscriptContentId) {
  const pool = getPool();
  if (!pool) return [];
  await ensureSlotFilesSchema(pool);
  const [rows] = await pool.query(
    `SELECT
       msf.id              AS slot_file_id,
       msf.uploaded_at     AS storage_date,
       msf.drive_url       AS drive_url,
       m.id                AS slot_id,
       m.folder_date       AS folder_date,
       m.slot_number       AS slot_number,
       -- 地域: 同スロット に Excel として格納された batches の filter_prefecture を集約
       (SELECT GROUP_CONCAT(DISTINCT eb.filter_prefecture ORDER BY eb.filter_prefecture SEPARATOR ', ')
          FROM manuscript_slot_files msf2
          JOIN extraction_batches eb ON eb.drive_file_id = msf2.drive_file_id
         WHERE msf2.manuscript_id = m.id AND msf2.kind = 'excel'
           AND eb.filter_prefecture IS NOT NULL AND eb.filter_prefecture <> ''
       )                                                            AS prefectures,
       (SELECT GROUP_CONCAT(DISTINCT eb.filter_industry ORDER BY eb.filter_industry SEPARATOR ', ')
          FROM manuscript_slot_files msf2
          JOIN extraction_batches eb ON eb.drive_file_id = msf2.drive_file_id
         WHERE msf2.manuscript_id = m.id AND msf2.kind = 'excel'
           AND eb.filter_industry IS NOT NULL AND eb.filter_industry <> ''
       )                                                            AS industries,
       -- 反応 (= 受電報告 件数)
       (SELECT COUNT(*) FROM incoming_call_reports icr
         WHERE icr.manuscript_id = m.id)                            AS response_count,
       -- 結果別 内訳
       (SELECT COUNT(*) FROM incoming_call_reports icr
         WHERE icr.manuscript_id = m.id AND icr.result = 'project') AS project_count,
       (SELECT COUNT(*) FROM incoming_call_reports icr
         WHERE icr.manuscript_id = m.id AND icr.result = 'ng')      AS ng_count,
       (SELECT COUNT(*) FROM incoming_call_reports icr
         WHERE icr.manuscript_id = m.id AND icr.result = 'recall')  AS recall_count,
       (SELECT COUNT(*) FROM incoming_call_reports icr
         WHERE icr.manuscript_id = m.id AND icr.result = 'material_sent') AS material_count,
       (SELECT COUNT(*) FROM incoming_call_reports icr
         WHERE icr.manuscript_id = m.id AND icr.result = 'other')   AS other_count
     FROM manuscript_slot_files msf
     JOIN manuscripts m ON m.id = msf.manuscript_id
     WHERE msf.manuscript_content_id = ? AND msf.kind = 'manuscript'
     ORDER BY m.folder_date DESC, m.slot_number ASC, msf.uploaded_at DESC`,
    [manuscriptContentId]
  );
  return rows;
}

/**
 * 原稿 × スロット 反応 (incoming_call_reports) の明細
 *   "反応" セルクリックで一覧表示する用
 */
async function getStorageResponses(manuscriptContentId, slotId) {
  const pool = getPool();
  if (!pool) return [];
  await ensureSlotFilesSchema(pool);
  // manuscriptContentId は 検証用 (このスロットがこの原稿に紐づいていることを確認)
  const [check] = await pool.query(
    `SELECT 1 FROM manuscript_slot_files
      WHERE manuscript_id = ? AND manuscript_content_id = ? AND kind = 'manuscript' LIMIT 1`,
    [slotId, manuscriptContentId]
  );
  if (!check.length) return [];

  const [rows] = await pool.query(
    `SELECT icr.id, icr.send_date, icr.pc_number, icr.responded_at,
            icr.result, icr.result_detail, icr.candidate_registration_no,
            c.id AS customer_id, c.company_name, c.fax_number, c.phone_number,
            c.industry_category, c.prefecture
       FROM incoming_call_reports icr
  LEFT JOIN customers c ON c.id = icr.customer_id
      WHERE icr.manuscript_id = ?
      ORDER BY icr.responded_at DESC, icr.id DESC
      LIMIT 1000`,
    [slotId]
  );
  return rows;
}

/**
 * 既存のローカル保存 PDF を Drive に一括移行 (drive folder 設定済の場合のみ)
 *   pdf_file_path がある & pdf_drive_file_id が無い 全レコードを処理
 */
async function migrateLocalToDrive({ limit = 1000 } = {}) {
  if (!isConfigured()) { const e = new Error('DB未設定'); e.status = 500; throw e; }
  const folderId = await getPdfDriveFolderId();
  if (!folderId) {
    const e = new Error('Drive 親フォルダ未設定 (settings: drive_root_folder_id / manuscript_pdf_drive_folder_id)');
    e.status = 400; throw e;
  }
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT id, pdf_file_path, pdf_original_name FROM manuscript_contents
      WHERE pdf_drive_file_id IS NULL AND pdf_file_path IS NOT NULL
      LIMIT ?`,
    [Math.min(Number(limit) || 1000, 5000)]
  );
  const stats = { target: rows.length, uploaded: 0, missing: 0, errors: 0, errorSamples: [], folderId };
  for (const r of rows) {
    const full = path.resolve(UPLOAD_DIR, r.pdf_file_path);
    if (!fs.existsSync(full)) { stats.missing++; continue; }
    try {
      const f = await drive.uploadFile({
        filePath: full,
        mimeType: 'application/pdf',
        name: `${r.id}_${r.pdf_original_name || `manuscript-${r.id}.pdf`}`.replace(/[\r\n\t]/g, ''),
        parentId: folderId,
      });
      await pool.query(
        'UPDATE manuscript_contents SET pdf_drive_file_id = ?, pdf_drive_url = ? WHERE id = ?',
        [f.id, f.webViewLink || null, r.id]
      );
      stats.uploaded++;
    } catch (e) {
      console.error(`[manuscriptContent] migrate id=${r.id} failed: ${e.message}`);
      stats.errors++;
      if (stats.errorSamples.length < 3) {
        stats.errorSamples.push({ id: r.id, error: e.message });
      }
    }
  }
  return stats;
}

module.exports = {
  list, getById, create, update, remove,
  getPdfPath, getPdfSource,
  listUsage, upsertUsage, deleteUsage,
  getStorageHistory, getStorageResponses,
  migrateLocalToDrive, getPdfDriveFolderId,
  NATIONALITIES, GENDERS, INDUSTRY_CATEGORIES,
};
