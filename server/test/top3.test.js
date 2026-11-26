// Overview "Top 3" lists, with data whose answers are known in advance.
//   Product Team: only people AT OR UNDER the error target, lowest error % first, at most 3.
//   Audit Team:   the auditors who found the most ERROR TYPES (a SKU with two error types counts 2), at most 3; an auditor who found nothing is never listed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seedReferenceData } from '../src/services/settings.js';

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

// builder, auditor, audited SKUs, SKUs with errors, error types written on each of those SKUs  ->  error %
const THREE = 'DM, DE, FE'; // three error types on one SKU
const PLAN = [
  ['Dee', 'Tia', 10, 0],          //  0 %    auditor Tia finds nothing
  ['Hal', 'Sam', 30, 1],          //  3.3 %
  ['Eli', 'Pat', 25, 1, THREE],   //  4 %
  ['Ann', 'Pat', 20, 1, THREE],   //  5 %
  ['Bea', 'Quin', 20, 2],         // 10 %   exactly on a 10 % target
  ['Cy', 'Quin', 20, 3],          // 15 %
  ['Gus', 'Rae', 20, 4],          // 20 %
  ['Fay', 'Rae', 3, 0],           //  0 % but only 3 audited SKUs (below the minimum of 5)
];
// error types found (classifications): Pat 6 (on only 2 SKUs), Quin 5, Rae 4, Sam 1, Tia 0
// SKUs with errors:                    Quin 5, Rae 4, Pat 2, Sam 1, Tia 0   <- a different order, so the test shows which one is used
const book = () => {
  const rows = []; let n = 0;
  for (const [builder, auditor, audited, errs, codes = 'DM'] of PLAN) for (let i = 0; i < audited; i++, n++) rows.push([`T${n}`, builder, 'FA', auditor, i < errs ? codes : '', i < errs ? 'Color' : '', '', '', '', '', '', '', '', '']);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD, ...rows]), 'Data'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};
const top = async (q = '') => (await api('GET', '/api/overview' + q)).body.top;
const setTarget = async (t) => assert.equal((await api('PUT', '/api/settings', { errorTargetPct: t })).status, 200);

before(async () => {
  db = await openDb({ client: 'sqlite', path: ':memory:' }); await seedReferenceData(db);
  server = createApp(db).listen(0); base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await api('POST', '/api/auth/setup', { username: 'admin', displayName: 'Admin', password: 'correct-horse-9' })).status, 201);
  const f = new FormData(); f.append('files', new Blob([book()]), 'Top3.xlsx');
  const staged = await api('POST', '/api/uploads', f); assert.equal(staged.status, 201);
  assert.equal((await api('POST', `/api/uploads/${staged.body.files[0].id}/commit`, { auditDate: '2026-07-14', project: 'Top3' })).status, 200);
});
after(() => { server?.close(); });

test('Product Team top 3: target 10 % -> the three lowest people, nobody above the target, nobody with too few audited SKUs', async () => {
  await setTarget(10);
  const t = await top();
  assert.deepEqual(t.content.map((p) => p.name), ['Dee', 'Hal', 'Eli']);       // Ann 5 % and Bea 10 % are under the target too, but only 3 are shown
  assert.deepEqual(t.content.map((p) => p.errorRate), [0, 3.33, 4]);
  assert.ok(!t.content.some((p) => ['Cy', 'Gus', 'Fay'].includes(p.name)));      // 15 %, 20 % and "too few SKUs" never appear
  assert.equal(t.ranked, 7);                                                     // Fay (3 SKUs) is not ranked at all
});

test('Product Team top 3: a lower target shrinks the list (fewer than 3 is fine), and the target itself counts as "on target"', async () => {
  await setTarget(4);
  assert.deepEqual((await top()).content.map((p) => p.name), ['Dee', 'Hal', 'Eli']);   // Eli is exactly 4 %
  await setTarget(3);
  assert.deepEqual((await top()).content.map((p) => p.name), ['Dee']);                 // Hal is 3.33 % > 3
  await setTarget(5);
  assert.deepEqual((await top('?builderId=' + (await builderId('Ann')))).content.map((p) => p.name), ['Ann']);  // exactly 5 % -> counts
  await setTarget(4.9);
  const none = await top('?builderId=' + (await builderId('Ann')));
  assert.deepEqual(none.content, []);                                                   // 5 % is above a 4.9 % target...
  assert.equal(none.ranked, 1);                                                         // ...but she is ranked: "nobody under the target", not "nobody ranked"
  await setTarget(10);
});

test('Audit Team top 3: ranked by how many error types were found (not by SKUs); nobody who found none', async () => {
  const t = await top();
  // Pat wrote 3 error types on each of 2 SKUs = 6, so Pat beats Quin (5 SKUs, 5 error types) and Rae (4 and 4). Sam (1) is 4th, Tia (0) is never listed.
  assert.deepEqual(t.audit.map((a) => [a.name, a.classifications]), [['Pat', 6], ['Quin', 5], ['Rae', 4]]);
  assert.deepEqual(t.audit.map((a) => a.errorSkus), [2, 5, 4]);          // the SKU counts stay available for the line under each name
  assert.deepEqual(t.audit.map((a) => a.skusAudited), [45, 40, 23]);
  const onlyTia = await top('?auditorId=' + (await auditorId('Tia')));
  assert.deepEqual(onlyTia.audit, []);
});

test('champion pop-up: the auditor is picked by error types found, in the same order as the Overview (not by SKUs audited)', async () => {
  const c = (await api('GET', '/api/champions')).body;
  // by SKUs audited the order would be Pat (45), Quin (40), Sam (30); by error types found it is Pat 6, Quin 5, Rae 4
  assert.deepEqual(c.audit.map((a) => [a.name, a.classifications]), [['Pat', 6], ['Quin', 5], ['Rae', 4]]);
  assert.deepEqual(c.audit.map((a) => a.name), (await top()).audit.map((a) => a.name));
});

async function personId(role, name) { const m = (await api('GET', '/api/meta')).body; return (role === 'content' ? m.builders : m.auditors).find((p) => p.name === name).id; }
const builderId = (n) => personId('content', n);
const auditorId = (n) => personId('auditor', n);
