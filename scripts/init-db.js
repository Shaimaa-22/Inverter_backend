const path = require('node:path');
const { execFileSync } = require('node:child_process');
execFileSync(process.execPath, [path.join(__dirname, 'migrate.js')], { stdio: 'inherit' });
