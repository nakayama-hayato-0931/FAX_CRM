/**
 * Phase 3b: 顧客マスタ読み込みの抽象化レイヤ。
 *
 * env USE_CALLCENTER_DB の値に応じて読み込み元を切替:
 *   未設定 / '0'  → fax-crm.customers から読む（Phase 2 までの動作）
 *   '1' / 'tier1' → Tier 1 (顧客一覧) を callcenter.companies から読む
 *   'tier2'       → Tier 1+2 (詳細も) callcenter から読む
 *   'tier3'       → Tier 1+2+3 (書き込みも) ※実装は今後
 *   'tier4'       → フル切替 (Phase 4 直前)
 *
 * 読み込み元が callcenter の時:
 *   - companies + fax_customer_ext を JOIN
 *   - 戻り値の「id」は fax-crm 互換に変換:
 *       companies.external_faxcrm_id があればそれを id とする
 *       無い場合は -companies.id (負数 sentinel) を返す → callcenter-only 顧客
 *
 * 仕様詳細: callcenter-ai-system/docs/PHASE_3B_READ_SWITCH.md
 */
const { getPool: getFaxPool } = require('../../config/db');
const ccDb = require('../../config/callcenterDb');

function readMode() {
  const v = String(process.env.USE_CALLCENTER_DB || '').toLowerCase();
  if (v === '' || v === '0' || v === 'false') return 'faxcrm';
  if (v === '1' || v === 'true' || v === 'tier1') return 'tier1';
  if (v === 'tier2') return 'tier2';
  if (v === 'tier3') return 'tier3';
  if (v === 'tier4') return 'tier4';
  return 'faxcrm';
}

function shouldReadFromCallcenter(tier) {
  const mode = readMode();
  if (mode === 'faxcrm') return false;
  const tierOrder = { tier1: 1, tier2: 2, tier3: 3, tier4: 4 };
  return (tierOrder[mode] || 0) >= (tier || 1);
}

const SEARCHABLE = ['company_name', 'fax_number', 'phone_number', 'address'];

const SORT_MAP = {
  updated_at: 'updated_at',
  created_at: 'created_at',
  company_name: 'company_name',
  send_count: 'send_count',
  last_sent_at: 'last_sent_at',
};

// ============================================
// fax-crm.customers から読む実装 (旧仕様)
// ============================================
async function listFromFaxCrm(query) {
  const pool = getFaxPool();
  if (!pool) return { items: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 } };

  const where = [];
  const params = [];
  if (query.q) {
    const raw = String(query.q);
    const like = `%${raw}%`;
    const digitsOnly = raw.replace(/[^0-9]/g, '');
    const orParts = SEARCHABLE.map((col) => `c.${col} LIKE ?`);
    SEARCHABLE.forEach(() => params.push(like));
    if (digitsOnly.length >= 3) {
      orParts.push(`REGEXP_REPLACE(c.fax_number, '[^0-9]', '') LIKE ?`);
      params.push(`%${digitsOnly}%`);
      orParts.push(`REGEXP_REPLACE(c.phone_number, '[^0-9]', '') LIKE ?`);
      params.push(`%${digitsOnly}%`);
    }
    where.push(`(${orParts.join(' OR ')})`);
  }
  if (query.industry) { where.push('c.industry_category = ?'); params.push(query.industry); }
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
         SELECT customer_id, COUNT(*) AS call_count FROM contact_events
          WHERE channel = 'call' GROUP BY customer_id
       ) cc ON cc.customer_id = c.id
       ${whereSql}
       ORDER BY c.${sortCol} ${dir}
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [cnt] = await pool.query(`SELECT COUNT(*) AS total FROM customers c ${whereSql}`, params);
  return { items: rows, pagination: { page, pageSize: limit, total: cnt[0].total, totalPages: Math.ceil(cnt[0].total / limit) } };
}

