// Strict-source rules: only columns A:N of the audit table are used. Built from small workbooks whose expected
// results are worked out by hand, including decoy summary sheets and decoy columns that must be ignored.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seedReferenceData } from '../src/services/settings.js';
import { suggestProject } from '../src/lib/project.js';

let db, server, base, cookie = '';
async function api(method, url, body, headers = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + url, { method, headers: { 'x-requested-with': 'audit-app', ...(body && !isForm ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const form = (name, buf) => { const f = new FormData(); f.append('files', new Blob([buf]), name); return f; };
const HEAD = ['SKU ID', 'SKU Build By', 'Sample', 'Audit By', 'Error Type', 'Attribute/Field', 'Audit Comments', 'PT Status', 'PT Comments', 'Re-Audit Comments', 'Gap/Similar', 'PT Response', 'CFB Attribute', 'CFB Comments'];
const row = (sku, builder, sample = '', auditor = '', err = '', attr = '', comment = '', pt = '', ptc = '', rea = '', gap = '', resp = '') => [sku, builder, sample, auditor, err, attr, comment, pt, ptc, rea, gap, resp, '', ''];
const xlsx = (sheets) => { const wb = XLSX.utils.book_new(); for (const [n, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), n); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); };

before(async () => {
  db = await openDb({ client: 'sqlite', path: ':memory:' }); await seedReferenceData(db);
  server = createApp(db).listen(0); base = `http://127.0.0.1:${server.address().port}`;
  await api('POST', '/api/auth/setup', { username: 'admin', displayName: 'Admin', password: 'correct-horse-9' });
});
after(() => server.close());

// 10 SKUs. Hand-worked expectations are in the assertions below.
const ROWS = [
  row('S1', 'Ann', 'FA', 'Bob', 'DM', 'Colour', 'Colour missing'),
  row('S2', 'Ann', 'FA', 'Bob', 'DE | DM', 'Colour | Weight', 'Colour missing'),
  row('S3', 'Ann', 'FA', 'Bob', 'SG', '', 'suggestion only'),
  row('S4', 'Ann', 'FA', 'Bob', 'ZZ', 'Size', 'unknown code'),
  row('S5', 'Cy', 'FA', 'Bob'),
  row('S6', 'Cy', 'FA', 'Bob', 'DM', 'Colour', 'Colour missing', 'Not Updated', 'PT will fix', '', '', 'PT agrees'),
  row('S7', 'Cy'), row('S8', 'Cy'),
  row('S9', 'Cy', '', 'Bob', 'DM', 'Colour', 'audit details but Sample empty'),
  row('S10', 'Ann'),
];
// decoys: a summary sheet with wrong figures, title rows above the headings, and columns beyond N carrying a different "Error Type"/"SKU Build By"
const decoyBook = () => xlsx([
  ['Totals', [['Total SKUs', 9999], ['Error Count', 8888], ['Error Type', 'Count'], ['DE', 777]]],
  ['Zebra', [['Audit export', '', '', ''], [], [...HEAD, 'Manufacturer', 'Error Type', 'SKU Build By'], ...ROWS.map((r) => [...r, 'ACME', 'DE', 'Decoy Person'])]],
]);

test('only A:N of the audit table is read; summary sheets and columns beyond N are ignored; sheet found by headings', async () => {
  const up = await api('POST', '/api/uploads', form('Audit_Test_080326.xlsx', decoyBook()));
  const a = up.body.files[0].analysis;
  assert.equal(a.sheet.used, 'Zebra');                    // odd sheet name, headings on row 3
  assert.equal(a.sheet.headerRow, 3);
  assert.equal(a.sheet.options.length, 1);
  assert.equal(a.preview[0].rowNo, 4, 'row numbers are true spreadsheet rows');
  assert.ok(Object.values(a.columns.found).every((v) => /^[A-N]: /.test(v)));
  assert.equal(a.computed.skus, 10);
  assert.equal(a.computed.samples, 6);
  assert.equal(a.computed.errorSkus, 3);                  // S1, S2, S6 (ZZ unknown, SG not an error, S9 not sampled)
  assert.equal(a.computed.classifications, 4);            // DM + (DE, DM) + DM
  assert.deepEqual(a.validation.unrecognisedCodes, [{ code: 'ZZ', rows: 1 }]);
  assert.equal(a.dataChecks.unsampledWithAuditDetails, 1);
  assert.ok(a.validation.warnings['Audit details found but Sample is empty – not counted as an audited sample']);
  assert.equal((await api('POST', `/api/uploads/${up.body.files[0].id}/commit`, {})).status, 200);
});

test('dashboard numbers come from the rows: product team, audit team, errors, follow-up, details', async () => {
  const o = (await api('GET', '/api/overview')).body;
  assert.deepEqual([o.kpis.skus, o.kpis.samples, o.kpis.errorSkus, o.kpis.classifications], [10, 6, 3, 4]);
  assert.equal(o.kpis.errorRate, 50);                      // 3 / 6
  assert.equal(o.kpis.sampleRate, 60);                     // 6 / 10
  const team = Object.fromEntries((await api('GET', '/api/content-team')).body.members.map((m) => [m.name, m]));
  assert.deepEqual([team.Ann.skus, team.Ann.samples, team.Ann.errorSkus, team.Ann.errorRate, team.Ann.classifications], [5, 4, 2, 50, 3]);
  assert.deepEqual([team.Cy.skus, team.Cy.samples, team.Cy.errorSkus, team.Cy.errorRate, team.Cy.classifications], [5, 2, 1, 50, 1]);
  assert.equal(team['Decoy Person'], undefined);
  const au = (await api('GET', '/api/audit-team')).body.auditors;
  assert.equal(au.length, 1);
  // Bob is named on 7 rows (records) but only 6 are audited samples; S9 has Audit By but an empty Sample, so it is not an audited SKU
  assert.deepEqual([au[0].name, au[0].skusAudited, au[0].records, au[0].classifications], ['Bob', 6, 7, 4]);
});

test('error analysis: classifications per code, by member and auditor, recurring comments from column G', async () => {
  const e = (await api('GET', '/api/errors')).body;
  assert.deepEqual(Object.fromEntries(e.byType.map((t) => [t.code, t.classifications])), { DM: 3, DE: 1 });
  assert.equal(e.totals.errorSkus, 3);
  assert.equal(e.byMember.find((m) => m.name === 'Ann').total, 3);
  assert.equal(e.byAuditor.find((m) => m.name === 'Bob').total, 4);
  assert.deepEqual(e.unrecognisedCodes.map((u) => u.code), ['ZZ']);
  const rc = e.recurringComments.find((c) => /colour missing/i.test(c.comment));
  assert.equal(rc.skus, 3);
  assert.deepEqual(e.byAttribute.find((a) => a.attribute === 'Colour').skus, 3);
});

test('PT & re-audit use PT status, PT comments, re-audit comments and PT response; blanks are not invented', async () => {
  const f = (await api('GET', '/api/follow-ups')).body;
  const s6 = f.items.find((i) => i.skuId === 'S6');
  assert.equal(s6.ptClass, 'pending');
  assert.equal(s6.ptComments, 'PT will fix');
  assert.equal(s6.ptResponse, 'PT agrees');
  assert.equal(f.pt.pending, 1);                           // S6 only
  assert.equal(f.pt.not_recorded, 4);                      // S1, S2, S3, S4: audit finding present, PT Status empty -> "no status recorded", not pending
  assert.equal(f.reaudit.pending, 0);                      // nobody has PT "completed", so nothing is due for re-audit
  assert.ok(!f.items.find((i) => i.skuId === 'S5'), 'a sampled SKU with no finding and no PT status is not a follow-up case');
  assert.ok(!f.items.find((i) => i.skuId === 'S9'), 'a row that is not a sample is not a follow-up case');
});

test('personal feedback: suggestions from that person\'s own errors, message, SKU list, PDF, email address, roles', async () => {
  const meta = (await api('GET', '/api/meta')).body;
  const ann = meta.builders.find((b) => b.name === 'Ann').id;
  const fb = (await api('GET', `/api/feedback/${ann}`)).body;
  assert.equal(fb.member.name, 'Ann');
  assert.deepEqual([fb.member.samples, fb.member.errorSkus, fb.member.errorRate], [4, 2, 50]);
  assert.deepEqual(fb.skusToCheck.map((s) => s.skuId), ['S1', 'S2']);          // her audited error SKUs only
  const ids = fb.suggestions.map((s) => s.id);
  assert.ok(ids.includes('few'), 'only 4 audited SKUs: fairness note');
  assert.ok(ids.includes('type-DM'), 'DM is her most common mistake');
  assert.ok(ids.includes('attr-Colour'), 'Colour repeated on 2 SKUs');
  assert.ok(ids.includes('comment-0'), 'same auditor comment on 2 SKUs');
  assert.ok(fb.suggestions.every((s) => s.title && s.detail && s.evidence));
  assert.match(fb.message, /^Hi Ann,/);
  assert.match(fb.message, /SKUs with errors: 2 \(50%/);
  assert.match(fb.message, /S1: DM/);
  assert.ok(!/Cy|S6/.test(fb.message), "nothing about other people's SKUs");
  // a different person gets different content
  const cy = meta.builders.find((b) => b.name === 'Cy').id;
  assert.deepEqual((await api('GET', `/api/feedback/${cy}`)).body.skusToCheck.map((s) => s.skuId), ['S6']);
  // email address + PDF
  assert.equal((await api('PUT', `/api/feedback/${ann}/email`, { email: 'not an email' })).status, 400);
  assert.equal((await api('PUT', `/api/feedback/${ann}/email`, { email: 'ann@example.com' })).status, 200);
  assert.equal((await api('GET', `/api/feedback/${ann}`)).body.email, 'ann@example.com');
  const res = await fetch(`${base}/api/feedback/${ann}/pdf`, { headers: { cookie } });
  const pdf = Buffer.from(await res.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(res.headers.get('content-disposition'), /audit-feedback-Ann-/);
  // no data in the chosen period -> clear message
  assert.equal((await api('GET', `/api/feedback/${ann}?from=2020-01-01&to=2020-01-02`)).status, 400);
  // viewer may read suggestions but cannot save an address
  const admin = cookie;
  await api('POST', '/api/users', { username: 'view1', name: 'View', role: 'viewer', password: 'another-long-pass-1' });
  cookie = ''; await api('POST', '/api/auth/login', { username: 'view1', password: 'another-long-pass-1' });
  assert.equal((await api('GET', `/api/feedback/${ann}`)).status, 200);
  assert.equal((await api('PUT', `/api/feedback/${ann}/email`, { email: 'x@example.com' })).status, 403);
  cookie = admin;
});

test('an Admin adding the unknown code to the error list makes it count - nothing is auto-counted', async () => {
  const before = (await api('GET', '/api/overview')).body.kpis;
  assert.equal(before.errorSkus, 3);
  await api('PUT', '/api/error-types', [{ code: 'ZZ', name: 'Custom error', isError: true, tip: '', verified: true }]);
  const after = (await api('GET', '/api/overview')).body.kpis;
  assert.equal(after.errorSkus, 4);
  assert.equal(after.classifications, 5);
});

test('a file that lists only audited SKUs: total SKUs and sample % are "not available", error % still works', async () => {
  const buf = xlsx([['Data', [HEAD, row('Q1', 'Dee', 'FA', 'Bob', 'DM', 'Colour'), row('Q2', 'Dee', 'FA', 'Bob')]]]);
  const up = await api('POST', '/api/uploads', form('only_audited_080426.xlsx', buf));
  const a = up.body.files[0].analysis;
  assert.equal(a.dataChecks.totalSkusAvailable, false);
  assert.match(a.dataChecks.totalSkusNote, /Not available/);
  await api('POST', `/api/uploads/${up.body.files[0].id}/commit`, {});
  const deeId = (await api('GET', '/api/meta')).body.builders.find((b) => b.name === 'Dee').id;
  const dee = (await api('GET', `/api/content-team?builderId=${deeId}`)).body;
  assert.equal(dee.members.length, 1);
  assert.equal(dee.members[0].skusAvailable, false);
  assert.equal(dee.members[0].sampleRate, null);
  assert.equal(dee.members[0].errorRate, 50);            // error % does not need total SKUs
  const ov = (await api('GET', '/api/overview')).body;
  assert.equal(ov.kpis.skusAvailable, false);              // one contributing file cannot show the total
  assert.equal(ov.kpis.sampleRate, null);
  // the earlier full file on its own (filter by its members) still has a total
  const annId = (await api('GET', '/api/meta')).body.builders.find((b) => b.name === 'Ann').id;
  const ann = (await api('GET', `/api/overview?builderId=${annId}`)).body;
  assert.equal(ann.kpis.skusAvailable, true);
  assert.equal(ann.kpis.sampleRate, 80);                   // 4 of 5
});

test('multi-error SKU counts once as an error SKU but once per code in error analysis', async () => {
  const e = (await api('GET', '/api/errors?week=2026-08-03')).body;
  const s2 = (await api('GET', '/api/records?q=S2&errorCode=DE')).body;
  assert.equal(s2.total, 1);
  assert.deepEqual(s2.rows[0].errorCodes.sort(), ['DE', 'DM']);
  assert.ok(e.byType.find((t) => t.code === 'DE'));
});

test('original text is preserved exactly in SKU details', async () => {
  const h = (await api('GET', '/api/skus/S2')).body.history[0];
  assert.equal(h.errorType, 'DE | DM');
  assert.equal(h.attribute, 'Colour | Weight');
  assert.equal(h.auditComments, 'Colour missing');
});

test('project: suggested from the file name, editable, used as a filter', async () => {
  assert.equal(suggestProject('Grainger 2026_NPI_Flight Group 32_Data_550 SKUs_071526_A2.ods'), 'Grainger 2026 NPI Flight Group 32');
  assert.equal(suggestProject('weird.xlsx'), 'weird');
  const meta = (await api('GET', '/api/meta')).body;
  assert.deepEqual(meta.projects.map((p) => p.name).sort(), ['Audit Test', 'only audited']);
  const t = (await api('GET', '/api/overview?project=Audit%20Test')).body;
  assert.deepEqual([t.kpis.skus, t.kpis.samples], [10, 6]);
  assert.equal(t.kpis.skusAvailable, true);
  const o = (await api('GET', '/api/overview?project=only%20audited')).body;
  assert.deepEqual([o.kpis.skus, o.kpis.skusAvailable], [2, false]);
  // rename the project of an imported file: every dashboard follows
  const up = (await api('GET', '/api/uploads')).body.find((u) => u.original_name === 'only_audited_080426.xlsx');
  assert.equal(up.project, 'only audited');
  assert.equal((await api('PATCH', `/api/uploads/${up.id}/project`, { project: 'Audit Test' })).status, 200);
  assert.deepEqual((await api('GET', '/api/meta')).body.projects.map((p) => [p.name, p.files]), [['Audit Test', 2]]);
  assert.equal((await api('GET', '/api/overview?project=Audit%20Test')).body.kpis.skus, 12);
  assert.equal((await api('PATCH', `/api/uploads/${up.id}/project`, { project: '  ' })).status, 400);
});

test('common search: people (by role), projects, files and SKU IDs', async () => {
  const s = (await api('GET', '/api/search?q=an')).body;
  assert.deepEqual(s.people.map((p) => [p.name, p.role]), [['Ann', 'content']]);
  assert.deepEqual((await api('GET', '/api/search?q=bob')).body.people.map((p) => [p.name, p.role]), [['Bob', 'auditor']]);
  assert.deepEqual((await api('GET', '/api/search?q=audit')).body.projects.map((p) => p.name), ['Audit']); // projects are listed by their first word only
  assert.ok((await api('GET', '/api/search?q=080326')).body.files.length === 1);
  assert.deepEqual((await api('GET', '/api/search?q=s1')).body.skus.map((x) => x.skuId), ['S1', 'S10']);
  const none = (await api('GET', '/api/search?q=a')).body;                     // one letter is too short
  assert.deepEqual([none.people.length, none.skus.length], [0, 0]);
  assert.equal((await api('GET', '/api/search?q=zzzzqq')).body.people.length, 0);
});

test('Top 3 lists: product = at most 3 people at or under the target, lowest error % first; audit = most SKUs with errors found', async () => {
  const first = (await api('GET', '/api/overview')).body.top;
  assert.deepEqual(first.content, []);   // nobody has 5 audited SKUs yet
  assert.equal(first.ranked, 0);
  await api('PUT', '/api/settings', { minSample: 2, errorTargetPct: 100 });   // everybody is "under" a 100 % target
  const top = (await api('GET', '/api/overview')).body.top;
  assert.ok(top.content.length >= 2 && top.content.length <= 3, `got ${top.content.length}`);
  const rates = top.content.map((c) => c.errorRate);
  assert.deepEqual(rates, [...rates].sort((a, b) => a - b));
  assert.deepEqual(top.content.map((c) => c.rank), top.content.map((_, i) => i + 1));
  assert.ok(top.audit.length >= 1 && top.audit.length <= 3);
  const found = top.audit.map((a) => a.classifications);
  assert.deepEqual(found, [...found].sort((a, b) => b - a));           // most error types found first
  assert.ok(found.every((n) => n > 0));                                // an auditor who found nothing is never listed
  assert.equal(top.audit[0].name, 'Bob');
  assert.ok(top.audit[0].skusAudited >= 6);
  // a target of 0 % leaves only people with no errors at all; the list shrinks but never shows anybody above the target
  await api('PUT', '/api/settings', { errorTargetPct: 0 });
  const strict = (await api('GET', '/api/overview')).body.top;
  assert.ok(strict.content.every((c) => c.errorRate <= 0));
  assert.ok(strict.ranked >= 2);                                       // people are ranked, they are just not under the target
  await api('PUT', '/api/settings', { minSample: 5, errorTargetPct: 10 });
});

// ---- attribute-based numbers (the one exception to "A:N only": the Att n / Raw Val n / Build Val n columns are COUNTED) ----
const slotHead = (n) => Array.from({ length: n }, (_, i) => [`Att ${i + 1}`, `Raw Val ${i + 1}`, `Build Val ${i + 1}`, `UOM ${i + 1}`]).flat();
// slots: [[attributeName, raw, build], ...]
const arow = (sku, builder, sample, auditor, err, attr, slots) => [...row(sku, builder, sample, auditor, err, attr), 'decoy', ...slots.flatMap(([a, r = '', b = '']) => [a, r, b, ''])];
const attrBook = (withAtt, pre = '') => xlsx([['Data', [withAtt ? [...HEAD, 'Manufacturer', ...slotHead(3)] : HEAD, ...[
  ['T1', 'Ann', 'FA', 'Bob', 'DM', 'Colour', [['Colour'], ['Weight', '5'], ['Size', '', 'L']]],          // 2 enriched; Colour flagged and empty
  ['T2', 'Ann', 'FA', 'Bob', '', '', [['Colour', 'red'], ['Weight'], ['Size']]],                          // 1 enriched
  ['T3', 'Ann', '', '', '', '', [['Colour', 'blue'], ['Weight', '2']]],                                   // 2 enriched, not audited
  ['T4', 'Cy', 'FA', 'Bob', 'DE', 'Source', [['Colour', 'x']]],                                           // 1 enriched; "Source" is not an attribute
].map(([s, b, sm, a, e, at, sl]) => (withAtt ? arow(pre + s, b, sm, a, e, at, sl) : row(pre + s, b, sm, a, e, at)))]]]);

test('attribute based: enriched, audited, with errors, error % - per person, overall, and not available without the columns', async () => {
  const up = await api('POST', '/api/uploads', form('Attr_Check_080526.xlsx', attrBook(true)));
  const a = up.body.files[0].analysis;
  assert.equal(a.dataChecks.attributes.columnsFound, true);
  assert.equal(a.dataChecks.attributes.slots, 3);
  assert.equal(a.dataChecks.attributes.enrichedTotal, 6);
  assert.equal((await api('POST', `/api/uploads/${up.body.files[0].id}/commit`, {})).status, 200);
  const q = '?project=Attr%20Check';
  const o = (await api('GET', `/api/overview${q}`)).body.kpis;
  assert.deepEqual([o.skus, o.samples, o.errorSkus], [4, 3, 2]);                 // SKU based numbers are unchanged by the attribute columns
  assert.deepEqual([o.attrsAvailable, o.attrsEnriched, o.attrsAudited, o.attrErrors, o.otherFieldErrors, o.attrErrorRate], [true, 6, 5, 1, 1, 20]);
  const m = Object.fromEntries((await api('GET', `/api/content-team${q}`)).body.members.map((x) => [x.name, x]));
  assert.deepEqual([m.Ann.attrsEnriched, m.Ann.attrsAudited, m.Ann.attrErrors, m.Ann.attrErrorRate], [5, 4, 1, 25]);
  assert.deepEqual([m.Cy.attrsEnriched, m.Cy.attrsAudited, m.Cy.attrErrors, m.Cy.otherFieldErrors, m.Cy.attrErrorRate], [1, 1, 0, 1, 0]);
  const au = (await api('GET', `/api/audit-team${q}`)).body.auditors[0];
  assert.deepEqual([au.name, au.attrsAudited, au.attrErrors], ['Bob', 5, 1]);
  // files without the attribute columns: error attributes still counted from column F, everything else "Not available"
  const old = (await api('GET', '/api/overview?project=Audit%20Test')).body.kpis;
  assert.deepEqual([old.attrsAvailable, old.attrsEnriched, old.attrsAudited, old.attrErrorRate], [false, null, null, null]);
  assert.ok(old.attrErrors >= 4);
  // mixing a file that has the columns with files that have not: the numbers use ONLY the files that have them, and say so
  const mixed = (await api('GET', '/api/overview')).body;
  assert.deepEqual([mixed.kpis.attrsAvailable, mixed.kpis.attrsPartial, mixed.kpis.attrsEnriched, mixed.kpis.attrCoverage.skus], [true, true, 6, 4]);
  assert.ok(mixed.kpis.attrCoverage.of > 4);
  const names = mixed.attrMissingFiles.map((f) => f.name);
  assert.ok(names.includes('Audit_Test_080326.xlsx') && !names.includes('Attr_Check_080526.xlsx'), 'files without attribute data are listed');
  assert.deepEqual((await api('GET', `/api/overview${q}`)).body.attrMissingFiles, []);
  assert.ok((await api('GET', '/api/uploads')).body.find((u) => u.original_name === 'Audit_Test_080326.xlsx').no_attr > 0);
});

test('re-uploading an older file WITH the attribute columns fills them in (updated details, no duplicates)', async () => {
  const first = await api('POST', '/api/uploads', form('Refill_080626.xlsx', attrBook(false, 'R')));
  await api('POST', `/api/uploads/${first.body.files[0].id}/commit`, { project: 'Refill' });
  assert.equal((await api('GET', '/api/overview?project=Refill')).body.kpis.attrsAvailable, false);
  const again = await api('POST', '/api/uploads', form('Refill_080626.xlsx', attrBook(true, 'R')));
  const a = again.body.files[0].analysis;
  assert.equal(a.counts.changed, 4);                                              // same findings, new detail: attributes enriched
  assert.equal(a.counts.new, 0);
  assert.ok(a.review.every((r) => r.diff.some((d) => d.field === 'Attributes enriched')));
  const c = await api('POST', `/api/uploads/${again.body.files[0].id}/commit`, { project: 'Refill' });
  assert.deepEqual([c.body.imported, c.body.updated], [0, 4]);
  const k = (await api('GET', '/api/overview?project=Refill')).body.kpis;
  assert.deepEqual([k.skus, k.attrsAvailable, k.attrsEnriched, k.attrErrors], [4, true, 6, 1]);
});
