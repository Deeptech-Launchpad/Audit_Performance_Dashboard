// "Check mistakes at the source": the attributes marked wrong for one person, with exactly the links / captured values the file holds for them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seedReferenceData } from '../src/services/settings.js';
import { readWorkbook, detectTable, readSourceColumns } from '../src/services/parser.js';

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
const SKU_LINK_HEAD = ['PT_Data Source URL_1', 'PT_PDF Source URL_1', 'PT_PDF Page#_1', 'PT_Client URL'];
const slotHead = (n) => [`Att ${n}`, `Raw Val ${n}`, `Build Val ${n}`, `PT_Source URL Link ${n}`, `PT_Source Page# ${n}`];
const row = (sku, builder, sample, auditor, err, attr) => [sku, builder, sample, auditor, err, attr, '', '', '', '', '', '', '', ''];
const slot = (name = '', raw = '', url = '', page = '') => [name, raw, raw, url, page];

// links = true -> the file has the source columns; false -> the same audit rows without them (an "older" upload)
function book(prefix, links = true) {
  const rows = [
    // SKU,                                                                     product links: data page, PDF, PDF page, client page        slot 1                                                        slot 2
    [row(`${prefix}1`, 'Asha', 'FA', 'Audrey', 'DM', 'Flow Rate – Maximum'), ['https://maker.example/p1', 'https://maker.example/sheet.pdf', '2', 'https://client.example/x'], slot('Flow Rate - Maximum', '5 gpm', 'https://maker.example/flow.pdf', 'p. 3'), slot('Color', 'Red', 'https://maker.example/red', '')],
    [row(`${prefix}2`, 'Asha', 'FA', 'Audrey', 'DE', 'Color|Source'), ['www.maker.example/p2', '', '', ''], slot('Color', 'Blue;Green'), slot('Size', 'XL', 'https://maker.example/size')],
    [row(`${prefix}3`, 'Asha', 'FA', 'Audrey', 'SG', 'Color'), ['https://maker.example/p3', '', '', ''], slot('Color', 'Red'), slot()],        // suggestion = not an error
    [row(`${prefix}4`, 'Asha', 'FA', 'Audrey', '', ''), ['https://maker.example/p4', '', '', ''], slot('Color', 'Red'), slot()],               // no mistake
    [row(`${prefix}5`, 'Asha', '', 'Audrey', 'DM', 'Color'), ['https://maker.example/p5', '', '', ''], slot('Color', 'Red'), slot()],           // not sampled = not audited
    [row(`${prefix}6`, 'Bala', 'FA', 'Audrey', 'DM', 'Color'), ['javascript:alert(1)', '', '', ''], slot('Color', '', 'javascript:alert(2)'), slot()],
    [row(`${prefix}7`, 'Asha', 'FA', 'Bruno', 'DM', ''), ['https://maker.example/p7', '', '', ''], slot('Color', 'Red'), slot()],              // error, but no attribute named
  ];
  const head = links ? [...HEAD, ...SKU_LINK_HEAD, ...slotHead(1), ...slotHead(2)] : HEAD;
  const aoa = [head, ...rows.map(([a, product, s1, s2]) => (links ? [...a, ...product, ...s1, ...s2] : a))];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Data'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
async function upload(buffer, name, date = '2026-07-14') {
  const f = new FormData(); f.append('files', new Blob([buffer]), name);
  const staged = await api('POST', '/api/uploads', f); assert.equal(staged.status, 201, JSON.stringify(staged.body));
  const id = staged.body.files[0].id;
  const analysis = (await api('POST', `/api/uploads/${id}/analyze`, { auditDate: date })).body.analysis;
  const done = await api('POST', `/api/uploads/${id}/commit`, { auditDate: date, project: 'Links' }); assert.equal(done.status, 200, JSON.stringify(done.body));
  return { analysis, result: done.body };
}
const personId = async (name) => (await api('GET', '/api/meta')).body.builders.find((p) => p.name === name).id;
const checks = async (name, q = '') => (await api('GET', `/api/content-team/${await personId(name)}/source-checks${q}`)).body;
const count = async () => (await db.get('SELECT COUNT(*) AS n FROM audit_records')).n;

before(async () => {
  db = await openDb({ client: 'sqlite', path: ':memory:' }); await seedReferenceData(db);
  server = createApp(db).listen(0); base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await api('POST', '/api/auth/setup', { username: 'admin', displayName: 'Admin', password: 'correct-horse-9' })).status, 201);
  await upload(book('L'), 'links.xlsx');
});
after(() => { server?.close(); });

test('only the person’s audited SKUs with a real error are listed', async () => {
  const d = await checks('Asha');
  assert.deepEqual(d.items.map((i) => i.skuId), ['L1', 'L2', 'L7']);   // not L3 (suggestion), L4 (no error), L5 (not sampled), L6 (other person)
  assert.deepEqual(d.items.map((i) => i.codes), [['DM'], ['DE'], ['DM']]);
  assert.deepEqual(d.missingFiles, []);
});

