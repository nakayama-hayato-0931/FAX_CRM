const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const extraction = require('../services/extractionService');
const drive = require('../services/driveService');
const settings = require('../services/settingsService');
const { getPool } = require('../../config/db');
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

// DELETE /api/batches/:id - バッチ削除
//   extraction_records は CASCADE で同時削除、incoming_call_reports.batch_id は SET NULL
router.delete('/:id(\\d+)', async (req, res, next) => {
  try {
    const deleted = await extraction.deleteBatch(req.params.id);
    if (!deleted) return fail(res, 404, 'NOT_FOUND', 'batch not found');
    return ok(res, { deleted: 1 });
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

// POST /api/batches/check-slots — 日付 + PC番号(配列) の slot 存在確認
//   返り値: { date, missingPcs: [n,...], allExist: bool }
router.post('/check-slots', async (req, res, next) => {
  try {
    const ms = require('../services/manuscriptService');
    const { date, pcNumbers } = req.body || {};
    if (!date || !Array.isArray(pcNumbers) || !pcNumbers.length) {
      return fail(res, 400, 'INVALID_INPUT', 'date と pcNumbers (配列) が必要');
    }
    const missing = [];
    for (const pc of pcNumbers) {
      const slot = await ms.getSlotByDateAndPc(date, Number(pc));
      if (!slot) missing.push(Number(pc));
    }
    return ok(res, { date, missingPcs: missing, allExist: missing.length === 0 });
  } catch (e) { next(e); }
});

// POST /api/batches/ensure-slots — 日付の23スロットを冪等作成
router.post('/ensure-slots', async (req, res, next) => {
  try {
    const ms = require('../services/manuscriptService');
    const { date } = req.body || {};
    if (!date) return fail(res, 400, 'INVALID_INPUT', 'date が必要');
    const r = await ms.ensureSlotsExist(date);
    return ok(res, r);
  } catch (e) { next(e); }
});

// POST /api/batches/extract-and-upload — リスト抽出 + 各 PC スロットに自動 Drive upload
//   body: { listName, date, industry, prefecture, recentDays, targetCount, pcNumbers: [1,3] }
//   各 PC ごとに 1バッチ作成 → Excel生成 → manuscripts[date][slot=pc] の Drive フォルダにアップ
router.post('/extract-and-upload', async (req, res, next) => {
  const ms = require('../services/manuscriptService');
  const body = req.body || {};
  if (!body.date || !Array.isArray(body.pcNumbers) || !body.pcNumbers.length) {
    return fail(res, 400, 'INVALID_INPUT', 'date と pcNumbers (配列) が必要');
  }
  if (!body.targetCount) return fail(res, 400, 'INVALID_INPUT', 'targetCount が必要');

  const results = [];
  for (const pc of body.pcNumbers) {
    const pcNum = Number(pc);
    let batchInfo = null, driveInfo = null, error = null;
    let tmpPath = null;
    try {
      // 1. extraction_batch を作成 (per-PC count = targetCount)
      const created = await extraction.createBatch({
        name: `${body.listName || 'リスト'}_${body.date}_PC${String(pcNum).padStart(2, '0')}`,
        industry: body.industry || null,
        prefecture: body.prefecture || null,
        recentDays: Number(body.recentDays) || null,
        targetCount: Number(body.targetCount),
        pcNumber: `NO.${pcNum}`,
      });
      batchInfo = { batchId: created.batchId, actualCount: created.actualCount };

      // 2. Excel生成
      const excelResult = await extraction.generateExcelBuffer(created.batchId);

      // 3. スロットを確保 (manuscripts[date][slot=pc])
      let slot = await ms.getSlotByDateAndPc(body.date, pcNum);
      if (!slot) {
        await ms.ensureSlotsExist(body.date);
        slot = await ms.getSlotByDateAndPc(body.date, pcNum);
      }
      if (!slot) throw new Error(`スロット作成失敗 (${body.date} / PC${pcNum})`);

      // 4. Excel を Drive にアップロード (スロットの Drive folder 配下)
      tmpPath = path.join(os.tmpdir(), `${Date.now()}_${excelResult.fileName}`);
      fs.writeFileSync(tmpPath, excelResult.buffer);
      const parentId = await ms.ensureSlotDriveFolder(slot.id);
      const uploaded = await drive.uploadFile({
        filePath: tmpPath,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        name: excelResult.fileName,
        parentId,
      });

      // 5. manuscript_slot_files に記録
      const pool = getPool();
      if (pool) {
        await pool.query(
          `INSERT INTO manuscript_slot_files
             (manuscript_id, kind, original_name, mime_type, size_bytes, drive_file_id, drive_url)
           VALUES (?, 'excel', ?, ?, ?, ?, ?)`,
          [slot.id, excelResult.fileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           excelResult.buffer.length, uploaded.id, uploaded.webViewLink || null]
        );
        await pool.query(
          `UPDATE extraction_batches
              SET drive_file_id = ?, drive_file_url = ?, status = 'ready'
            WHERE id = ?`,
          [uploaded.id, uploaded.webViewLink || null, created.batchId]
        );
      }
      driveInfo = { fileId: uploaded.id, webViewLink: uploaded.webViewLink, slotId: slot.id };
    } catch (e) {
      error = e.userMessage || e.sqlMessage || e.message;
    } finally {
      if (tmpPath && fs.existsSync(tmpPath)) { try { fs.unlinkSync(tmpPath); } catch (_) {} }
    }
    results.push({ pcNumber: pcNum, batch: batchInfo, drive: driveInfo, error });
  }
  return created(res, { date: body.date, results });
});

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
