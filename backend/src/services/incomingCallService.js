const { getPool, isConfigured } = require('../../config/db');
const contactEvents = require('./contactEventService');

// 本番デプロイで runtime migration が走る前に新コードが SELECT/INSERT してしまう
// race condition への防御。 sales_owner 列が無ければ追加する。 1 度成功すれば以降は no-op。
let _salesOwnerColumnEnsured = false;
async function ensureSalesOwnerColumn(pool) {
  if (_salesOwnerColumnEnsured) return;
  try {
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'incoming_call_reports'
          AND COLUMN_NAME = 'sales_owner'`
    );
    if (rows.length === 0) {
      await pool.query(
        `ALTER TABLE incoming_call_reports
           ADD COLUMN sales_owner VARCHAR(100) DEFAULT NULL
             COMMENT '担当営業 (手動入力 / 自動補完)'`
      );
      console.log('[incomingCallService] sales_owner 列 自動追加 完了');
    }
    _salesOwnerColumnEnsured = true;
  } catch (e) {
    console.error('[incomingCallService] sales_owner 列 ensure 失敗:', e.message);
    // 失敗時はフラグを立てずに次回再試行
  }
}

// 新しい結果の選択肢
//   project       ... 案件化
//   ng            ... NG
//   recall        ... リコール
//   material_sent ... 資料送付
//   other         ... その他
// 旧値 (no_response/response_inquiry/response_order/refusal/invalid_number) も
// 後方互換のため許容
const VALID_RESULTS = new Set([
  'project', 'ng', 'recall', 'material_sent', 'other',
  // legacy
  'no_response', 'response_inquiry', 'response_order',
  'refusal', 'invalid_number',
]);
// 「反応あり」 として扱う結果 (顧客マスタの response_count 加算条件)
const RESPONSE_RESULTS = new Set(['project', 'material_sent', 'response_inquiry', 'response_order']);

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
  await ensureSalesOwnerColumn(pool);
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
            icr.manuscript_folder_date, icr.manuscript_slot, icr.candidate_registration_no,
            icr.sales_owner,
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
  await ensureSalesOwnerColumn(pool);
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
                  manuscript_folder_date = ?, manuscript_slot = ?, manuscript_id = ?,
                  candidate_registration_no = ?, sales_owner = ?
            WHERE id = ?`,
          [
            it.result, it.result_detail || null, respondedAt,
            sendDate, pcNumber,
            manuscriptDate || null, manuscriptSlot || null, manuscriptId || null,
            it.candidate_registration_no || null,
            it.sales_owner || null,
            existing[0].id,
          ]
        );
      } else {
        await conn.query(
          `INSERT INTO incoming_call_reports
             (customer_id, batch_id, send_date, pc_number,
              manuscript_id, manuscript_folder_date, manuscript_slot,
              candidate_registration_no, sales_owner,
              result, result_detail, responded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            it.customerId, batchId, sendDate, pcNumber,
            manuscriptId || null, manuscriptDate || null, manuscriptSlot || null,
            it.candidate_registration_no || null, it.sales_owner || null,
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

    // contact_events への自動連携 (顧客タイムライン用)
    //   per-item の try/catch で 1件失敗しても他は継続。 エラーは log に出す
    //   (顧客タイムラインに出ないトラブルの原因を追えるように)
    let contactEventsSynced = 0;
    const contactEventsFailed = [];
    for (const it of items) {
      try {
        // 受電報告の event は すべて 'call' チャネル (顧客から FAX に対してかかってきた電話)
        const ceChannel = 'call';
        await contactEvents.createEvent({
          customer_id: it.customerId,
          channel: ceChannel,
          event_type: it.result === 'no_response' ? 'send' : it.result,
          // 受電日時 > 送信日 > 今 の優先順で occurred_at を決める
          occurred_at: it.responded_at || (sendDate ? `${sendDate}T00:00:00` : new Date().toISOString()),
          source_system: 'fax-crm',
          // source_event_id は (batchId * 1e7 + customer_id) で衝突しない一意キー生成
          // 手動入力 (batchId=null) は null → dedup スキップ で常に新規 insert
          source_event_id: batchId ? batchId * 10000000 + Number(it.customerId) : null,
          pc_number: pcNumber,
          // 担当営業 を operator_name に保存 (タイムラインに 「担当: 山田」 と表示)
          operator_name: it.sales_owner || null,
          manuscript_id: manuscriptId || null,
          manuscript_folder_date: manuscriptDate || null,
          manuscript_slot: manuscriptSlot || null,
          result_label: it.result,
          memo: it.result_detail || null,
        });
        contactEventsSynced++;
      } catch (e) {
        contactEventsFailed.push({ customerId: it.customerId, error: e.message });
        console.error(
          `[incomingCall.bulkSave] contact_events 連携失敗 (customer_id=${it.customerId}):`,
          e.message
        );
      }
    }

    return { saved, contactEventsSynced, contactEventsFailed: contactEventsFailed.length };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * 顧客の最新 incoming_call_report を返す (手動入力モーダルの自動入力用)
 */
async function getLastForCustomer(customerId) {
  const pool = getPool();
  if (!pool) return null;
  await ensureSalesOwnerColumn(pool);
  const [rows] = await pool.query(
    `SELECT id, send_date, pc_number,
            manuscript_id, manuscript_folder_date, manuscript_slot,
            candidate_registration_no, sales_owner,
            result, result_detail, responded_at, recorded_at
       FROM incoming_call_reports
      WHERE customer_id = ?
      ORDER BY responded_at DESC, recorded_at DESC, id DESC
      LIMIT 1`,
    [customerId]
  );
  return rows[0] || null;
}

async function createSingle({ customerId, sendDate, pcNumber, result, resultDetail, respondedAt, batchId, manuscriptId, manuscriptDate, manuscriptSlot, candidateRegistrationNo, salesOwner }) {
  if (!isConfigured()) {
    const err = new Error('DBが未設定です'); err.status = 500; err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  assertResult(result);
  if (!customerId) {
    const err = new Error('customerId は必須です');
    err.status = 400; err.code = 'INVALID_INPUT';
    throw err;
  }
  // 担当営業 を マスタ (sales_owners) にも 自動登録 (トグル選択肢に反映)
  if (salesOwner && String(salesOwner).trim()) {
    try {
      await require('./salesOwnerService').findOrCreate(salesOwner);
    } catch (e) {
      console.warn('[createSingle] sales_owner マスタ登録 skip:', e.message);
    }
  }
  // sendDate / pcNumber は任意化 (顧客の最終送信が不明な場合 NULL を許容)
  return bulkSave({
    batchId: batchId || null,
    sendDate: sendDate || null,
    pcNumber: pcNumber || null,
    manuscriptId, manuscriptDate, manuscriptSlot,
    items: [{
      customerId,
      result,
      result_detail: resultDetail,
      responded_at: respondedAt,
      candidate_registration_no: candidateRegistrationNo || null,
      sales_owner: salesOwner || null,
    }],
  });
}

module.exports = { listReports, getBatchInputView, bulkSave, createSingle, getLastForCustomer, VALID_RESULTS };
