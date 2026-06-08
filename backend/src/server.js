require('dotenv').config();

// Google サービスアカウントJSONの書き出し(Railway等のファイル永続性がない環境向け)
// 環境変数 GOOGLE_SERVICE_ACCOUNT_KEY_JSON があれば ./config/google-service-account.json に書き出し
// 同一プロセス内で GOOGLE_SERVICE_ACCOUNT_KEY_PATH を設定する。
(function setupGoogleCredentials() {
  const fs = require('fs');
  const path = require('path');
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  if (!json) {
    console.log('[server] GOOGLE_SERVICE_ACCOUNT_KEY_JSON 未設定 (Drive/Sheets連携は無効)');
    return;
  }
  try {
    const parsed = JSON.parse(json);
    if (!parsed.client_email || !parsed.private_key) {
      console.warn('[server] GOOGLE_SERVICE_ACCOUNT_KEY_JSON に client_email/private_key が含まれていません');
      return;
    }
    const dir = path.resolve(__dirname, '../config');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const dst = path.resolve(dir, 'google-service-account.json');
    fs.writeFileSync(dst, json, { mode: 0o600 });
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH = dst;
    console.log(`[server] service account JSON written to ${dst} (client: ${parsed.client_email})`);
  } catch (e) {
    console.error('[server] サービスアカウントJSON書き出し失敗:', e.message);
  }
})();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { ping, isConfigured } = require('../config/db');
const { runStartupMigrations } = require('./migrations/runtime');
const { notFound, errorHandler, attachRequestId } = require('./middlewares/errorHandler');
const { requireAuth, requireAuthOrWebhook } = require('./middlewares/auth');
const authSvc = require('./services/authService');
const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const cpaRouter = require('./routes/cpa');
const customersRouter = require('./routes/customers');
const batchesRouter = require('./routes/batches');
const manuscriptsRouter = require('./routes/manuscripts');
const incomingCallsRouter = require('./routes/incomingCalls');
const faxStatsRouter = require('./routes/faxStats');
const settingsRouter = require('./routes/settings');
const contactEventsRouter = require('./routes/contactEvents');
const outsourcedFaxRouter = require('./routes/outsourcedFax');
const salesProjectsRouter = require('./routes/salesProjects');
const interviewsRouter = require('./routes/interviews');
const jobPostingsRouter = require('./routes/jobPostings');
const manuscriptContentsRouter = require('./routes/manuscriptContents');
const ngWordsRouter = require('./routes/ngWords');
const salesOwnersRouter = require('./routes/salesOwners');

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

// 認証 不要 (ログイン と health のみ)
app.use('/api/auth', authRouter);

// 以下、全 API ルートに requireAuth を適用
//   ※ requireAuth は DISABLE_AUTH=1 環境変数で バイパス可能 (開発用)
app.use('/api/users', usersRouter);  // 内部で requireRole('admin')
app.use('/api/cpa', requireAuth, cpaRouter);
// callcenter からのシャドー書きや sync 経由でアクセスできるよう webhook secret も許可
app.use('/api/customers', requireAuthOrWebhook, customersRouter);
app.use('/api/batches', requireAuth, batchesRouter);
app.use('/api/manuscripts', requireAuth, manuscriptsRouter);
app.use('/api/incoming-calls', requireAuth, incomingCallsRouter);
app.use('/api/fax-stats', requireAuth, faxStatsRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/contact-events', requireAuthOrWebhook, contactEventsRouter);
app.use('/api/outsourced-fax', requireAuth, outsourcedFaxRouter);
app.use('/api/sales-projects', requireAuth, salesProjectsRouter);
app.use('/api/interviews', requireAuth, interviewsRouter);
app.use('/api/job-postings', requireAuth, jobPostingsRouter);
app.use('/api/manuscript-contents', requireAuth, manuscriptContentsRouter);
app.use('/api/ng-words', requireAuth, ngWordsRouter);
app.use('/api/sales-owners', requireAuth, salesOwnersRouter);

app.use(notFound);
app.use(errorHandler);

const PORT = Number(process.env.PORT || 4001);
app.listen(PORT, async () => {
  console.log(`[server] FAX CRM Backend listening on :${PORT}`);
  if (!isConfigured()) {
    console.log('[server] ⚠ DB未設定 (DB_HOST が空)。.env を設定するとDB機能が有効になります。');
    return;
  }
  // 起動時 自動スキーマ補正 (冪等)
  try {
    const r = await runStartupMigrations();
    if (r.skipped) {
      console.log('[migrations] skipped (DB未設定)');
    } else {
      if (r.applied.length) console.log('[migrations] applied:', r.applied);
      else                  console.log('[migrations] 適用済み (no-op)');
      if (r.failed.length)  console.warn('[migrations] failed:', r.failed);
    }
  } catch (e) {
    console.error('[migrations] 起動時マイグレーション失敗:', e.message);
  }

  // 初期 admin ユーザー ブートストラップ
  try {
    const r = await authSvc.bootstrapInitialAdmin();
    if (r.created) console.log(`[auth] initial admin created: ${r.username}`);
  } catch (e) {
    console.error('[auth] 初期 admin 作成失敗:', e.message);
  }
});
