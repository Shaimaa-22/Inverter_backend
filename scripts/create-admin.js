const readline = require('node:readline/promises');
const { stdin: input, stdout: output } = require('node:process');
const bcrypt = require('bcryptjs');
const { pool } = require('../src/config/db');
const env = require('../src/config/env');
(async () => {
  const rl = readline.createInterface({ input, output });
  try {
    const name = (await rl.question('Admin name: ')).trim();
    const username = (await rl.question('Admin username: ')).trim().toLowerCase();
    const password = await rl.question('Admin password (min 8 chars): ');
    if (name.length < 2 || username.length < 3 || password.length < 8) throw new Error('Invalid admin data.');
    const hash = await bcrypt.hash(password, env.bcryptRounds);
    const result = await pool.query(
      `INSERT INTO users (name, username, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       RETURNING id, name, username, role`,
      [name, username, hash]
    );
    console.log('Admin created:', result.rows[0]);
  } finally { rl.close(); await pool.end(); }
})().catch((error) => { console.error(error); process.exit(1); });
