const app = require('./app');
const env = require('./config/env');
const { pool, testConnection } = require('./config/db');
const { connectMqtt, disconnectMqtt } = require('./services/mqttService');
const { startOfflineMonitor } = require('./jobs/offlineMonitor');
const { recoverInflightCommands } = require('./services/deviceService');

let server;
async function start() {
  await testConnection();
  await recoverInflightCommands();
  connectMqtt();
  startOfflineMonitor();
  server = app.listen(env.port, '0.0.0.0', () => console.log(`[HTTP] Listening on 0.0.0.0:${env.port}`));
}

async function shutdown(signal) {
  console.log(`[System] ${signal} received; shutting down...`);
  if (server) await new Promise((resolve) => server.close(resolve));
  await disconnectMqtt();
  await pool.end();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (error) => console.error('[System] Unhandled rejection:', error));
process.on('uncaughtException', (error) => { console.error('[System] Uncaught exception:', error); process.exit(1); });

start().catch((error) => { console.error('[System] Startup failed:', error); process.exit(1); });
