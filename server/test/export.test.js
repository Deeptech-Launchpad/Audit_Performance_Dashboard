// "Open in Excel" from another computer (live site): an uploaded .ods is downloaded as a full .xlsx copy (every sheet);
// ?original=1 still gives the file exactly as uploaded.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seedReferenceData } from '../src/services/settings.js';

process.env.AUDIT_NO_LAUNCH = '1';
let db, server, base; let cookie = '';
const H = { 'x-requested-with': 'audit-app' };
async function call(method, url, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + url, { method, headers: { ...H, ...(body && !isForm ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return res;
}

before(async () => {
  db = await openDb({ client: 'sqlite', path: ':memory:' });
  await seedReferenceData(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await call('POST', '/api/auth/setup', { username: 'admin', displayName: 'Admin', password: 'correct-horse-9' })).status, 201);
});
after(() => { server?.close(); });

test('Open in Excel download: .ods original comes as a full .xlsx (all sheets); ?original=1 gives the .ods', async () => {
  const HEAD = ['SKU ID', 'SKU Build By', 'Sample', 'Audit By', 'Error Type', 'Attribute/Field', 'Audit Comments', 'PT Status', 'PT Comments', 'Re-Audit Comments', 'Gap/Similar', 'PT Response', 'CFB Attribute', 'CFB Comments', 'Extra column O'];
  const rows = Array.from({ length: 6 }, (_, i) => [`SKU${i}`, 'Ann', 'FA', 'Audrey', i === 0 ? 'DM' : '', i === 0 ? 'Color' : '', '', '', '', '', i === 0 ? 'check similar case' : '', '', '', '', `extra ${i}`]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD, ...rows]), 'Data');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Schema'], ['a'], ['b']]), 'Schema');
  const f = new FormData(); f.append('files', new Blob([XLSX.write(wb, { type: 'buffer', bookType: 'ods' })]), 'Demo_Data.ods');
  const staged = await (await call('POST', '/api/uploads', f)).json();
  const id = staged.files[0].id;
  assert.equal((await call('POST', `/api/uploads/${id}/commit`, { auditDate: '2026-11-24', project: 'Demo' })).status, 200);

  const res = await call('GET', `/api/uploads/${id}/export`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  assert.match(res.headers.get('content-disposition'), /Demo_Data\.xlsx/);
  const back = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' });
  assert.deepEqual(back.SheetNames, ['Data', 'Schema'], 'every sheet is kept');
  const data = XLSX.utils.sheet_to_json(back.Sheets.Data, { header: 1, defval: '' });
  assert.equal(data.length, 7); assert.equal(data[0][14], 'Extra column O', 'columns beyond N are kept'); assert.equal(data[1][10], 'check similar case');

  const orig = await call('GET', `/api/uploads/${id}/export?original=1`);
  assert.match(orig.headers.get('content-type'), /opendocument/);
  assert.match(orig.headers.get('content-disposition'), /Demo_Data\.ods/);
});
