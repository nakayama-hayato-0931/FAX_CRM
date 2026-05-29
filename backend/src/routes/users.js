const express = require('express');
const svc = require('../services/userService');
const { requireRole } = require('../middlewares/auth');
const { ok, created, fail } = require('../utils/response');

const router = express.Router();

// すべて admin 専用
router.use(requireRole('admin'));

// GET /api/users
router.get('/', async (_req, res, next) => {
  try { return ok(res, await svc.list()); }
  catch (e) { next(e); }
});

// POST /api/users  body: { username, password, display_name, role }
router.post('/', async (req, res, next) => {
  try {
    const u = await svc.create(req.body || {});
    return created(res, u);
  } catch (e) { next(e); }
});

// PUT /api/users/:id  body: { display_name?, role?, is_active? }
router.put('/:id(\\d+)', async (req, res, next) => {
  try {
    const u = await svc.update(req.params.id, req.body || {});
    return ok(res, u);
  } catch (e) { next(e); }
});

// PUT /api/users/:id/password  body: { new_password }
router.put('/:id(\\d+)/password', async (req, res, next) => {
  try {
    const { new_password } = req.body || {};
    if (!new_password) return fail(res, 400, 'MISSING_PASSWORD', 'new_password が必要');
    await svc.changePassword(req.params.id, new_password);
    return ok(res, { ok: true });
  } catch (e) { next(e); }
});

// DELETE /api/users/:id
router.delete('/:id(\\d+)', async (req, res, next) => {
  try {
    const r = await svc.remove(req.params.id, req.user?.id);
    return ok(res, r);
  } catch (e) { next(e); }
});

module.exports = router;
