const { z } = require('zod');
const db = require('../config/db');

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'sent', 'confirmed', 'failed', 'timeout']).optional(),
  command: z.enum(['ON', 'OFF']).optional()
});

async function commands(req, res) {
  const { page, limit, status, command } = querySchema.parse(req.query);
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`c.status = $${params.length}`); }
  if (command) { params.push(command); where.push(`c.command = $${params.length}`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  params.push(limit);
  params.push((page - 1) * limit);
  const rows = await db.query(
    `SELECT c.request_id, c.device_id, c.command, c.status, c.error_message,
            c.created_at, c.sent_at, c.confirmed_at, c.timed_out_at,
            u.name AS user_name, u.username
     FROM commands c LEFT JOIN users u ON u.id = c.user_id
     ${clause}
     ORDER BY c.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  const countParams = params.slice(0, -2);
  const count = await db.query(`SELECT COUNT(*)::int AS total FROM commands c ${clause}`, countParams);
  res.json({ success: true, data: { commands: rows.rows, pagination: { page, limit, total: count.rows[0].total } } });
}

async function audit(req, res) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const result = await db.query(
    `SELECT a.*, u.name AS user_name, u.username
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
    [limit, (page - 1) * limit]
  );
  res.json({ success: true, data: { logs: result.rows, pagination: { page, limit } } });
}

module.exports = { commands, audit };
