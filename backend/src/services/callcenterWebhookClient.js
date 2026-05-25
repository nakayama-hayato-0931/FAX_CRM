/**
 * callcenter-ai-system の webhook 受け口へ contact_event を push するクライアント。
 *
 * ENV:
 *   CALLCENTER_API_BASE_URL    callcenter backend のベース URL（callcenterClient と共有）
 *   CALLCENTER_WEBHOOK_SECRET  callcenter 側の FAX_CRM_WEBHOOK_SECRET と同じ値
 *
 * 認証: HTTP ヘッダ `X-Webhook-Secret` に CALLCENTER_WEBHOOK_SECRET を載せる。
 *      → callcenter 側の /api/integrations/faxcrm/event は JWT ではなく
 *        この共有シークレットだけで受け付ける。
 *
 * 仕様: callcenter-ai-system/backend/src/controllers/faxCrmWebhookController.js
 *
 * 失敗ポリシー: fax-crm 本処理を阻害しないよう、失敗はすべて握りつぶしてログのみ。
 */
const logger = {
  info:  (...a) => console.log('[INFO]', ...a),
  warn:  (...a) => console.warn('[WARN]', ...a),
  debug: (...a) => process.env.LOG_DEBUG ? console.log('[DEBUG]', ...a) : null,
};

const DEFAULT_TIMEOUT_MS = 5000;

function baseUrl() {
  return (process.env.CALLCENTER_API_BASE_URL || '').replace(/\/+$/, '');
}
function secret() {
  return process.env.CALLCENTER_WEBHOOK_SECRET || '';
}

function isEnabled() {
  return !!baseUrl() && !!secret();
}

/**
 * 単発の contact_event を callcenter に通知。
 * @param {object} payload  fax-crm 側の event 行をそのまま渡せばよい (id, customer, channel など)
 * @returns {Promise<{ok:boolean, status?:number, body?:any, error?:string, skipped?:boolean}>}
 */
async function pushEvent(payload) {
  if (!isEnabled()) {
    return { ok: false, skipped: true, reason: 'CALLCENTER_WEBHOOK 未設定' };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(`${baseUrl()}/api/integrations/faxcrm/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': secret(),
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    let body;
    try { body = JSON.parse(text); } catch (_e) { body = text; }
    if (!resp.ok) return { ok: false, status: resp.status, body };
    return { ok: true, status: resp.status, body };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

/**
 * バルク通知（events 配列まとめ送信）
 */
async function pushEventsBulk(events) {
  if (!isEnabled()) return { ok: false, skipped: true };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS * 3);
  try {
    const resp = await fetch(`${baseUrl()}/api/integrations/faxcrm/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': secret(),
      },
      body: JSON.stringify({ events }),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    let body;
    try { body = JSON.parse(text); } catch (_e) { body = text; }
    if (!resp.ok) return { ok: false, status: resp.status, body };
    return { ok: true, status: resp.status, body };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

/**
 * fax-crm 側の保存済み contact_event 1件分から、callcenter 受け口の payload を作る。
 * customer.external_callcenter_id が無い場合は callcenter 側で「unknown_company」扱いで
 * スキップされるため、ここではエラーにしない。
 */
function buildPayloadFromEvent(eventRow, customerRow) {
  return {
    lookup: {
      external_callcenter_id: customerRow?.external_callcenter_id || null,
      fax: customerRow?.fax_number || null,
      phone: customerRow?.phone_number || null,
    },
    id: eventRow.id,
    source_event_id: eventRow.source_event_id || `fax-crm-${eventRow.id}`,
    channel: eventRow.channel,
    event_type: eventRow.event_type,
    occurred_at: eventRow.occurred_at instanceof Date
      ? eventRow.occurred_at.toISOString()
      : eventRow.occurred_at,
    operator_name: eventRow.operator_name || null,
    result_label: eventRow.result_label || null,
    memo: eventRow.memo || null,
  };
}

/**
 * fire-and-forget で送る薄いラッパ（contactEventService から呼ばれる）
 */
function notifyCallcenter(eventRow, customerRow) {
  if (!isEnabled()) return;
  // external_callcenter_id が無いと callcenter 側で照合できないのでスキップ
  if (!customerRow?.external_callcenter_id) {
    logger.debug && logger.debug(`[callcenterWebhook] external_callcenter_id 無し → スキップ event_id=${eventRow.id}`);
    return;
  }
  const payload = buildPayloadFromEvent(eventRow, customerRow);
  pushEvent(payload)
    .then((r) => {
      if (r.ok) {
        logger.info(`[callcenterWebhook] push OK event=${eventRow.id} company_cc=${customerRow.external_callcenter_id}`);
      } else if (r.skipped) {
        // no-op
      } else {
        logger.warn(`[callcenterWebhook] push 失敗 event=${eventRow.id}: ${r.error || JSON.stringify(r.body)}`);
      }
    })
    .catch((e) => logger.warn(`[callcenterWebhook] push 例外 event=${eventRow.id}: ${e.message}`));
}

module.exports = {
  isEnabled,
  pushEvent,
  pushEventsBulk,
  notifyCallcenter,
  buildPayloadFromEvent,
};
