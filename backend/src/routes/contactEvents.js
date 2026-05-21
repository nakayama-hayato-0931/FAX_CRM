const express = require('express');
const svc = require('../services/contactEventService');
const { ok, created, fail } = require('../utils/response');

const router = express.Router();

// POST /api/contact-events  (外部システム or fax-crm内部から書き込み)
router.post('/', async (req, res, next) => {
  try {
    const result = await svc.createEvent(req.body || {});
    return created(res, result);
  } catch (e) { next(e); }
});

// POST /api/contact-events/bulk  (まとめて書き込み)
router.post('/bulk', async (req, res, next) => {
  try {
    const events = req.body?.events;
    if (!Array.isArray(events)) return fail(res, 400, 'INVALID_BODY', 'events 配列が必要');
    const stats = await svc.createBulk(events);
    return ok(res, stats);
  } catch (e) { next(e); }
});

module.exports = router;
