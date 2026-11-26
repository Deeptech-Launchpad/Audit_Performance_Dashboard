// PT status combinations, re-audit "OK" comments, and the rule "count an error only after the re-audit has checked it".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seedReferenceData, DEFAULT_SETTINGS } from '../src/services/settings.js';
import { ptClass, reauditPassed, classifyFollowUp } from '../src/services/followup.js';

const S = DEFAULT_SETTINGS;

test('combined PT statuses are read word by word; | and / are the same', () => {
  assert.equal(ptClass('Updated|Not Updated', S), 'pending');   // was "Unrecognised"
  assert.equal(ptClass('Updated|Not updated', S), 'pending');
  assert.equal(ptClass('Not Updated/Checked', S), 'pending');   // part of the work not done
  assert.equal(ptClass('Not Updated/Updated', S), 'pending');
  assert.equal(ptClass('Checked/Updated', S), 'completed');
  assert.equal(ptClass('Updated/Checked', S), 'completed');
  assert.equal(ptClass('Updated / Not Updated', S), 'pending');  // the Admin's own entry still matches with spaces
  assert.equal(ptClass('updated', S), 'completed');
  assert.equal(ptClass('In progress/Updated', S), 'unmapped');   // an unknown word is never guessed
  assert.equal(ptClass('Something else', S), 'unmapped');
});

test('a re-audit comment is "OK" only when it is OK-type words', () => {
  for (const t of ['ok', 'OK', 'Okay.', 'done', 'OK - done', 'ok checked', 'Done!']) assert.equal(reauditPassed(t, S), true, t);
  for (const t of ['', '<Connector Size> 7/8 in', 'not ok', 'ok but Includes missing raw value', 'checked']) assert.equal(reauditPassed(t, S), false, t);
  assert.equal(classifyFollowUp({ codes: ['DM'], ptStatus: 'Updated', reauditComments: '<Connector Size> 7/8 in', sampled: true }, S).reaudit, 'issues');
  assert.equal(classifyFollowUp({ codes: ['DM'], ptStatus: 'Updated', reauditComments: '', sampled: true }, S).reaudit, 'pending');
  assert.equal(classifyFollowUp({ codes: ['DM'], ptStatus: 'Not Updated', reauditComments: '', sampled: true }, S).reaudit, 'not_due');
});

// ---------- the counting rule, end to end ----------
process.env.AUDIT_NO_LAUNCH = '1';
let db, server, base; let cookie = '';
async function api(method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'x-requested-with': 'audit-app', ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const HEAD = ['SKU ID', 'SKU Build By', 'Sample', 'Audit By', 'Error Type', 'Attribute/Field', 'Audit Comments', 'PT Status', 'PT Comments', 'Re-Audit Comments', 'Gap/Similar', 'PT Response', 'CFB Attribute', 'CFB Comments'];
// 10 audited SKUs of Ann: 5 with errors -> re-audit ok (2), re-auditor notes (1), not re-audited yet (1), PT "Not Updated" but re-audit ok (1)
const ROWS = [
  ['R1', 'Ann', 'FA', 'Pat', 'DM', 'Color', '', 'Updated', '', 'ok'],
  ['R2', 'Ann', 'FA', 'Pat', 'DE | DM', 'Width', '', 'Checked/Updated', '', 'Okay.'],
  ['R3', 'Ann', 'FA', 'Pat', 'DM', 'Height', '', 'Updated', '', '<Height> 9 in'],
  ['R4', 'Ann', 'FA', 'Pat', 'DE', 'Depth', '', 'Updated|Not Updated', '', ''],
  ['R5', 'Ann', 'FA', 'Pat', 'DM', 'Weight', '', 'Not Updated', '', 'ok'],
  ...['R6', 'R7', 'R8', 'R9', 'R10'].map((s) => [s, 'Ann', 'FA', 'Pat', '', '', '', '', '', '']),
].map((r) => [...r, '', '', '', '']);

before(async () => {
  db = await openDb({ client: 'sqlite', path: ':memory:' }); await seedReferenceData(db);
  server = createApp(db).listen(0); base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await api('POST', '/api/auth/setup', { username: 'admin', displayName: 'Admin', password: 'correct-horse-9' })).status, 201);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD, ...ROWS]), 'Data');
  const f = new FormData(); f.append('files', new Blob([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })]), 'Reaudit.xlsx');
  const staged = await api('POST', '/api/uploads', f); assert.equal(staged.status, 201);
  assert.equal((await api('POST', `/api/uploads/${staged.body.files[0].id}/commit`, { auditDate: '2026-07-14', project: 'Test' })).status, 200);
});
after(() => { server?.close(); });

test('rule off (default): every audit error counts, as before', async () => {
  const k = (await api('GET', '/api/overview')).body.kpis;
  assert.deepEqual([k.errorSkus, k.classifications, k.errorRate, k.waitingSkus, k.afterReaudit], [5, 6, 50, 0, false]);
});

test('rule on: only errors the re-audit checked (and PT did not say Not Updated) count; the rest are not confirmed, everywhere', async () => {
  const s = (await api('GET', '/api/settings')).body.settings;
  assert.equal((await api('PUT', '/api/settings', { ...s, countErrorsAfterReaudit: true })).status, 200);
  const o = (await api('GET', '/api/overview')).body;
  // R1 ok + R2 okay + R3 re-auditor notes = 3 SKUs (4 error codes) counted; R4 not re-audited yet + R5 PT "Not Updated" -> not confirmed
  assert.deepEqual([o.kpis.errorSkus, o.kpis.classifications, o.kpis.errorRate, o.kpis.waitingSkus, o.kpis.waitingClassifications, o.kpis.afterReaudit], [3, 4, 30, 2, 2, true]);
  const list = (await api('GET', '/api/records?unconfirmed=1')).body;
  assert.deepEqual(list.rows.map((r) => r.skuId).sort(), ['R4', 'R5']);
  const ann = (await api('GET', '/api/content-team')).body.members.find((m) => m.name === 'Ann');
  assert.deepEqual([ann.errorSkus, ann.errorRate, ann.attrErrors], [3, 30, 3]);           // the Product Team page uses the same rule
  const ea = (await api('GET', '/api/errors')).body;
  assert.equal(ea.totals.errorSkus, 3);
  // the PT & Re-Audit page still lists the waiting one (it is a follow-up case)
  const fu = (await api('GET', '/api/follow-ups')).body;
  assert.equal(fu.pt.pending, 2);                                                        // R4 "Updated|Not Updated" (no longer "Unrecognised") + R5 "Not Updated"
  assert.equal(fu.pt.unmapped ?? 0, 0);
  assert.equal(fu.reaudit.passed, 3); assert.equal(fu.reaudit.issues, 1);
  await api('PUT', '/api/settings', { ...s, countErrorsAfterReaudit: false });
});
