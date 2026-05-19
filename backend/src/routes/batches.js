const express = require('express');
const extraction = require('../services/extractionService');
const { ok, created, fail } = require('../utils/response');

const router = express.Router();

// GET /api/batches - バッチ一覧
router.get('/', async (req, res, next) => {
  try {
    const result = await extraction.listBatches(req.query);
    return ok(res, result.items, { pagination: result.pagination });
  } catch (e) { next(e); }
});

// GET /api/batches/preview?industry=&prefecture=&recentDays= - 該当件数プレビュー
router.get('/preview', async (req, res, next) => {
  try {
    const result = await extraction.previewCount(req.query);
    return ok(res, result);
  } catch (e) { next(e); }
});

// POST /api/batches - 抽出実行
router.post('/', async (req, res, next) => {
  try {
    const { name, industry, prefecture, recentDays, targetCount, pcNumber } = req.body || {};
    const result = await extraction.createBatch({
      name, industry, prefecture, recentDays,
      targetCount: Number(targetCount),
      pcNumber,
    });
    return created(res, result);
  } catch (e) { next(e); }
});

// GET /api/batches/:id - バッチ詳細 + 顧客一覧
router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const data = await extraction.getBatchWithCustomers(req.params.id);
    if (!data) return fail(res, 404, 'NOT_FOUND', 'batch not found');
    return ok(res, data);
  } catch (e) { next(e); }
});

// GET /api/batches/:id/excel - Excelダウンロード
router.get('/:id(\\d+)/excel', async (req, res, next) => {
  try {
    const result = await extraction.generateExcelBuffer(req.params.id);
    if (!result) return fail(res, 404, 'NOT_FOUND', 'batch not found');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(result.fileName)}"`
    );
    return res.send(result.buffer);
  } catch (e) { next(e); }
});

// POST /api/batches/:id/upload-to-drive  Excelを生成してDriveに保存
const fs = require('fs');
const path = require('path');
const os = require('os');
const drive = require('../services/driveService');
const settings = require('../services/settingsService');
const { getPool } = require('../../config/db');

router.post('/:id(\\d+)/upload-to-drive', async (req, res, next) => {
  let tmpPath;
  try {
    const result = await extraction.generateExcelBuffer(req.params.id);
    if (!result) return fail(res, 404, 'NOT_FOUND', 'batch not found');

    const rootFolderId = await settings.get('drive_root_folder_id');
    if (!rootFolderId) {
      return fail(res, 400, 'NO_ROOT_FOLDER', '設定画面で drive_root_folder_id を登録してください');
    }

    // 日付サブフォルダ /FAXリスト/{YYYY-MM-DD}/{file}.xlsx
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const dateFolder = await drive.findOrCreateFolder({ name: ymd, parentId: rootFolderId });

    tmpPath = path.join(os.tmpdir(), `${Date.now()}_${result.fileName}`);
    fs.writeFileSync(tmpPath, result.buffer);
    const uploaded = await drive.uploadFile({
      filePath: tmpPath,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      name: result.fileName,
      parentId: dateFolder.id,
    });

    // DBに保存
    const pool = getPool();
    if (pool) {
      await pool.query(
        `UPDATE extraction_batches
            SET drive_file_id = ?, drive_file_url = ?, status = 'ready'
          WHERE id = ?`,
        [uploaded.id, uploaded.webViewLink, req.params.id]
      );
    }
    return ok(res, {
      driveFolder: { id: dateFolder.id, webViewLink: dateFolder.webViewLink, created: dateFolder.created },
      driveFile: { id: uploaded.id, name: uploaded.name, webViewLink: uploaded.webViewLink },
    });
  } catch (e) { next(e); }
  finally { if (tmpPath && fs.existsSync(tmpPath)) fs.unlink(tmpPath, () => {}); }
});

module.exports = router;
