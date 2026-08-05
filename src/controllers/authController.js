const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const db = require('../config/db');
const env = require('../config/env');
const HttpError = require('../utils/httpError');
const { writeAuditLog } = require('../utils/audit');

const loginSchema = z.object({
  username: z.string().trim().min(3).max(100),
  password: z.string().min(8).max(200)
});

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    maxAge: 8 * 60 * 60 * 1000,
    path: '/'
  };
}

async function login(req, res) {
  const { username, password } = loginSchema.parse(req.body);
  const result = await db.query(`SELECT * FROM users WHERE username = $1`, [username.toLowerCase()]);
  const user = result.rows[0];

  if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'Invalid username or password.', 'INVALID_CREDENTIALS');
  }

  // Do all DB work (and anything that can fail) BEFORE we set the cookie, so
  // the client never ends up with a valid session cookie while the request
  // itself reports failure.
  await db.query(`UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`, [user.id]);
  req.user = user;
  await safeAuditLog(req, { action: 'auth.login', resource: 'user', resourceId: String(user.id) });

  const token = jwt.sign(
    { sub: String(user.id), role: user.role, sessionVersion: user.session_version ?? 0 },
    env.jwtSecret,
    { algorithm: 'HS256', expiresIn: env.jwtExpiresIn, issuer: 'inverter-control-api' }
  );

  res.cookie(env.cookieName, token, cookieOptions());
  res.json({ success: true, data: { user: publicUser(user) } });
}

async function logout(req, res) {
  await db.query(`UPDATE users SET session_version = session_version + 1, updated_at = NOW() WHERE id = $1`, [req.user.id]);
  await safeAuditLog(req, { action: 'auth.logout', resource: 'user', resourceId: String(req.user.id) });
  res.clearCookie(env.cookieName, { httpOnly: true, secure: env.cookieSecure, sameSite: env.cookieSameSite, path: '/' });
  res.json({ success: true, message: 'Logged out.' });
}

// Audit logging is best-effort: a logging failure must never block or flip
// the outcome of the auth flow itself (e.g. cookie already sent to client).
async function safeAuditLog(req, entry) {
  try {
    await writeAuditLog(req, entry);
  } catch (error) {
    console.error('[Audit] Failed to write audit log:', error);
  }
}

function me(req, res) {
  res.json({ success: true, data: { user: publicUser(req.user) } });
}

function publicUser(user) {
  return { id: user.id, name: user.name, username: user.username, role: user.role, isActive: user.is_active };
}

module.exports = { login, logout, me };
