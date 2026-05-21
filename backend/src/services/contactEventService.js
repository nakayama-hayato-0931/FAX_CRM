/**
 * contact_events サービス
 *   - 全チャネル横断のタッチポイントイベント管理
 *   - 詳細仕様: docs/SHARED_CUSTOMER_MASTER.md
 */
const { getPool, isConfigured } = require('../../config/db');

const VALID_CHANNELS = new Set(['fax', 'call', 'email', 'sns', 'meeting', 'other']);
const VALID_SOURCES  = new Set(['fax-crm', 'callcenter-ai', 'manual']);

function assertChannel(c) {
  if (!VALID_CHANNELS.has(c)) {
    const err = new Error(`不正な channel: ${c}`);
    err.status = 400; err.code = 'INVALID_CHANNEL';
    throw err;
  }
}
function assertSource(s) {
  if (!VALID_SOURCES.has(s)) {
    const err = new Error(`不正な source_system: ${s}`);
    err.status = 400; err.code = 'INVALID_SOURCE';
    throw err;
  }
}

/**
 * 顧客のタイムライン取得
 */
async function getTimeline(customerId, { limit = 100, channels } = {}) {
  const pool = getPool();
  if (!pool) return [];

  const where = ['customer_id = ?'];
  const params = [customerId];
  if (channels) {
    const list = String(channels).split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) {
      where.push(`channel IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
  }
  const lim = Math.min(Number(limit) || 100, 500);

  const [rows] = await pool.query(
    `SELECT id, customer_id, channel, event_type, occurred_at, source_system, source_event_id,
            operator_name, pc_number, manuscript_id, manuscript_folder_date, manuscript_slot,
            result_label, memo, raw_payload, created_at
       FROM contact_events
      WHERE ${where.join(' AND ')}
      ORDER BY occurred_at DESC, id DESC
      LIMIT ?`,
    [...params, lim]
  );
  return rows;
}

/**
 * 顧客のルックアップ(callcenter から fax-crm の customer_id を解決する用)
 */
async function lookup({ fax, phone, external_callcenter_id, company_name }) {
  const pool = getPool();
  if (!pool) return null;

  const where = [];
  const params = [];
  if (external_callcenter_id) { where.push('external_callcenter_id = ?'); params.push(external_callcenter_id); }
  if (fax)                    { where.push('fax_number = ?');             params.push(String(fax).replace(/[^0-9+]/g, '')); }
  if (phone)                  { where.push('phone_number = ?');           params.push(String(phone).replace(/[^0-9+]/g, '')); }
  if (company_name)           { where.push('company_name = ?');           params.push(company_name); }

  if (!where.length) {
    const err = new Error('lookup には fax / phone / external_callcenter_id / company_name のいずれかが必要');
    err.status = 400; err.code = 'NO_LOOKUP_KEY';
    throw err;
  }

  const [rows] = await pool.query(
    `SELECT id, company_name, fax_number, phone_number, external_callcenter_id
       FROM customers
      WHERE ${where.join(' OR ')}
      ORDER BY (CASE WHEN external_callcenter_id IS NOT NULL THEN 0 ELSE 1 END), id ASC
      LIMIT 5`,
    params
  );
  return rows;  // 複数返す。呼び出し側で先頭を採用する想定
}

/**
 * イベント作成(冪等)
 *   source_system + source_event_id で重複検出 → 既存があれば更新せず無視
 */
async function createEvent(body, opts = {}) {
  if (!isConfigured()) {
    const err = new Error('DBが未設定です');
    err.status = 500; err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }

  // 必須: channel, event_type, occurred_at, source_system
  const channel = body.channel || 'other';
  const event_type = body.event_type || 'other';
  const occurred_at = body.occurred_at || new Date().toISOString();
  const source_system = body.source_system || 'manual';
  assertChannel(channel);
  assertSource(source_system);

  let customerId = body.customer_id;
  // customer_id が無ければ lookup
  if (!customerId && body.lookup) {
    const candidates = await lookup(body.lookup);
    if (!candidates.length) {
      const err = new Error('lookup で顧客が見つかりませんでした');
      err.status = 404; err.code = 'CUSTOMER_NOT_FOUND';
      throw err;
    }
    customerId = candidates[0].id;
  }
  if (!customerId) {
    const err = new Error('customer_id または lookup が必要です');
    err.status = 400; err.code = 'NO_CUSTOMER';
    throw err;
  }

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    // 重複チェック (source_system, source_event_id) UNIQUE
    if (body.source_event_id) {
      const [dup] = await conn.query(
        `SELECT id FROM contact_events WHERE source_system = ? AND source_event_id = ? LIMIT 1`,
        [source_system, body.source_event_id]
      );
      if (dup.length) {
        return { id: dup[0].id, duplicated: true };
      }
    }
    const [result] = await conn.query(
      `INSERT INTO contact_events
        (customer_id, channel, event_type, occurred_at, source_system, source_event_id,
         operator_name, pc_number, manuscript_id, manuscript_folder_date, manuscript_slot,
         result_label, memo, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customerId, channel, event_type, new Date(occurred_at), source_system,
        body.source_event_id || null,
        body.operator_name || null,
        body.pc_number || null,
        body.manuscript_id || null,
        body.manuscript_folder_date || null,
        body.manuscript_slot || null,
        body.result_label || null,
        body.memo || null,
        body.raw_payload ? JSON.stringify(body.raw_payload) : null,
      ]
    );
    return { id: result.insertId, duplicated: false, customer_id: customerId };
  } finally {
    conn.release();
  }
}

/**
 * バルク挿入(複数イベントを一度に)
 * 既存(source_system, source_event_id)はスキップ
 */
async function createBulk(events) {
  const stats = { inserted: 0, duplicated: 0, failed: 0, errors: [] };
  for (const ev of events) {
    try {
      const r = await createEvent(ev);
      if (r.duplicated) stats.duplicated++;
      else stats.inserted++;
    } catch (e) {
      stats.failed++;
      stats.errors.push({ event: ev, error: e.message, code: e.code });
    }
  }
  return stats;
}

module.exports = {
  getTimeline, lookup, createEvent, createBulk,
  VALID_CHANNELS, VALID_SOURCES,
};
