// SQLite adapter using Node's built-in node:sqlite (no native add-on to install).
// Exposes the same async interface as the PostgreSQL adapter so the rest of the code never changes.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export async function openSqlite(file, schemaSql) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  raw.exec(schemaSql);
  // small in-place upgrades for databases created by an earlier version
  const cols = raw.prepare('PRAGMA table_info(uploads)').all().map((c) => c.name);
  if (!raw.prepare('PRAGMA table_info(employees)').all().some((c) => c.name === 'email')) raw.exec('ALTER TABLE employees ADD COLUMN email TEXT');
  const colsOf = (t) => raw.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
  if (!colsOf('audit_records').includes('taxonomy')) raw.exec('ALTER TABLE audit_records ADD COLUMN taxonomy TEXT');
  if (!colsOf('audit_records').includes('attrs_enriched')) raw.exec('ALTER TABLE audit_records ADD COLUMN attrs_enriched INTEGER');
  if (!colsOf('audit_records').includes('source_info')) raw.exec('ALTER TABLE audit_records ADD COLUMN source_info TEXT');
  if (!colsOf('record_attributes').includes('is_attribute')) raw.exec('ALTER TABLE record_attributes ADD COLUMN is_attribute INTEGER NOT NULL DEFAULT 1');
  if (!colsOf('record_attributes').includes('was_enriched')) raw.exec('ALTER TABLE record_attributes ADD COLUMN was_enriched INTEGER');
  if (!cols.includes('project')) raw.exec('ALTER TABLE uploads ADD COLUMN project TEXT');
  if (!cols.includes('has_unsampled')) raw.exec('ALTER TABLE uploads ADD COLUMN has_unsampled INTEGER NOT NULL DEFAULT 1');
  const cache = new Map();
  const stmt = (sql) => { let s = cache.get(sql); if (!s) { s = raw.prepare(sql); cache.set(sql, s); } return s; };
  const api = {
    kind: 'sqlite',
    all: async (sql, p = []) => stmt(sql).all(...p),
    get: async (sql, p = []) => stmt(sql).get(...p),
    run: async (sql, p = []) => { const r = stmt(sql).run(...p); return { lastId: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
    insert: async (sql, p = []) => { const r = stmt(sql).run(...p); return Number(r.lastInsertRowid); },
    exec: async (sql) => raw.exec(sql),
    close: async () => raw.close(),
  };
  // Serialise transactions: callbacks only await DB calls (resolved promises) so no other request can interleave.
  let chain = Promise.resolve();
  api.tx = (fn) => {
    const run = async () => {
      raw.exec('BEGIN IMMEDIATE');
      try { const out = await fn(api); raw.exec('COMMIT'); return out; }
      catch (e) { try { raw.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  };
  return api;
}
