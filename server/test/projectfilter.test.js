// The Project filter and search use only the FIRST WORD of the project name ("Grainger 2026 NPI Flight Group 32" -> "Grainger").
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seedReferenceData } from '../src/services/settings.js';
import { projectGroup, groupProjects } from '../src/lib/project.js';

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
const book = (prefix, n) => { const rows = Array.from({ length: n }, (_, i) => [`${prefix}${i}`, 'Asha', 'FA', 'Audrey', '', '', '', '', '', '', '', '', '', '']);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD, ...rows]), 'Data'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); };
async function importFile(prefix, n, date, project) {
  const f = new FormData(); f.append('files', new Blob([book(prefix, n)]), `${prefix}.xlsx`);
  const staged = await api('POST', '/api/uploads', f); assert.equal(staged.status, 201);
  const done = await api('POST', `/api/uploads/${staged.body.files[0].id}/commit`, { auditDate: date, project }); assert.equal(done.status, 200, JSON.stringify(done.body));
}
const audited = async (q = '') => (await api('GET', '/api/overview' + q)).body.kpis?.samples ?? 0;

before(async () => {
  db = await openDb({ client: 'sqlite', path: ':memory:' }); await seedReferenceData(db);
  server = createApp(db).listen(0); base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await api('POST', '/api/auth/setup', { username: 'admin', displayName: 'Admin', password: 'correct-horse-9' })).status, 201);
  await importFile('g1x', 5, '2026-07-14', 'Grainger 2026 NPI Flight Group 32');   // 5 audited SKUs
  await importFile('g2x', 7, '2026-07-15', 'Grainger 2026 NPI Flight Group 40');   // 7
  await importFile('a1x', 3, '2026-07-16', 'Analog 2026 Test');                    // 3
  await importFile('u1x', 2, '2026-07-16', 'Under_score 1');                       // 2
  await importFile('u2x', 4, '2026-07-16', 'UnderXscore 2');                       // 4  (must never match "Under_score")
});
after(() => { server?.close(); });

test('the short project name is the first word', () => {
  assert.equal(projectGroup('Grainger 2026 NPI Flight Group 32'), 'Grainger');
  assert.equal(projectGroup('  Analog   Devices 7 '), 'Analog');
  assert.equal(projectGroup('Solo'), 'Solo');
  assert.equal(projectGroup(null), '');
  assert.deepEqual(groupProjects([{ name: 'Grainger A', files: 2 }, { name: 'Analog B', files: 1 }, { name: 'Grainger C', files: 1 }, { name: null, files: 9 }]),
    [{ name: 'Analog', files: 1 }, { name: 'Grainger', files: 3 }]);
});

test('the Project list holds one short name per client, with the file counts added up', async () => {
  const m = (await api('GET', '/api/meta')).body;
  assert.deepEqual(m.projectGroups, [{ name: 'Analog', files: 1 }, { name: 'Grainger', files: 2 }, { name: 'Under_score', files: 1 }, { name: 'UnderXscore', files: 1 }]);
  assert.equal(m.projects.length, 5); // full names are still kept for the Upload screen
});

test('picking a short name shows every file of that client; the filter never matches half a word', async () => {
  assert.equal(await audited(), 21);
  assert.equal(await audited('?project=Grainger'), 12);
  assert.equal(await audited('?project=Analog'), 3);
  assert.equal(await audited('?project=Grain'), 0);
  assert.equal(await audited('?project=' + encodeURIComponent('Grainger 2026 NPI Flight Group 40')), 7); // a full name still matches itself
});

test('an underscore or percent sign in a project name is not a wildcard', async () => {
  assert.equal(await audited('?project=' + encodeURIComponent('Under_score')), 2);
  assert.equal(await audited('?project=' + encodeURIComponent('UnderXscore')), 4);
  assert.equal(await audited('?project=' + encodeURIComponent('%')), 0);
});

test('the search box lists projects by their short name too', async () => {
  const s = (await api('GET', '/api/search?q=grain')).body;
  assert.deepEqual(s.projects, [{ name: 'Grainger', files: 2 }]);
  assert.deepEqual((await api('GET', '/api/search?q=flight')).body.projects, []);
});
