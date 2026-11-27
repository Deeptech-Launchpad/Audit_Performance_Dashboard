// Copies everything from the dashboard's SQLite file into an EMPTY PostgreSQL database (same tables, same ids).
// Only the two databases named on the command line are opened. The SQLite file is only read, never changed.
//   node server/tools/sqlite-to-postgres.mjs data/audit.db                 -> shows what would be copied (nothing changes)
//   node server/tools/sqlite-to-postgres.mjs data/audit.db --yes           -> copies it
// The PostgreSQL address comes from DATABASE_URL (e.g. postgres://user:pass@127.0.0.1:5432/audit_dashboard).
// Stop the app first so nothing changes while copying.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openPostgres } from '../src/db/postgres.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [file, flag] = process.argv.slice(2);
if (!file || !fs.existsSync(file)) { console.error('Give the SQLite file, e.g. data/audit.db'); process.exit(1); }
// DATABASE_URL (a PostgreSQL server), or PGLITE_DIR (PostgreSQL inside the app on this PC); both may come from the .env file
const { config } = await import('../src/config.js');
const url = config.databaseUrl || (config.pgliteDir ? await (await import('../src/db/index.js')).startPglite(config.pgliteDir) : '');
if (!url) { console.error('Set DATABASE_URL (or PGLITE_DIR) to the PostgreSQL database first.'); process.exit(1); }

// parents before children (foreign keys)
const ORDER = ['users', 'sessions', 'employees', 'employee_roles', 'uploads', 'skus', 'audit_records', 'error_classifications', 'record_attributes', 'pt_tracking', 'reaudit_tracking', 'error_types', 'settings', 'weekly_reports', 'notes'];
const UPSERT = { error_types: 'code', settings: 'key' };      // the app may already have filled these with its defaults
const IDENTITY = ['users', 'employees', 'uploads', 'audit_records', 'error_classifications', 'weekly_reports', 'notes'];

const lite = new DatabaseSync(file, { readOnly: true });
const liteTables = new Set(lite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name));
const pg = await openPostgres(url, fs.readFileSync(path.join(ROOT, 'db', 'schema.postgres.sql'), 'utf8')); // creates the tables if they are missing
const pgCols = {};
for (const r of await pg.all(`SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = current_schema()`)) (pgCols[r.t] ||= new Set()).add(r.c);

const count = async (t) => Number((await pg.get(`SELECT COUNT(*) AS n FROM ${t}`)).n);
console.log('table                   SQLite  PostgreSQL now');
let notEmpty = [];
for (const t of ORDER) {
  const a = liteTables.has(t) ? lite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n : 0; const b = await count(t);
  console.log(`  ${t.padEnd(22)} ${String(a).padStart(6)}  ${String(b).padStart(6)}`);
  if (b && !UPSERT[t]) notEmpty.push(t);
}
if (notEmpty.length) { console.error(`\nStopped: PostgreSQL already has data in ${notEmpty.join(', ')}. Copy only into an empty database.`); await pg.close(); process.exit(1); }
if (flag !== '--yes') { console.log('\nNothing changed. Run again with --yes to copy.'); await pg.close(); process.exit(0); }

await pg.tx(async (tx) => {
  for (const t of ORDER) {
    if (!liteTables.has(t)) continue;
    const rows = lite.prepare(`SELECT * FROM ${t}`).all(); if (!rows.length) continue;
    const cols = Object.keys(rows[0]).filter((c) => pgCols[t]?.has(c));
    const override = IDENTITY.includes(t) ? ' OVERRIDING SYSTEM VALUE' : '';
    const conflict = UPSERT[t] ? ` ON CONFLICT (${UPSERT[t]}) DO UPDATE SET ${cols.filter((c) => c !== UPSERT[t]).map((c) => `${c} = EXCLUDED.${c}`).join(', ')}` : '';
    for (let i = 0; i < rows.length; i += 200) {
      const part = rows.slice(i, i + 200);
      const values = part.map(() => `(${cols.map(() => '?').join(',')})`).join(',');
      await tx.run(`INSERT INTO ${t} (${cols.join(',')})${override} VALUES ${values}${conflict}`, part.flatMap((r) => cols.map((c) => (typeof r[c] === 'bigint' ? Number(r[c]) : r[c]))));
    }
  }
  // new rows continue after the copied ids
  for (const t of IDENTITY) await tx.run(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
});

console.log('\nAfter copying:');
let ok = true;
for (const t of ORDER) {
  const a = liteTables.has(t) ? lite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n : 0; const b = await count(t);
  const same = UPSERT[t] ? b >= a : a === b; if (!same) ok = false;
  console.log(`  ${t.padEnd(22)} ${String(a).padStart(6)}  ${String(b).padStart(6)}  ${same ? 'OK' : 'DIFFERENT'}`);
}
console.log(ok ? '\nAll tables copied.' : '\nSome tables differ - do not switch the app to PostgreSQL yet.');
lite.close(); await pg.close(); process.exit(ok ? 0 : 1);
