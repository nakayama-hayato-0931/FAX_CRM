/**
 * Phase 2: fax-crm の顧客変更を callcenter DB にシャドー二重書き込みするユーティリティ。
 *
 * 設計:
 *   - callcenter DB の companies テーブルに upsert (Phase 1 で互換カラム追加済)
 *   - 紐付けキー: external_faxcrm_id (BIGINT UNSIGNED UNIQUE) = fax-crm.customers.id
 *               または external_callcenter_id (fax-crm 側) = callcenter.companies.id
 *   - 失敗は fire-and-forget: callcenter DB が落ちていても fax-crm 本処理は止めない
 *
 * 仕様詳細: callcenter-ai-system/docs/UNIFIED_CUSTOMER_SCHEMA.md
 */
const ccDb = require('../../config/callcenterDb');
const { getPool: getFaxPool } = require('../../config/db');

function logInfo(...a)  { console.log('[ccDbWriter]', ...a); }
function logWarn(...a)  { console.warn('[ccDbWriter]', ...a); }

function isEnabled() { return ccDb.isConfigured(); }

/**
 * fax-crm.customers の 1 行を受け取り、callcenter.companies に upsert する。
 * external_callcenter_id 優先 → external_faxcrm_id → 新規作成。
 *
 * @param {object} customer fax-crm.customers の行 (全カラム想定)
 * @returns {Promise<{ok, action?, ccId?, error?, skipped?}>}
 */
async function upsertToCallcenter(customer) {
  if (!isEnabled()) return { ok: false, skipped: true, reason: 'CALLCENTER_DB 未設定' };
  if (!customer || !customer.id) return { ok: false, skipped: true, reason: 'customer.id 無し' };

  const pool = ccDb.getPool();
  const conn = await pool.getConnection();
  try {
    // 既存検索: external_callcenter_id (fax-crm が知ってる callcenter id) → external_faxcrm_id (逆参照)
    let ccId = null;
    if (customer.external_callcenter_id) {
      const [r] = await conn.query(
        'SELECT id FROM companies WHERE id = ? LIMIT 1',
        [customer.external_callcenter_id]
      );
      if (r[0]) ccId = r[0].id;
    }
    if (!ccId) {
      const [r] = await conn.query(
        'SELECT id FROM companies WHERE external_faxcrm_id = ? LIMIT 1',
        [customer.id]
      );
      if (r[0]) ccId = r[0].id;
    }

    // callcenter.companies は phone_number NOT NULL → phone が無い時は fax で代用
    const phone = customer.phone_number || customer.fax_number || null;

    const cols = {
      company_name:       customer.company_name || '(未設定)',
      phone_number:       phone,
      fax_number:         customer.fax_number || null,
      industry:           customer.industry || null,
      industry_category:  customer.industry_category || null,
      prefecture:         customer.prefecture || null,
      city:               customer.city || null,
      region:             null, // fax-crm 側に「広域」概念は無いので NULL
      address:            customer.address || null,
      postal_code:        customer.postal_code || null,
      url:                customer.url || null,
      employee_count:     customer.employee_count || null,
      representative:     customer.representative || null,
      note:               customer.note || null,
      is_blacklisted:     customer.is_blacklisted ? 1 : 0,
      blacklisted_reason: customer.blacklisted_reason || null,
      source_file:        customer.source_file || null,
      imported_at:        customer.imported_at || null,
      external_faxcrm_id: customer.id,
    };

    if (ccId) {
      // UPDATE: callcenter 固有フィールド (priority_score, locked_*, exclusion_*) は触らない
      const setCols = Object.keys(cols).map(k => `${k} = ?`).join(', ');
      await conn.query(
        `UPDATE companies SET ${setCols} WHERE id = ?`,
        [...Object.values(cols), ccId]
      );
    } else {
      // INSERT
      const colNames = Object.keys(cols).join(', ');
      const ph = Object.keys(cols).map(() => '?').join(', ');
      const [ins] = await conn.query(
        `INSERT INTO companies (${colNames}) VALUES (${ph})`,
        Object.values(cols)
      );
      ccId = ins.insertId;
    }

    // fax_customer_ext (1:1) を upsert
    await conn.query(
      `INSERT INTO fax_customer_ext
         (company_id, send_count, last_sent_at, last_pc_number, last_result, response_count)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         send_count     = VALUES(send_count),
         last_sent_at   = VALUES(last_sent_at),
         last_pc_number = VALUES(last_pc_number),
         last_result    = VALUES(last_result),
         response_count = VALUES(response_count)`,
      [
        ccId,
        Number(customer.send_count) || 0,
        customer.last_sent_at || null,
        customer.last_pc_number || null,
        customer.last_result || null,
        Number(customer.response_count) || 0,
      ]
    );

    // fax-crm 側にも external_callcenter_id を書き戻す（未設定の場合のみ）
    if (!customer.external_callcenter_id && ccId) {
      try {
        const faxPool = getFaxPool();
        if (faxPool) {
          await faxPool.query(
            'UPDATE customers SET external_callcenter_id = ? WHERE id = ? AND external_callcenter_id IS NULL',
            [ccId, customer.id]
          );
        }
      } catch (e) {
        logWarn(`fax-crm.customers の external_callcenter_id 書き戻し失敗 id=${customer.id}: ${e.message}`);
      }
    }

    return { ok: true, action: customer.external_callcenter_id || ccId ? 'updated' : 'created', ccId };
  } catch (e) {
    logWarn(`upsert失敗 fax-crm.customer.id=${customer.id}: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    conn.release();
  }
}

/**
 * fire-and-forget 版 (本処理は止めない)
 */
function shadowUpsert(customer) {
  if (!isEnabled()) return;
  upsertToCallcenter(customer)
    .then((r) => {
      if (r.ok) logInfo(`shadow upsert OK fax-crm.id=${customer.id} cc.id=${r.ccId}`);
      else if (!r.skipped) logWarn(`shadow upsert NG fax-crm.id=${customer.id}: ${r.error}`);
    })
    .catch((e) => logWarn(`shadow upsert exception fax-crm.id=${customer.id}: ${e.message}`));
}

/**
 * fax-crm 全顧客を callcenter にバックフィル (1回実行する想定)
 */
async function backfillAll({ limit = 0, batchSize = 500 } = {}) {
  if (!isEnabled()) return { ok: false, reason: 'CALLCENTER_DB 未設定' };
  const faxPool = getFaxPool();
  if (!faxPool) return { ok: false, reason: 'fax-crm DB 未設定' };
  const stats = { total: 0, created: 0, updated: 0, errors: 0, batches: 0 };
  let lastId = 0;
  while (true) {
    if (limit > 0 && stats.total >= limit) break;
    const remain = limit > 0 ? Math.min(batchSize, limit - stats.total) : batchSize;
    const [rows] = await faxPool.query(
      `SELECT * FROM customers WHERE id > ? ORDER BY id ASC LIMIT ?`,
      [lastId, remain]
    );
    if (rows.length === 0) break;
    stats.batches++;
    for (const c of rows) {
      const r = await upsertToCallcenter(c);
      if (!r.ok) stats.errors++;
      else if (r.action === 'created') stats.created++;
      else stats.updated++;
    }
    stats.total += rows.length;
    lastId = rows[rows.length - 1].id;
    logInfo(`backfill progress total=${stats.total} created=${stats.created} updated=${stats.updated} errors=${stats.errors}`);
  }
  return { ok: true, ...stats };
}

module.exports = {
  isEnabled,
  upsertToCallcenter,
  shadowUpsert,
  backfillAll,
};
