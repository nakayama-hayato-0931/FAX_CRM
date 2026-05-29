/**
 * ユーザー管理 サービス (admin 専用)
 */
const { getPool, isConfigured } = require('../../config/db');
const auth = require('./authService');

async function list() {
  const pool = getPool();
  if (!pool) return [];
  const [rows] = await pool.query(
    `SELECT id, username, display_name, role, is_active, last_login_at, created_at, updated_at
       FROM users ORDER BY id ASC`
  );
  return rows;
}

async function getById(id) {
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.query(
    `SELECT id, username, display_name, role, is_active, last_login_at, created_at, updated_at
       FROM users WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function create({ username, password, display_name, role }) {
  if (!isConfigured()) { const e = new Error('DB未設定'); e.status = 500; throw e; }
  if (!username || !String(username).trim()) {
    const e = new Error('ユーザー名は必須'); e.status = 400; throw e;
  }
  if (!password || String(password).length < 6) {
    const e = new Error('パスワードは6文字以上'); e.status = 400; throw e;
  }
  const r = role || 'sales';
  auth.assertRole(r);
  const pool = getPool();
  // 重複チェック
  const [dup] = await pool.query(`SELECT id FROM users WHERE username = ? LIMIT 1`, [username]);
  if (dup.length) {
    const e = new Error(`そのユーザー名は既に使われています: ${username}`);
    e.status = 409; e.code = 'DUPLICATE_USERNAME'; throw e;
  }
  const hash = await auth.hashPassword(password);
  const [result] = await pool.query(
    `INSERT INTO users (username, password_hash, display_name, role, is_active)
     VALUES (?, ?, ?, ?, 1)`,
    [String(username).trim(), hash, display_name || null, r]
  );
  return getById(result.insertId);
}

async function update(id, { display_name, role, is_active }) {
  if (!isConfigured()) { const e = new Error('DB未設定'); e.status = 500; throw e; }
  const fields = [];
  const params = [];
  if (display_name !== undefined) { fields.push('display_name = ?'); params.push(display_name || null); }
  if (role !== undefined)         { auth.assertRole(role); fields.push('role = ?'); params.push(role); }
  if (is_active !== undefined)    { fields.push('is_active = ?'); params.push(is_active ? 1 : 0); }
  if (!fields.length) return getById(id);
  params.push(id);
  const pool = getPool();
  await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
  return getById(id);
}

async function changePassword(id, newPassword) {
  if (!newPassword || String(newPassword).length < 6) {
    const e = new Error('新しいパスワードは6文字以上'); e.status = 400; throw e;
  }
  const pool = getPool();
  const hash = await auth.hashPassword(newPassword);
  await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, id]);
  return { ok: true };
}

async function remove(id, requesterId) {
  if (Number(id) === Number(requesterId)) {
    const e = new Error('自分自身は削除できません'); e.status = 400; throw e;
  }
  const pool = getPool();
  // 残り admin が 1人もいなくならないようにチェック
  const target = await getById(id);
  if (!target) { const e = new Error('対象ユーザーが見つかりません'); e.status = 404; throw e; }
  if (target.role === 'admin') {
    const [cnt] = await pool.query(
      `SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?`,
      [id]
    );
    if (Number(cnt[0]?.c || 0) === 0) {
      const e = new Error('admin が 0人になるため削除できません');
      e.status = 400; e.code = 'LAST_ADMIN'; throw e;
    }
  }
  const [r] = await pool.query(`DELETE FROM users WHERE id = ?`, [id]);
  return { deleted: r.affectedRows };
}

module.exports = { list, getById, create, update, changePassword, remove };
