import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const config = {
  root,
  port: Number(process.env.PORT || 3000),
  dbClient: process.env.DB_CLIENT || 'sqlite', // 'sqlite' | 'postgres'
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'audit.db'),
  databaseUrl: process.env.DATABASE_URL || '',
  clientDist: path.join(root, 'client', 'dist'),
  maxUploadBytes: 60 * 1024 * 1024,
  sessionDays: 7,
  cookieSecure: process.env.COOKIE_SECURE === '1', // set to 1 when served over HTTPS
  schedulerEnabled: process.env.SCHEDULER !== '0',
};
