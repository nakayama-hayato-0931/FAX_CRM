const express = require('express');
const settings = require('../services/settingsService');
const drive = require('../services/driveService');
const { ok, fail } = require('../utils/response');

const router = express.Router();

// GET /api/settings
router.get('/', async (_req, res, next) => {
  try {
    const [all, driveStatus] = await Promise.all([
      settings.getAll(),
      Promise.resolve(drive.getStatus()),
    ]);
    return ok(res, { settings: all, drive: driveStatus });
  } catch (e) { next(e); }
});

// PUT /api/settings
router.put('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body || typeof body !== 'object') return fail(res, 400, 'INVALID_BODY', 'JSONオブジェクトを送ってください');
    const updated = await settings.setMany(body);
    return ok(res, updated);
  } catch (e) { next(e); }
});

// POST /api/settings/drive/test
router.post('/drive/test', async (_req, res, next) => {
  try {
    const result = await drive.testConnection();
    return ok(res, result);
  } catch (e) { next(e); }
});

module.exports = router;
