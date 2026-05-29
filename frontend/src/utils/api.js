import axios from 'axios';

const TOKEN_KEY = 'fax_crm_token';

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4001',
  timeout: 60000,
});

// 全リクエストに Authorization: Bearer <token> を付与
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const body = err?.response?.data?.error;
    const status = err?.response?.status;
    const reqId = body?.request_id;
    const msg = body?.message || err?.message || 'リクエストに失敗しました';
    err.userMessage = reqId ? `${msg} (req: ${reqId})` : msg;
    err.errorCode = body?.code;
    err.statusCode = status;
    err.requestId = reqId;

    // 401 はログイン画面へリダイレクト (ログイン中の以外で発生時)
    if (status === 401 && typeof window !== 'undefined') {
      const path = window.location.pathname;
      if (!path.startsWith('/login')) {
        window.localStorage.removeItem(TOKEN_KEY);
        const next = encodeURIComponent(path + window.location.search);
        window.location.href = `/login?next=${next}`;
      }
    }
    return Promise.reject(err);
  }
);

// ----- トークン管理ヘルパー (login/logout 用) -----
export function setAuthToken(token) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else       window.localStorage.removeItem(TOKEN_KEY);
}
export function getAuthToken() {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
