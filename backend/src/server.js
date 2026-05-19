require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { ping, isConfigured } = require('../config/db');
const { notFound, errorHandler, attachRequestId } = require('./middlewares/errorHandler');
const cpaRouter = require('./routes/cpa');
const customersRouter = require('./routes/customers');
const batchesRouter = require('./routes/batches');
const manuscriptsRouter = require('./routes/manuscripts');
const incomingCallsRouter = require('./routes/incomingCalls');
const faxStatsRouter = require('./routes/faxStats');
const settingsRouter = require('./routes/settings');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3001', credentials: true }));
app.use(attachRequestId);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(morgan('dev'));

app.get('/api/health', async (_req, res) => {
  let db = { ok: false, configured: isConfigured() };
  try { db = await ping(); } catch (_e) { /* keep default */ }
  res.json({ status: 'ok', db, uptime: process.uptime(), env: process.env.NODE_ENV });
});

app.use('/api/cpa', cpaRouter);
app.use('/api/customers', customersRouter);
app.use('/api/batches', batchesRouter);
app.use('/api/manuscripts', manuscriptsRouter);
app.use('/api/incoming-calls', incomingCallsRouter);
app.use('/api/fax-stats', faxStatsRouter);
app.use('/api/settings', settingsRouter);

app.use(notFound);
app.use(errorHandler);

const PORT = Number(process.env.PORT || 4001);
app.listen(PORT, () => {
  console.log(`[server] FAX CRM Backend listening on :${PORT}`);
  if (!isConfigured()) {
    console.log('[server] ⚠ DB未設定 (DB_HOST が空)。.env を設定するとDB機能が有効になります。');
  }
});
