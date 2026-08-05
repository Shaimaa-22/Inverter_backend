const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');
const env = require('../src/config/env');
(async () => {
  const rl = readline.createInterface({ input, output });
  try {
    const username = (await rl.question('Admin username: ')).trim().toLowerCase();
    const password = await rl.question('New admin password (min 8 chars): ');
    if (username.length < 3 || password.length < 8) throw new Error('Invalid admin data.');
    const hash = await bcrypt.hash(password, env.bcryptRounds);
    const result = await pool.query(`UPDATE users SET password_hash = $1, role = 'admin', is_active = TRUE, session_version = session_version + 1, updated_at = NOW() WHERE username = $2 RETURNING id, name, username, role`, [hash, username]);
    if (!result.rowCount) throw new Error('Admin user not found.');
    console.log('Admin password reset:', result.rows[0]);
  } finally { rl.close(); await pool.end(); }
})().catch((error) => { console.error(error); process.exit(1); });
