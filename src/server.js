import { config } from './config.js';
import { open } from './db.js';
import { createApp } from './app.js';

if (config.env === 'production' && (!config.adminToken || config.adminToken === 'dev-secret')) {
  console.error('Refusing to start: APP_ENV=production requires ADMIN_TOKEN');
  process.exit(1);
}

const server = createApp(open(config.dbPath), config);

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  const forceExit = setTimeout(() => process.exit(1), 7000);
  forceExit.unref();

  server.close(() => {
    clearTimeout(forceExit);
    process.exit(0);
  });

  if (typeof server.closeIdleConnections === 'function') {
    server.closeIdleConnections();
  }
};

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

server.listen(config.port, () =>
  console.log(`linkbox ${config.version} (${config.env}) on :${config.port}, db ${config.dbPath}`));
