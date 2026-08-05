const { Pool } = require('pg');
const env = require('./env');

// Neon requires TLS. In production, DATABASE_SSL=true is mandatory for this project.
// Neon connection strings commonly also include ?sslmode=require.
const ssl = env.databaseSsl
  ? { rejectUnauthorized: env.databaseSslRejectUnauthorized }
  : false;

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl,
  max: env.databasePoolMax,
  min: 0,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  keepAlive: true,
  allowExitOnIdle: false
});

pool.on('connect', () => {
  if (env.nodeEnv !== 'test') console.log('[DB] PostgreSQL client connected');
});

pool.on('error', (error) => {
  console.error('[DB] Unexpected idle client error:', error);
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function testConnection() {
  const result = await query('SELECT NOW() AS now, current_database() AS database');
  console.log(`[DB] Connected to ${result.rows[0].database} at ${result.rows[0].now}`);
}

module.exports = { pool, query, testConnection };
