const jwt = require('jsonwebtoken');
const db = require('../config/db');
const env = require('../config/env');
const HttpError = require('../utils/httpError');
const asyncHandler = require('../utils/asyncHandler');

const authenticate = asyncHandler(async (req, _res, next) => {
  const token = req.cookies?.[env.cookieName];
  if (!token) throw new HttpError(401, 'Authentication required.', 'AUTH_REQUIRED');

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'], issuer: 'inverter-control-api' });
  } catch {
    throw new HttpError(401, 'Session is invalid or expired.', 'INVALID_SESSION');
  }

  const result = await db.query(
    `SELECT id, name, username, role, is_active, session_version, created_at
     FROM users WHERE id = $1`,
    [payload.sub]
  );

  const user = result.rows[0];
  if (!user || !user.is_active || Number(user.session_version) !== Number(payload.sessionVersion ?? 0)) {
    throw new HttpError(401, 'User account is inactive.', 'INACTIVE_USER');
  }

  req.user = user;
  next();
});

function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new HttpError(403, 'You do not have permission for this action.', 'FORBIDDEN'));
    }
    next();
  };
}

module.exports = { authenticate, authorize };
