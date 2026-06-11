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
const { digitsOnly: phoneDigits } = require('../utils/phone');
const { withRegionNames } = require('../utils/prefectures');

/**
 * prefecture フィルタ: 単一/CSV/配列 を受け取り、 選択された県の所属地域名
 * (関東/近畿 等) も常に OR に追加する。 callcenter.companies に
 * 「関東」 のような地域名がそのまま残っているデータも県名選択でヒットさせるため。
 */
function addPrefectureFilter(query, alias, where, params) {
  const v = query.prefecture;
  if (!v) return;
  let list;
  if (Array.isArray(v)) list = v;
  else list = String(v).split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return;
  const finalList = withRegionNames(list);
  if (finalList.length === 1) {
    where.push(`${alias}prefecture = ?`);
    params.push(finalList[0]);
  } else {
    where.push(`${alias}prefecture IN (?)`);
    params.push(finalList);
  }
}

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
    const normPhoneDigits = phoneDigits(raw);  // +81/全角 を吸収して 国内形式の digits-only
    const orParts = SEARCHABLE.map((col) => `c.${col} LIKE ?`);
    SEARCHABLE.forEach(() => params.push(like));
    if (normPhoneDigits.length >= 3) {
      orParts.push(`REGEXP_REPLACE(c.fax_number, '[^0-9]', '') LIKE ?`);
      params.push(`%${normPhoneDigits}%`);
      orParts.push(`REGEXP_REPLACE(c.phone_number, '[^0-9]', '') LIKE ?`);
      params.push(`%${normPhoneDigits}%`);
    }
    where.push(`(${orParts.join(' OR ')})`);
  }
  if (query.industry) { where.push('c.industry_category = ?'); params.push(query.industry); }
  addPrefectureFilter(query, 'c.', where, params);
  if (query.blacklisted === 'true')  where.push('c.is_blacklisted = 1');
  if (query.blacklisted === 'false') where.push('c.is_blacklisted = 0');
  // has_fax フィルタ
  //   true  → 数字を含む実 FAX 番号がある顧客のみ
  //   false → FAX 番号が空 / NULL / 数字を含まない顧客のみ
  if (query.has_fax === 'true') {
    where.push(`(c.fax_number IS NOT NULL AND c.fax_number <> '' AND REGEXP_REPLACE(c.fax_number, '[^0-9]', '') <> '')`);
  }
  if (query.has_fax === 'false') {
    where.push(`(c.fax_number IS NULL OR c.fax_number = '' OR REGEXP_REPLACE(c.fax_number, '[^0-9]', '') = '')`);
  }
  // 抽出履歴 N 回以上で絞る
  if (query.minExtractCount && Number(query.minExtractCount) > 0) {
    where.push('COALESCE(c.extract_count, 0) >= ?');
    params.push(Number(query.minExtractCount));
  }
  // 架電回数 N 回以上で絞る (相関サブクエリ で contact_events を集計)
  if (query.minCallCount && Number(query.minCallCount) > 0) {
    where.push(`(
      SELECT COUNT(*) FROM contact_events
       WHERE customer_id = c.id AND channel = 'call'
    ) >= ?`);
    params.push(Number(query.minCallCount));
  }

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
            COALESCE(c.extract_count, 0) AS extract_count,
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
    const normPhoneDigits = phoneDigits(raw);  // +81/全角 を吸収して 国内形式の digits-only
    const orParts = ['c.company_name LIKE ?', 'c.fax_number LIKE ?', 'c.phone_number LIKE ?', 'c.address LIKE ?'];
    params.push(like, like, like, like);
    if (normPhoneDigits.length >= 3) {
      orParts.push(`REGEXP_REPLACE(c.fax_number, '[^0-9]', '') LIKE ?`);
      orParts.push(`REGEXP_REPLACE(c.phone_number, '[^0-9]', '') LIKE ?`);
      params.push(`%${normPhoneDigits}%`, `%${normPhoneDigits}%`);
    }
    where.push(`(${orParts.join(' OR ')})`);
  }
  if (query.industry) { where.push('c.industry_category = ?'); params.push(query.industry); }
  addPrefectureFilter(query, 'c.', where, params);
  if (query.blacklisted === 'true')  where.push('c.is_blacklisted = 1');
  if (query.blacklisted === 'false') where.push('c.is_blacklisted = 0');
  // has_fax フィルタ (fax-crm 側と同じ挙動)
  //   true  → 数字を含む実 FAX 番号がある顧客のみ
  //   false → FAX 番号が空 / NULL の顧客のみ
  if (query.has_fax === 'true') {
    where.push(`(c.fax_number IS NOT NULL AND c.fax_number <> '' AND REGEXP_REPLACE(c.fax_number, '[^0-9]', '') <> '')`);
  }
  if (query.has_fax === 'false') {
    where.push(`(c.fax_number IS NULL OR c.fax_number = '' OR REGEXP_REPLACE(c.fax_number, '[^0-9]', '') = '')`);
  }
  // 抽出履歴 N 回以上で絞る — customers.extract_count を JOIN で参照
  // (callcenter DB と同じ MySQL に fax-crm customers があるので database 名で限定)
  if (query.minExtractCount && Number(query.minExtractCount) > 0) {
    where.push(`COALESCE((
      SELECT extract_count FROM customers WHERE customers.id = c.external_faxcrm_id LIMIT 1
    ), 0) >= ?`);
    params.push(Number(query.minExtractCount));
  }
  // 架電回数 N 回以上で絞る — contact_events の集計
  if (query.minCallCount && Number(query.minCallCount) > 0) {
    where.push(`(
      SELECT COUNT(*) FROM contact_events
       WHERE contact_events.customer_id = c.external_faxcrm_id AND channel = 'call'
    ) >= ?`);
    params.push(Number(query.minCallCount));
  }

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
// getById (Tier 2)
// ============================================
async function getByIdFromFaxCrm(id) {
  const pool = getFaxPool();
  if (!pool) return null;
  const [rows] = await pool.query(`SELECT * FROM customers WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

/**
 * callcenter.companies から 1顧客を取得。
 *   id > 0: fax-crm.customers.id 想定 → external_faxcrm_id で検索
 *   id < 0: callcenter-only (sentinel) → -id を companies.id として検索
 *
 * 戻り値は fax-crm.customers 互換形式 + 補足フィールド:
 *   _callcenter_id, _is_callcenter_only
 */
async function getByIdFromCallcenter(id) {
  const pool = ccDb.getPool();
  if (!pool) return null;
  const numId = Number(id);
  if (!numId) return null;

  let row;
  if (numId > 0) {
    // 通常 fax-crm.id
    const [rows] = await pool.query(
      `SELECT c.*, fce.send_count, fce.last_sent_at, fce.last_pc_number, fce.last_result, fce.response_count
         FROM companies c
         LEFT JOIN fax_customer_ext fce ON fce.company_id = c.id
        WHERE c.external_faxcrm_id = ? LIMIT 1`,
      [numId]
    );
    row = rows[0];
  } else {
    // callcenter-only (negative sentinel)
    const ccId = -numId;
    const [rows] = await pool.query(
      `SELECT c.*, fce.send_count, fce.last_sent_at, fce.last_pc_number, fce.last_result, fce.response_count
         FROM companies c
         LEFT JOIN fax_customer_ext fce ON fce.company_id = c.id
        WHERE c.id = ? LIMIT 1`,
      [ccId]
    );
    row = rows[0];
  }
  if (!row) return null;

  return {
    // fax-crm 互換 id (負数 sentinel あり)
    id: numId,
    _callcenter_id: row.id,
    _is_callcenter_only: !row.external_faxcrm_id,
    company_name: row.company_name,
    fax_number: row.fax_number,
    phone_number: row.phone_number,
    industry: row.industry,
    industry_category: row.industry_category,
    prefecture: row.prefecture,
    city: row.city,
    address: row.address,
    postal_code: row.postal_code,
    url: row.url,
    employee_count: row.employee_count,
    representative: row.representative,
    note: row.note,
    send_count: Number(row.send_count) || 0,
    last_sent_at: row.last_sent_at,
    last_pc_number: row.last_pc_number,
    last_result: row.last_result,
    response_count: Number(row.response_count) || 0,
    is_blacklisted: row.is_blacklisted,
    blacklisted_reason: row.blacklisted_reason,
    source_file: row.source_file,
    imported_at: row.imported_at,
    external_callcenter_id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getById(id) {
  if (shouldReadFromCallcenter(2)) {
    return getByIdFromCallcenter(id);
  }
  return getByIdFromFaxCrm(id);
}

// ============================================
// Public API
// ============================================
async function listCustomers(query) {
  // 架電回数 / 抽出回数 フィルタは contact_events / customers.extract_count を
  // 参照する必要があるが、 callcenter DB にはそれらが無い。
  // → これらフィルタが指定された時は tier3 でも fax-crm 側 read に強制フォールバック
  const needsFaxCrmTables =
    (Number(query.minCallCount) > 0) || (Number(query.minExtractCount) > 0);
  if (needsFaxCrmTables) {
    return listFromFaxCrm(query);
  }
  if (shouldReadFromCallcenter(1)) {
    return listFromCallcenter(query);
  }
  return listFromFaxCrm(query);
}

/**
 * timeline の顧客ID解決:
 *   正数 → そのまま fax-crm.customers.id として contact_events 検索
 *   負数 → callcenter-only → contact_events は存在しない → 空配列
 */
function resolveTimelineCustomerId(id) {
  const n = Number(id);
  if (!n || n < 0) return null; // callcenter-only は履歴無し
  return n;
}

/**
 * Tier 3: callcenter.companies で既存顧客を検索
 *   phone / fax を正規化して LIKE 検索。見つかれば
 *   { ccId, external_faxcrm_id } を返す。
 */
async function findExistingInCallcenter({ fax_number, phone_number }) {
  if (!shouldReadFromCallcenter(3)) return null;
  const pool = ccDb.getPool();
  if (!pool) return null;
  const faxDigits = (fax_number || '').replace(/[^0-9]/g, '');
  const phoneDigits = (phone_number || '').replace(/[^0-9]/g, '');
  if (faxDigits.length < 6 && phoneDigits.length < 6) return null;
  // fax → phone の優先順位で検索
  if (faxDigits.length >= 6) {
    const [r] = await pool.query(
      `SELECT id, external_faxcrm_id FROM companies
        WHERE REGEXP_REPLACE(COALESCE(fax_number, ''), '[^0-9]', '') = ? LIMIT 1`,
      [faxDigits]
    );
    if (r[0]) return { ccId: r[0].id, external_faxcrm_id: r[0].external_faxcrm_id, matchedBy: 'fax' };
  }
  if (phoneDigits.length >= 6) {
    const [r] = await pool.query(
      `SELECT id, external_faxcrm_id FROM companies
        WHERE REGEXP_REPLACE(COALESCE(phone_number, ''), '[^0-9]', '') = ? LIMIT 1`,
      [phoneDigits]
    );
    if (r[0]) return { ccId: r[0].id, external_faxcrm_id: r[0].external_faxcrm_id, matchedBy: 'phone' };
  }
  return null;
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
  getById,
  resolveTimelineCustomerId,
  findExistingInCallcenter,
  readMode,
  shouldReadFromCallcenter,
  getReadStatus,
};
