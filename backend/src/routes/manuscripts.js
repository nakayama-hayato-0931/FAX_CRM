const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ms = require('../services/manuscriptService');
const { ok, created, fail } = require('../utils/response');

const router = express.Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: (Number(process.env.MAX_SLOT_FILE_MB) || 50) * 1024 * 1024 },
});

// GET /api/manuscripts - 日付ごとのサマリ一覧
router.get('/', async (req, res, next) => {
  try {
    const rows = await ms.listDates(req.query);
    return ok(res, rows);
  } catch (e) { next(e); }
});

// GET /api/manuscripts/:date - 特定日の23スロット (date = YYYY-MM-DD)
router.get('/:date(\\d{4}-\\d{2}-\\d{2})', async (req, res, next) => {
  try {
    const rows = await ms.getByDate(req.params.date);
    return ok(res, rows);
  } catch (e) { next(e); }
});

// POST /api/manuscripts/:date - 日付登録 (不足分のスロットをINSERT)
router.post('/:date(\\d{4}-\\d{2}-\\d{2})', async (req, res, next) => {
  try {
    const result = await ms.createDate(req.params.date);
    return created(res, result);
  } catch (e) { next(e); }
});

// PATCH /api/manuscripts/slots/:id - スロットを編集 (title, drive_folder_url, memo 等)
router.patch('/slots/:id(\\d+)', async (req, res, next) => {
  try {
    const updated = await ms.updateSlot(req.params.id, req.body);
    if (!updated) return fail(res, 404, 'NOT_FOUND', 'slot not found');
    return ok(res, { id: req.params.id });
  } catch (e) { next(e); }
});

// GET /api/manuscripts/slots/:id/usage  スロットの使用履歴(PC別 / バッチ別 / 明細)
router.get('/slots/:id(\\d+)/usage', async (req, res, next) => {
  try {
    const result = await ms.getSlotUsage(req.params.id);
    if (!result) return fail(res, 404, 'NOT_FOUND', 'slot not found');
    return ok(res, result);
  } catch (e) { next(e); }
});

// POST /api/manuscripts/:date/ensure-drive  Drive上に1〜23フォルダを冪等に作成
router.post('/:date(\\d{4}-\\d{2}-\\d{2})/ensure-drive', async (req, res, next) => {
  try {
    const result = await ms.ensureDriveFolders(req.params.date);
    return ok(res, result);
  } catch (e) { next(e); }
});

// ----- スロット内のファイル管理 -----

// GET /api/manuscripts/slots/:id/files
router.get('/slots/:id(\\d+)/files', async (req, res, next) => {
  try { return ok(res, await ms.listSlotFiles(req.params.id)); }
  catch (e) { next(e); }
});

// POST /api/manuscripts/slots/:id/files  (multipart, kind=manuscript|excel|other)
router.post('/slots/:id(\\d+)/files', upload.single('file'), async (req, res, next) => {
  try {
    const kind = req.body?.kind || 'other';
    if (!req.file) return fail(res, 400, 'NO_FILE', 'ファイル必須');
    // multer は multipart/form-data の filename を Latin-1 として渡してくる ため
    // 日本語ファイル名は文字化けする。UTF-8 として読み直す。
    if (req.file.originalname) {
      try {
        req.file.originalname = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      } catch (_) { /* keep original on failure */ }
    }
    const r = await ms.uploadFileToSlot(req.params.id, { kind, file: req.file });
    return created(res, r);
  } catch (e) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
    }
    next(e);
  }
});

// DELETE /api/manuscripts/slots/:id/files/:fileId
router.delete('/slots/:id(\\d+)/files/:fileId(\\d+)', async (req, res, next) => {
  try {
    const okFlag = await ms.deleteSlotFile(req.params.fileId);
    if (!okFlag) return fail(res, 404, 'NOT_FOUND', 'file not found');
    return ok(res, { deleted: 1 });
  } catch (e) { next(e); }
});

// DELETE /api/manuscripts/:date - 日付ごと全スロット削除 (DB + Drive)
router.delete('/:date(\\d{4}-\\d{2}-\\d{2})', async (req, res, next) => {
  try {
    const result = await ms.deleteDate(req.params.date);
    return ok(res, result);
  } catch (e) { next(e); }
});

module.exports = router;
