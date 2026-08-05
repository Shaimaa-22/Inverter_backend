const crypto = require('node:crypto');
const db = require('../config/db');
const env = require('../config/env');
const mqttService = require('./mqttService');
const HttpError = require('../utils/httpError');

async function getDeviceStatus() {
  const result = await db.query(`SELECT * FROM device_status WHERE device_id = $1`, [env.deviceId]);
  return result.rows[0];
}

async function sendCommand({ command, userId }) {
  const device = await getDeviceStatus();
  if (!device?.esp_online) {
    throw new HttpError(503, 'ESP32 is offline. Command was not sent.', 'DEVICE_OFFLINE');
  }
  if (!mqttService.isMqttConnected()) {
    throw new HttpError(503, 'Backend is not connected to MQTT broker.', 'MQTT_OFFLINE');
  }

  const requestId = crypto.randomUUID();
  const message = {
    requestId,
    deviceId: env.deviceId,
    command,
    sentAt: new Date().toISOString()
  };

  try {
    await db.query(
      `INSERT INTO commands (request_id, device_id, user_id, command, status, mqtt_message)
       VALUES ($1, $2, $3, $4, 'pending', $5)`,
      [requestId, env.deviceId, userId, command, message]
    );
  } catch (error) {
    // idx_commands_one_inflight_per_device: another command for this device
    // is still pending/sent. The DB is the source of truth here, so this
    // check is race-proof even under two near-simultaneous requests.
    if (error.code === '23505') {
      throw new HttpError(409, 'Another command is already in progress for this device.', 'COMMAND_IN_PROGRESS');
    }
    throw error;
  }

  try {
    await mqttService.publishCommand(message);
    const sent = await db.query(
      `UPDATE commands SET status = 'sent', sent_at = NOW()
       WHERE request_id = $1 AND status = 'pending'`,
      [requestId]
    );
    if (sent.rowCount === 1) mqttService.markCommandSent(requestId);
  } catch (error) {
    await db.query(
      `UPDATE commands SET status = 'failed', error_message = $2 WHERE request_id = $1`,
      [requestId, error.message]
    );
    throw new HttpError(503, 'Failed to publish command to MQTT broker.', 'MQTT_PUBLISH_FAILED');
  }

  return { requestId, status: 'sent', timeoutMs: env.commandTimeoutMs };
}

async function getCommand(requestId, { userId, role }) {
  const result = await db.query(
    `SELECT c.request_id, c.device_id, c.command, c.status, c.error_message,
            c.created_at, c.sent_at, c.confirmed_at, c.timed_out_at,
            c.acknowledgment, u.name AS user_name, u.username
     FROM commands c LEFT JOIN users u ON u.id = c.user_id
     WHERE c.request_id = $1
       AND ($2 = 'admin' OR c.user_id = $3)`,
    [requestId, role, userId]
  );
  if (!result.rows[0]) throw new HttpError(404, 'Command not found.', 'COMMAND_NOT_FOUND');
  return result.rows[0];
}

async function recoverInflightCommands() {
  const result = await db.query(
    `UPDATE commands
     SET status = 'timeout', timed_out_at = NOW(),
         error_message = 'Backend restarted before the command was confirmed.'
     WHERE status IN ('pending', 'sent')
     RETURNING request_id`
  );
  if (result.rowCount) console.warn(`[Commands] Marked ${result.rowCount} in-flight command(s) as timeout after restart.`);
  return result.rowCount;
}

module.exports = { getDeviceStatus, sendCommand, getCommand, recoverInflightCommands };
