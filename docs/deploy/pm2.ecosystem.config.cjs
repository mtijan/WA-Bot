module.exports = {
  apps: [
    {
      name: 'wa-bot-api',
      cwd: '/opt/wa-bot/backend',
      script: 'src/processes/api.js',
      interpreter: 'node',
      env_file: '/etc/wa-bot/wa-bot.env',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      error_file: '/var/log/wa-bot/api.err.log',
      out_file: '/var/log/wa-bot/api.out.log',
      merge_logs: true,
      time: true,
      restart_delay: 5000
    },
    {
      name: 'wa-bot-worker',
      cwd: '/opt/wa-bot/backend',
      script: 'src/processes/worker.js',
      interpreter: 'node',
      env_file: '/etc/wa-bot/wa-bot.env',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '768M',
      error_file: '/var/log/wa-bot/worker.err.log',
      out_file: '/var/log/wa-bot/worker.out.log',
      merge_logs: true,
      time: true,
      restart_delay: 5000
    }
  ]
};
