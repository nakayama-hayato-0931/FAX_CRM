const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const customerService = require('../services/customerService');
const customerImport = require('../services/customerImportService');
const contactEvents = require('../services/contactEventService');
const customerSync = require('../services/customerSyncService');
const ccClient = require('../services/callcenterClient');
const { ok, created, fail } = require('../utils/response');

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: (Number(process.env.MAX_UPLOAD_SIZE_MB) || 20) * 1024 * 1024 },
});

router.get('/', async (req, res, next) => {
  try {
    const result = await customerService.listCustomers(req.query);
    return ok(res, result.items, { pagination: result.pagination });
  } catch (e) { next(e); }
});

router.get('/facets/industries', async (_req, res, next) => {
  try { return ok(res, await customerService.getDistinctIndustries()); }
  catch (e) { next(e); }
});

// GET /api/customers/lookup?fax=&phone=&external_callcenter_id=&company_name=
//   callcenter から fax-crm の customer_id を探す用
router.get('/lookup', async (req, res, next) => {
  try {
    const candidates = await contactEvents.lookup(req.query);
    return ok(res, candidates || []);
  } catch (e) { next(e); }
});

// GET /api/customers/:id/timeline
router.get('/:id(\\d+)/timeline', async (req, res, next) => {
  try {
    const rows = await contactEvents.getTimeline(req.params.id, req.query);
    return ok(res, rows);
  } catch (e) { next(e); }
});

router.get('/facets/prefectures', async (_req, res, next) => {
  try { return ok(res, await customerService.getDistinctPrefectures()); }
  catch (e) { next(e); }
});

router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const c = await customerService.getById(req.params.id);
    if (!c) return fail(res, 404, 'NOT_FOUND', 'customer not found');
    return ok(res, c);
  } catch (e) { next(e); }
});

router.patch('/:id(\\d+)/blacklist', async (req, res, next) => {
  try {
    const { isBlacklisted, reason } = req.body || {};
    await customerService.setBlacklist(req.params.id, !!isBlacklisted, reason);
    return ok(res, { id: req.params.id, isBlacklisted: !!isBlacklisted });
  } catch (e) { next(e); }
});

router.post('/import', upload.single('file'), async (req, res, next) => {
  let p;
  try {
    if (!req.file) return fail(res, 400, 'NO_FILE', 'CSVファイルが必要です');
    p = req.file.path;
    const result = await customerImport.importCsv(p, req.file.originalname);
    return created(res, result);
  } catch (e) { next(e); }
  finally { if (p && fs.existsSync(p)) fs.unlink(p, () => {}); }
});

// ============================================================
// callcenter-ai-system 連携
// ============================================================

// GET /api/customers/sync/status — 連携設定の状態確認
router.get('/sync/status', (_req, res) => {
  return ok(res, {
    configured: ccClient.isConfigured(),
    base_url_set: !!process.env.CALLCENTER_API_BASE_URL,
    token_set: !!process.env.CALLCENTER_API_TOKEN,
  });
});

// POST /api/customers/sync/pull — callcenter → fax-crm 取り込み
router.post('/sync/pull', async (_req, res, next) => {
  try {
    const stats = await customerSync.pullFromCallcenter();
    return created(res, stats);
  } catch (e) { next(e); }
});

// POST /api/customers/sync/push — fax-crm → callcenter 一括 push
router.post('/sync/push', async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 1000;
    const stats = await customerSync.pushAllToCallcenter({ limit });
    return created(res, stats);
  } catch (e) { next(e); }
});

// POST /api/customers/sync/both — 双方向同期 (pull → push 順次)
router.post('/sync/both', async (req, res, next) => {
  try {
    const pushLimit = Number(req.query.limit) || 2000;
    const stats = await customerSync.syncBothDirections({ pushLimit });
    return created(res, stats);
  } catch (e) { next(e); }
});

module.exports = router;
