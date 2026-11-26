// Regression tests for bugs found in the 2026-11-23 bug hunt. Self-contained: builds its own small workbooks (no sample file needed).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seedReferenceData } from '../src/services/settings.js';

process.env.AUDIT_NO_LAUNCH = '1';
let db, server, base; let cookie = '';
const H = { 'x-requested-with': 'audit-app' };
async function api(method, url, body, extra = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + url, { method, headers: { ...H, ...(body && !isForm ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...extra }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

const HEAD = ['SKU ID', 'SKU Build By', 'Sample', 'Audit By', 'Error Type', 'Attribute/Field', 'Audit Comments', 'PT Status', 'PT Comments', 'Re-Audit Comments', 'Gap/Similar', 'PT Response', 'CFB Attribute', 'CFB Comments'];
/** rows: [sku, builder, sample, auditor, errorType] */
function book(rows) {
  const aoa = [HEAD, ...rows.map(([sku, b, s, a, e]) => [sku, b, s, a, e, e ? 'Color' : '', '', '', '', '', '', '', '', ''])];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Data');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
const form = (name, buf) => { const f = new FormData(); f.append('files', new Blob([buf]), name); return f; };
async function importFile(name, rows, { date, project }) {
  const staged = await api('POST', '/api/uploads', form(name, book(rows)));
  assert.equal(staged.status, 201, JSON.stringify(staged.body));
  const id = staged.body.files[0].id;
  const done = await api('POST', `/api/uploads/${id}/commit`, { auditDate: date, project });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return { id, ...done.body, analysis: staged.body.files[0].analysis };
}
const make = (prefix, n, { builder, errEvery = 0, sample = 'FA' }) => Array.from({ length: n }, (_, i) => [`${prefix}${String(i).padStart(4, '0')}`, builder, sample, 'Audrey', errEvery && i % errEvery === 0 ? 'DM' : '']);

before(async () => {
  db = await openDb({ client: 'sqlite', path: ':memory:' });
  await seedReferenceData(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await api('POST', '/api/auth/setup', { username: 'admin', displayName: 'Admin', password: 'correct-horse-9' })).status, 201);
});
after(() => { server?.close(); });

test('overview "previous period" follows the project filter (like for like)', async () => {
  // week 1 (6-12 Jul): Alpha 10 audited SKUs, Beta 20 audited SKUs.  week 2 (13-19 Jul): Alpha 10.
  await importFile('alpha_w1.xlsx', make('AW1', 10, { builder: 'Asha', errEvery: 2 }), { date: '2026-07-06', project: 'Alpha' });
  await importFile('beta_w1.xlsx', make('BW1', 20, { builder: 'Bala', errEvery: 4 }), { date: '2026-07-06', project: 'Beta' });
  await importFile('alpha_w2.xlsx', make('AW2', 10, { builder: 'Asha', errEvery: 5 }), { date: '2026-07-13', project: 'Alpha' });
  const all = (await api('GET', '/api/overview?from=2026-07-13&to=2026-07-19')).body;
  assert.equal(all.previous.samples, 30, 'no project chosen: the earlier week holds both projects');
  const alpha = (await api('GET', '/api/overview?from=2026-07-13&to=2026-07-19&project=Alpha')).body;
  assert.equal(alpha.kpis.samples, 10);
  assert.equal(alpha.previous.samples, 10, 'project Alpha: compare with Alpha only, not with Beta as well');
  assert.equal(alpha.previous.errorSkus, 5);
});

test('a file listing only audited SKUs: the "Not available" note has no broken characters', async () => {
  const r = await api('POST', '/api/uploads', form('only_sampled.xlsx', book(make('NS', 6, { builder: 'Asha' }))));
  const note = r.body.files[0].analysis.dataChecks.totalSkusNote;
  assert.match(note, /“Not available”/);
  assert.ok(!note.includes('�'), 'no replacement characters');
  await api('POST', `/api/uploads/${r.body.files[0].id}/discard`);
});

test('a long file uploaded twice is not added twice (more than 2000 rows needing a decision)', async () => {
  const rows = make('LONG', 2150, { builder: 'Chitra', errEvery: 7 });
  const first = await importFile('long_file.xlsx', rows, { date: '2026-08-03', project: 'Long' });
  assert.equal(first.imported, 2150);
  const again = await api('POST', '/api/uploads', form('long_file.xlsx', book(rows)));
  assert.equal(again.body.files[0].analysis.counts.identical, 2150);
  assert.equal(again.body.files[0].analysis.review.length, 2000, 'the screen list is still cut to 2000');
  const done = await api('POST', `/api/uploads/${again.body.files[0].id}/commit`, { auditDate: '2026-08-03', project: 'Long' });
  assert.equal(done.body.imported, 0, 'nothing imported a second time');
  assert.equal(done.body.skipped, 2150);
  const n = await db.get(`SELECT COUNT(*) AS n FROM audit_records WHERE sku_id LIKE 'LONG%'`);
  assert.equal(n.n, 2150);
});

test('an upload cannot be imported twice (second import is refused)', async () => {
  const staged = await api('POST', '/api/uploads', form('once.xlsx', book(make('ONCE', 8, { builder: 'Dev' }))));
  const id = staged.body.files[0].id;
  assert.equal((await api('POST', `/api/uploads/${id}/commit`, { auditDate: '2026-08-10', project: 'Once' })).status, 200);
  assert.equal((await api('POST', `/api/uploads/${id}/commit`, { auditDate: '2026-08-10', project: 'Once' })).status, 400);
  const n = await db.get(`SELECT COUNT(*) AS n FROM audit_records WHERE sku_id LIKE 'ONCE%'`);
  assert.equal(n.n, 8);
});

test('audited rows with no "SKU Build By" are shown but never ranked or named a top performer', async () => {
  await importFile('nameless.xlsx', make('NONAME', 12, { builder: '' }), { date: '2026-08-17', project: 'Nameless' });
  const ct = (await api('GET', '/api/content-team?project=Nameless')).body;
  const blank = ct.members.find((m) => m.id == null);
  assert.ok(blank && blank.samples === 12, 'the blank-name group is listed');
  assert.ok(blank.rank == null, 'but not ranked');
  const ov = (await api('GET', '/api/overview?project=Nameless')).body;
  assert.equal(ov.top.content.length, 0, 'not in the Top 5');
  const cat = (await api('GET', '/api/categories?project=Nameless')).body;
  assert.ok(cat && cat.categories.every((c) => c.recommended.every((x) => x.id != null)), 'never recommended for new SKUs');
});

test('a damaged sign-in cookie means "not signed in", not a server error', async () => {
  const r = await api('GET', '/api/auth/status', null, { cookie: 'audit_session=%E0%A4%A' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user, null);
});
