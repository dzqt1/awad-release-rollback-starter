export const config = {
  env: process.env.APP_ENV ?? 'development',
  port: 3000,
  dbPath: process.env.DB_PATH ?? './data/app.db',
  baseUrl: process.env.BASE_URL ?? 'http://localhost:3000',
  adminToken: process.env.ADMIN_TOKEN,
  version: process.env.APP_VERSION ?? 'dev',
};
