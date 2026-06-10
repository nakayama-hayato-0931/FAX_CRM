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

// scheduler 手動 trigger ルート (notFound より前に登録)
registerSchedulerRoutes(app);

app.use(notFound);
app.use(errorHandler);

const PORT = Number(process.env.PORT || 4001);
const server = app.listen(PORT, async () => {
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

  // 定時スケジューラ: 毎朝 JST 7:00 に 各種シート同期を直列実行
  //   FAX 送信実績 → 売上 → 案件 → 面接 の順
  startDailyScheduler();
});

// ============================================================
// 定時スケジューラ (JST 基準)
// ============================================================
//   Railway は UTC で動くので TZ 計算を内部で実施。
//   node-cron を入れず 軽量 setTimeout チェーンで実装。
//
//   実行ジョブ (順次):
//     1. FAX 送信実績 同期 (直近 N 日)
//     2. 売上 (sales-projects) シート同期
//     3. 案件 (job-postings) シート同期
//     4. 面接 (interviews) シート同期
//
//   env:
//     DAILY_SYNC_HOUR        (default 7)  — 起動時刻 (JST hour 0-23)
//     DAILY_SYNC_MINUTE      (default 0)
//     DAILY_SYNC_ENABLED=0   — 全体無効化
//     FAX_STATS_DAILY_SYNC_DAYS (default 7) — FAX 同期の直近日数
//     旧 FAX_STATS_DAILY_SYNC_HOUR/MINUTE/ENABLED も後方互換で読む
// 個別 job ランナー (手動 trigger 用にも export)。 ここで取得した jobs は
//   個別に setTimeout で予約され、 1 ジョブの長時間化 / 例外で他が止まらない
const SCHEDULER_JOBS = (() => {
  const faxStatsDays = Number(process.env.FAX_STATS_DAILY_SYNC_DAYS ?? 7);
  return [
    {
      name: 'fax-stats',
      fn: async () => {
        const svc = require('./services/faxStatsService');
        return svc.syncFromSheets({ recentOnly: true, recentDays: faxStatsDays });
      },
    },
    {
      name: 'sales-projects',
      fn: async () => {
        const svc = require('./services/salesProjectService');
        return svc.syncFromSheets();
      },
    },
    {
      name: 'job-postings',
      fn: async () => {
        const svc = require('./services/jobPostingService');
        return svc.syncFromSheets();
      },
    },
    {
      name: 'interviews',
      fn: async () => {
        const svc = require('./services/interviewService');
        return svc.syncFromSheets();
      },
    },
  ];
})();

// 進行中ステータス (手動 trigger / status 確認用)
const SCHEDULER_STATE = {};
for (const j of SCHEDULER_JOBS) {
  SCHEDULER_STATE[j.name] = { state: 'idle', startedAt: null, finishedAt: null, elapsedSec: null, result: null, error: null };
}

async function runJob(name) {
  const job = SCHEDULER_JOBS.find((j) => j.name === name);
  if (!job) throw new Error(`unknown job: ${name}`);
  const st = SCHEDULER_STATE[name];
  if (st.state === 'running') {
    console.log(`[scheduler] ${name}: skip (already running)`);
    return { skipped: true, reason: 'already_running' };
  }
  st.state = 'running'; st.startedAt = new Date().toISOString(); st.finishedAt = null; st.error = null; st.result = null;
  const t0 = Date.now();
  console.log(`[scheduler] ${name} sync: START`);
  try {
    const result = await job.fn();
    const elapsed = Math.round((Date.now() - t0) / 1000);
    st.state = 'done'; st.finishedAt = new Date().toISOString(); st.elapsedSec = elapsed; st.result = result;
    console.log(`[scheduler] ${name} sync: DONE elapsed=${elapsed}s result=${JSON.stringify(result)}`);
    return result;
  } catch (e) {
    const elapsed = Math.round((Date.now() - t0) / 1000);
    st.state = 'failed'; st.finishedAt = new Date().toISOString(); st.elapsedSec = elapsed; st.error = e.message;
    console.error(`[scheduler] ${name} sync: FAILED elapsed=${elapsed}s err=${e.message}\n${e.stack}`);
    throw e;
  }
}

