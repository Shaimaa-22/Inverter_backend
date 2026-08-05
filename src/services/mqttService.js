const fs = require('node:fs');
const mqtt = require('mqtt');
const db = require('../config/db');
const env = require('../config/env');

let client = null;
let connected = false;
const pendingTimers = new Map();

function safeJson(buffer) {
  try { return JSON.parse(buffer.toString('utf8')); } catch { return null; }
}

async function updateAvailability(isOnline, payload = null) {
  await db.query(
    `INSERT INTO device_status (device_id, esp_online, mqtt_connected, last_seen, last_status_payload, updated_at)
     VALUES ($1, $2, $3, CASE WHEN $2 THEN NOW() ELSE NULL END, $4, NOW())
     ON CONFLICT (device_id) DO UPDATE SET
       esp_online = EXCLUDED.esp_online,
       mqtt_connected = EXCLUDED.mqtt_connected,
       last_seen = CASE WHEN EXCLUDED.esp_online THEN NOW() ELSE device_status.last_seen END,
       last_status_payload = COALESCE(EXCLUDED.last_status_payload, device_status.last_status_payload),
       updated_at = NOW()`,
    [env.deviceId, isOnline, isOnline, payload]
  );
}

async function handleAck(payload) {
  if (!payload?.requestId || !payload?.deviceId || payload.deviceId !== env.deviceId) return;
  if (!['success', 'failed'].includes(payload.result)) return;
  if (!['ON', 'OFF'].includes(payload.command)) return;

  // Validate the ACK against the exact command stored in PostgreSQL.
  const result = await db.query(
    `UPDATE commands SET
       status = $2,
       acknowledgment = $3,
       error_message = $4,
       confirmed_at = CASE WHEN $2 = 'confirmed' THEN NOW() ELSE confirmed_at END
     WHERE request_id = $1
       AND device_id = $5
       AND command = $6
       AND status IN ('pending', 'sent')
     RETURNING request_id`,
    [payload.requestId, payload.result === 'success' ? 'confirmed' : 'failed',
      payload, payload.error || null, env.deviceId, payload.command]
  );
  if (result.rowCount === 0) return; // stale/duplicate/mismatched ACK

  const timer = pendingTimers.get(payload.requestId);
  if (timer) clearTimeout(timer);
  pendingTimers.delete(payload.requestId);

  if (payload.relayState || payload.inverterState) {
    await db.query(
      `UPDATE device_status SET
         esp_online = TRUE, mqtt_connected = TRUE,
         relay_state = COALESCE($2, relay_state),
         inverter_state = COALESCE($3, inverter_state),
         last_seen = NOW(), last_status_payload = $4, updated_at = NOW()
       WHERE device_id = $1`,
      [env.deviceId, payload.relayState || null, payload.inverterState || null, payload]
    );
  }
}

async function handleStatus(payload) {
  if (!payload || payload.deviceId !== env.deviceId) return;
  await db.query(
    `INSERT INTO device_status
      (device_id, esp_online, mqtt_connected, relay_state, inverter_state, fault_code,
       wifi_rssi, uptime_seconds, firmware_version, last_seen, last_status_payload, updated_at)
     VALUES ($1, TRUE, TRUE, $2, $3, $4, $5, $6, $7, NOW(), $8, NOW())
     ON CONFLICT (device_id) DO UPDATE SET
       esp_online = TRUE,
       mqtt_connected = TRUE,
       relay_state = COALESCE(EXCLUDED.relay_state, device_status.relay_state),
       inverter_state = COALESCE(EXCLUDED.inverter_state, device_status.inverter_state),
       fault_code = EXCLUDED.fault_code,
       wifi_rssi = COALESCE(EXCLUDED.wifi_rssi, device_status.wifi_rssi),
       uptime_seconds = COALESCE(EXCLUDED.uptime_seconds, device_status.uptime_seconds),
       firmware_version = COALESCE(EXCLUDED.firmware_version, device_status.firmware_version),
       last_seen = NOW(),
       last_status_payload = EXCLUDED.last_status_payload,
       updated_at = NOW()`,
    [env.deviceId, payload.relayState || 'UNKNOWN', payload.inverterState || 'UNKNOWN',
      payload.faultCode || null, payload.wifiRssi ?? null, payload.uptime ?? null,
      payload.firmwareVersion || null, payload]
  );
}

