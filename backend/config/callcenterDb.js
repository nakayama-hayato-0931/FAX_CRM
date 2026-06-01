/**
 * callcenter-ai-system の MySQL への接続プール (Phase 2: シャドー二重書き用)。
 *
 * ENV:
 *   CALLCENTER_DB_HOST       Railway の callcenter MySQL ホスト名 (例: monorail.proxy.rlwy.net)
 *   CALLCENTER_DB_PORT       同ポート
 *   CALLCENTER_DB_USER       接続ユーザー (専用ユーザー推奨)
 *   CALLCENTER_DB_PASSWORD   接続パスワード
 *   CALLCENTER_DB_NAME       database 名 (例: railway)
 *
 * 未設定なら getPool() は null を返す → 呼び出し側で no-op として扱う。
 *
 * これは「fax-crm 本来の DB とは別に」 callcenter DB にも書く目的のみ。
 * fax-crm 本処理の DB は config/db.js のまま。
 */
const mysql = require('mysql2/promise');

let pool = null;
let triedBuild = false;

function isConfigured() {
  return !!process.env.CALLCENTER_DB_HOST && !!process.env.CALLCENTER_DB_USER;
}

function buildPool() {
  if (!isConfigured()) return null;
  return mysql.createPool({
    host: process.env.CALLCENTER_DB_HOST,
    port: Number(process.env.CALLCENTER_DB_PORT || 3306),
    user: process.env.CALLCENTER_DB_USER,
    password: process.env.CALLCENTER_DB_PASSWORD || '',
    database: process.env.CALLCENTER_DB_NAME || 'railway',
    waitForConnections: true,
    connectionLimit: Number(process.env.CALLCENTER_DB_CONNECTION_LIMIT || 5),
    queueLimit: 0,
    charset: 'utf8mb4_general_ci',
    dateStrings: ['DATE'],
    connectTimeout: 10000,
  });
}

function getPool() {
  if (pool) return pool;
  if (triedBuild) return null;
  triedBuild = true;
  pool = buildPool();
  if (pool) console.log('[callcenterDb] connection pool 構築');
  else console.log('[callcenterDb] 未設定 (CALLCENTER_DB_HOST 等が空) — shadow write skip');
  return pool;
}

async function ping() {
  const p = getPool();
  if (!p) return { ok: false, configured: false };
  try {
    const conn = await p.getConnection();
    await conn.ping();
    conn.release();
    return { ok: true, configured: true };
  } catch (e) {
    return { ok: false, configured: true, error: e.message };
  }
}

module.exports = { getPool, ping, isConfigured };
