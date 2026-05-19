const { getPool } = require('../../config/db');

const SEARCHABLE = ['company_name', 'fax_number', 'phone_number', 'address'];

const SORT_MAP = {
  updated_at: 'updated_at',
  created_at: 'created_at',
  company_name: 'company_name',
  send_count: 'send_count',
  last_sent_at: 'last_sent_at',
};

async function listCustomers(query = {}) {
  const pool = getPool();
  if (!pool) {
    return { items: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 } };
  }

  const where = [];
  const params = [];

  if (query.q) {
    const like = `%${query.q}%`;
    where.push(`(${SEARCHABLE.map((c) => `${c} LIKE ?`).join(' OR ')})`);
    SEARCHABLE.forEach(() => params.push(like));
  }
  if (query.industry)   { where.push('industry = ?');   params.push(query.industry); }
  if (query.prefecture) { where.push('prefecture = ?'); params.push(query.prefecture); }
  if (query.blacklisted === 'true')  where.push('is_blacklisted = 1');
  if (query.blacklisted === 'false') where.push('is_blacklisted = 0');

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sortCol = SORT_MAP[query.sortBy] || 'updated_at';
  const dir = String(query.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const limit = Math.min(Number(query.pageSize) || 50, 200);
  const page = Math.max(Number(query.page) || 1, 1);
  const offset = (page - 1) * limit;

  const [rows] = await pool.query(
    `SELECT id, company_name, fax_number, phone_number, industry, prefecture, city,
            send_count, last_sent_at, last_pc_number, last_result, response_count,
            is_blacklisted, updated_at
       FROM customers
       ${whereSql}
       ORDER BY ${sortCol} ${dir}
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [cnt] = await pool.query(`SELECT COUNT(*) AS total FROM customers ${whereSql}`, params);
  const total = cnt[0].total;

  return {
    items: rows,
    pagination: { page, pageSize: limit, total, totalPages: Math.ceil(total / limit) },
  };
}

async function getById(id) {
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.query(`SELECT * FROM customers WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function getDistinctIndustries() {
  const pool = getPool();
  if (!pool) return [];
  const [rows] = await pool.query(
    `SELECT industry, COUNT(*) AS cnt FROM customers
      WHERE industry IS NOT NULL AND industry <> ''
      GROUP BY industry ORDER BY cnt DESC LIMIT 200`
  );
  return rows;
}

async function getDistinctPrefectures() {
  const pool = getPool();
  if (!pool) return [];
  const [rows] = await pool.query(
    `SELECT prefecture, COUNT(*) AS cnt FROM customers
      WHERE prefecture IS NOT NULL AND prefecture <> ''
      GROUP BY prefecture ORDER BY cnt DESC`
  );
  return rows;
}

async function setBlacklist(id, isBlacklisted, reason) {
  const pool = getPool();
  if (!pool) throw new Error('DB未設定');
  await pool.query(
    `UPDATE customers SET is_blacklisted = ?, blacklisted_reason = ? WHERE id = ?`,
    [isBlacklisted ? 1 : 0, reason || null, id]
  );
}

module.exports = {
  listCustomers,
  getById,
  getDistinctIndustries,
  getDistinctPrefectures,
  setBlacklist,
};
