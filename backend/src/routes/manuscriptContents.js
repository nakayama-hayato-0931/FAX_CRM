const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const svc = require('../services/manuscriptContentService');
const { ok, created, fail } = require('../utils/response');

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// PDF 最大 30MB
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: (Number(process.env.MAX_PDF_SIZE_MB) || 30) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('PDF ファイルのみ許可されています'));
    }
    cb(null, true);
  },
});

// GET /api/manuscript-contents/meta — UI 用の選択肢
router.get('/meta', (_req, res) => {
  return ok(res, {
    nationalities: svc.NATIONALITIES,
    genders: svc.GENDERS,
    industry_categories: svc.INDUSTRY_CATEGORIES,
  });
});

// GET /api/manuscript-contents — 一覧
router.get('/', async (req, res, next) => {
  try {
    const result = await svc.list(req.query);
    return ok(res, result.items, { pagination: result.pagination });
  } catch (e) { next(e); }
});

// POST /api/manuscript-contents — 新規登録 (PDF + メタデータ)
router.post('/', upload.single('pdf'), async (req, res, next) => {
  try {
    const body = req.body || {};
    const record = await svc.create({
      title: body.title,
      registration_no: body.registration_no,
      nationality: body.nationality,
      gender: body.gender,
      industry_category: body.industry_category,
      memo: body.memo,
      file: req.file,
    });
    return created(res, record);
  } catch (e) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    next(e);
  }
});

// GET /api/manuscript-contents/:id — 詳細 (usage 込み)
router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const r = await svc.getById(req.params.id);
    if (!r) return fail(res, 404, 'NOT_FOUND', '原稿が見つかりません');
    return ok(res, r);
  } catch (e) { next(e); }
});

// PUT /api/manuscript-contents/:id — メタデータ更新 (PDF差替なし)
router.put('/:id(\\d+)', async (req, res, next) => {
  try {
    const r = await svc.update(req.params.id, req.body || {});
    return ok(res, r);
  } catch (e) { next(e); }
});

// DELETE /api/manuscript-contents/:id
router.delete('/:id(\\d+)', async (req, res, next) => {
  try {
    await svc.remove(req.params.id);
    return ok(res, { ok: true });
  } catch (e) { next(e); }
});

// GET /api/manuscript-contents/:id/pdf — PDFダウンロード/プレビュー
//   Drive 保存があれば Drive から stream、 無ければローカル fallback
router.get('/:id(\\d+)/pdf', async (req, res, next) => {
  try {
    const r = await svc.getById(req.params.id);
    if (!r) return fail(res, 404, 'NOT_FOUND', '原稿が見つかりません');
    const src = await svc.getPdfSource(r);
    if (!src) return fail(res, 404, 'NO_PDF', 'PDFファイルが保存されていません');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(r.pdf_original_name || `manuscript-${r.id}.pdf`)}"`);
    if (src.source === 'drive') {
      src.stream.pipe(res);
    } else {
      fs.createReadStream(src.path).pipe(res);
    }
  } catch (e) { next(e); }
});

// POST /api/manuscript-contents/migrate-to-drive — 既存ローカルPDF を Drive に一括移行
router.post('/migrate-to-drive', async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 1000;
    const stats = await svc.migrateLocalToDrive({ limit });
    return ok(res, stats);
  } catch (e) { next(e); }
});

// ----- usage (送信日 × PC × 受電結果) -----

router.get('/:id(\\d+)/usage', async (req, res, next) => {
  try { return ok(res, await svc.listUsage(req.params.id)); }
  catch (e) { next(e); }
});

router.post('/:id(\\d+)/usage', async (req, res, next) => {
  try {
    const rows = await svc.upsertUsage(req.params.id, req.body || {});
    return created(res, rows);
  } catch (e) { next(e); }
});

router.delete('/:id(\\d+)/usage/:usageId(\\d+)', async (req, res, next) => {
  try { return ok(res, await svc.deleteUsage(req.params.usageId)); }
  catch (e) { next(e); }
});

module.exports = router;
