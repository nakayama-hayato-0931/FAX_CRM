import axios from 'axios';

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4001',
  timeout: 60000,
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
    return Promise.reject(err);
  }
);
