function genRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function attachRequestId(req, _res, next) {
  req.requestId = req.headers['x-request-id'] || genRequestId();
  next();
}

function notFound(req, res) {
  return res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.path}`,
      request_id: req.requestId,
    },
  });
}

function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const requestId = req.requestId || '-';

  // 構造化ログ(本番では JSON ログ収集に流せる形)
  const logLine = {
    level: status >= 500 ? 'error' : 'warn',
    request_id: requestId,
    method: req.method,
    path: req.path,
    status,
    code,
    message: err.message,
  };
  console.error('[error]', JSON.stringify(logLine));
  if (status >= 500 && err.stack) console.error(err.stack);

  return res.status(status).json({
    success: false,
    error: {
      code,
      message: status >= 500
        ? 'サーバー内部でエラーが発生しました。担当者にお問い合わせください。'
        : err.message,
      request_id: requestId,
    },
  });
}

module.exports = { notFound, errorHandler, attachRequestId };
