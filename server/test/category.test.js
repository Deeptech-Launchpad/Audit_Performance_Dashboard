// Category-Based Performance Tracking. The PIM Taxonomy column is found by its heading (here column R, like the real file).
// Expected values are worked out by hand from the rows below.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seedReferenceData } from '../src/services/settings.js';
import { l1Category } from '../src/services/parser.js';

let db, server, base, cookie = '';
async function api(method, url, body, headers = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + url, { method, headers: { 'x-requested-with': 'audit-app', ...(body && !isForm ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('json')) return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  return { status: res.status, body: await res.json() };
}
const form = (name, buf, field = 'files') => { const f = new FormData(); f.append(field, new Blob([buf]), name); return f; };
const HEAD = ['SKU ID', 'SKU Build By', 'Sample', 'Audit By', 'Error Type', 'Attribute/Field', 'Audit Comments', 'PT Status', 'PT Comments', 'Re-Audit Comments', 'Gap/Similar', 'PT Response', 'CFB Attribute', 'CFB Comments'];
const xlsx = (sheets) => { const wb = XLSX.utils.book_new(); for (const [n, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); };

const ABR = 'Abrasives > Blasting, Deburring and Sharpening > Dust Collectors';
const ADH = 'Adhesives, Sealants and Tape > Caulks, Sealants';
const PWR = 'Power Tools > Drills';
const TXT = 'Textiles > Fabric';
// [sku, builder, sampled?, error?, taxonomy]
const DATA = [
  ...['A1', 'A2', 'A3', 'A4'].map((s) => [s, 'Ann', 1, 0, ABR]), ['A5', 'Ann', 0, 0, 'abrasives > Grinding'],     // lower-case spelling = same category
  ...['C1', 'C2'].map((s) => [s, 'Cy', 1, 1, ABR]), ...['C3', 'C4'].map((s) => [s, 'Cy', 1, 0, ABR]),
  ...['D1', 'D2'].map((s) => [s, 'Dee', 1, 0, ABR]),
  ['H1', 'Ann', 1, 1, ADH], ['H2', 'Ann', 1, 0, ADH], ['H3', 'Ann', 1, 0, ADH],
  ...['J1', 'J2', 'J3'].map((s) => [s, 'Cy', 1, 0, ADH]),
  ...['K1', 'K2', 'K3'].map((s) => [s, 'Dee', 0, 0, ADH]),
  ...['P1', 'P2', 'P3'].map((s) => [s, 'Cy', 1, 0, PWR]), ...['Q1', 'Q2', 'Q3'].map((s) => [s, 'Dee', 1, 0, PWR]),
  ['T1', 'Dee', 1, 1, TXT], ['T2', 'Dee', 1, 0, TXT],
  ['M1', 'Ann', 0, 0, ''],                                                                                        // no taxonomy
];
const book = (withTax) => xlsx([['Data', [withTax ? [...HEAD, 'Source ID', 'Source Type', 'Gather Group ID', 'PIM Taxonomy'] : HEAD,
  ...DATA.map(([sku, b, smp, err, tax]) => [sku, b, smp ? 'FA' : '', smp ? 'Bob' : '', err ? 'DM' : '', err ? 'Colour' : '', '', '', '', '', '', '', '', '', ...(withTax ? ['id', 'type', 'grp', tax] : [])])]]]);

before(async () => {
  db = await openDb({ client: 'sqlite', path: ':memory:' }); await seedReferenceData(db);
  server = createApp(db).listen(0); base = `http://127.0.0.1:${server.address().port}`;
  await api('POST', '/api/auth/setup', { username: 'admin', displayName: 'Admin', password: 'correct-horse-9' });
});
after(() => server.close());

test('L1 category = text before the first ">"', () => {
  assert.equal(l1Category(ABR), 'Abrasives');
  assert.equal(l1Category('  Adhesives, Sealants and Tape  > Caulks'), 'Adhesives, Sealants and Tape');
  assert.equal(l1Category('Single level'), 'Single level');
  assert.equal(l1Category(''), null);
  assert.equal(l1Category(null), null);
});

test('PIM Taxonomy is found by its heading (column R) and shown in the upload checks', async () => {
  const up = await api('POST', '/api/uploads', form('Cat_Test_080326.xlsx', book(true)));
  const a = up.body.files[0].analysis;
  assert.deepEqual([a.dataChecks.categories.columnFound, a.dataChecks.categories.column, a.dataChecks.categories.count, a.dataChecks.categories.skusWithoutCategory], [true, 'R', 4, 1]);
  assert.equal((await api('POST', `/api/uploads/${up.body.files[0].id}/commit`, {})).status, 200);
});

test('who is strongest in which category (tiers, ranking, recommended, needs support)', async () => {
  const c = (await api('GET', '/api/categories')).body;
  assert.deepEqual(c.categories.map((x) => x.name), ['Abrasives', 'Adhesives, Sealants and Tape', 'Power Tools', 'Textiles']);   // by volume
  const by = Object.fromEntries(c.categories.map((x) => [x.name, x]));
  const abr = by.Abrasives;
  assert.equal(abr.skus, 11);                                            // A1-A5 (incl. lower-case spelling), C1-C4, D1-D2
  assert.deepEqual(abr.members.map((m) => [m.name, m.tier]), [['Ann', 'strong'], ['Dee', 'early'], ['Cy', 'weak']]);
  assert.deepEqual([abr.members[0].skus, abr.members[0].samples, abr.members[0].errorRate], [5, 4, 0]);
  assert.deepEqual([abr.members[2].samples, abr.members[2].errorSkus, abr.members[2].errorRate], [4, 2, 50]);
  assert.deepEqual(abr.recommended.map((m) => m.name), ['Ann']); assert.equal(abr.basis, 'proven');
  assert.deepEqual(abr.needsSupport.map((m) => m.name), ['Cy']);
  const adh = by['Adhesives, Sealants and Tape'];
  assert.deepEqual(adh.members.map((m) => [m.name, m.tier]), [['Cy', 'strong'], ['Dee', 'untested'], ['Ann', 'weak']]);   // 1 of 3 = 33.3% is above target + margin (30%)
  assert.deepEqual(adh.recommended.map((m) => m.name), ['Cy']);
  assert.deepEqual(by['Power Tools'].recommended.map((m) => m.name), ['Cy', 'Dee']);   // two proven people, equal results: more audited/built first, then name
  const txt = by.Textiles;
  assert.deepEqual([txt.basis, txt.recommended.map((m) => m.name), txt.recommended[0].tier], ['best available', ['Dee'], 'early']);   // nobody proven: best available, clearly labelled
  assert.deepEqual(c.summary, { categories: 4, withProven: 3, noProven: 1, expertPeople: 3 });
  const ann = c.people.find((p) => p.name === 'Ann');
  assert.deepEqual([ann.strong.map((x) => x.category), ann.weak.map((x) => x.category)], [['Abrasives'], ['Adhesives, Sealants and Tape']]);
  assert.deepEqual(c.coverage, { skusWithCategory: c.coverage.skusTotal - 1, skusTotal: c.coverage.skusTotal });   // M1 has no taxonomy
  assert.deepEqual(c.missingFiles, []);
});

test('the proven threshold follows Settings (categoryMinSample) and filters apply', async () => {
  assert.equal((await api('PUT', '/api/settings', { categoryMinSample: 2 })).status, 200);
  let by = Object.fromEntries((await api('GET', '/api/categories')).body.categories.map((x) => [x.name, x]));
  assert.equal(by.Abrasives.members.find((m) => m.name === 'Dee').tier, 'strong');      // 2 audited, 0 errors now counts as proven
  assert.equal(by.Textiles.members[0].tier, 'weak');                                     // 2 audited, 50% errors
  assert.equal((await api('PUT', '/api/settings', { categoryMinSample: 3 })).status, 200);
  assert.equal((await api('PUT', '/api/settings', { categoryMinSample: 0 })).status, 400);
  by = Object.fromEntries((await api('GET', '/api/categories?week=2030-01-07')).body.categories.map((x) => [x.name, x]));
  assert.deepEqual(Object.keys(by), []);                                                 // nothing in that week
});

test('champions of the week: best Product Team person (lowest error rate, fair minimum) and Audit Team person (most error types found)', async () => {
  // week of 2026-08-03: Ann 7 audited / 1 error (14.29%), Cy 10 / 2 (20%), Dee 7 / 1 (14.29%); Bob audited 24 SKUs (all audited rows)
  const c = (await api('GET', '/api/champions')).body;
  assert.deepEqual([c.week.start, c.week.end, c.latest, c.weeks], ['2026-08-03', '2026-08-08', true, ['2026-08-03']]); // a week is Monday to Saturday
  assert.equal(c.teamErrorRate, 16.67);                                       // 4 error SKUs of 24 audited
  assert.equal(c.product.length, 3);
  assert.deepEqual(c.product.map((p) => p.errorRate), [14.29, 14.29, 20]);   // best first, Cy last
  assert.equal(c.product[2].name, 'Cy');
  assert.ok(['Ann', 'Dee'].includes(c.product[0].name));
  assert.deepEqual([c.audit[0].name, c.audit[0].skusAudited, c.audit[0].sharePct], ['Bob', 24, 100]);
  // a week without data: nobody, no guessing
  const none = (await api('GET', '/api/champions?week=2026-07-27')).body;
  assert.deepEqual([none.week.start, none.product, none.audit], ['2026-07-27', [], []]);
  // the fairness minimum applies: with minimum 8 audited SKUs only Cy (10) qualifies
  await api('PUT', '/api/settings', { minSample: 8 });
  const strict = (await api('GET', '/api/champions')).body;
  assert.deepEqual([strict.product.map((p) => p.name), strict.minSample], [['Cy'], 8]);
  await api('PUT', '/api/settings', { minSample: 5 });
  assert.equal((await api('GET', '/api/champions?week=nonsense')).status, 400);
  // viewers may look
  const admin = cookie; await api('POST', '/api/users', { username: 'view2', name: 'View', role: 'viewer', password: 'another-long-pass-1' });
  cookie = ''; await api('POST', '/api/auth/login', { username: 'view2', password: 'another-long-pass-1' });
  assert.equal((await api('GET', '/api/champions')).status, 200);
  cookie = admin;
});

test('re-uploading an older file WITH the PIM Taxonomy column fills it in; a file without it never erases it; files missing it are listed', async () => {
  const noTaxUp = await api('POST', '/api/uploads', form('Old_080426.xlsx', xlsx([['Data', [HEAD, ['Z1', 'Zed', 'FA', 'Bob', 'DM', 'Colour', '', '', '', '', '', '', '', ''], ['Z2', 'Zed', 'FA', 'Bob', '', '', '', '', '', '', '', '', '', '']]]])));
  assert.deepEqual([noTaxUp.body.files[0].analysis.dataChecks.categories.columnFound, noTaxUp.body.files[0].analysis.dataChecks.categories.note.length > 0], [false, true]);
  await api('POST', `/api/uploads/${noTaxUp.body.files[0].id}/commit`, { project: 'Old' });
  const miss = (await api('GET', '/api/categories?project=Old')).body;
  assert.deepEqual([miss.categories.length, miss.missingFiles.map((f) => f.name)], [0, ['Old_080426.xlsx']]);
  const withTax = xlsx([['Data', [[...HEAD, 'PIM Taxonomy'], ['Z1', 'Zed', 'FA', 'Bob', 'DM', 'Colour', '', '', '', '', '', '', '', '', 'Garden > Tools'], ['Z2', 'Zed', 'FA', 'Bob', '', '', '', '', '', '', '', '', '', '', 'Garden > Tools']]]]);
  const again = await api('POST', '/api/uploads', form('Old_080426.xlsx', withTax));
  const a = again.body.files[0].analysis;
  assert.equal(a.counts.changed, 2);
  assert.ok(a.review.every((r) => r.diff.length === 1 && r.diff[0].field === 'PIM Taxonomy'));
  assert.deepEqual((await api('POST', `/api/uploads/${again.body.files[0].id}/commit`, { project: 'Old' })).body, { imported: 0, updated: 2, skipped: 0 });
  const g = (await api('GET', '/api/categories?project=Old')).body;
  assert.deepEqual([g.categories.map((x) => x.name), g.categories[0].members[0].name, g.missingFiles], [['Garden'], 'Zed', []]);
  // a later file with no taxonomy column does not erase what is stored
  const again2 = await api('POST', '/api/uploads', form('Old_080426.xlsx', xlsx([['Data', [HEAD, ['Z1', 'Zed', 'FA', 'Bob', 'DM', 'Colour', '', '', '', '', '', '', '', ''], ['Z2', 'Zed', 'FA', 'Bob', '', '', '', '', '', '', '', '', '', '']]]])));
  assert.equal(again2.body.files[0].analysis.counts.identical, 2);
});
