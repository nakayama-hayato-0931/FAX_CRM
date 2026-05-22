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
 * 全企業を取得 (ページング対応 + 並行取得)
 *   callcenter の GET /api/companies は ApiResponse.success 経由で:
 *     { success, data: { companies: [...], pagination: { page, limit, total, totalPages } }, message, error }
 *   を返す。 limit 最大値は 100 (callcenter 側でクランプされる)
 *
 *   オプション:
 *     pageSize         ... 1ページあたり件数 (max 100)
 *     maxPages         ... 安全装置 (デフォルト 25000ページ = 250万件、 200万件規模対応)
 *     concurrency      ... 並行リクエスト数 (デフォルト 5、 callcenter 負荷とのバランス)
 *     showExcluded     ... 1 で除外フラグ付き企業も取得 (デフォルト '1' で全件)
 *     includeSpecial   ... 'special' で特別リスト、 何もしないと通常リスト
 *     includeSalesList ... '1' で営業用リスト、 何もしないとオペレータ用リスト
 *     onProgress       ... (loadedCount, totalIfKnown) のコールバック (任意)
 *
 *   実装メモ:
 *     1ページ目を直列で取得して pagination.totalPages を確定
 *     → 残りページを並行 (concurrency 単位) で fetch、 メモリ膨張を抑える
 *     totalPages 不明な場合は直列フォールバック (空ページで終了判定)
 */