// ============================================
// callcenter.companies から読む実装 (Tier 1)
// ============================================
async function listFromCallcenter(query) {
  const pool = ccDb.getPool();
  if (!pool) {
    console.warn('[customerRepo] USE_CALLCENTER_DB が有効だが callcenter DB に接続できない → fax-crm にフォールバック');
    return listFromFaxCrm(query);
  }

  const where = [];
  const params = [];
  // 検索: 社名・電話・FAX・住所
  if (query.q) {
    const raw = String(query.q);
    const like = `%${raw}%`;
    const digitsOnly = raw.replace(/[^0-9]/g, '');
    const orParts = ['c.company_name LIKE ?', 'c.fax_number LIKE ?', 'c.phone_number LIKE ?', 'c.address LIKE ?'];
    params.push(like, like, like, like);
    if (digitsOnly.length >= 3) {
      orParts.push(`REGEXP_REPLACE(c.fax_number, '[^0-9]', '') LIKE ?`);
      orParts.push(`REGEXP_REPLACE(c.phone_number, '[^0-9]', '') LIKE ?`);
      params.push(`%${digitsOnly}%`, `%${digitsOnly}%`);
    }
    where.push(`(${orParts.join(' OR ')})`);
  }
  if (query.industry) { where.push('c.industry_category = ?'); params.push(query.industry); }
  if (query.prefecture) { where.push('c.prefecture = ?'); params.push(query.prefecture); }
  if (query.blacklisted === 'true')  where.push('c.is_blacklisted = 1');
  if (query.blacklisted === 'false') where.push('c.is_blacklisted = 0');

  // callcenter 固有: 除外フラグ立ってる行は除く (デフォルト)
  // ただし NG リスト表示モードなら含める
  // ここでは fax-crm 互換のため exclusion_flag は無視
  // → callcenter 側で意図的に除外している顧客も fax-crm UI には出る

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sortCol = SORT_MAP[query.sortBy] || 'updated_at';
  const dir = String(query.sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(Number(query.pageSize) || 50, 200);
  const page = Math.max(Number(query.page) || 1, 1);
  const offset = (page - 1) * limit;

  // companies の updated_at は無いので created_at にフォールバック
  // callcenter MySQL の companies 列定義に updated_at がある前提（ある）
  const [rows] = await pool.query(
    `SELECT
       COALESCE(NULLIF(c.external_faxcrm_id, 0), -c.id) AS id,
       c.id AS _callcenter_id,
       c.external_faxcrm_id,
       c.company_name, c.fax_number, c.phone_number,
       c.industry, c.industry_category, c.prefecture, c.city,
       c.is_blacklisted, c.updated_at,
       fce.send_count, fce.last_sent_at, fce.last_pc_number, fce.last_result, fce.response_count
     FROM companies c
     LEFT JOIN fax_customer_ext fce ON fce.company_id = c.id
     ${whereSql}
     ORDER BY c.${sortCol} ${dir}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [cnt] = await pool.query(`SELECT COUNT(*) AS total FROM companies c ${whereSql}`, params);

  // call_count は contact_events から取りたいが、それは fax-crm DB 側にある
  // → 一覧では call_count を 0 と仮置き (Tier 2 で詳細ページから取得)
  const items = rows.map(r => ({
    ...r,
    send_count: Number(r.send_count) || 0,
    response_count: Number(r.response_count) || 0,
    call_count: 0,
    // external_callcenter_id 互換 (旧 API レスポンス維持)
    external_callcenter_id: r._callcenter_id,
  }));

  return { items, pagination: { page, pageSize: limit, total: cnt[0].total, totalPages: Math.ceil(cnt[0].total / limit) } };
}

// ============================================
// Public API
// ============================================
async function listCustomers(query) {
  if (shouldReadFromCallcenter(1)) {
    return listFromCallcenter(query);
  }
  return listFromFaxCrm(query);
}

async function getReadStatus() {
  const mode = readMode();
  const ccConfigured = ccDb.isConfigured();
  let ccPing = null;
  if (ccConfigured) {
    try { ccPing = await ccDb.ping(); } catch (e) { ccPing = { ok: false, error: e.message }; }
  }
  return {
    mode,
    use_callcenter_db: mode !== 'faxcrm',
    callcenter_configured: ccConfigured,
    callcenter_ping: ccPing,
  };
}

module.exports = {
  listCustomers,
  readMode,
  shouldReadFromCallcenter,
  getReadStatus,
};