test('each named attribute gets its own link, page and captured value; a dash typed differently still matches', async () => {
  const [one] = (await checks('Asha')).items;
  assert.deepEqual(one.attributes, [{ name: 'Flow Rate – Maximum', isAttribute: true, matched: true, value: '5 gpm', links: [{ url: 'https://maker.example/flow.pdf', page: 3 }], note: '', auditorLinks: [], hints: [] }]);
  // product links are kept too (data page + PDF with its page); the client page is not a source and is not read
  assert.deepEqual(one.productLinks, [{ kind: 'data', url: 'https://maker.example/p1', page: null }, { kind: 'pdf', url: 'https://maker.example/sheet.pdf', page: 2 }]);
  assert.ok(!JSON.stringify(one).includes('client.example'));
  assert.ok(!JSON.stringify(one).includes('maker.example/red'), 'the link of an attribute that was NOT marked wrong is not shown');
});

test('an attribute without its own link falls back to the product links; a name that is not an attribute is not guessed', async () => {
  const two = (await checks('Asha')).items[1];
  assert.deepEqual(two.attributes, [{ name: 'Color', isAttribute: true, matched: true, value: 'Blue;Green', links: [], note: '', auditorLinks: [], hints: [] }, { name: 'Source', isAttribute: false, matched: false, value: '', links: [], note: '', auditorLinks: [], hints: [] }]);
  assert.deepEqual(two.productLinks, [{ kind: 'data', url: 'https://www.maker.example/p2', page: null }]);
  const seven = (await checks('Asha')).items[2];
  assert.deepEqual([seven.attributes, seven.saved], [[], false]);
});

test('only web links are ever kept', async () => {
  const [six] = (await checks('Bala')).items;
  assert.deepEqual(six.attributes[0].links, []); assert.deepEqual(six.productLinks, []);
  assert.ok(!(await db.all('SELECT source_info FROM audit_records')).some((r) => /javascript:/i.test(r.source_info || '')));
});

test('the page filters apply, and unknown people / signed-out visitors get nothing', async () => {
  const auditor = (await api('GET', '/api/meta')).body.auditors.find((p) => p.name === 'Bruno').id;
  assert.deepEqual((await checks('Asha', `?auditorId=${auditor}`)).items.map((i) => i.skuId), ['L7']);
  assert.equal((await api('GET', '/api/content-team/abc/source-checks')).status, 400);
  assert.deepEqual((await api('GET', '/api/content-team/99999/source-checks')).body.items, []);
  const keep = cookie; cookie = '';
  assert.equal((await api('GET', '/api/content-team/1/source-checks')).status, 401);
  cookie = keep;
});

test('a file uploaded before links were kept is named, and uploading it again adds the links without duplicating anything', async () => {
  await upload(book('Q'), 'older.xlsx', '2026-07-15');
  await db.run(`UPDATE audit_records SET source_info = NULL WHERE sku_id LIKE 'Q%'`); // exactly what the earlier version stored: the same records without links
  const before = await checks('Asha', '?from=2026-07-15&to=2026-07-15');
  assert.deepEqual(before.items.map((i) => [i.skuId, i.saved, i.attributes.map((a) => a.links.length)]), [['Q1', false, [0]], ['Q2', false, [0, 0]], ['Q7', false, []]]);
  assert.deepEqual(before.missingFiles, ['older.xlsx']);
  const records = await count();

  const again = await upload(book('Q', true), 'older.xlsx', '2026-07-15');
  const q1 = again.analysis.review.find((r) => r.skuId === 'Q1');
  assert.equal(q1.verdict, 'changed'); assert.deepEqual(q1.diff, [{ field: 'Source links', old: '', new: 'from this file' }]); // no technical text on the review screen
  assert.equal(again.result.imported, 0);
  assert.equal(await count(), records);                                    // nothing added twice
  const afterwards = await checks('Asha', '?from=2026-07-15&to=2026-07-15');
  assert.equal(afterwards.items[0].attributes[0].links[0].url, 'https://maker.example/flow.pdf');
  assert.deepEqual(afterwards.missingFiles, []);

  // uploading the very same file once more changes nothing, and an upload without the link columns never wipes stored links
  assert.deepEqual([(await upload(book('Q', true), 'older.xlsx', '2026-07-15')).result.updated], [0]);
  await upload(book('Q', false), 'older.xlsx', '2026-07-15');
  assert.equal((await checks('Asha', '?from=2026-07-15&to=2026-07-15')).items[0].attributes[0].links.length, 1);
});

test('a file without any source columns reads no links at all', () => {
  const wb = readWorkbook(book('N', false), 'n.xlsx');
  assert.equal(readSourceColumns(wb, detectTable(wb).usable[0]), null);
});
