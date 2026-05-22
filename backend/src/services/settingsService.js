const fs = require('fs');
const { getPool, isConfigured } = require('../../config/db');

const ALLOWED_KEYS = new Set([
  'drive_root_folder_id',
  'drive_auto_upload',
  'manuscript_auto_create_folders',
  'manuscript_pdf_drive_folder_id',  // 原稿PDFを保存する Drive 親フォルダ ID
]);

async function getAll() {
  const pool = getPool();
  if (!pool) return {};
  const [rows] = await pool.query(`SELECT setting_key, setting_value, description, updated_at FROM system_settings`);
  const out = {};
  for (const r of rows) out[r.setting_key] = { value: r.setting_value, description: r.description, updated_at: r.updated_at };
  return out;
}

async function get(key) {
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.query(`SELECT setting_value FROM system_settings WHERE setting_key = ? LIMIT 1`, [key]);
  return rows[0]?.setting_value ?? null;
}

async function set(key, value) {
  if (!ALLOWED_KEYS.has(key)) {
    const err = new Error(`未許可の設定キー: ${key}`);
    err.status = 400; err.code = 'INVALID_KEY';
    throw err;
  }
  if (!isConfigured()) {
    const err = new Error('DBが未設定です'); err.status = 500; err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  const pool = getPool();
  await pool.query(
    `INSERT INTO system_settings (setting_key, setting_value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, value == null ? null : String(value)]
  );
  return get(key);
}

async function setMany(map) {
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    if (!ALLOWED_KEYS.has(k)) continue;
    await set(k, v);
    out[k] = v;
  }
  return out;
}

/**
 * Google API の認証状態を返す。実際の接続テストは別エンドポイントで。
 */
function getGoogleAuthStatus() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath) {
    return { configured: false, reason: 'GOOGLE_SERVICE_ACCOUNT_KEY_PATH 未設定' };
  }
  if (!fs.existsSync(keyPath)) {
    return { configured: false, reason: `鍵ファイルが存在しません: ${keyPath}` };
  }
  let svcAccount = null;
  try {
    const j = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    svcAccount = j.client_email || null;
  } catch (_e) { /* ignore */ }
  return {
    configured: true,
    keyPath,
    serviceAccount: svcAccount,
  };
}

module.exports = {
  getAll, get, set, setMany, getGoogleAuthStatus,
  ALLOWED_KEYS,
};
