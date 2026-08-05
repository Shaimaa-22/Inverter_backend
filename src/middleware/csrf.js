const HttpError = require('../utils/httpError');
const env = require('../config/env');

function requireSameOrigin(req, _res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  const referer = req.get('referer');
  const expected = env.frontendOrigin.replace(/\/$/, '');
  if (origin) {
    if (origin.replace(/\/$/, '') !== expected) return next(new HttpError(403, 'Cross-site request blocked.', 'CSRF_ORIGIN_MISMATCH'));
    return next();
  }
  if (referer) {
    try {
      if (new URL(referer).origin !== expected) return next(new HttpError(403, 'Cross-site request blocked.', 'CSRF_REFERER_MISMATCH'));
      return next();
    } catch { return next(new HttpError(403, 'Invalid request origin.', 'CSRF_INVALID_REFERER')); }
  }
  return next(new HttpError(403, 'Request origin is required.', 'CSRF_ORIGIN_REQUIRED'));
}
module.exports = { requireSameOrigin };
