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

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads');
const PDF_SUBDIR = 'manuscripts';

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
async function list(query = {}) {
  const pool = getPool();
  if (!pool) return { items: [], pagination: { total: 0, page: 1, pageSize: 50, totalPages: 0 } };

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

  // メイン + usage の合算 SUBSELECT
  const [rows] = await pool.query(
    `SELECT mc.*,
            COALESCE(u.send_days, 0) AS usage_send_days,
            COALESCE(u.total_sent, 0) AS usage_total_sent,
            COALESCE(u.total_inquiry, 0) AS usage_total_inquiry,
            COALESCE(u.total_order, 0) AS usage_total_order,
            COALESCE(u.total_refusal, 0) AS usage_total_refusal,
            u.last_used_date
       FROM manuscript_contents mc
       LEFT JOIN (
         SELECT manuscript_content_id,
                COUNT(*) AS send_days,
                SUM(sent_count) AS total_sent,
                SUM(response_inquiry_count) AS total_inquiry,
                SUM(response_order_count) AS total_order,
                SUM(refusal_count) AS total_refusal,
                MAX(send_date) AS last_used_date
           FROM manuscript_content_usage
          GROUP BY manuscript_content_id
       ) u ON u.manuscript_content_id = mc.id
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

  // PDF を id 確定後にリネーム保存
  if (file && file.path && fs.existsSync(file.path)) {
    const dir = ensurePdfDir();
    const dst = path.join(dir, `${newId}.pdf`);
    try {
      fs.renameSync(file.path, dst);
    } catch (e) {
      // ボリュームまたぎで rename 失敗時は copy + unlink
      fs.copyFileSync(file.path, dst);
      try { fs.unlinkSync(file.path); } catch (_) {}
    }
    const relPath = path.join(PDF_SUBDIR, `${newId}.pdf`).replace(/\\/g, '/');
    await pool.query('UPDATE manuscript_contents SET pdf_file_path = ? WHERE id = ?', [relPath, newId]);
  }

  return getById(newId);
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
  // PDF ファイルも削除
  const [rows] = await pool.query('SELECT pdf_file_path FROM manuscript_contents WHERE id = ?', [id]);
  if (rows[0]?.pdf_file_path) {
    const full = path.resolve(UPLOAD_DIR, rows[0].pdf_file_path);
    try { fs.unlinkSync(full); } catch (_) {}
  }
  await pool.query('DELETE FROM manuscript_contents WHERE id = ?', [id]);
  return { ok: true };
}

/**
 * PDF ファイルストリーム (download / preview)
 */
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

module.exports = {
  list, getById, create, update, remove,
  getPdfPath,
  listUsage, upsertUsage, deleteUsage,
  NATIONALITIES, GENDERS, INDUSTRY_CATEGORIES,
};
