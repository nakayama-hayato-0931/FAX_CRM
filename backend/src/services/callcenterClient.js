/**
 * callcenter-ai-system の REST API クライアント
 *   - ENV: CALLCENTER_API_BASE_URL  (例: https://callcenter-backend.up.railway.app)
 *          CALLCENTER_API_TOKEN     (サービス用 JWT)
 *   - 認証: Authorization: Bearer <token>
 *   - 取得: GET  /api/companies
 *           GET  /api/companies/:id
 *   - 作成: POST /api/companies
 *   - 更新: PUT  /api/companies/:id
 *   - 失敗時は status を含む Error を throw
 */

const BASE_URL = () => (process.env.CALLCENTER_API_BASE_URL || '').replace(/\/+$/, '');
const TOKEN = () => process.env.CALLCENTER_API_TOKEN || '';

function isConfigured() {
  return !!BASE_URL() && !!TOKEN();
}

async function request(method, path, body) {
  if (!isConfigured()) {
    const err = new Error('callcenter API 連携が未設定 (CALLCENTER_API_BASE_URL / CALLCENTER_API_TOKEN)');
    err.code = 'CALLCENTER_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }
  const url = `${BASE_URL()}${path}`;
  const headers = {
    'Accept': 'application/json',
    'Authorization': `Bearer ${TOKEN()}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const err = new Error(`callcenter HTTP接続失敗: ${e.message}`);
    err.code = 'CALLCENTER_FETCH_FAILED'; err.status = 502;
    throw err;
  }

  let json = null;
  try { json = await res.json(); } catch (_e) { /* not JSON */ }

  if (!res.ok) {
    const msg = json?.message || json?.error || res.statusText;
    const err = new Error(`callcenter API ${method} ${path} → ${res.status}: ${msg}`);
    err.code = 'CALLCENTER_API_ERROR'; err.status = res.status; err.body = json;
    throw err;
  }
  return json;
}

/**
 * 全企業を取得 (ページング対応)
 *   callcenter の GET /api/companies は { data: [...], pagination: { page, total, totalPages } } を返す想定
 *   実装が単純配列を返す場合も safe-handle する
 */
async function listAllCompanies({ pageSize = 200, maxPages = 100 } = {}) {
  const all = [];
  let page = 1;
  while (page <= maxPages) {
    const resp = await request('GET', `/api/companies?page=${page}&limit=${pageSize}`);
    // 想定: { success, data: [...], pagination: { ... } }
    const items = Array.isArray(resp?.data) ? resp.data
                : Array.isArray(resp?.data?.data) ? resp.data.data
                : Array.isArray(resp) ? resp
                : [];
    if (items.length === 0) break;
    all.push(...items);
    const pagination = resp?.pagination || resp?.data?.pagination;
    if (pagination) {
      if (page >= (pagination.totalPages || page)) break;
    } else if (items.length < pageSize) {
      // pagination 情報無し + 1ページが満杯でなければ終了
      break;
    }
    page++;
  }
  return all;
}

async function getCompany(id) {
  const resp = await request('GET', `/api/companies/${id}`);
  return resp?.data || resp;
}

async function createCompany(payload) {
  const resp = await request('POST', `/api/companies`, payload);
  return resp?.data || resp;
}

async function updateCompany(id, payload) {
  const resp = await request('PUT', `/api/companies/${id}`, payload);
  return resp?.data || resp;
}

module.exports = {
  isConfigured,
  listAllCompanies, getCompany, createCompany, updateCompany,
};
