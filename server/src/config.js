import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Optional ".env" file in the project folder (never in git): KEY=VALUE lines, e.g. the database address and password.
// A variable that is already set (by PM2, the shell, the tests) always wins over the file.
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* no .env file: defaults below */ }

export const config = {
  root,
  port: Number(process.env.PORT || 3000),
  // HOST=127.0.0.1 on a server: only the web server in front (nginx) can reach the app, the port is not open to the internet.
  host: process.env.HOST || undefined,
  // TRUST_PROXY=1 behind nginx on the same machine: read the visitor's real address from X-Forwarded-For (login lock-out works per visitor).
  trustProxy: process.env.TRUST_PROXY === '1',
  dbClient: process.env.DB_CLIENT || 'sqlite', // 'sqlite' | 'postgres'
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'audit.db'),
  databaseUrl: process.env.DATABASE_URL || '',
  // PGLITE_DIR (this PC only): run PostgreSQL inside the app (PGlite), saved in that folder, instead of a PostgreSQL server
  pgliteDir: process.env.PGLITE_DIR ? path.resolve(root, process.env.PGLITE_DIR) : '',
  clientDist: path.join(root, 'client', 'dist'),
  maxUploadBytes: 60 * 1024 * 1024,
  sessionDays: 7,
  cookieSecure: process.env.COOKIE_SECURE === '1', // set to 1 when served over HTTPS
  schedulerEnabled: process.env.SCHEDULER !== '0',
};
