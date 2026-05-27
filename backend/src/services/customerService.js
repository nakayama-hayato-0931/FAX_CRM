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
    const raw = String(query.q);
    const like = `%${raw}%`;
    // 文字列カラムは通常の LIKE
    // 電話 / FAX カラムは「ハイフン無視」 にするため、 数字のみで部分一致もチェック
    const digitsOnly = raw.replace(/[^0-9]/g, '');
    const orParts = SEARCHABLE.map((col) => `c.${col} LIKE ?`);
    SEARCHABLE.forEach(() => params.push(like));
    if (digitsOnly.length >= 3) {
      // fax_number / phone_number の 「-」 や空白を取り除いた状態で部分一致
      orParts.push(`REGEXP_REPLACE(c.fax_number, '[^0-9]', '') LIKE ?`);
      params.push(`%${digitsOnly}%`);
      orParts.push(`REGEXP_REPLACE(c.phone_number, '[^0-9]', '') LIKE ?`);
      params.push(`%${digitsOnly}%`);
    }
    where.push(`(${orParts.join(' OR ')})`);
  }
  // industry フィルタは「業種カテゴリ (6種)」のいずれかに正規化された値で絞る
  if (query.industry) {
    where.push('c.industry_category = ?');
    params.push(query.industry);
  }
  if (query.prefecture) { where.push('c.prefecture = ?'); params.push(query.prefecture); }
  if (query.blacklisted === 'true')  where.push('c.is_blacklisted = 1');
  if (query.blacklisted === 'false') where.push('c.is_blacklisted = 0');

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sortCol = SORT_MAP[query.sortBy] || 'updated_at';
  const dir = String(query.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

  const limit = Math.min(Number(query.pageSize) || 50, 200);
  const page = Math.max(Number(query.page) || 1, 1);
  const offset = (page - 1) * limit;

  const [rows] = await pool.query(
    `SELECT c.id, c.company_name, c.fax_number, c.phone_number,
            c.industry, c.industry_category, c.prefecture, c.city,
            c.send_count, c.last_sent_at, c.last_pc_number, c.last_result, c.response_count,
            c.is_blacklisted, c.updated_at, c.external_callcenter_id,
            COALESCE(cc.call_count, 0) AS call_count
       FROM customers c
       LEFT JOIN (
         SELECT customer_id, COUNT(*) AS call_count
           FROM contact_events
          WHERE channel = 'call'
          GROUP BY customer_id
       ) cc ON cc.customer_id = c.id
       ${whereSql}
       ORDER BY c.${sortCol} ${dir}
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [cnt] = await pool.query(`SELECT COUNT(*) AS total FROM customers c ${whereSql}`, params);
  const total = cnt[0].total;

  return {
    items: rows,
    pagination: { page, pageSize: limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * 受電報告 手動入力等で「会社名/電話/FAX のいずれか」 から顧客を確保する
 *   - phone/fax は半角化 + 数字のみに正規化
 *   - 既存 (fax_number / phone_number で照合) があれば再利用
 *   - 無ければ新規 INSERT
 *   - 必要なら industry / prefecture / address / industry_category なども初期化
 *
 *   payload: { company_name, phone_number, fax_number, industry, prefecture, address, source_file }
 */
function _normalizeDigit(s) {
  if (!s) return null;
  // 全角数字を半角に
  let t = String(s).replace(/[0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  // 全角ハイフン類を半角に
  t = t.replace(/[‐‑‒–—―−ー－]/g, '-');
  // 全角(+) を半角に
  t = t.replace(/[+]/g, '+');
  // 数字 / + / - 以外を除去 + 32文字 clip
  t = t.replace(/[^0-9+\-]/g, '').slice(0, 32);
  return t || null;
}

async function quickCreate(payload = {}) {
  const pool = getPool();
  if (!pool) { const e = new Error('DB未設定'); e.status = 500; throw e; }
  const company = (payload.company_name || '').trim();
  const fax     = _normalizeDigit(payload.fax_number);
  const phone   = _normalizeDigit(payload.phone_number);
  if (!company && !fax && !phone) {
    const e = new Error('company_name / fax_number / phone_number のいずれか必須');
    e.status = 400; e.code = 'NO_KEY'; throw e;
  }

  // 1. 既存検索 (fax → phone → company)、 ハイフン等の差を吸収するため数字のみで比較
  if (fax) {
    const faxDigits = fax.replace(/[^0-9]/g, '');
    if (faxDigits.length >= 6) {
      const [r] = await pool.query(
        `SELECT id, company_name, fax_number, phone_number FROM customers
          WHERE REGEXP_REPLACE(COALESCE(fax_number, ''), '[^0-9]', '') = ? LIMIT 1`,
        [faxDigits]
      );
      if (r[0]) return { ...r[0], reused: 'fax' };
    }
  }
  if (phone) {
    const phoneDigits = phone.replace(/[^0-9]/g, '');
    if (phoneDigits.length >= 6) {
      const [r] = await pool.query(
        `SELECT id, company_name, fax_number, phone_number FROM customers
          WHERE REGEXP_REPLACE(COALESCE(phone_number, ''), '[^0-9]', '') = ? LIMIT 1`,
        [phoneDigits]
      );
      if (r[0]) return { ...r[0], reused: 'phone' };
    }
  }
  if (company && !fax && !phone) {
    // 会社名のみで完全一致 → 既存があれば再利用
    const [r] = await pool.query('SELECT id, company_name, fax_number, phone_number FROM customers WHERE company_name = ? LIMIT 1', [company]);
    if (r[0]) return { ...r[0], reused: 'company_name' };
  }

  // 2. 新規 INSERT
  const [result] = await pool.query(
    `INSERT INTO customers (
       company_name, fax_number, phone_number,
       industry, prefecture, address, source_file, imported_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      company || '(名称未登録)',
      fax || null,
      phone || null,
      payload.industry || null,
      payload.prefecture || null,
      payload.address || null,
      payload.source_file || 'manual-entry',
    ]
  );
  const [created] = await pool.query(
    'SELECT id, company_name, fax_number, phone_number FROM customers WHERE id = ?',
    [result.insertId]
  );
  return { ...created[0], reused: false, created: true };
}

async function getById(id) {
  const pool = getPool();
  if (!pool) return null;
  const [rows] = await pool.query(`SELECT * FROM customers WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

/**
 * 業種カテゴリ (6種固定) の件数を返す
 *   旧仕様の「industry 詳細を全件 distinct」 から、 6カテゴリ集約に変更
 */
async function getDistinctIndustries() {
  const pool = getPool();
  if (!pool) return [];
  const [rows] = await pool.query(
    `SELECT industry_category AS industry, COUNT(*) AS cnt FROM customers
      WHERE industry_category IS NOT NULL AND industry_category <> ''
      GROUP BY industry_category
      ORDER BY FIELD(industry_category, '飲食','製造','小売','宿泊','建設','農業','介護','運送','その他')`
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
  quickCreate,
  getDistinctIndustries,
  getDistinctPrefectures,
  setBlacklist,
};
