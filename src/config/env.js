const path = require('node:path');
const dotenv = require('dotenv');

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function bool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function number(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: number('PORT', 3000),
  trustProxy: number('TRUST_PROXY', 0),
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:5500',
  databaseUrl: required('DATABASE_URL'),
  databaseSsl: bool('DATABASE_SSL', process.env.NODE_ENV === 'production'),
  databaseSslRejectUnauthorized: bool('DATABASE_SSL_REJECT_UNAUTHORIZED', false),
  databasePoolMax: number('DATABASE_POOL_MAX', 5),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  cookieName: process.env.COOKIE_NAME || 'inverter_session',
  cookieSecure: bool('COOKIE_SECURE', process.env.NODE_ENV === 'production'),
  cookieSameSite: process.env.COOKIE_SAME_SITE || 'lax',
  mqttUrl: required('MQTT_URL'),
  mqttUsername: required('MQTT_USERNAME'),
  mqttPassword: required('MQTT_PASSWORD'),
  mqttClientId: `${process.env.MQTT_CLIENT_ID || 'inverter-backend'}-${process.env.FLY_MACHINE_ID || process.pid}`.slice(0, 128),
  mqttRejectUnauthorized: bool('MQTT_REJECT_UNAUTHORIZED', true),
  mqttCaPath: process.env.MQTT_CA_PATH ? path.resolve(process.env.MQTT_CA_PATH) : null,
  mqttKeepaliveSeconds: number('MQTT_KEEPALIVE_SECONDS', 30),
  mqttReconnectPeriodMs: number('MQTT_RECONNECT_PERIOD_MS', 3000),
  mqttConnectTimeoutMs: number('MQTT_CONNECT_TIMEOUT_MS', 15000),
  deviceId: process.env.DEVICE_ID || 'inverter-01',
  topics: {
    command: process.env.MQTT_COMMAND_TOPIC || 'company/inverter-01/command',
    ack: process.env.MQTT_ACK_TOPIC || 'company/inverter-01/ack',
    status: process.env.MQTT_STATUS_TOPIC || 'company/inverter-01/status',
    heartbeat: process.env.MQTT_HEARTBEAT_TOPIC || 'company/inverter-01/heartbeat',
    lwt: process.env.MQTT_LWT_TOPIC || 'company/inverter-01/availability'
  },
  commandTimeoutMs: number('COMMAND_TIMEOUT_MS', 10000),
  heartbeatOfflineMs: number('HEARTBEAT_OFFLINE_MS', 30000),
  statusPollIntervalMs: number('STATUS_POLL_INTERVAL_MS', 5000),
  bcryptRounds: number('BCRYPT_ROUNDS', 12)
};

if (env.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters.');
}

module.exports = env;
