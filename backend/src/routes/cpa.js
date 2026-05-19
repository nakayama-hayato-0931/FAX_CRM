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
router.get('/monthly', async (req, res, next) => {
  try {
    const rows = await cpa.getMonthly({ months: req.query.months });
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

module.exports = router;
