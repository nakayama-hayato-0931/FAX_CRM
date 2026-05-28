const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const svc = require('../services/faxStatsService');
const { ok, created, fail } = require('../utils/response');

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: (Number(process.env.MAX_UPLOAD_SIZE_MB) || 20) * 1024 * 1024 },
});

router.get('/', async (req, res, next) => {
  try { return ok(res, await svc.listStats(req.query)); }
  catch (e) { next(e); }
});

router.get('/daily', async (req, res, next) => {
  try { return ok(res, await svc.getDailySummary(req.query)); }
  catch (e) { next(e); }
});

router.get('/by-pc', async (req, res, next) => {
  try { return ok(res, await svc.getPcSummary(req.query)); }
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

// POST /api/fax-stats/sync
//   ?recent=1            直近 N日分のみ upsert (既定 7日)
//   ?recent=1&days=14    日数指定
router.post('/sync', async (req, res, next) => {
  try {
    const recentOnly = ['1', 'true', 'yes'].includes(
      String(req.query.recent ?? req.body?.recent ?? '').toLowerCase()
    );
    const recentDays = Number(req.query.days ?? req.body?.days ?? 7) || 7;
    const result = await svc.syncFromSheets({ recentOnly, recentDays });
    return created(res, result);
  } catch (e) { next(e); }
});

router.post('/import', upload.single('file'), async (req, res, next) => {
  let p;
  try {
    if (!req.file) return fail(res, 400, 'NO_FILE', 'CSVファイルが必要です');
    p = req.file.path;
    const result = await svc.importCsv(p, req.file.originalname);
    return created(res, result);
  } catch (e) { next(e); }
  finally { if (p && fs.existsSync(p)) fs.unlink(p, () => {}); }
});

module.exports = router;
