import { config } from './config.js';
import { open } from './db.js';
import { createApp } from './app.js';

if (config.env === 'production' && (!config.adminToken || config.adminToken === 'dev-secret')) {
  console.error('Refusing to start: APP_ENV=production requires ADMIN_TOKEN');
  process.exit(1);
}

const db = open(config.dbPath);
const linksColumns = db.prepare('PRAGMA table_info(links)').all().map((column) => column.name);
const hasFlagsTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'feature_flags'").get();
if (!linksColumns.includes('expires_at') || !hasFlagsTable) {
  console.error('Refusing to start: database schema 002 is required (links.expires_at and feature_flags)');
  process.exit(1);
}

const server = createApp(db, config);

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
};

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

server.listen(config.port, () =>
  console.log(`linkbox ${config.version} (${config.env}) on :${config.port}, db ${config.dbPath}`));
