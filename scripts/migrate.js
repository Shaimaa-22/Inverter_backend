const fs = require('node:fs');
const path = require('node:path');
const { pool } = require('../src/config/db');
(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const dir = path.join(__dirname, '..', 'database', 'migrations');
    const files = fs.readdirSync(dir).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
      if (exists.rowCount) continue;
      await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      console.log(`[DB] Applied migration ${file}`);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await pool.end(); }
})().catch((error) => { console.error(error); process.exit(1); });
