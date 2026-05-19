#!/usr/bin/env node
/**
 * 起動前準備: 環境変数 GOOGLE_SERVICE_ACCOUNT_KEY_JSON があれば
 *   ./config/google-service-account.json に書き出して
 *   GOOGLE_SERVICE_ACCOUNT_KEY_PATH を上書きする。
 *
 * Railway のようにファイルアップロード機能がない環境で
 * サービスアカウントJSONを安全に配置するためのブートスクリプト。
 */
const fs = require('fs');
const path = require('path');

const json = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
if (!json) {
  console.log('[prepare] GOOGLE_SERVICE_ACCOUNT_KEY_JSON 未設定。Drive/Sheets連携を使う場合は要設定。');
  process.exit(0);
}

try {
  // 軽くバリデーション (JSONとしてパース可能か)
  const parsed = JSON.parse(json);
  if (!parsed.client_email || !parsed.private_key) {
    console.error('[prepare] JSONに client_email / private_key が含まれていません。値を確認してください。');
    process.exit(1);
  }
  const dir = path.resolve(__dirname, '../config');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const dst = path.resolve(dir, 'google-service-account.json');
  fs.writeFileSync(dst, json, { mode: 0o600 });
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH = dst;
  console.log(`[prepare] service account JSON written to ${dst} (client: ${parsed.client_email})`);
} catch (e) {
  console.error('[prepare] JSON書き出し失敗:', e.message);
  process.exit(1);
}
