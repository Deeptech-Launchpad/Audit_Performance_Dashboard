// A week is Monday to Saturday (Sunday is not part of any week). Self-contained: builds its own small workbooks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seedReferenceData } from '../src/services/settings.js';
import { generateDueWeeklyReports, refreshWeeklyPeriods } from '../src/services/reports.js';
import { weekStart, weekEnd, previousPeriod } from '../src/lib/dates.js';

process.env.AUDIT_NO_LAUNCH = '1';
let db, server, base; let cookie = '';
async function api(method, url, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + url, { method, headers: { 'x-requested-with': 'audit-app', ...(body && !isForm ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const HEAD = ['SKU ID', 'SKU Build By', 'Sample', 'Audit By', 'Error Type', 'Attribute/Field', 'Audit Comments', 'PT Status', 'PT Comments', 'Re-Audit Comments', 'Gap/Similar', 'PT Response', 'CFB Attribute', 'CFB Comments'];
const book = (rows) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD, ...rows.map(([s, b, e]) => [s, b, 'FA', 'Audrey', e, e ? 'Color' : '', '', '', '', '', '', '', '', ''])]), 'Data'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); };
async function importOn(prefix, n, date) {
  const f = new FormData(); f.append('files', new Blob([book(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, 'Asha', i % 2 ? 'DM' : '']))]), `${prefix}.xlsx`);
  const staged = await api('POST', '/api/uploads', f); assert.equal(staged.status, 201);
  // the audit date is chosen after the file is read: the page re-checks with it (this is what the Upload screen does)
  const warnings = (await api('POST', `/api/uploads/${staged.body.files[0].id}/analyze`, { auditDate: date })).body.analysis.validation.warnings;
  const done = await api('POST', `/api/uploads/${staged.body.files[0].id}/commit`, { auditDate: date, project: 'Weeks' });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return warnings;
}

before(async () => {
  db = await openDb({ client: 'sqlite', path: ':memory:' }); await seedReferenceData(db);
  server = createApp(db).listen(0); base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await api('POST', '/api/auth/setup', { username: 'admin', displayName: 'Admin', password: 'correct-horse-9' })).status, 201);
});
after(() => { server?.close(); });

test('a week runs Monday to Saturday', () => {
  assert.equal(weekStart('2026-07-15'), '2026-07-13');   // Wednesday -> its Monday
  assert.equal(weekEnd('2026-07-15'), '2026-07-18');     // ... -> that Saturday
  assert.equal(weekEnd('2026-07-19'), '2026-07-18');     // a Sunday is after its Monday's week (Saturday 18 Jul is the last day of that week)
});

test('the previous period of a Monday-Saturday week is the Monday-Saturday week before it', () => {
  assert.deepEqual(previousPeriod('2026-07-20', '2026-07-25'), { from: '2026-07-13', to: '2026-07-18' });
  assert.deepEqual(previousPeriod('2026-07-20', '2026-07-26'), { from: '2026-07-13', to: '2026-07-19' }, 'a Monday-Sunday custom range is still compared with the same number of days before it');
  assert.deepEqual(previousPeriod('2026-07-15', '2026-07-21'), { from: '2026-07-08', to: '2026-07-14' });
});

test('the week filter covers Monday to Saturday only, and a Sunday-dated file says so', async () => {
  const w1 = await importOn('MON', 4, '2026-07-13');   // Monday
  const w2 = await importOn('SAT', 6, '2026-07-18');   // Saturday
  const w3 = await importOn('SUN', 8, '2026-07-19');   // Sunday
  assert.ok(!Object.keys(w1).some((k) => /Sunday/.test(k)) && !Object.keys(w2).some((k) => /Sunday/.test(k)), 'no notice for Monday or Saturday');
  assert.ok(Object.keys(w3).some((k) => /Sunday.*Monday to Saturday/.test(k)), 'a Sunday date is flagged in the upload review');
  const wk = (await api('GET', '/api/overview?week=2026-07-15')).body;     // any day of the week
  assert.equal(wk.kpis.samples, 10, 'Monday (4) + Saturday (6); the Sunday file (8) is not part of the week');
  const all = (await api('GET', '/api/overview')).body;
  assert.equal(all.kpis.samples, 18, 'everything still counts when no week is chosen');
  const champs = (await api('GET', '/api/champions?week=2026-07-13')).body;
  assert.deepEqual(champs.week, { start: '2026-07-13', end: '2026-07-18' });
});

test('automatic weekly reports: made once the week has finished (next Monday), covering Monday to Saturday', async () => {
  assert.equal((await generateDueWeeklyReports(db, new Date('2026-07-19T10:00:00Z'))).length, 0, 'Sunday: the week is not reported yet');
  assert.equal((await generateDueWeeklyReports(db, new Date('2026-07-20T00:00:00Z'))).length, 0, 'Monday 05:30 local, before the report hour');
  const made = await generateDueWeeklyReports(db, new Date('2026-07-20T01:30:00Z')); // Monday 07:00 local
  assert.equal(made.length, 1);
  const list = (await api('GET', '/api/reports')).body;
  const r = list.find((x) => x.kind === 'weekly');
  assert.equal(r.period_start, '2026-07-13'); assert.equal(r.period_end, '2026-07-18');
  const rep = (await api('GET', `/api/reports/${r.id}`)).body;
  assert.equal(rep.period.to, '2026-07-18'); assert.equal(rep.overall.samples, 10);
  assert.equal(rep.previous.from, '2026-07-06'); assert.equal(rep.previous.to, '2026-07-11', 'compared with the Monday-Saturday week before');
});

test('weekly reports saved when a week still ended on Sunday are converted once', async () => {
  const r = (await api('GET', '/api/reports')).body.find((x) => x.kind === 'weekly');
  await db.run('UPDATE weekly_reports SET period_end = ? WHERE id = ?', ['2026-07-19', r.id]);
  assert.equal(await refreshWeeklyPeriods(db), 1);
  const after = (await api('GET', '/api/reports')).body.find((x) => x.id === r.id);
  assert.equal(after.period_end, '2026-07-18');
  assert.equal(after.generated_at, r.generated_at, 'creation time is kept');
  assert.equal(await refreshWeeklyPeriods(db), 0, 'nothing left to convert');
  const rep = (await api('GET', `/api/reports/${r.id}`)).body;
  assert.equal(rep.period.to, '2026-07-18');
});

test('the Rules page can save without the removed boxes (time zone and per-category minimum keep their values)', async () => {
  const before = (await api('GET', '/api/settings')).body.settings;
  assert.equal((await api('PUT', '/api/settings', { errorTargetPct: 12 })).status, 200);
  const after = (await api('GET', '/api/settings')).body.settings;
  assert.equal(after.timezone, before.timezone); assert.equal(after.categoryMinSample, before.categoryMinSample); assert.equal(after.errorTargetPct, 12);
});
