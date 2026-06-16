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

const { ping, isConfigured, getPool } = require('../config/db');
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
const sendResultSummaryRouter = require('./routes/sendResultSummary');

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
  // scheduler の状態も同梱 (認証なしで見られる、 定時動作確認用)
  const scheduler = {
    enabled: !(process.env.DAILY_SYNC_ENABLED === '0' || process.env.FAX_STATS_DAILY_SYNC_ENABLED === '0'),
    hour: Number(process.env.DAILY_SYNC_HOUR ?? process.env.FAX_STATS_DAILY_SYNC_HOUR ?? 7),
    minute: Number(process.env.DAILY_SYNC_MINUTE ?? process.env.FAX_STATS_DAILY_SYNC_MINUTE ?? 0),
    jstNow: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace('Z', ''),
    jobs: SCHEDULER_JOBS.map((j) => ({
      name: j.name,
      lastRunDate: j._lastRunDate || null,
      state: SCHEDULER_STATE[j.name]?.state || 'idle',
      startedAt: SCHEDULER_STATE[j.name]?.startedAt || null,
      finishedAt: SCHEDULER_STATE[j.name]?.finishedAt || null,
      elapsedSec: SCHEDULER_STATE[j.name]?.elapsedSec || null,
      error: SCHEDULER_STATE[j.name]?.error || null,
    })),
  };
  res.json({ status: 'ok', db, uptime: process.uptime(), env: process.env.NODE_ENV, scheduler });
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
app.use('/api/send-result-summary', requireAuth, sendResultSummaryRouter);

// scheduler 手動 trigger ルート (notFound より前に登録)
registerSchedulerRoutes(app);

app.use(notFound);
app.use(errorHandler);

const PORT = Number(process.env.PORT || 4001);
const server = app.listen(PORT, () => {
  console.log(`[server] FAX CRM Backend listening on :${PORT}`);

  // DB pool を先に初期化 (lazy 初期化なので getPool() を 1 回呼んで
  //   dbConfigured を true にしないと isConfigured() が常に false になる)
  if (process.env.DB_HOST) {
    try { getPool(); } catch (_e) {}
  }

  // 定時スケジューラを最優先で起動 (migration を待たない)
  //   旧実装は listen callback の中で await runStartupMigrations() を
  //   先に呼んでいたため、 大規模 ALTER TABLE (49 万件への index 追加など)
  //   で callback が数分ブロックされ、 startDailyScheduler() の登録が遅延し、
  //   結果として朝 7:00 の sync が走らない 事象があった。
  //   scheduler 自体は 60 秒間隔の setInterval なので、 migration が
  //   進行中でも 各 sync は DB 接続待ちで自然に直列化される。
  if (isConfigured()) {
    startDailyScheduler();
  } else {
    console.log('[server] ⚠ DB未設定 (DB_HOST が空)。.env を設定するとDB機能が有効になります。');
    return;
  }

  // migration / admin bootstrap は バックグラウンドで実行 (await しない)
  //   listen callback は同期的にすぐ return、 startDailyScheduler の
  //   setInterval を確実に登録する
  (async () => {
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

    try {
      const r = await authSvc.bootstrapInitialAdmin();
      if (r.created) console.log(`[auth] initial admin created: ${r.username}`);
    } catch (e) {
      console.error('[auth] 初期 admin 作成失敗:', e.message);
    }
  })();
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

  // JST の今日の日付 (YYYY-MM-DD)
  function jstToday() {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return jst.toISOString().slice(0, 10);
  }
  // JST 現在時刻が hour:minute 以降か
  function jstPastTarget() {
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const h = jst.getUTCHours();
    const m = jst.getUTCMinutes();
    return h > hour || (h === hour && m >= minute);
  }

  // 各ジョブの最終実行日 (YYYY-MM-DD) を 1 日 1 回ガード
  //   process メモリ上のみ保持 (再起動でリセット)。
  //   Railway 再起動が朝 7:00 をまたいでも、 起動後 60 秒以内に
  //   tick() が走り 「今日まだ動いてない」 を検知して 1 回だけ実行する。
  for (const j of SCHEDULER_JOBS) j._lastRunDate = null;

  async function tick() {
    if (!jstPastTarget()) return;       // まだ朝 7:00 前 → 何もしない
    const today = jstToday();
    for (let i = 0; i < SCHEDULER_JOBS.length; i++) {
      const job = SCHEDULER_JOBS[i];
      if (job._lastRunDate === today) continue;  // 今日もう走った
      job._lastRunDate = today;                  // 先にマーク (二重起動防止)
      // Google Sheets API rate limit 回避のため 5 秒 stagger で順次起動
      setTimeout(() => { runJob(job.name).catch(() => {}); }, i * 5_000);
    }
  }

  // 毎分 1 回チェック (1 日 1 回しか走らない、 失敗してもリトライしない、 起動時の即時実行もしない)
  setInterval(tick, 60 * 1000);
  console.log(`[scheduler] daily sync: enabled at JST ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (poll every 60s, lastRunDate guard, jobs: ${SCHEDULER_JOBS.map((j) => j.name).join(', ')})`);
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
