const express = require('express');
const svc = require('../services/salesProjectService');
const { ok, created } = require('../utils/response');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try { return ok(res, await svc.list(req.query)); }
  catch (e) { next(e); }
});

router.get('/config', async (_req, res, next) => {
  try { return ok(res, await svc.getConfig()); }
  catch (e) { next(e); }
});

router.put('/config', async (req, res, next) => {
  try {
    const c = await svc.updateConfig(req.body || {});
    return ok(res, c);
  } catch (e) { next(e); }
});

router.post('/sync', async (_req, res, next) => {
  try {
    const result = await svc.syncFromSheets();
    return created(res, result);
  } catch (e) { next(e); }
});

// デバッグ: シート生データを月別/フィルタ別で集計して返す
//   ?ym=2026-04 のように調べたい月を指定可能
router.get('/debug-inspect', async (req, res, next) => {
  try {
    const data = await svc.debugInspectSheet({ targetYM: req.query.ym || '2026-04' });
    return ok(res, data);
  } catch (e) { next(e); }
});

module.exports = router;
