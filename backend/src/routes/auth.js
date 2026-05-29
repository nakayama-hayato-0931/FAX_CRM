const express = require('express');
const auth = require('../services/authService');
const userSvc = require('../services/userService');
const { requireAuth } = require('../middlewares/auth');
const { ok, fail } = require('../utils/response');

const router = express.Router();

// POST /api/auth/login  body: { username, password }
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const result = await auth.login(username, password);
    return ok(res, result);
  } catch (e) { next(e); }
});

// GET /api/auth/me  現在のログインユーザー
router.get('/me', requireAuth, async (req, res) => {
  return ok(res, { user: req.user });
});

// PUT /api/auth/me/password  自分のパスワード変更
//   body: { current_password, new_password }
router.put('/me/password', requireAuth, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return fail(res, 400, 'MISSING_INPUT', '現在のパスワードと新しいパスワードを入力してください');
    }
    // 現在パスワード検証
    const { getPool } = require('../../config/db');
    const pool = getPool();
    const [rows] = await pool.query(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]);
    if (!rows.length) return fail(res, 404, 'NOT_FOUND', 'ユーザーが見つかりません');
    const okPw = await auth.verifyPassword(current_password, rows[0].password_hash);
    if (!okPw) return fail(res, 401, 'INVALID_PASSWORD', '現在のパスワードが違います');
    await userSvc.changePassword(req.user.id, new_password);
    return ok(res, { ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
