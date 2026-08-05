const bcrypt = require('bcryptjs');
const { z } = require('zod');
const db = require('../config/db');
const env = require('../config/env');
const HttpError = require('../utils/httpError');
const { writeAuditLog } = require('../utils/audit');

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  username: z.string().trim().min(3).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(8).max(200),
  role: z.enum(['admin', 'operator']).default('operator')
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  role: z.enum(['admin', 'operator']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).max(200).optional()
}).refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

async function list(_req, res) {
  const result = await db.query(
    `SELECT id, name, username, role, is_active, last_login_at, created_at, updated_at
     FROM users ORDER BY created_at DESC`
  );
  res.json({ success: true, data: { users: result.rows } });
}

async function create(req, res) {
  const input = createSchema.parse(req.body);
  const hash = await bcrypt.hash(input.password, env.bcryptRounds);
  const result = await db.query(
    `INSERT INTO users (name, username, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, username, role, is_active, created_at`,
    [input.name, input.username.toLowerCase(), hash, input.role]
  );
  const user = result.rows[0];
  await writeAuditLog(req, { action: 'user.create', resource: 'user', resourceId: String(user.id), details: { role: user.role } });
  res.status(201).json({ success: true, data: { user } });
}

async function update(req, res) {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const input = updateSchema.parse(req.body);
  if (id === Number(req.user.id) && input.isActive === false) {
    throw new HttpError(400, 'You cannot deactivate your own account.', 'SELF_DEACTIVATION');
  }

  const fields = [];
  const values = [];
  const add = (sql, value) => { values.push(value); fields.push(`${sql} = $${values.length}`); };
  if (input.name !== undefined) add('name', input.name);
  if (input.role !== undefined) add('role', input.role);
  if (input.isActive !== undefined) add('is_active', input.isActive);
  if (input.password !== undefined) add('password_hash', await bcrypt.hash(input.password, env.bcryptRounds));
  values.push(id);

  const result = await db.query(
    `UPDATE users SET ${fields.join(', ')}, updated_at = NOW()
     WHERE id = $${values.length}
     RETURNING id, name, username, role, is_active, last_login_at, created_at, updated_at`,
    values
  );
  if (!result.rows[0]) throw new HttpError(404, 'User not found.', 'USER_NOT_FOUND');
  await writeAuditLog(req, { action: 'user.update', resource: 'user', resourceId: String(id), details: input.password ? { ...input, password: '[changed]' } : input });
  res.json({ success: true, data: { user: result.rows[0] } });
}

module.exports = { list, create, update };
