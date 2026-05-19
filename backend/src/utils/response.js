function ok(res, data = null, meta) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.json(body);
}
function created(res, data = null) {
  return res.status(201).json({ success: true, data });
}
function fail(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}
module.exports = { ok, created, fail };