async function listAllCompanies(opts = {}) {
  const pageSize = Math.min(Math.max(Number(opts.pageSize) || 100, 1), 100);
  const maxPages = Number(opts.maxPages) || 25000;
  const concurrency = Math.min(Math.max(Number(opts.concurrency) || 5, 1), 20);
  const showExcluded = opts.showExcluded ?? '1';
  const listType = opts.includeSpecial === 'special' ? 'special' : null;
  const isSalesList = opts.includeSalesList === '1' ? '1' : null;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  const baseParams = new URLSearchParams();
  baseParams.set('limit', String(pageSize));
  if (showExcluded) baseParams.set('show_excluded', String(showExcluded));
  if (listType) baseParams.set('list_type', listType);
  if (isSalesList) baseParams.set('is_sales_list', isSalesList);

  // ---- 1) 1ページ目 (totalPages 確定用) ----
  baseParams.set('page', '1');
  const first = await request('GET', `/api/companies?${baseParams.toString()}`);
  const firstBlock = first?.data;
  const firstItems = Array.isArray(firstBlock?.companies) ? firstBlock.companies
                   : Array.isArray(firstBlock) ? firstBlock : [];
  if (firstItems.length === 0) return [];
  const all = [...firstItems];
  if (onProgress) onProgress(all.length, firstBlock?.pagination?.total ?? null);

  const totalPages = firstBlock?.pagination?.totalPages || null;
  const stopPage = totalPages ? Math.min(totalPages, maxPages) : maxPages;
  if (stopPage <= 1) return all;

  // ---- 2) 残りページを並行取得 ----
  if (totalPages) {
    // totalPages 既知 → ページ番号一覧を作って worker pool で並列
    const queue = [];
    for (let p = 2; p <= stopPage; p++) queue.push(p);
    let cursor = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (cursor < queue.length) {
        const myIdx = cursor++;
        const p = queue[myIdx];
        const params = new URLSearchParams(baseParams);
        params.set('page', String(p));
        const resp = await request('GET', `/api/companies?${params.toString()}`);
        const block = resp?.data;
        const items = Array.isArray(block?.companies) ? block.companies
                    : Array.isArray(block) ? block : [];
        all.push(...items);
        if (onProgress) onProgress(all.length, firstBlock?.pagination?.total ?? null);
      }
    });
    await Promise.all(workers);
  } else {
    // totalPages 不明 → 直列フォールバック (空ページで終了判定)
    let page = 2;
    while (page <= stopPage) {
      const params = new URLSearchParams(baseParams);
      params.set('page', String(page));
      const resp = await request('GET', `/api/companies?${params.toString()}`);
      const block = resp?.data;
      const items = Array.isArray(block?.companies) ? block.companies
                  : Array.isArray(block) ? block : [];
      if (items.length === 0) break;
      all.push(...items);
      if (items.length < pageSize) break;
      if (onProgress) onProgress(all.length, null);
      page++;
    }
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

/**
 * 全企業をページ単位で stream 処理 (メモリ膨張回避)
 *   onBatch(items, meta) を各ページごとに呼ぶ
 *   - 200万件規模ではこちらを使う (listAllCompanies は全件 array で持つ)
 *   - 内部実装は listAllCompanies と同等の並行取得
 */
async function streamAllCompanies(opts, onBatch) {
  if (typeof onBatch !== 'function') throw new Error('onBatch required');
  const pageSize = Math.min(Math.max(Number(opts.pageSize) || 100, 1), 100);
  const maxPages = Number(opts.maxPages) || 25000;
  const concurrency = Math.min(Math.max(Number(opts.concurrency) || 5, 1), 20);
  const showExcluded = opts.showExcluded ?? '1';
  const listType = opts.includeSpecial === 'special' ? 'special' : null;
  const isSalesList = opts.includeSalesList === '1' ? '1' : null;
  const updatedSince = opts.updatedSince || null;  // ISO8601 文字列。 指定時は updated_at >= で差分のみ取得

  const baseParams = new URLSearchParams();
  baseParams.set('limit', String(pageSize));
  if (showExcluded) baseParams.set('show_excluded', String(showExcluded));
  if (listType) baseParams.set('list_type', listType);
  if (isSalesList) baseParams.set('is_sales_list', isSalesList);
  if (updatedSince) baseParams.set('updated_since', updatedSince);

  // 1ページ目で totalPages 確定
  baseParams.set('page', '1');
  const first = await request('GET', `/api/companies?${baseParams.toString()}`);
  const firstBlock = first?.data;
  const firstItems = Array.isArray(firstBlock?.companies) ? firstBlock.companies
                   : Array.isArray(firstBlock) ? firstBlock : [];
  const total = firstBlock?.pagination?.total ?? null;
  if (firstItems.length === 0) return { totalProcessed: 0, totalKnown: total };

  let processed = 0;
  await onBatch(firstItems, { page: 1, total });
  processed += firstItems.length;

  const totalPages = firstBlock?.pagination?.totalPages || null;
  const stopPage = totalPages ? Math.min(totalPages, maxPages) : maxPages;
  if (stopPage <= 1) return { totalProcessed: processed, totalKnown: total };

  if (totalPages) {
    const queue = [];
    for (let p = 2; p <= stopPage; p++) queue.push(p);
    let cursor = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (cursor < queue.length) {
        const myIdx = cursor++;
        const p = queue[myIdx];
        const params = new URLSearchParams(baseParams);
        params.set('page', String(p));
        const resp = await request('GET', `/api/companies?${params.toString()}`);
        const block = resp?.data;
        const items = Array.isArray(block?.companies) ? block.companies
                    : Array.isArray(block) ? block : [];
        if (items.length > 0) {
          await onBatch(items, { page: p, total });
          processed += items.length;
        }
      }
    });
    await Promise.all(workers);
  } else {
    let page = 2;
    while (page <= stopPage) {
      const params = new URLSearchParams(baseParams);
      params.set('page', String(page));
      const resp = await request('GET', `/api/companies?${params.toString()}`);
      const block = resp?.data;
      const items = Array.isArray(block?.companies) ? block.companies
                  : Array.isArray(block) ? block : [];
      if (items.length === 0) break;
      await onBatch(items, { page, total });
      processed += items.length;
      if (items.length < pageSize) break;
      page++;
    }
  }
  return { totalProcessed: processed, totalKnown: total };
}

module.exports = {
  isConfigured,
  listAllCompanies, listAllCompaniesBothLists, streamAllCompanies,
  getCompany, createCompany, updateCompany,
};
