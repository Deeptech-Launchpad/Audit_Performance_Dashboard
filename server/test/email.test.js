// Appreciation / feedback emails: the right message for each person, sending one, sending to a whole group (Admin), mail settings never leak the password.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seedReferenceData } from '../src/services/settings.js';
import { testOutbox } from '../src/services/mailer.js';

process.env.AUDIT_NO_LAUNCH = '1';
let db, server, base; let cookie = '';
async function api(method, url, body) {
  const res = await fetch(base + url, { method, headers: { 'x-requested-with': 'audit-app', ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const HEAD = ['SKU ID', 'SKU Build By', 'Sample', 'Audit By', 'Error Type', 'Attribute/Field', 'Audit Comments', 'PT Status', 'PT Comments', 'Re-Audit Comments', 'Gap/Similar', 'PT Response', 'CFB Attribute', 'CFB Comments'];
// target 10 %: Ann 0/10 and Bea 1/10 achieved; Cy 5/10 needs improvement (above 10 + 15)
const PLAN = [['Ann', 10, 0], ['Bea', 10, 1], ['Cy', 10, 5]];
const id = async (name) => (await api('GET', '/api/meta')).body.builders.find((b) => b.name === name).id;

before(async () => {
  process.env.MAIL_TEST = '1';
  db = await openDb({ client: 'sqlite', path: ':memory:' }); await seedReferenceData(db);
  server = createApp(db).listen(0); base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await api('POST', '/api/auth/setup', { username: 'admin', displayName: 'Admin Lead', password: 'correct-horse-9' })).status, 201);
  const rows = []; let n = 0;
  for (const [b, audited, errs] of PLAN) for (let i = 0; i < audited; i++, n++) rows.push([`E${n}`, b, 'FA', 'Pat', i < errs ? 'DM' : '', i < errs ? 'Color' : '', '', '', '', '', '', '', '', '']);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD, ...rows]), 'Data');
  const f = new FormData(); f.append('files', new Blob([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })]), 'Mail.xlsx');
  const st = await api('POST', '/api/uploads', f);
  assert.equal((await api('POST', `/api/uploads/${st.body.files[0].id}/commit`, { auditDate: '2026-07-14', project: 'Test' })).status, 200);
  const s = (await api('GET', '/api/settings')).body.settings;
  assert.equal((await api('PUT', '/api/settings', { ...s, errorTargetPct: 10 })).status, 200);
});
after(() => { server?.close(); delete process.env.MAIL_TEST; });

test('someone who achieved the target gets an appreciation message; someone above it gets feedback', async () => {
  const ann = (await api('GET', `/api/feedback/${await id('Ann')}`)).body;
  assert.equal(ann.kind, 'appreciation'); assert.match(ann.subject, /Congratulations – lowest error rate/);
  assert.match(ann.message, /Congratulations!/); assert.match(ann.message, /without a single error/); assert.match(ann.message, /Lowest error rate/);
  const bea = (await api('GET', `/api/feedback/${await id('Bea')}`)).body;
  assert.equal(bea.kind, 'appreciation'); assert.match(bea.message, /only 1 had an error, which is an error rate of 10%/);
  const cy = (await api('GET', `/api/feedback/${await id('Cy')}`)).body;
  assert.equal(cy.kind, 'feedback'); assert.match(cy.subject, /^Audit feedback/); assert.match(cy.message, /What to work on/);
});

test('send one email: needs an address, saves it, attaches the PDF', async () => {
  testOutbox.length = 0;
  const annId = await id('Ann');
  assert.equal((await api('POST', `/api/feedback/${annId}/send`, {})).status, 400);                               // no address yet
  const r = await api('POST', `/api/feedback/${annId}/send`, { email: 'ann@example.com', message: 'Edited text' });
  assert.equal(r.status, 200);
  assert.deepEqual([testOutbox[0].to, testOutbox[0].text, /Congratulations/.test(testOutbox[0].subject), testOutbox[0].attachments.length], ['ann@example.com', 'Edited text', true, 1]);
  assert.equal((await api('GET', `/api/feedback/${annId}`)).body.email, 'ann@example.com');                          // remembered
});

test('bulk (Admin): each person in the group gets their own email; people without an address are reported, not skipped silently', async () => {
  testOutbox.length = 0;
  const g = (await api('GET', '/api/feedback/bulk/achieved')).body;
  assert.deepEqual(g.members.map((m) => m.name), ['Ann', 'Bea']);                                                    // best first; Cy is not in this group
  const r = (await api('POST', '/api/feedback/bulk/achieved', { ids: g.members.map((m) => m.id) })).body;
  assert.deepEqual([r.sent, r.failed], [1, 1]);
  assert.equal(r.results.find((x) => x.name === 'Bea').error, 'No email address');
  const r2 = (await api('POST', '/api/feedback/bulk/achieved', { ids: [await id('Bea')], emails: { [await id('Bea')]: 'bea@example.com' } })).body;
  assert.equal(r2.sent, 1);
  const imp = (await api('GET', '/api/feedback/bulk/improve')).body;
  assert.deepEqual(imp.members.map((m) => m.name), ['Cy']);
  await api('POST', '/api/feedback/bulk/improve', { ids: [await id('Cy'), await id('Ann')], emails: { [await id('Cy')]: 'cy@example.com' } });  // Ann is not in this group: ignored
  assert.deepEqual(testOutbox.map((m) => [m.to, m.subject.startsWith('Congratulations') ? 'appreciation' : 'feedback']), [['ann@example.com', 'appreciation'], ['bea@example.com', 'appreciation'], ['cy@example.com', 'feedback']]);
});

test('mail settings: Admin only; the password is never sent back, and an empty password keeps the saved one', async () => {
  const put = await api('PUT', '/api/feedback/mail/settings', { host: 'smtp.example.com', port: 587, secure: false, user: 'u@example.com', pass: 'secret-pass-123', fromAddress: 'audit@example.com', fromName: 'Audit Team' });
  assert.equal(put.status, 200); assert.equal(put.body.pass, undefined); assert.equal(put.body.hasPassword, true);
  const again = await api('PUT', '/api/feedback/mail/settings', { host: 'smtp.example.com', port: 587, secure: false, user: 'u@example.com', fromAddress: 'audit@example.com', fromName: 'Audit Team' });
  assert.equal(again.body.hasPassword, true);
  assert.ok(!JSON.stringify((await api('GET', '/api/feedback/mail/settings')).body).includes('secret-pass-123'));
  assert.ok(!JSON.stringify((await api('GET', '/api/settings')).body).includes('secret-pass-123'));                  // not in the general settings either
  assert.equal((await api('PUT', '/api/feedback/mail/settings', { host: 'x', port: 25, secure: false, user: '', fromAddress: 'not-an-email', fromName: '' })).status, 400);
  // a viewer cannot read or change it, nor send in bulk
  await api('POST', '/api/users', { username: 'view3', name: 'View', role: 'viewer', password: 'another-long-pass-1' });
  cookie = ''; await api('POST', '/api/auth/login', { username: 'view3', password: 'another-long-pass-1' });
  assert.equal((await api('GET', '/api/feedback/mail/settings')).status, 403);
  assert.equal((await api('POST', '/api/feedback/bulk/achieved', { ids: [] })).status, 403);
});
