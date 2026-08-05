CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commands (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  device_id VARCHAR(100) NOT NULL,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  command VARCHAR(10) NOT NULL CHECK (command IN ('ON', 'OFF')),
  status VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'confirmed', 'failed', 'timeout')),
  mqtt_message JSONB NOT NULL,
  acknowledgment JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  timed_out_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_commands_created_at ON commands(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commands_user_id ON commands(user_id);
CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status);

-- Guarantees at most one in-flight command per device at the database level,
-- so two near-simultaneous requests can never both be sent to the ESP32.
CREATE UNIQUE INDEX IF NOT EXISTS idx_commands_one_inflight_per_device
  ON commands(device_id) WHERE status IN ('pending', 'sent');

CREATE TABLE IF NOT EXISTS device_status (
  device_id VARCHAR(100) PRIMARY KEY,
  esp_online BOOLEAN NOT NULL DEFAULT FALSE,
  mqtt_connected BOOLEAN NOT NULL DEFAULT FALSE,
  relay_state VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN'
    CHECK (relay_state IN ('ON', 'OFF', 'UNKNOWN')),
  inverter_state VARCHAR(30) NOT NULL DEFAULT 'UNKNOWN'
    CHECK (inverter_state IN ('RUNNING', 'STOPPED', 'FAULT', 'UNKNOWN')),
  fault_code VARCHAR(100),
  wifi_rssi INTEGER,
  uptime_seconds BIGINT,
  firmware_version VARCHAR(50),
  last_seen TIMESTAMPTZ,
  last_status_payload JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  resource VARCHAR(100),
  resource_id VARCHAR(100),
  ip_address INET,
  user_agent TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);

INSERT INTO device_status (device_id)
VALUES ('inverter-01')
ON CONFLICT (device_id) DO NOTHING;

-- Safe upgrade for databases created before session-versioned JWTs.
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
