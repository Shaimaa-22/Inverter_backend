module.exports = {
  apps: [
    {
      name: 'inverter-control-backend',
      script: './src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      kill_timeout: 10000,
      listen_timeout: 10000,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