async function handleHeartbeat(payload) {
  if (!payload || payload.deviceId !== env.deviceId) return;
  await db.query(
    `UPDATE device_status SET
       esp_online = TRUE,
       mqtt_connected = TRUE,
       wifi_rssi = COALESCE($2, wifi_rssi),
       uptime_seconds = COALESCE($3, uptime_seconds),
       firmware_version = COALESCE($4, firmware_version),
       last_seen = NOW(),
       updated_at = NOW()
     WHERE device_id = $1`,
    [env.deviceId, payload.wifiRssi ?? null, payload.uptime ?? null, payload.firmwareVersion || null]
  );
}

function startCommandTimeout(requestId) {
  const timer = setTimeout(async () => {
    pendingTimers.delete(requestId);
    try {
      await db.query(
        `UPDATE commands SET status = 'timeout', timed_out_at = NOW(),
           error_message = 'ESP32 did not acknowledge the command before timeout.'
         WHERE request_id = $1 AND status = 'sent'`,
        [requestId]
      );
    } catch (error) { console.error('[MQTT] Failed to mark timeout:', error); }
  }, env.commandTimeoutMs);
  timer.unref();
  pendingTimers.set(requestId, timer);
}

function publishCommand(message) {
  if (!client || !connected) {
    const error = new Error('MQTT broker is not connected.');
    error.code = 'MQTT_OFFLINE';
    throw error;
  }
  return new Promise((resolve, reject) => {
    client.publish(env.topics.command, JSON.stringify(message), { qos: 1, retain: false }, (error) => {
      if (error) return reject(error);
      // Timer starts only after deviceService successfully changes pending -> sent.
      resolve();
    });
  });
}

function markCommandSent(requestId) { startCommandTimeout(requestId); }
function isMqttReady() { return Boolean(client && connected); }

function connectMqtt() {
  const options = {
    clientId: env.mqttClientId,
    username: env.mqttUsername,
    password: env.mqttPassword,
    clean: true,
    protocolVersion: 4,
    keepalive: env.mqttKeepaliveSeconds,
    reconnectPeriod: env.mqttReconnectPeriodMs,
    connectTimeout: env.mqttConnectTimeoutMs,
    rejectUnauthorized: env.mqttRejectUnauthorized,
    resubscribe: true,
    queueQoSZero: false
  };
  if (env.mqttCaPath) options.ca = fs.readFileSync(env.mqttCaPath);

  client = mqtt.connect(env.mqttUrl, options);

  client.on('connect', (connack) => {
    connected = true;
    console.log(`[MQTT] Connected to HiveMQ (sessionPresent=${Boolean(connack.sessionPresent)})`);
    client.subscribe([env.topics.ack, env.topics.status, env.topics.heartbeat, env.topics.lwt], { qos: 1 }, (error) => {
      if (error) console.error('[MQTT] Subscribe failed:', error);
      else console.log('[MQTT] Subscribed to device topics');
    });
  });

  client.on('reconnect', () => console.log('[MQTT] Reconnecting...'));
  client.on('offline', () => { connected = false; console.warn('[MQTT] Offline'); });
  client.on('close', () => { connected = false; });
  client.on('error', (error) => {
    connected = false;
    console.error('[MQTT] Error:', error.message);
  });

  client.on('message', async (topic, buffer) => {
    const payload = safeJson(buffer);
    if (!payload) return console.warn('[MQTT] Ignored invalid JSON on', topic);
    try {
      if (topic === env.topics.ack) await handleAck(payload);
      else if (topic === env.topics.status) await handleStatus(payload);
      else if (topic === env.topics.heartbeat) await handleHeartbeat(payload);
      else if (topic === env.topics.lwt) await updateAvailability(payload.status === 'online', payload);
    } catch (error) {
      console.error('[MQTT] Message processing failed:', error);
    }
  });

  return client;
}

async function disconnectMqtt() {
  for (const timer of pendingTimers.values()) clearTimeout(timer);
  pendingTimers.clear();
  if (!client) return;
  await new Promise((resolve) => client.end(false, {}, resolve));
}

function isMqttConnected() { return connected; }

module.exports = { connectMqtt, disconnectMqtt, publishCommand, markCommandSent, isMqttConnected, isMqttReady };
