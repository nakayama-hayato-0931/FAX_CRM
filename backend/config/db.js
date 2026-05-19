const mysql = require('mysql2/promise');

let pool = null;
let dbConfigured = false;

function buildPool() {
  if (!process.env.DB_HOST) return null;
  dbConfigured = true;
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'fax_crm',
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    queueLimit: 0,
    charset: 'utf8mb4_general_ci',
    dateStrings: ['DATE'],
  });
}

function getPool() {
  if (!pool) pool = buildPool();
  return pool;
}

async function ping() {
  const p = getPool();
  if (!p) return { ok: false, configured: false };
  const conn = await p.getConnection();
  try {
    await conn.ping();
    return { ok: true, configured: true };
  } finally {
    conn.release();
  }
}

module.exports = { getPool, ping, isConfigured: () => dbConfigured };
