const express = require('express');
const ngWordService = require('../services/ngWordService');
const { ok, created, fail } = require('../utils/response');

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    const items = await ngWordService.list();
    return ok(res, items);
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const { field, word, memo, enabled } = req.body || {};
    const r = await ngWordService.create({ field, word, memo, enabled });
    return created(res, r);
  } catch (e) { next(e); }
});

router.patch('/:id(\\d+)', async (req, res, next) => {
  try {
    const { enabled, memo } = req.body || {};
    const ok2 = await ngWordService.update(req.params.id, { enabled, memo });
    if (!ok2) return fail(res, 404, 'NOT_FOUND', 'ngword not found');
    return ok(res, { id: Number(req.params.id) });
  } catch (e) { next(e); }
});

router.delete('/:id(\\d+)', async (req, res, next) => {
  try {
    const ok2 = await ngWordService.remove(req.params.id);
    if (!ok2) return fail(res, 404, 'NOT_FOUND', 'ngword not found');
    return ok(res, { id: Number(req.params.id) });
  } catch (e) { next(e); }
});

module.exports = router;
