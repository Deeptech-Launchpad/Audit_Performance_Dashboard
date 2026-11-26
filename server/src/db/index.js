import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../config.js';
import { openSqlite } from './sqlite.js';
import { openPostgres } from './postgres.js';

/** PostgreSQL inside this app (PGlite), saved in `dir`, reachable over the normal PostgreSQL protocol on 127.0.0.1 only.
 *  For a PC that cannot run a PostgreSQL server. PGlite takes one connection at a time, so the pool uses one connection. */
export async function startPglite(dir) {
  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  fs.mkdirSync(dir, { recursive: true });
  const db = await PGlite.create(dir);
  const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
  await server.start();
  server.server?.unref?.();
  process.env.PG_POOL_MAX = '1';
  return `postgres://postgres:postgres@127.0.0.1:${server.server.address().port}/postgres`;
}

export async function openDb(overrides = {}) {
  let client = overrides.client || config.dbClient;
  let url = overrides.url || config.databaseUrl;
  // Tests only: TEST_PG_FACTORY=<module> runs every test that asks for a throw-away in-memory database on a fresh PostgreSQL instead.
  if (process.env.TEST_PG_FACTORY && client === 'sqlite' && overrides.path === ':memory:') {
    client = 'postgres';
    url = await (await import(pathToFileURL(process.env.TEST_PG_FACTORY).href)).default();
  } else if (client === 'postgres' && !overrides.url && config.pgliteDir) url = await startPglite(config.pgliteDir);
  if (client === 'postgres' && !url) throw new Error('DB_CLIENT=postgres needs DATABASE_URL (or PGLITE_DIR on this PC).');
  const schemaFile = path.join(config.root, 'db', client === 'postgres' ? 'schema.postgres.sql' : 'schema.sqlite.sql');
  const schema = fs.readFileSync(schemaFile, 'utf8');
  if (client === 'postgres') return openPostgres(url, schema);
  return openSqlite(overrides.path || config.dbPath, schema);
}
