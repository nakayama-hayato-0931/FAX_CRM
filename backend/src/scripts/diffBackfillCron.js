#!/usr/bin/env node
/**
 * 定期実行用: 差分バックフィルだけを cron から呼ぶスクリプト。
 *
 * 使い方 (Railway cron):
 *   Settings → Schedule → "0 *​/4 * * *" (4時間ごと) など
 *   Start Command: node src/scripts/diffBackfillCron.js
 *
 * 環境変数は backend と同じ DB_HOST 等を使う。
 */
require('dotenv').config();

(async () => {
  try {
    const ccWriter = require('../services/callcenterDbWriter');
    if (!ccWriter.isEnabled()) {
      console.error('[diffBackfillCron] CALLCENTER_DB 未設定。スキップ');
      process.exit(0);
    }
    console.log('[diffBackfillCron] 開始');
    const startedAt = Date.now();
    const stats = await ccWriter.diffBackfill({ limit: 0 });
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[diffBackfillCron] 完了 (${elapsed}s): ${JSON.stringify(stats)}`);
    process.exit(stats.ok ? 0 : 1);
  } catch (e) {
    console.error('[diffBackfillCron] エラー:', e.message);
    process.exit(1);
  }
})();
