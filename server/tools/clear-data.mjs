// Clean start: removes ALL audit data (uploads, records, people, reports) from the dashboard database.
// KEEPS: user logins (users, sessions), the rules (settings, incl. email settings) and the error-type list.
// Only this app's SQLite file is opened; no other database is touched.
//   node server/tools/clear-data.mjs data/audit.db            -> shows what would be removed (nothing changes)
//   node server/tools/clear-data.mjs data/audit.db --yes      -> removes it
// Stop the app first (pm2 stop audit-dashboard) and keep a backup of the data folder.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const [file, flag] = process.argv.slice(2);
if (!file || !fs.existsSync(file)) { console.error('Give the database file, e.g. data/audit.db'); process.exit(1); }
const CLEAR = ['weekly_reports', 'reaudit_tracking', 'pt_tracking', 'record_attributes', 'error_classifications', 'audit_records', 'skus', 'uploads', 'employee_roles', 'employees']; // children first
const KEEP = ['users', 'sessions', 'settings', 'error_types'];
const db = new DatabaseSync(file);
const have = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name));
const count = (t) => (have.has(t) ? db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n : '-');
const show = (title) => { console.log(title); for (const t of [...CLEAR, ...KEEP]) console.log(`  ${KEEP.includes(t) ? 'keep  ' : 'remove'}  ${t.padEnd(22)} ${count(t)} rows`); };
show('Now:');
if (flag !== '--yes') { console.log('\nNothing changed. Run again with --yes to remove the rows marked "remove".'); process.exit(0); }
db.exec('PRAGMA foreign_keys = ON; BEGIN');
try {
  for (const t of CLEAR) if (have.has(t)) db.exec(`DELETE FROM ${t}`);
  if (have.has('sqlite_sequence')) db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${CLEAR.map(() => '?').join(',')})`).run(...CLEAR); // numbering starts again at 1
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); console.error('Stopped, nothing was removed:', e.message); process.exit(1); }
db.exec('VACUUM');
show('\nAfter:');
console.log(`\nIntegrity: ${db.prepare('PRAGMA integrity_check').get().integrity_check}`);
db.close();
