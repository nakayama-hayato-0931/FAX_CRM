const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const cpa = require('../services/cpaService');
const { ok, created, fail } = require('../utils/response');

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: (Number(process.env.MAX_UPLOAD_SIZE_MB) || 20) * 1024 * 1024 },
});

// GET /api/cpa/monthly
//   query:
//     months: 取得する月数 (既定 12、最大 60)
//     basis : 'acquired' (BK列=案件取得日、既定) / 'offer' (A列=内定日)
router.get('/monthly', async (req, res, next) => {
  try {
    const rows = await cpa.getMonthly({
      months: req.query.months,
      basis: req.query.basis === 'offer' ? 'offer' : 'acquired',
    });
    return ok(res, rows);
  } catch (e) { next(e); }
});

// GET /api/cpa/detail
router.get('/detail', async (req, res, next) => {
  try {
    const rows = await cpa.listDetail(req.query);
    return ok(res, rows);
  } catch (e) { next(e); }
});

// POST /api/cpa/import
router.post('/import', upload.single('file'), async (req, res, next) => {
  let p;
  try {
    if (!req.file) return fail(res, 400, 'NO_FILE', 'CSVファイルが必要です');
    p = req.file.path;
    const result = await cpa.importCsv(p, req.file.originalname);
    return created(res, result);
  } catch (e) { next(e); }
  finally { if (p && fs.existsSync(p)) fs.unlink(p, () => {}); }
});

// ========================================
// 月別 確定版コスト (cpa_monthly_costs)
// ========================================

// GET /api/cpa/cost-per-fax  概算単価 (現在の cpa_cost_per_fax 設定値)
router.get('/cost-per-fax', async (_req, res, next) => {
  try { return ok(res, { value: await cpa.getCostPerFax() }); }
  catch (e) { next(e); }
});

// GET /api/cpa/monthly-costs  確定版コスト一覧
router.get('/monthly-costs', async (_req, res, next) => {
  try { return ok(res, await cpa.listMonthlyCosts()); }
  catch (e) { next(e); }
});

// GET /api/cpa/monthly-cost/:month (YYYY-MM-01)
router.get('/monthly-cost/:month(\\d{4}-\\d{2}-\\d{2})', async (req, res, next) => {
  try { return ok(res, await cpa.getMonthlyCost(req.params.month)); }
  catch (e) { next(e); }
});

// PUT /api/cpa/monthly-cost/:month  body: { in_house_cost, memo }
router.put('/monthly-cost/:month(\\d{4}-\\d{2}-\\d{2})', async (req, res, next) => {
  try {
    const r = await cpa.setMonthlyCost(req.params.month, req.body || {});
    return ok(res, r);
  } catch (e) { next(e); }
});

// DELETE /api/cpa/monthly-cost/:month  概算に戻す
router.delete('/monthly-cost/:month(\\d{4}-\\d{2}-\\d{2})', async (req, res, next) => {
  try {
    const deleted = await cpa.deleteMonthlyCost(req.params.month);
    return ok(res, { deleted });
  } catch (e) { next(e); }
});

// PUT /api/cpa/monthly-incoming/:month  受電数 手動入力
//   body: { incoming_picked_manual, incoming_missed_manual }
//   各値 null / 空 を渡すと その項目は自動集計に戻す
router.put('/monthly-incoming/:month(\\d{4}-\\d{2}-\\d{2})', async (req, res, next) => {
  try {
    const r = await cpa.setMonthlyIncoming(req.params.month, req.body || {});
    return ok(res, r);
  } catch (e) { next(e); }
});

// PUT /api/cpa/monthly-metrics/:month  CPA 指標 手動上書き (案件数/面接数/内定/バラシ/初回入金/見込売上/入金実績)
//   body: { projects?, interviews?, offers?, cancels?, first_payment?, expected_revenue?, payment_actual? }
//   各値 null / 空 を渡すと その項目は自動集計に戻る (シート同期では触らない)
//   渡されなかったキーは触らない
router.put('/monthly-metrics/:month(\\d{4}-\\d{2}-\\d{2})', async (req, res, next) => {
  try {
    const r = await cpa.setMonthlyMetrics(req.params.month, req.body || {});
    return ok(res, r);
  } catch (e) { next(e); }
});

module.exports = router;
