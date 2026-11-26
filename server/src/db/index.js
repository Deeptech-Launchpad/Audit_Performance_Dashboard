import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { openSqlite } from './sqlite.js';
import { openPostgres } from './postgres.js';

export async function openDb(overrides = {}) {
  const client = overrides.client || config.dbClient;
  const schemaFile = path.join(config.root, 'db', client === 'postgres' ? 'schema.postgres.sql' : 'schema.sqlite.sql');
  const schema = fs.readFileSync(schemaFile, 'utf8');
  if (client === 'postgres') return openPostgres(overrides.url || config.databaseUrl, schema);
  return openSqlite(overrides.path || config.dbPath, schema);
}
