const db = require('../config/db');

async function writeAuditLog(req, { action, resource = null, resourceId = null, details = null }) {
  const userId = req.user?.id || null;
  const ip = req.ip;

  await db.query(
    `INSERT INTO audit_logs
      (user_id, action, resource, resource_id, ip_address, user_agent, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, action, resource, resourceId, ip || null, req.get('user-agent') || null, details]
  );
}

module.exports = { writeAuditLog };
