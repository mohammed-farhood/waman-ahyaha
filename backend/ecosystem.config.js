module.exports = {
  apps: [{
    name: 'al-ayn-api',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    env_file: '.env',
    max_memory_restart: '512M',
    error_file: '/var/log/al-ayn/err.log',
    out_file:   '/var/log/al-ayn/out.log',
    time: true,
    watch: false,
    restart_delay: 3000,
    max_restarts: 10,
  }]
};
