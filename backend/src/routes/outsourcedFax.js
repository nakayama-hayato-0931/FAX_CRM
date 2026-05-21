const express = require('express');
const svc = require('../services/outsourcedFaxService');
const { ok, created, fail } = require('../utils/response');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try { return ok(res, await svc.list(req.query)); }
  catch (e) { next(e); }
});

router.get('/:month', async (req, res, next) => {
  try {
    const row = await svc.getByMonth(req.params.month);
    if (!row) return fail(res, 404, 'NOT_FOUND', 'その月のデータがありません');
    return ok(res, row);
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const row = await svc.upsert(req.body || {});
    return created(res, row);
  } catch (e) { next(e); }
});

router.delete('/:month', async (req, res, next) => {
  try {
    const result = await svc.remove(req.params.month);
    return ok(res, result);
  } catch (e) { next(e); }
});

module.exports = router;
