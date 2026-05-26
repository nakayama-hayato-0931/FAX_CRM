const express = require('express');
const svc = require('../services/interviewService');
const { ok, created } = require('../utils/response');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try { return ok(res, await svc.list(req.query)); }
  catch (e) { next(e); }
});

// GET /api/interviews/offers-only?month=YYYY-MM-01&basis=acquired|offer
//   その月の 内定はあるが 面接記録に無い 企業 (= CPA 面接数 UNION で加算された分)
router.get('/offers-only', async (req, res, next) => {
  try { return ok(res, await svc.listOfferOnly(req.query)); }
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

module.exports = router;
