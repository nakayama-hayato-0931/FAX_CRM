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

// POST /api/customers/quick-create — 会社名 or 電話 or FAX 最低1つで顧客を確保
//   既存とマッチすれば再利用、無ければ新規作成
//   電話/FAX は全角→半角自動正規化
router.post('/quick-create', async (req, res, next) => {
  try {
    const r = await customerService.quickCreate(req.body || {});
    return created(res, r);
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

// POST /api/customers/recategorize?mode=missing|all
//   全顧客の industry_category を industry/note から再算出する admin 操作
//   - mode=missing (default): NULL / 'その他' の行のみ対象
//   - mode=all              : 全件強制で上書き
router.post('/recategorize', async (req, res, next) => {
  try {
    const mode = req.query.mode === 'all' ? 'all' : 'missing';
    const result = await customerService.recategorizeIndustries({ mode });
    return ok(res, result);
  } catch (e) { next(e); }
});

router.post('/import', upload.single('file'), async (req, res, next) => {
  let p;
  try {
    if (!req.file) return fail(res, 400, 'NO_FILE', 'ファイル (CSV / Excel) が必要です');
    const mode = (req.body?.mode || req.query?.mode || 'new').toString();
    if (!customerImport.MODES.has(mode)) {
      return fail(res, 400, 'INVALID_INPUT', `不正な mode: ${mode} (許容: new / existing / ng)`);
    }
    p = req.file.path;
    const result = await customerImport.importCsv(p, req.file.originalname, { mode });
    return created(res, result);
  } catch (e) { next(e); }
  finally { if (p && fs.existsSync(p)) fs.unlink(p, () => {}); }
});

// ============================================================
// callcenter-ai-system 連携
// ============================================================

// GET /api/customers/sync/status — 連携設定の状態確認 + 最終同期日時
router.get('/sync/status', async (_req, res, next) => {
  try {
    const lastSyncedAt = await customerSync.getLastSyncedAt();
    return ok(res, {
      configured: ccClient.isConfigured(),
      base_url_set: !!process.env.CALLCENTER_API_BASE_URL,
      token_set: !!process.env.CALLCENTER_API_TOKEN,
      last_synced_at: lastSyncedAt,
    });
  } catch (e) { next(e); }
});

// POST /api/customers/sync/pull — callcenter → fax-crm 取り込み
//   ?full=1 で差分フィルタを無視して全件強制 (デフォルトは差分)
router.post('/sync/pull', async (req, res, next) => {
  try {
    const full = req.query.full === '1';
    const stats = await customerSync.pullFromCallcenter({ full });
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
//   ?full=1 で pull 部分を全件強制
router.post('/sync/both', async (req, res, next) => {
  try {
    const pushLimit = Number(req.query.limit) || 2000;
    const full = req.query.full === '1';
    const stats = await customerSync.syncBothDirections({ pushLimit, full });
    return created(res, stats);
  } catch (e) { next(e); }
});

// POST /api/customers/sync/reset — 最終同期日時を NULL に戻す (全件再同期を強制したい時用)
router.post('/sync/reset', async (_req, res, next) => {
  try {
    await customerSync.setLastSyncedAt(null);
    return ok(res, { ok: true, message: '最終同期日時をリセットしました。 次回の同期は全件 pull になります' });
  } catch (e) { next(e); }
});

module.exports = router;
