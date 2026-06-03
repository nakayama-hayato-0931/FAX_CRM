/**
 * contact_events サービス
 *   - 全チャネル横断のタッチポイントイベント管理
 *   - 詳細仕様: docs/SHARED_CUSTOMER_MASTER.md
 */
const { getPool, isConfigured } = require('../../config/db');
const callcenterWebhook = require('./callcenterWebhookClient');

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
/**
 * クエリパラメータ指定での一覧取得 (callcenter からの FAX履歴照会用)
 *   - customer_id 指定 → そのまま
 *   - external_callcenter_id / fax / phone 指定 → lookup で customer_id 解決
 *   - channel: 'fax' / 'call' / 'fax,call' のカンマ区切り
 *   - limit (max 500)
 */
async function listByQuery(query = {}) {
  const pool = getPool();
  if (!pool) return { events: [], customers: [] };

  let customerIds = [];
  if (query.customer_id) {
    customerIds = [Number(query.customer_id)];
  } else if (query.external_callcenter_id || query.fax || query.phone || query.company_name) {
    const customers = await lookup({
      fax: query.fax,
      phone: query.phone,
      external_callcenter_id: query.external_callcenter_id,
      company_name: query.company_name,
    });
    customerIds = (customers || []).map((c) => c.id);
    if (customerIds.length === 0) return { events: [], customers: [] };
  } else {
    // どのキーも無い場合はチャネル全体 (limit 制限のみ)
    customerIds = null;
  }

  const where = [];
  const params = [];
  if (customerIds) {
    where.push(`customer_id IN (${customerIds.map(() => '?').join(',')})`);
    params.push(...customerIds);
  }
  if (query.channel) {
    const list = String(query.channel).split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) {
      where.push(`channel IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
  }
  if (query.event_type) {
    where.push(`event_type = ?`);
    params.push(query.event_type);
  }
  if (query.since) {
    where.push(`occurred_at >= ?`);
    params.push(query.since);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const lim = Math.min(Number(query.limit) || 100, 500);

  const [events] = await pool.query(
    `SELECT id, customer_id, channel, event_type, occurred_at, source_system, source_event_id,
            operator_name, pc_number, manuscript_id, manuscript_folder_date, manuscript_slot,
            result_label, memo, raw_payload, created_at
       FROM contact_events
       ${whereSql}
       ORDER BY occurred_at DESC, id DESC
       LIMIT ?`,
    [...params, lim]
  );
  return { events, customer_ids: customerIds };
}

async function getTimeline(customerId, { limit = 100, channels } = {}) {
  const pool = getPool();
  if (!pool) return [];
  // Phase 3b Tier 2: callcenter-only sentinel (負数) は履歴を持たないので空返却
  const repo = require('./customerRepo');
  const resolved = repo.resolveTimelineCustomerId(customerId);
  if (!resolved) return [];
  customerId = resolved;

  const where = ['customer_id = ?'];
  const params = [customerId];
  let channelList = null;
  if (channels) {
    const list = String(channels).split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) {
      channelList = list;
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

  // zp_* (Zoom Phone) を マージ:
  //   call チャネル が要求 (or 全チャネル要求) なら 顧客の電話番号と照合して
  //   受電 / 不在着信 を取り込む。 zp_* テーブルが無い環境では skip。
  if (!channelList || channelList.includes('call')) {
    try {
      const zpRows = await fetchZpEventsForCustomer(pool, customerId, lim);
      if (zpRows.length) {
        const merged = [...rows, ...zpRows]
          .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
          .slice(0, lim);
        return merged;
      }
    } catch (e) {
      // zp_* テーブル未デプロイ環境を想定して 失敗時は contact_events のみ返却
      console.warn('[getTimeline] zp_* マージ skip:', e.message);
    }
  }
  return rows;
}

/**
 * 顧客の電話/FAX を正規化して zp_recordings (受電) + zp_missed_calls (不在)
 * を contact_event 互換オブジェクトに変換して返す。
 */
async function fetchZpEventsForCustomer(pool, customerId, limit) {
  const { digitsOnly } = require('../utils/phone');
  const [custRows] = await pool.query(
    'SELECT phone_number, fax_number FROM customers WHERE id = ? LIMIT 1',
    [customerId]
  );
  if (!custRows.length) return [];
  const phones = new Set();
  if (custRows[0].phone_number) {
    const d = digitsOnly(custRows[0].phone_number);
    if (d) phones.add(d);
  }
  if (custRows[0].fax_number) {
    const d = digitsOnly(custRows[0].fax_number);
    if (d) phones.add(d);
  }
  const phoneList = [...phones].filter((p) => p.length >= 9);
  if (!phoneList.length) return [];

  // zp_* テーブルの caller_number は +81 国際表記 → REGEXP_REPLACE + REPLACE で
  // 国内 digits-only に変換して IN 検索
  const matchSql = `REGEXP_REPLACE(REPLACE(caller_number, '+81', '0'), '[^0-9]', '')`;
  const events = [];

  // 受電 (zp_recordings)
  try {
    const [recs] = await pool.query(
      `SELECT id, caller_number, callee_name, date_time
         FROM zp_recordings
        WHERE ${matchSql} IN (?)
          AND direction = '着信'
        ORDER BY date_time DESC
        LIMIT ?`,
      [phoneList, limit]
    );
    for (const r of recs) {
      events.push({
        id: `zp_rec_${r.id}`,
        customer_id: customerId,
        channel: 'call',
        event_type: 'response_inquiry',
        occurred_at: r.date_time,
        source_system: 'zoom-phone',
        source_event_id: null,
        operator_name: r.callee_name || null,
        pc_number: null,
        manuscript_id: null,
        manuscript_folder_date: null,
        manuscript_slot: null,
        result_label: '受電',
        memo: `Zoom Phone 受電 (${r.caller_number || ''})`,
        raw_payload: null,
        created_at: r.date_time,
      });
    }
  } catch (e) {
    console.warn('[zp merge] zp_recordings skip:', e.message);
  }

  // 不在 (zp_missed_calls)
  try {
    const [misses] = await pool.query(
      `SELECT id, caller_number, callee_number, date_time
         FROM zp_missed_calls
        WHERE ${matchSql} IN (?)
        ORDER BY date_time DESC
        LIMIT ?`,
      [phoneList, limit]
    );
    for (const m of misses) {
      events.push({
        id: `zp_miss_${m.id}`,
        customer_id: customerId,
        channel: 'call',
        event_type: 'no_answer',
        occurred_at: m.date_time,
        source_system: 'zoom-phone',
        source_event_id: null,
        operator_name: null,
        pc_number: null,
        manuscript_id: null,
        manuscript_folder_date: null,
        manuscript_slot: null,
        result_label: '不在',
        memo: `Zoom Phone 不在着信 → ${m.callee_number || ''}`,
        raw_payload: null,
        created_at: m.date_time,
      });
    }
  } catch (e) {
    console.warn('[zp merge] zp_missed_calls skip:', e.message);
  }

  return events;
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
  // 電話 / FAX はハイフン無視で比較 (数字のみで完全一致)
  if (fax) {
    const d = String(fax).replace(/[^0-9]/g, '');
    if (d.length >= 6) {
      where.push(`REGEXP_REPLACE(COALESCE(fax_number, ''), '[^0-9]', '') = ?`);
      params.push(d);
    }
  }
  if (phone) {
    const d = String(phone).replace(/[^0-9]/g, '');
    if (d.length >= 6) {
      where.push(`REGEXP_REPLACE(COALESCE(phone_number, ''), '[^0-9]', '') = ?`);
      params.push(d);
    }
  }
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
    const inserted = { id: result.insertId, duplicated: false, customer_id: customerId };

    // callcenter-ai-system へリアルタイム通知（fax-crm 由来のイベントのみ。
    // callcenter から push されたイベントを更に callcenter に返すと無限ループになるのでスキップ）
    if (callcenterWebhook.isEnabled() && source_system !== 'callcenter-ai') {
      try {
        const [custRows] = await conn.query(
          `SELECT id, company_name, fax_number, phone_number, external_callcenter_id
             FROM customers WHERE id = ? LIMIT 1`,
          [customerId]
        );
        const customer = custRows[0];
        if (customer) {
          const eventRow = {
            id: inserted.id,
            channel,
            event_type,
            occurred_at,
            source_event_id: body.source_event_id || `fax-crm-${inserted.id}`,
            operator_name: body.operator_name || null,
            result_label: body.result_label || null,
            memo: body.memo || null,
          };
          // fire-and-forget
          callcenterWebhook.notifyCallcenter(eventRow, customer);
        }
      } catch (e) {
        // 失敗しても本処理は阻害しない
        console.warn('[contactEventService] callcenter webhook 通知失敗:', e.message);
      }
    }

    return inserted;
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
  listByQuery,
  getTimeline, lookup, createEvent, createBulk,
  VALID_CHANNELS, VALID_SOURCES,
};