function startDailyScheduler() {
  // 後方互換: FAX_STATS_DAILY_SYNC_ENABLED=0 でも全体無効化扱い
  if (process.env.DAILY_SYNC_ENABLED === '0' || process.env.FAX_STATS_DAILY_SYNC_ENABLED === '0') {
    console.log('[scheduler] daily sync: DISABLED (env)');
    return;
  }
  const hour = Number(process.env.DAILY_SYNC_HOUR ?? process.env.FAX_STATS_DAILY_SYNC_HOUR ?? 7);
  const minute = Number(process.env.DAILY_SYNC_MINUTE ?? process.env.FAX_STATS_DAILY_SYNC_MINUTE ?? 0);

  function nextRunMs() {
    // JST = UTC + 9h。 「JST の今日 hour:minute」 が過ぎていれば翌日に
    const now = new Date();
    const jstMs = now.getTime() + 9 * 60 * 60 * 1000;
    const jst = new Date(jstMs);
    jst.setUTCHours(hour, minute, 0, 0);
    let targetUtcMs = jst.getTime() - 9 * 60 * 60 * 1000;
    if (targetUtcMs <= now.getTime()) targetUtcMs += 24 * 60 * 60 * 1000;
    return targetUtcMs - now.getTime();
  }

  // 各ジョブを 個別 setTimeout チェーンで予約
  //   理由: 旧実装 (for-loop) では fax-stats が 45 分かかった日に
  //   後続 3 ジョブが押し出されて 翌日に走らなかった事例があった。
  //   個別 setTimeout なら 1 ジョブが長くても他は時刻通りに発火する。
  //   ※ 同時刻だと Google Sheets API rate limit のリスクがあるため、
  //   2 番目以降は 5 秒 ずつずらして 直列に近い順次起動 (上の jobs 配列の順)。
  for (let i = 0; i < SCHEDULER_JOBS.length; i++) {
    const job = SCHEDULER_JOBS[i];
    const stagger = i * 5_000; // 5 秒ずつずらす
    const scheduleNext = () => {
      const delay = nextRunMs() + stagger;
      console.log(`[scheduler] ${job.name}: next run in ${Math.round(delay / 1000 / 60)} min`);
      setTimeout(async () => {
        try { await runJob(job.name); } catch (_e) { /* logged in runJob */ }
        scheduleNext();
      }, delay);
    };
    scheduleNext();
  }

  console.log(`[scheduler] daily sync: enabled at JST ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (jobs: ${SCHEDULER_JOBS.map((j) => j.name).join(', ')}, 5s staggered)`);
}

// 手動 trigger ルートは notFound より前に登録する必要があるので
//   このスコープではなく app.use('/api/...') 群と一緒に server.js 上部で
//   定義済み (registerSchedulerRoutes 経由)。 ここでは関数だけ用意し、
//   ファイル先頭で呼び出される
function registerSchedulerRoutes(app) {
  app.get('/api/admin/scheduler/status', requireAuth, (_req, res) => {
    res.json({ success: true, data: SCHEDULER_STATE });
  });
  app.post('/api/admin/scheduler/run-now', requireAuth, async (req, res) => {
    const which = (req.query.job || req.body?.job || 'all').toString();
    if (which !== 'all' && !SCHEDULER_JOBS.find((j) => j.name === which)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: `unknown job: ${which}` } });
    }
    const targets = which === 'all' ? SCHEDULER_JOBS.map((j) => j.name) : [which];
    // 即時 202 で返却 → バックグラウンドで順次実行 (fail-soft)
    res.status(202).json({ success: true, data: { accepted: true, targets } });
    for (const name of targets) {
      try { await runJob(name); } catch (_e) { /* logged */ }
    }
  });
}

// 大規模インポート (60万行クラス) 対応: HTTP server の各種 timeout を緩める
//   - keepAliveTimeout / headersTimeout の デフォは 65/66 秒 (Node 18)
//   - 大規模アップロード処理中の long polling 接続 維持のため 2時間に
server.requestTimeout = 0;            // 0 = リクエスト全体の timeout を無効化 (Node 18.2+)
server.headersTimeout = 2 * 60 * 60 * 1000;
server.keepAliveTimeout = 2 * 60 * 60 * 1000;
server.timeout = 2 * 60 * 60 * 1000;  // socket timeout
