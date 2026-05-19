const express = require('express');
const ms = require('../services/manuscriptService');
const { ok, created, fail } = require('../utils/response');

const router = express.Router();

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

// DELETE /api/manuscripts/:date - 日付ごと全スロット削除
router.delete('/:date(\\d{4}-\\d{2}-\\d{2})', async (req, res, next) => {
  try {
    const deleted = await ms.deleteDate(req.params.date);
    return ok(res, { deleted });
  } catch (e) { next(e); }
});

module.exports = router;
