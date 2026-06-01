#!/usr/bin/env node
/**
 * 定期実行用: ドリフト検出。 結果をログ出力し、 deviation 検出時は exit code 2 で終了
 * (Railway の通知や監視サービスから検知できるように)。
 *
 * 使い方 (Railway cron):
 *   Schedule: 0 9 * * *   (毎日 9時)
 *   Start Command: node src/scripts/driftCheckCron.js
 */
require('dotenv').config();

(async () => {
  try {
    const drift = require('../services/driftCheckService');
    console.log('[driftCheckCron] 開始');
    const r = await drift.runDriftCheck({ sampleSize: 200 });
    console.log('[driftCheckCron] result:', JSON.stringify(r, null, 2));
    if (r.status === 'drift_detected') {
      console.error('[driftCheckCron] ✗ DRIFT DETECTED');
      process.exit(2);
    }
    process.exit(0);
  } catch (e) {
    console.error('[driftCheckCron] エラー:', e.message);
    process.exit(1);
  }
})();
