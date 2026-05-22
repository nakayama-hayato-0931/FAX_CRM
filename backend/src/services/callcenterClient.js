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
 *   callcenter の GET /api/companies は ApiResponse.success 経由で:
 *     { success, data: { companies: [...], pagination: { page, limit, total, totalPages } }, message, error }
 *   を返す。 limit 最大値は 100 (callcenter 側でクランプされる)
 *
 *   オプション:
 *     pageSize         ... 1ページあたり件数 (max 100)
 *     maxPages         ... 安全装置 (デフォルト 1000ページ = 100000件)
 *     showExcluded     ... 1 で除外フラグ付き企業も取得 (デフォルト '1' で全件)
 *     includeSpecial   ... 'special' で特別リスト、 何もしないと通常リスト
 *     includeSalesList ... '1' で営業用リスト、 何もしないとオペレータ用リスト
 */
async function listAllCompanies(opts = {}) {
  const pageSize = Math.min(Math.max(Number(opts.pageSize) || 100, 1), 100);
  const maxPages = Number(opts.maxPages) || 1000;
  const showExcluded = opts.showExcluded ?? '1';  // 既定: 除外企業も取得
  const listType = opts.includeSpecial === 'special' ? 'special' : null;
  const isSalesList = opts.includeSalesList === '1' ? '1' : null;

  const baseParams = new URLSearchParams();
  baseParams.set('limit', String(pageSize));
  if (showExcluded) baseParams.set('show_excluded', String(showExcluded));
  if (listType) baseParams.set('list_type', listType);
  if (isSalesList) baseParams.set('is_sales_list', isSalesList);

  const all = [];
  let page = 1;
  while (page <= maxPages) {
    baseParams.set('page', String(page));
    const resp = await request('GET', `/api/companies?${baseParams.toString()}`);
    // resp = { success, data: { companies: [...], pagination: {...} }, ... }
    const block = resp?.data;
    const items = Array.isArray(block?.companies) ? block.companies
                : Array.isArray(block) ? block       // 単純配列フォールバック
                : [];
    if (items.length === 0) break;
    all.push(...items);
    const pg = block?.pagination;
    if (pg && pg.totalPages && page >= pg.totalPages) break;
    if (items.length < pageSize) break;  // ページサイズ未満なら最終ページ
    page++;
  }
  return all;
}

/**
 * オペレータ用リスト + 営業用リスト の両方を取得 (callcenter のフィルタが
 * デフォルトで is_sales_list=0 になっているため、 サイドごとに2回呼ぶ)
 */
async function listAllCompaniesBothLists(opts = {}) {
  const op = await listAllCompanies({ ...opts, includeSalesList: null });   // オペレータ用
  const sales = await listAllCompanies({ ...opts, includeSalesList: '1' }); // 営業用
  // id でユニーク化
  const seen = new Set();
  return [...op, ...sales].filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
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
  listAllCompanies, listAllCompaniesBothLists,
  getCompany, createCompany, updateCompany,
};
