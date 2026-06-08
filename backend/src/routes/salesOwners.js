const express = require('express');
const svc = require('../services/salesOwnerService');
const { ok, created, fail } = require('../utils/response');

const router = express.Router();

// GET /api/sales-owners?includeInactive=1
router.get('/', async (req, res, next) => {
  try {
    const includeInactive = req.query.includeInactive === '1';
    return ok(res, await svc.list({ includeInactive }));
  } catch (e) { next(e); }
});

// POST /api/sales-owners  body: { name }
router.post('/', async (req, res, next) => {
  try {
    const r = await svc.create(req.body || {});
    return created(res, r);
  } catch (e) { next(e); }
});

// PATCH /api/sales-owners/:id  body: { name?, is_active?, sort_order? }
router.patch('/:id(\\d+)', async (req, res, next) => {
  try {
    const ok2 = await svc.update(req.params.id, req.body || {});
    if (!ok2) return fail(res, 404, 'NOT_FOUND', 'sales owner not found');
    return ok(res, { id: Number(req.params.id) });
  } catch (e) { next(e); }
});

// DELETE /api/sales-owners/:id
router.delete('/:id(\\d+)', async (req, res, next) => {
  try {
    const ok2 = await svc.remove(req.params.id);
    if (!ok2) return fail(res, 404, 'NOT_FOUND', 'sales owner not found');
    return ok(res, { id: Number(req.params.id) });
  } catch (e) { next(e); }
});

module.exports = router;
