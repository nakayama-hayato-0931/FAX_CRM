#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const sqlPath = path.resolve(__dirname, '../../database/init.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error(`[migrate] init.sql not found: ${sqlPath}`); process.exit(1);
  }
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'fax_crm',
    multipleStatements: true,
  });

  console.log(`[migrate] applying init.sql -> ${process.env.DB_NAME || 'fax_crm'}`);
  try {
    await conn.query(sql);
    console.log('[migrate] success');
  } catch (e) {
    console.error('[migrate] failed:', e.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
}
main();
