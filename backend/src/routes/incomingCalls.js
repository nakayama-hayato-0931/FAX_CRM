const express = require('express');
const svc = require('../services/incomingCallService');
const { ok, created, fail } = require('../utils/response');

const router = express.Router();

// GET /api/incoming-calls
router.get('/', async (req, res, next) => {
  try {
    const result = await svc.listReports(req.query);
    return ok(res, result.items, { pagination: result.pagination });
  } catch (e) { next(e); }
});

// GET /api/incoming-calls/last?customer_id=  受電報告 手動入力モーダルの自動入力用
router.get('/last', async (req, res, next) => {
  try {
    const cid = Number(req.query.customer_id);
    if (!cid) return fail(res, 400, 'INVALID_INPUT', 'customer_id 必須');
    const r = await svc.getLastForCustomer(cid);
    return ok(res, r);
  } catch (e) { next(e); }
});

// GET /api/incoming-calls/by-batch/:batchId
router.get('/by-batch/:batchId(\\d+)', async (req, res, next) => {
  try {
    const data = await svc.getBatchInputView(req.params.batchId);
    if (!data) return fail(res, 404, 'NOT_FOUND', 'batch not found');
    return ok(res, data);
  } catch (e) { next(e); }
});

// POST /api/incoming-calls/bulk-save  バッチ一括保存
router.post('/bulk-save', async (req, res, next) => {
  try {
    const result = await svc.bulkSave(req.body || {});
    return ok(res, result);
  } catch (e) { next(e); }
});

// POST /api/incoming-calls  単独入力
router.post('/', async (req, res, next) => {
  try {
    const result = await svc.createSingle(req.body || {});
    return created(res, result);
  } catch (e) { next(e); }
});

module.exports = router;
