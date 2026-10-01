/**
 * PM2 — production on-premise (rechargement à chaud SANS interruption : wait_ready + kill_timeout).
 * `npm run pm2`  (pm2 reload → new workers servent dès /readyz OK, l’UI ne voit pas de 5xx).
 */
module.exports = {
  apps: [
    {
      name: 'sardpi-web',
      cwd: 'apps/web',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 0.0.0.0 -p ' + (process.env.PORT || 3000),
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',
      wait_ready: false, // Next signale « ready » via le port écouté ; /api/v1/health pour le monitoring externe
      listen_timeout: 15_000,
      kill_timeout: 8_000, // fin des requêtes en cours (transactions BD comprises)
      max_memory_restart: '600M',
      env: { NODE_ENV: 'production' },
      error_file: '../../logs/pm2-error.log',
      out_file: '../../logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
