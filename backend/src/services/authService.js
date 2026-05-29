/**
 * 認証 サービス (ログイン / トークン検証 / パスワードハッシュ)
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool, isConfigured } = require('../../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'fax_crm_dev_secret_change_in_prod';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const BCRYPT_ROUNDS = 10;

const VALID_ROLES = new Set(['admin', 'sales']);
function assertRole(r) {
  if (!VALID_ROLES.has(r)) {
    const err = new Error(`不正な role: ${r} (admin / sales のみ)`);
    err.status = 400; err.code = 'INVALID_ROLE';
    throw err;
  }
}

async function hashPassword(plain) {
  return bcrypt.hash(String(plain), BCRYPT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  return bcrypt.compare(String(plain), String(hash));
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, name: user.display_name || user.username },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch (_e) { return null; }
}

/**
 * users テーブル無し環境でも 落ちないように 起動マイグ前 / マイグ失敗時に
 * インラインで CREATE TABLE IF NOT EXISTS を実行する (冪等)。
 */
async function ensureUsersTable(pool) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS users (
       id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
       username VARCHAR(50) NOT NULL,
       password_hash VARCHAR(255) NOT NULL COMMENT 'bcrypt ハッシュ',
       display_name VARCHAR(100) DEFAULT NULL,
       role VARCHAR(20) NOT NULL DEFAULT 'sales' COMMENT 'admin / sales',
       is_active TINYINT(1) NOT NULL DEFAULT 1,
       last_login_at DATETIME DEFAULT NULL,
       created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
       UNIQUE KEY uk_users_username (username),
       INDEX idx_users_role (role)
     ) ENGINE=InnoDB COMMENT='ユーザー (ログイン認証)'`
  );
}

/**
 * ログイン: username + password で認証 → JWT トークンを返す
 */
async function login(username, password) {
  if (!isConfigured()) {
    const err = new Error('DB未設定'); err.status = 500; throw err;
  }
  if (!username || !password) {
    const err = new Error('ユーザー名とパスワードを入力してください');
    err.status = 400; err.code = 'MISSING_CREDENTIALS'; throw err;
  }
  const pool = getPool();
  // 起動時マイグ未適用環境向け 防御策: テーブル を保証 + admin が 0 人なら初期作成
  await ensureUsersTable(pool);
  try { await bootstrapInitialAdmin(); } catch (_e) { /* no-op */ }
  const [rows] = await pool.query(
    `SELECT id, username, password_hash, display_name, role, is_active
       FROM users WHERE username = ? LIMIT 1`,
    [String(username).trim()]
  );
  const user = rows[0];
  if (!user || !user.is_active) {
    const err = new Error('ユーザー名またはパスワードが違います');
    err.status = 401; err.code = 'INVALID_CREDENTIALS'; throw err;
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    const err = new Error('ユーザー名またはパスワードが違います');
    err.status = 401; err.code = 'INVALID_CREDENTIALS'; throw err;
  }
  // ログイン時刻を更新 (失敗してもログインは成功扱い)
  pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [user.id])
    .catch((e) => console.error('[auth] last_login_at update failed:', e.message));

  const token = signToken(user);
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
    },
  };
}

/**
 * 起動時 ブートストラップ: users テーブルが空なら 初期 admin を作成
 *   env: INIT_ADMIN_USERNAME (default 'admin')
 *        INIT_ADMIN_PASSWORD (default 'admin123' — 必ず変更してもらう)
 */
async function bootstrapInitialAdmin() {
  if (!isConfigured()) return { skipped: true };
  const pool = getPool();
  await ensureUsersTable(pool);  // テーブル未作成環境向け 防御
  const [cnt] = await pool.query(`SELECT COUNT(*) AS c FROM users`);
  if (Number(cnt[0]?.c || 0) > 0) return { skipped: true, reason: 'users already exist' };

  const username = process.env.INIT_ADMIN_USERNAME || 'admin';
  const password = process.env.INIT_ADMIN_PASSWORD || 'admin123';
  const hash = await hashPassword(password);
  await pool.query(
    `INSERT INTO users (username, password_hash, display_name, role, is_active)
     VALUES (?, ?, ?, 'admin', 1)`,
    [username, hash, '管理者']
  );
  console.log('==========================================================');
  console.log(`[auth] 初期管理者を作成しました`);
  console.log(`        ユーザー名: ${username}`);
  console.log(`        パスワード: ${password}`);
  console.log(`        ※ ログイン後に必ずパスワードを変更してください`);
  console.log('==========================================================');
  return { created: true, username };
}

module.exports = {
  login, signToken, verifyToken, hashPassword, verifyPassword,
  bootstrapInitialAdmin, assertRole, VALID_ROLES,
};
