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
 * バルクUPSERT版: 1 バッチを multi-row INSERT ... ON DUPLICATE KEY UPDATE で
 * 一気に書き込む。1件ずつより 50-100倍 速い。
 *
 * 紐付け戦略: external_faxcrm_id UNIQUE KEY を利用。
 * existing external_callcenter_id がある行も新規行も、external_faxcrm_id = fax-crm.id で一意に解決される。
 * (注: companies.external_callcenter_id ↔ fax-crm.id の関係なので
 *  fax-crm 側 external_callcenter_id がすでに紐づいてる場合は callcenter 側で
 *  対応する companies 行に external_faxcrm_id を埋めるロジックを最初に流す必要あり)
 */
async function bulkUpsertCallcenter(customers) {
  if (!isEnabled()) return { ok: false, skipped: true };
  if (!customers || customers.length === 0) return { ok: true, inserted: 0, updated: 0 };

  const pool = ccDb.getPool();
  const conn = await pool.getConnection();
  try {
    // ① external_callcenter_id 紐付け済みの fax-crm 顧客に対して、callcenter 側の
    //    external_faxcrm_id を埋める (同一バッチ内で UNIQUE 衝突しないように)
    const linked = customers.filter(c => c.external_callcenter_id);
    if (linked.length > 0) {
      // CASE WHEN id = ? THEN ? END で一括 UPDATE
      const ids = linked.map(c => c.external_callcenter_id);
      const cases = linked.map(c => `WHEN id = ${conn.escape(c.external_callcenter_id)} THEN ${conn.escape(c.id)}`).join(' ');
      await conn.query(
        `UPDATE companies SET external_faxcrm_id = CASE ${cases} END
          WHERE id IN (${ids.map(()=>'?').join(',')})
            AND (external_faxcrm_id IS NULL OR external_faxcrm_id IN (${linked.map(c => conn.escape(c.id)).join(',')}))`,
        ids
      );
    }

    // ② multi-row UPSERT into companies
    // phone_number は NOT NULL 制約があるので fax で代用 (両方無い行はスキップ)
    const validRows = customers.filter(c => c.phone_number || c.fax_number);
    const skippedNoPhone = customers.length - validRows.length;

    if (validRows.length > 0) {
      const COLS = [
        'company_name','phone_number','fax_number','industry','industry_category',
        'prefecture','city','address','postal_code','url','employee_count',
        'representative','note','is_blacklisted','blacklisted_reason',
        'source_file','imported_at','external_faxcrm_id'
      ];
      const valuesSql = validRows.map(() => `(${COLS.map(()=>'?').join(',')})`).join(',');
      const params = validRows.flatMap(c => [
        c.company_name || '(未設定)',
        c.phone_number || c.fax_number,
        c.fax_number || null,
        c.industry || null,
        c.industry_category || null,
        c.prefecture || null,
        c.city || null,
        c.address || null,
        c.postal_code || null,
        c.url || null,
        c.employee_count || null,
        c.representative || null,
        c.note || null,
        c.is_blacklisted ? 1 : 0,
        c.blacklisted_reason || null,
        c.source_file || null,
        c.imported_at || null,
        c.id,
      ]);
      // 既存 (external_faxcrm_id) なら UPDATE。callcenter 固有 (priority_*, locked_*, exclusion_*) は触らない
      await conn.query(
        `INSERT INTO companies (${COLS.join(',')}) VALUES ${valuesSql}
         ON DUPLICATE KEY UPDATE
           company_name       = VALUES(company_name),
           phone_number       = COALESCE(NULLIF(companies.phone_number, ''), VALUES(phone_number)),
           fax_number         = VALUES(fax_number),
           industry           = COALESCE(VALUES(industry), companies.industry),
           industry_category  = COALESCE(VALUES(industry_category), companies.industry_category),
           prefecture         = COALESCE(VALUES(prefecture), companies.prefecture),
           city               = COALESCE(VALUES(city), companies.city),
           address            = COALESCE(VALUES(address), companies.address),
           postal_code        = COALESCE(VALUES(postal_code), companies.postal_code),
           url                = COALESCE(VALUES(url), companies.url),
           employee_count     = COALESCE(VALUES(employee_count), companies.employee_count),
           representative     = COALESCE(VALUES(representative), companies.representative),
           note               = COALESCE(VALUES(note), companies.note),
           is_blacklisted     = VALUES(is_blacklisted),
           blacklisted_reason = VALUES(blacklisted_reason)`,
        params
      );

      // ③ 取得した callcenter 側 id を fax-crm.external_callcenter_id に書き戻す
      const faxIds = validRows.map(c => c.id);
      const [ccRows] = await conn.query(
        `SELECT id, external_faxcrm_id FROM companies WHERE external_faxcrm_id IN (${faxIds.map(()=>'?').join(',')})`,
        faxIds
      );
      // fax_customer_ext を multi-row UPSERT
      if (ccRows.length > 0) {
        const ccIdByFaxId = new Map(ccRows.map(r => [Number(r.external_faxcrm_id), Number(r.id)]));
        const extRows = validRows
          .map(c => ({ ccId: ccIdByFaxId.get(c.id), c }))
          .filter(x => x.ccId);
        if (extRows.length > 0) {
          const extSql = extRows.map(() => '(?,?,?,?,?,?)').join(',');
          const extParams = extRows.flatMap(({ ccId, c }) => [
            ccId,
            Number(c.send_count) || 0,
            c.last_sent_at || null,
            c.last_pc_number || null,
            c.last_result || null,
            Number(c.response_count) || 0,
          ]);
          await conn.query(
            `INSERT INTO fax_customer_ext
               (company_id, send_count, last_sent_at, last_pc_number, last_result, response_count)
             VALUES ${extSql}
             ON DUPLICATE KEY UPDATE
               send_count     = VALUES(send_count),
               last_sent_at   = VALUES(last_sent_at),
               last_pc_number = VALUES(last_pc_number),
               last_result    = VALUES(last_result),
               response_count = VALUES(response_count)`,
            extParams
          );
          // fax-crm 側 external_callcenter_id 書き戻し (NULL のみ)
          const faxPool = getFaxPool();
          if (faxPool) {
            const writeBack = extRows.filter(({ c }) => !c.external_callcenter_id);
            if (writeBack.length > 0) {
              const cases = writeBack.map(({ ccId, c }) => `WHEN id = ${faxPool.escape(c.id)} THEN ${faxPool.escape(ccId)}`).join(' ');
              const ids = writeBack.map(({ c }) => c.id);
              await faxPool.query(
                `UPDATE customers SET external_callcenter_id = CASE ${cases} END
                  WHERE id IN (${ids.map(()=>'?').join(',')}) AND external_callcenter_id IS NULL`,
                ids
              );
            }
          }
        }
      }
    }

    return { ok: true, batch_size: customers.length, valid: validRows.length, skipped_no_phone: skippedNoPhone };
  } catch (e) {
    logWarn(`bulkUpsert失敗 batch_size=${customers.length}: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    conn.release();
  }
}

/**
 * fax-crm 全顧客を callcenter にバックフィル (1回実行する想定)
 * バルクUPSERTで高速化
 */
async function backfillAll({ limit = 0, batchSize = 500 } = {}) {
  if (!isEnabled()) return { ok: false, reason: 'CALLCENTER_DB 未設定' };
  const faxPool = getFaxPool();
  if (!faxPool) return { ok: false, reason: 'fax-crm DB 未設定' };
  const stats = { total: 0, processed: 0, skipped_no_phone: 0, batches: 0, errors: 0 };
  const startedAt = Date.now();
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
    const r = await bulkUpsertCallcenter(rows);
    if (!r.ok) {
      stats.errors += rows.length;
    } else {
      stats.processed += r.valid || 0;
      stats.skipped_no_phone += r.skipped_no_phone || 0;
    }
    stats.total += rows.length;
    lastId = rows[rows.length - 1].id;
    if (stats.batches % 10 === 0 || rows.length < remain) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      const rate = stats.total > 0 ? Math.round(stats.total / Math.max(1, elapsed)) : 0;
      logInfo(`backfill progress total=${stats.total} processed=${stats.processed} errors=${stats.errors} (${elapsed}s, ${rate}件/秒)`);
    }
  }
  stats.elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  return { ok: true, ...stats };
}

module.exports = {
  isEnabled,
  upsertToCallcenter,
  bulkUpsertCallcenter,
  shadowUpsert,
  backfillAll,
};
