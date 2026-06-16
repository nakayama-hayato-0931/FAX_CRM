const express = require('express');
const svc = require('../services/sendResultSummaryService');
const { ok } = require('../utils/response');

const router = express.Router();

// GET /api/send-result-summary?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=region+industry+nationality
router.get('/', async (req, res, next) => {
  try {
    const { from, to, groupBy } = req.query;
    const result = await svc.summary({ from, to, groupBy });
    return ok(res, result);
  } catch (e) { next(e); }
});

module.exports = router;
