const express = require('express');
const svc = require('../services/contactEventService');
const { ok, created, fail } = require('../utils/response');

const router = express.Router();

// GET /api/contact-events  (外部システム or fax-crm内部から照会)
//   クエリ: external_callcenter_id / fax / phone / company_name / customer_id /
//          channel ('fax' or 'fax,call') / event_type / since / limit
//   callcenter の getFaxHistory() が叩く想定
router.get('/', async (req, res, next) => {
  try {
    const result = await svc.listByQuery(req.query);
    return ok(res, result.events, { meta: { customer_ids: result.customer_ids } });
  } catch (e) { next(e); }
});

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
