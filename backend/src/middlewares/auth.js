/**
 * 認証 ミドルウェア
 *   - requireAuth   : Authorization: Bearer <jwt> をチェックし req.user に展開
 *   - requireRole(r): requireAuth に加えて role を要求
 *
 *   開発用 escape hatch: 環境変数 DISABLE_AUTH=1 で 全 リクエストを admin として
 *   通過させる (本番では使わないこと)
 */
const auth = require('../services/authService');

function bypassed() {
  return ['1', 'true', 'yes'].includes(String(process.env.DISABLE_AUTH || '').toLowerCase());
}

function extractToken(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];
  if (req.query?.token) return String(req.query.token);
  return null;
}

function requireAuth(req, res, next) {
  if (bypassed()) {
    req.user = { id: 0, username: 'dev', role: 'admin', name: 'dev' };
    return next();
  }
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'ログインが必要です' },
    });
  }
  const payload = auth.verifyToken(token);
  if (!payload) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'セッションが無効です。 再ログインしてください' },
    });
  }
  req.user = {
    id: payload.sub,
    username: payload.username,
    role: payload.role,
    name: payload.name,
  };
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    requireAuth(req, res, (err) => {
      if (err) return next(err);
      if (req.user.role !== role) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'この操作には ' + role + ' 権限が必要です' },
        });
      }
      next();
    });
  };
}

module.exports = { requireAuth, requireRole };
