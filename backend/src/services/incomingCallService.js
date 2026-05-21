const { getPool, isConfigured } = require('../../config/db');
const contactEvents = require('./contactEventService');

const VALID_RESULTS = new Set([
  'no_response', 'response_inquiry', 'response_order',
  'refusal', 'invalid_number', 'other',
]);
const RESPONSE_RESULTS = new Set(['response_inquiry', 'response_order']);

function assertResult(r) {
  if (!VALID_RESULTS.has(r)) {
    const err = new Error(`不正な result 値: ${r}`);
    err.status = 400; err.code = 'INVALID_RESULT';
    throw err;
  }
}

async function listReports(query = {}) {
  const pool = getPool();
  if (!pool) return { items: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 } };
  const where = [];
  const params = [];
  if (query.from)       { where.push('icr.send_date >= ?'); params.push(query.from); }
  if (query.to)         { where.push('icr.send_date <= ?'); params.push(query.to); }
  if (query.pcNumber)   { where.push('icr.pc_number = ?'); params.push(query.pcNumber); }
  if (query.result)     { where.push('icr.result = ?');    params.push(query.result); }
  if (query.batchId)    { where.push('icr.batch_id = ?');  params.push(query.batchId); }
  if (query.customerId) { where.push('icr.customer_id = ?'); params.push(query.customerId); }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(Number(query.pageSize) || 50, 200);
  const page = Math.max(Number(query.page) || 1, 1);
  const offset = (page - 1) * limit;

  const [rows] = await pool.query(
    `SELECT icr.id, icr.customer_id, icr.batch_id, icr.send_date, icr.pc_number,
            icr.manuscript_folder_date, icr.manuscript_slot,
            icr.result, icr.result_detail, icr.responded_at, icr.recorded_at,
            c.company_name, c.fax_number, c.industry, c.prefecture
       FROM incoming_call_reports icr
       JOIN customers c ON c.id = icr.customer_id
       ${whereSql}
       ORDER BY icr.send_date DESC, icr.id DESC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [cnt] = await pool.query(
    `SELECT COUNT(*) AS total FROM incoming_call_reports icr ${whereSql}`,
    params
  );
  const total = cnt[0].total;
  return {
    items: rows,
    pagination: { page, pageSize: limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * バッチ別の受電報告入力用ビュー:
 *   - そのバッチに含まれる顧客一覧 + 既存の最新受電報告(あれば)を返す
 */
async function getBatchInputView(batchId) {
  const pool = getPool();
  if (!pool) return null;
  const [bRows] = await pool.query(
    `SELECT id, name, filter_industry, filter_prefecture, pc_number, manuscript_id,
            actual_count, status, created_at
       FROM extraction_batches WHERE id = ?`,
    [batchId]
  );
  if (!bRows.length) return null;
  const batch = bRows[0];

  // 各顧客の最新受電報告(このバッチ起因のもの)
  const [rows] = await pool.query(
    `SELECT er.row_index, c.id AS customer_id, c.company_name, c.fax_number,
            c.industry, c.prefecture, c.is_blacklisted,
            icr.id AS report_id, icr.result, icr.result_detail, icr.responded_at,
            icr.send_date, icr.pc_number, icr.manuscript_folder_date, icr.manuscript_slot
       FROM extraction_records er
       JOIN customers c ON c.id = er.customer_id
  LEFT JOIN incoming_call_reports icr
         ON icr.customer_id = er.customer_id AND icr.batch_id = er.batch_id
      WHERE er.batch_id = ?
      ORDER BY er.row_index ASC`,
    [batchId]
  );
  return { batch, rows };
}

/**
 * バッチ一括保存:
 *   各 row {customerId, result, result_detail?, responded_at?} を upsert する。
 *   1トランザクション内で customer の集計フィールドも更新。
 */
async function bulkSave({ batchId, sendDate, pcNumber, manuscriptDate, manuscriptSlot, manuscriptId, items }) {
  if (!isConfigured()) {
    const err = new Error('DBが未設定です'); err.status = 500; err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  if (!Array.isArray(items) || !items.length) return { saved: 0 };
  for (const it of items) assertResult(it.result);

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let saved = 0;

    for (const it of items) {
      const respondedAt = it.responded_at || (RESPONSE_RESULTS.has(it.result) ? new Date() : null);
      // 既存レポート(同 batch_id × customer_id)があるか
      const [existing] = await conn.query(
        `SELECT id FROM incoming_call_reports
          WHERE batch_id = ? AND customer_id = ? LIMIT 1`,
        [batchId, it.customerId]
      );
      if (existing.length) {
        await conn.query(
          `UPDATE incoming_call_reports
              SET result = ?, result_detail = ?, responded_at = ?,
                  send_date = ?, pc_number = ?,
                  manuscript_folder_date = ?, manuscript_slot = ?, manuscript_id = ?
            WHERE id = ?`,
          [
            it.result, it.result_detail || null, respondedAt,
            sendDate, pcNumber,
            manuscriptDate || null, manuscriptSlot || null, manuscriptId || null,
            existing[0].id,
          ]
        );
      } else {
        await conn.query(
          `INSERT INTO incoming_call_reports
             (customer_id, batch_id, send_date, pc_number,
              manuscript_id, manuscript_folder_date, manuscript_slot,
              result, result_detail, responded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            it.customerId, batchId, sendDate, pcNumber,
            manuscriptId || null, manuscriptDate || null, manuscriptSlot || null,
            it.result, it.result_detail || null, respondedAt,
          ]
        );
      }
      saved++;
    }

    // 各顧客のサマリを更新
    //   - last_result = 最新の result
    //   - response_count = 反応あり系 (response_inquiry / response_order) の累計
    //   - is_blacklisted = result が refusal なら 1
    const customerIds = items.map((it) => it.customerId);
    for (const it of items) {
      const updates = ['last_result = ?'];
      const params = [it.result];
      if (RESPONSE_RESULTS.has(it.result)) {
        updates.push('response_count = response_count + 1');
      }
      if (it.result === 'refusal') {
        updates.push('is_blacklisted = 1');
        updates.push('blacklisted_reason = ?');
        params.push(it.result_detail || '受電報告で拒否');
      }
      params.push(it.customerId);
      await conn.query(
        `UPDATE customers SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
    }

    await conn.commit();

    // contact_events への自動連携(失敗しても元処理は成功扱い)
    let contactEventsSynced = 0;
    try {
      for (const it of items) {
        await contactEvents.createEvent({
          customer_id: it.customerId,
          channel: 'fax',
          event_type: it.result === 'no_response' ? 'send' : it.result,
          // no_response = 送信のみ、それ以外は受電あり
          occurred_at: it.responded_at || `${sendDate}T00:00:00`,
          source_system: 'fax-crm',
          // source_event_id は incoming_call_reports.id を使いたいが手元に無いので
          // (batchId * 1e7 + customer_id) で衝突しない一意キー生成
          source_event_id: batchId ? batchId * 10000000 + Number(it.customerId) : null,
          pc_number: pcNumber,
          manuscript_id: manuscriptId || null,
          manuscript_folder_date: manuscriptDate || null,
          manuscript_slot: manuscriptSlot || null,
          result_label: it.result,
          memo: it.result_detail || null,
        });
        contactEventsSynced++;
      }
    } catch (_e) { /* swallow */ }

    return { saved, contactEventsSynced };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function createSingle({ customerId, sendDate, pcNumber, result, resultDetail, respondedAt, batchId, manuscriptId, manuscriptDate, manuscriptSlot }) {
  if (!isConfigured()) {
    const err = new Error('DBが未設定です'); err.status = 500; err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  assertResult(result);
  if (!customerId || !sendDate || !pcNumber) {
    const err = new Error('customerId / sendDate / pcNumber は必須です');
    err.status = 400; err.code = 'INVALID_INPUT';
    throw err;
  }
  return bulkSave({
    batchId: batchId || null,
    sendDate, pcNumber,
    manuscriptId, manuscriptDate, manuscriptSlot,
    items: [{ customerId, result, result_detail: resultDetail, responded_at: respondedAt }],
  });
}

module.exports = { listReports, getBatchInputView, bulkSave, createSingle, VALID_RESULTS };
