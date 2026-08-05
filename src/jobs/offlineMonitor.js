const db = require('../config/db');
const env = require('../config/env');

function startOfflineMonitor() {
  const timer = setInterval(async () => {
    try {
      await db.query(
        `UPDATE device_status SET esp_online = FALSE, mqtt_connected = FALSE, updated_at = NOW()
         WHERE device_id = $1 AND last_seen IS NOT NULL
           AND last_seen < NOW() - ($2::text || ' milliseconds')::interval
           AND esp_online = TRUE`,
        [env.deviceId, env.heartbeatOfflineMs]
      );
    } catch (error) {
      console.error('[Monitor] Failed to update offline state:', error);
    }
  }, env.statusPollIntervalMs);
  timer.unref();
  return timer;
}
module.exports = { startOfflineMonitor };
