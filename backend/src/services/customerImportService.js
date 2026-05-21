const fs = require('fs');
const csv = require('csv-parser');
const { getPool, isConfigured } = require('../../config/db');

const DEFAULT_MAPPING = {
  '会社名': 'company_name', '企業名': 'company_name', 'company_name': 'company_name',
  'FAX': 'fax_number', 'FAX番号': 'fax_number', 'fax': 'fax_number', 'fax_number': 'fax_number',
  '電話番号': 'phone_number', 'TEL': 'phone_number', 'phone': 'phone_number', 'phone_number': 'phone_number',
  '業種': 'industry', 'industry': 'industry',
  '都道府県': 'prefecture', 'prefecture': 'prefecture',
  '市区町村': 'city', 'city': 'city',
  '住所': 'address', 'address': 'address',
  '郵便番号': 'postal_code', 'postal_code': 'postal_code',
  'URL': 'url', 'HP': 'url', 'url': 'url',
  '従業員数': 'employee_count', 'employee_count': 'employee_count',
  '代表者': 'representative', 'representative': 'representative',
  '備考': 'note', 'メモ': 'note', 'note': 'note',
};

const VALID = new Set([
  'company_name', 'fax_number', 'phone_number', 'industry',
  'prefecture', 'city', 'address', 'postal_code', 'url',
  'employee_count', 'representative', 'note',
]);

function normalizeFax(v) {
  if (!v) return null;
  return String(v).replace(/[^0-9+]/g, '').trim() || null;
}

function rowToCustomer(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const dbKey = DEFAULT_MAPPING[k] || DEFAULT_MAPPING[k?.trim()];
    if (!dbKey || !VALID.has(dbKey)) continue;
    if (v === undefined || v === null || v === '') continue;
    if (dbKey === 'fax_number') {
      out[dbKey] = normalizeFax(v);
    } else if (dbKey === 'employee_count') {
      const n = Number(String(v).replace(/[^0-9.-]/g, ''));
      out[dbKey] = Number.isFinite(n) ? n : null;
    } else {
      out[dbKey] = String(v).trim();
    }
  }
  return out;
}

async function bulkUpsert(rows, sourceFile) {
  const stats = { inserted: 0, updated: 0, skipped: 0 };
  if (!rows.length) return stats;

  const CHUNK = 500;
  const cols = [
    'company_name', 'fax_number', 'phone_number', 'industry',
    'prefecture', 'city', 'address', 'postal_code', 'url',
    'employee_count', 'representative', 'note',
    'source_file', 'imported_at',
  ];
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const placeholders = [];
      const values = [];
      let validCount = 0;
      for (const c of chunk) {
        if (!c.company_name || !c.fax_number) { stats.skipped++; continue; }
        validCount++;
        placeholders.push(`(${cols.map(() => '?').join(',')})`);
        values.push(
          c.company_name, c.fax_number,
          c.phone_number || null, c.industry || null,
          c.prefecture || null, c.city || null, c.address || null,
          c.postal_code || null, c.url || null,
          c.employee_count ?? null,
          c.representative || null, c.note || null,
          sourceFile || null, new Date()
        );
      }
      if (!placeholders.length) continue;
      const sql = `
        INSERT INTO customers (${cols.join(',')})
        VALUES ${placeholders.join(',')}
        ON DUPLICATE KEY UPDATE
          -- 肉付けマージ: 既存に値があれば残し、空欄(NULL)だけ新値で埋める
          -- ※ company_name は NOT NULL なので実質既存維持
          company_name   = COALESCE(company_name,   VALUES(company_name)),
          phone_number   = COALESCE(phone_number,   VALUES(phone_number)),
          industry       = COALESCE(industry,       VALUES(industry)),
          prefecture     = COALESCE(prefecture,     VALUES(prefecture)),
          city           = COALESCE(city,           VALUES(city)),
          address        = COALESCE(address,        VALUES(address)),
          postal_code    = COALESCE(postal_code,    VALUES(postal_code)),
          url            = COALESCE(url,            VALUES(url)),
          employee_count = COALESCE(employee_count, VALUES(employee_count)),
          representative = COALESCE(representative, VALUES(representative)),
          note           = COALESCE(note,           VALUES(note)),
          -- メタ情報は最新の取込履歴として上書き
          source_file    = VALUES(source_file),
          imported_at    = VALUES(imported_at)
      `;
      const [result] = await conn.query(sql, values);
      // affectedRows = inserted + 2 * updated_with_change
      const updatedWithChange = Math.max(result.affectedRows - validCount, 0);
      stats.inserted += validCount - updatedWithChange;
      stats.updated += updatedWithChange;
    }
  } finally {
    conn.release();
  }
  return stats;
}

async function importCsv(filePath, originalName) {
  if (!isConfigured()) {
    const err = new Error('DBが未設定です。.env の DB_HOST 等を設定してください');
    err.status = 500;
    err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  const customers = [];
  let totalRows = 0;
  await new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        totalRows++;
        const c = rowToCustomer(row);
        if (c.company_name && c.fax_number) customers.push(c);
      })
      .on('end', resolve)
      .on('error', reject);
  });
  const stats = await bulkUpsert(customers, originalName);
  return { totalRows, validRows: customers.length, ...stats };
}

module.exports = { importCsv, rowToCustomer, DEFAULT_MAPPING };
