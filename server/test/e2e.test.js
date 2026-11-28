// End-to-end test: real HTTP server, in-memory database, the real sample workbook.
// Run:  npm test      (skips automatically if the sample .ods is not next to the project folder)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seedReferenceData } from '../src/services/settings.js';
import { config } from '../src/config.js';
import { generateDueWeeklyReports } from '../src/services/reports.js';
import { isLocalRequest } from '../src/lib/local.js';
import { ORIGINALS_DIR } from '../src/services/originals.js';

process.env.AUDIT_NO_LAUNCH = '1'; // tests never start Excel

const SAMPLE = fs.readdirSync(path.join(config.root, '..')).find((f) => /\.ods$/i.test(f));
const samplePath = SAMPLE && path.join(config.root, '..', SAMPLE);
const skip = !samplePath;

let db, server, base; let cookie = '';
const H = { 'x-requested-with': 'audit-app' };
async function api(method, url, body, { raw = false, headers = {} } = {}) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + url, { method, headers: { ...H, ...(body && !isForm ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  if (raw) return res;
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const form = (name, buf) => { const f = new FormData(); f.append('files', new Blob([buf]), name); return f; };

/** Build an .xlsx containing only the Data sheet of the sample, with edits applied by `edit(rows)` */
function variant(edit) {
  const wb = XLSX.read(fs.readFileSync(samplePath), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Data, { header: 1, defval: '', raw: false }).map((r) => r.slice(0, 14));
  edit(rows);
  const out = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(rows), 'Data');
  return XLSX.write(out, { type: 'buffer', bookType: 'xlsx' });
}

before(async () => {
  if (skip) return;
  db = await openDb({ client: 'sqlite', path: ':memory:' });
  await seedReferenceData(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); });

const t = (name, fn) => test(name, { skip }, fn);

t('first run: setup creates the Admin, then API requires sign-in', async () => {
  assert.equal((await api('GET', '/api/overview')).status, 401);
  assert.equal((await api('GET', '/api/auth/status')).body.needsSetup, true);
  assert.equal((await api('POST', '/api/auth/setup', { username: 'admin', displayName: 'Admin', password: 'short' })).status, 400);
  assert.equal((await api('POST', '/api/auth/setup', { username: 'admin', displayName: 'Admin', password: 'correct-horse-9' })).status, 201);
  assert.equal((await api('POST', '/api/auth/setup', { username: 'x2x', displayName: 'X', password: 'correct-horse-9' })).status, 409);
  assert.equal((await api('GET', '/api/overview', null, { headers: {} })).status, 200);
  // CSRF header guard
  const r = await api('POST', '/api/auth/logout', null, { raw: true, headers: { 'x-requested-with': '' } });
  assert.equal(r.status, 403);
});

t('preview of the sample workbook: structure, validation and cross-check against its own summary', async () => {
  const res = await api('POST', '/api/uploads', form(SAMPLE, fs.readFileSync(samplePath)));
  assert.equal(res.status, 201);
  const a = res.body.files[0].analysis;
  assert.equal(a.sheet.used, 'Data');
  assert.deepEqual(a.columns.missingRequired, []);
  assert.equal(a.counts.rowsRead, 555);
  assert.equal(a.upload.auditDate, '2026-07-15', 'date comes from the file name 071526 = 15 Jul 2026');
  assert.equal(a.computed.samples, 104);
  assert.equal(a.computed.errorSkus, 31);
  assert.equal(a.computed.classifications, 34);
  assert.equal(a.counts.new, 555);
  // everything comes from columns A:N only; the workbook's own "Error" summary sheet is neither read nor offered as a source
  assert.equal(a.sheet.options.length, 1, 'only the real audit table is a candidate');
  assert.equal(a.crossCheck, undefined, 'no summary-sheet figures are used');
  const d = a.dataChecks;
  assert.equal(d.totalSkusAvailable, true);
  assert.equal(d.extraClassifications, 3);                    // 34 classifications on 31 SKUs
  assert.equal(d.multiErrorSkus.length, 2);
  assert.deepEqual(d.unrecognisedCodes, []);
  assert.ok(Object.values(a.columns.found).every((v) => /^[A-N]: /.test(v)), 'every column comes from A:N');
  globalThis.__upId = res.body.files[0].id;
});

t('import is blocked without an audit date and works with one; numbers match the sample', async () => {
  const id = globalThis.__upId;
  const c = await api('POST', `/api/uploads/${id}/commit`, { decisions: {} });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.imported, 555);

  const o = (await api('GET', '/api/overview')).body;
  assert.equal(o.kpis.skus, 555);
  assert.equal(o.kpis.samples, 104);
  assert.equal(o.kpis.errorSkus, 31);
  assert.equal(o.kpis.classifications, 34);
  assert.equal(o.kpis.errorRate, 29.81);
  assert.equal(o.kpis.sampleRate, 18.74);                       // 104/555 (the workbook's 18.91 uses 550)
  assert.equal(o.reconciliation.extra, 3);
  // attribute based (Att n / Raw Val n / Build Val n columns counted): 4957 attributes carry a value in this file; 45 attribute names are
  // named in "Attribute/Field" of error SKUs, 43 of them are real attributes of the SKU and 2 are other fields ("Source").
  // Since Nov 2026 the attributes the auditor names in the Audit Comments are added too (81 more, e.g. 433NA1 "…|Filtration Type>>…"): 124.
  assert.deepEqual([o.kpis.attrsAvailable, o.kpis.attrsEnriched, o.kpis.attrErrors, o.kpis.otherFieldErrors], [true, 4957, 124, 2]);
  assert.ok(o.kpis.attrsAudited >= 1 && o.kpis.attrErrorRate > 0 && o.kpis.attrErrorRate < 100);
  assert.equal(o.reconciliation.multiErrorSkus.length, 2);      // DE|DM and DE|DM|UE  (SG|DM has one real error)

  const team = (await api('GET', '/api/content-team')).body.members;
  const by = Object.fromEntries(team.map((m) => [m.name, m]));
  assert.deepEqual([by['Jaya Vaishnavi M'].samples, by['Jaya Vaishnavi M'].errorSkus, by['Jaya Vaishnavi M'].errorRate], [15, 8, 53.33]);
  assert.deepEqual([by['Poorani D'].samples, by['Poorani D'].errorSkus, by['Poorani D'].errorRate], [23, 1, 4.35]);
  assert.deepEqual([by['Subaranjana T'].samples, by['Subaranjana T'].errorSkus, by['Subaranjana T'].errorRate], [4, 3, 75]);
  assert.equal(by['Vishnu Kannan GVS'].classifications, 5);     // 3 SKUs but 5 classifications
  assert.equal(by['Vishnu Kannan GVS'].errorSkus, 3);
  assert.equal(by['Subaranjana T'].level, 'few');               // 4 samples < minSample 5
  assert.equal(by['Poorani D'].level, 'good');
  assert.equal(team.reduce((a, m) => a + m.errorSkus, 0), 31);

  const au = (await api('GET', '/api/audit-team')).body.auditors;
  assert.equal(au.length, 4);
  assert.equal(au.reduce((a, x) => a + x.records, 0), 104);
  assert.ok(au.every((x) => x.errorSkus <= x.skusAudited));

  const ea = (await api('GET', '/api/errors')).body;
  assert.equal(ea.totals.classifications, 34);
  assert.deepEqual(Object.fromEntries(ea.byType.map((x) => [x.code, x.classifications])), { DM: 21, SRE: 5, DE: 4, RBE: 2, UE: 1, FE: 1 });
  assert.equal(ea.topAttributes.length, 10);
});

t('"Open in Excel": the FULL original file comes back exactly as uploaded', async () => {
  const res = await api('GET', `/api/uploads/${globalThis.__upId}/export?original=1`, null, { raw: true }); // ?original=1 = exactly as uploaded (plain download converts .ods to .xlsx - see export.test.js)
  assert.equal(res.status, 200);
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(fs.readFileSync(samplePath)));     // byte for byte: every sheet and column
  assert.match(res.headers.get('content-type'), /opendocument/);
  assert.equal((await api('GET', '/api/uploads/99999/export')).status, 404);
});

t('"Open in Excel" for a file uploaded before copies were kept: the rows come back as .xlsx with the original columns A:N first and the original text', async () => {
  const up = await db.get('SELECT file_hash FROM uploads WHERE id = ?', [globalThis.__upId]);
  const kept = path.join(ORIGINALS_DIR, `${up.file_hash}.ods`); const away = `${kept}.away`;
  fs.renameSync(kept, away);
  try {
  const res = await api('GET', `/api/uploads/${globalThis.__upId}/export`, null, { raw: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /\(from dashboard\)\.xlsx/);
  const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: 'buffer' });
  assert.deepEqual(wb.SheetNames, ['Audit data', 'About this file']);
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets['Audit data'], { header: 1 });
  assert.deepEqual(aoa[0].slice(0, 14), ['SKU ID', 'SKU Build By', 'Sample', 'Audit By', 'Error Type', 'Attribute/Field', 'Audit Comments', 'PT Status', 'PT Comments', 'Re-Audit Comments', 'Gap/Similar', 'PT Response', 'CFB Attribute', 'CFB Comments']);
  assert.equal(aoa.length, 556);                                           // header + 555 SKU rows
  assert.ok(aoa.some((r) => r[0] === '433TY2' && r[4] === 'DE | DM'));     // the original "DE | DM" text, not reformatted
  assert.equal(aoa.filter((r, i) => i > 0 && r[1] && r[14] === '2026-07-15').length, 555);   // builder + the audit date entered at upload
  const withTax = aoa.slice(1).filter((r) => r[15]);
  assert.equal(withTax.length, 555);
  assert.ok(withTax.every((r) => r[16] === String(r[15]).split('>')[0].trim()));            // Category (L1) = text before the first ">"
  } finally { fs.renameSync(away, kept); }
});

t('"Open in Excel" on the same PC: saves a copy and asks Windows to open it (launching is switched off in tests); other computers are never triggered', async () => {
  const r = await api('POST', `/api/uploads/${globalThis.__upId}/open-local`);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.opened, r.body.launched], [true, false]);
  assert.ok(fs.existsSync(r.body.file));
  assert.equal(r.body.original, true);
  assert.match(r.body.file, / \d\d-\d\d-\d\d\.ods$/);
  assert.ok(fs.readFileSync(r.body.file).equals(fs.readFileSync(samplePath)));
  fs.unlinkSync(r.body.file);
  // the guard: only a browser on this very computer, typing localhost, with no proxy in between
  const fake = (ra, host, xff) => ({ socket: { remoteAddress: ra }, headers: { host, ...(xff ? { 'x-forwarded-for': xff } : {}) } });
  assert.equal(isLocalRequest(fake('127.0.0.1', 'localhost:3000')), true);
  assert.equal(isLocalRequest(fake('::1', '127.0.0.1:3000')), true);
  assert.equal(isLocalRequest(fake('192.168.1.20', 'localhost:3000')), false);          // another computer
  assert.equal(isLocalRequest(fake('127.0.0.1', 'audit.company.com')), false);          // reached through a real server name
  assert.equal(isLocalRequest(fake('127.0.0.1', 'localhost', '10.0.0.5')), false);      // behind a proxy
  assert.equal((await api('POST', '/api/uploads/99999/open-local')).status, 404);
});

t('uploading the same file again: everything is recognised as duplicate and nothing is added twice', async () => {
  const res = await api('POST', '/api/uploads', form(SAMPLE, fs.readFileSync(samplePath)));
  const a = res.body.files[0].analysis;
  assert.ok(a.sameFileBefore, 'warns that the exact file was imported before');
  assert.equal(a.counts.identical, 555);
  assert.equal(a.counts.new, 0);
  const c = await api('POST', `/api/uploads/${res.body.files[0].id}/commit`, {});
  assert.deepEqual(c.body, { imported: 0, updated: 0, skipped: 555 });
  assert.equal((await api('GET', '/api/overview')).body.kpis.skus, 555);
});

t('a later version with progress is detected as changed: update vs skip is the reviewer\'s choice', async () => {
  const buf = variant((rows) => {
    const h = rows[0]; const ci = (n) => h.indexOf(n);
    const i = rows.findIndex((r, k) => k > 0 && /not updated/i.test(r[ci('PT Status')]));
    rows[i][ci('PT Status')] = 'Updated';
    globalThis.__changedSku = rows[i][0];
  });
  const res = await api('POST', '/api/uploads', form('Audit_File_071626.xlsx', buf));
  const a = res.body.files[0].analysis;
  assert.equal(a.upload.auditDate, '2026-07-16');
  assert.equal(a.counts.changed, 1);
  assert.equal(a.counts.identical, 554);
  const item = a.review.find((x) => x.verdict === 'changed');
  assert.equal(item.skuId, globalThis.__changedSku);
  assert.ok(item.diff.some((d) => d.field === 'PT Status'));
  // reviewer chooses to skip first -> no change
  const before = (await api('GET', '/api/follow-ups')).body;
  const skipRes = await api('POST', `/api/uploads/${res.body.files[0].id}/commit`, { decisions: { [item.rowNo]: 'skip' } });
  assert.equal(skipRes.body.updated, 0);
  assert.deepEqual((await api('GET', '/api/follow-ups')).body.pt, before.pt);
  // same change again, this time accepting the update
  const res2 = await api('POST', '/api/uploads', form('Audit_File_071626.xlsx', buf));
  const c = await api('POST', `/api/uploads/${res2.body.files[0].id}/commit`, { decisions: {} });
  assert.equal(c.body.updated, 1);
  const after = (await api('GET', '/api/follow-ups')).body;
  assert.equal(after.pt.pending, before.pt.pending - 1);
  assert.equal(after.pt.completed, before.pt.completed + 1);
  // SKU count did not grow
  assert.equal((await api('GET', '/api/overview')).body.kpis.skus, 555);
});

t('a second day\'s file with new SKUs adds records; a SKU with several errors is never dropped', async () => {
  const buf = variant((rows) => { for (let k = 1; k < rows.length; k++) rows[k][0] = 'N' + rows[k][0]; });
  const res = await api('POST', '/api/uploads', form('Next_Day_072226.xlsx', buf));
  const a = res.body.files[0].analysis;
  assert.equal(a.counts.new, 555);
  const c = await api('POST', `/api/uploads/${res.body.files[0].id}/commit`, {});
  assert.equal(c.body.imported, 555);
  const o = (await api('GET', '/api/overview')).body;
  assert.equal(o.kpis.skus, 1110);
  assert.equal(o.kpis.classifications, 68);
  assert.equal(o.kpis.errorSkus, 62);
  // File filter: one uploaded file at a time
  const uploads = (await api('GET', '/api/meta')).body.uploads;
  const nextDay = uploads.find((u) => u.name === 'Next_Day_072226.xlsx');
  assert.ok(nextDay && uploads.length >= 2);
  assert.equal(nextDay.auditDate, '2026-07-22');
  const one = (await api('GET', `/api/overview?uploadId=${nextDay.id}`)).body;
  assert.deepEqual([one.kpis.skus, one.kpis.samples, one.kpis.errorSkus, one.kpis.classifications], [555, 104, 31, 34]);
  assert.deepEqual(one.weekly.map((w) => w.week), ['2026-07-20']);
  assert.equal((await api('GET', `/api/records?uploadId=${nextDay.id}&pageSize=5`)).body.total, 555);
  assert.equal((await api('GET', `/api/content-team?uploadId=${nextDay.id}`)).body.team.samples, 104);
  const weeks = o.weekly.map((w) => w.week);
  assert.deepEqual(weeks, ['2026-07-13', '2026-07-20']);
  // week filter
  const wk = (await api('GET', '/api/overview?week=2026-07-20')).body;
  assert.equal(wk.kpis.samples, 104);
  assert.equal(wk.previous.samples, 104, 'a week is compared with the week before it');
  assert.ok(wk.weekCompare);
  // date range filter gives previous-period comparison
  const rng = (await api('GET', '/api/overview?from=2026-07-20&to=2026-07-26')).body;
  assert.equal(rng.previous.samples, 104);
});

t('filters: member, auditor, error type, PT status, SKU search, pagination, export, SKU history', async () => {
  const meta = (await api('GET', '/api/meta')).body;
  const jaya = meta.builders.find((b) => b.name === 'Jaya Vaishnavi M');
  const f = (await api('GET', `/api/content-team?builderId=${jaya.id}`)).body.members;
  assert.equal(f.length, 1);
  assert.equal(f[0].errorSkus, 16);                              // 8 per file x 2 files
  const dm = (await api('GET', '/api/records?errorCode=DM&pageSize=10')).body;
  assert.equal(dm.rows.length, 10);
  assert.ok(dm.total >= 36);
  assert.ok(dm.rows.every((r) => r.codes.includes('DM')));
  const none = (await api('GET', '/api/records?ptStatus=__none__&errorCode=DM')).body;
  assert.ok(none.rows.every((r) => !r.ptStatus));
  const q = (await api('GET', '/api/records?q=433ty2')).body;
  assert.equal(q.total, 2);
  const sku = (await api('GET', '/api/skus/433TY2')).body;
  assert.equal(sku.history.length, 1);
  assert.equal(sku.history[0].codes.length, 2);
  const bad = await api('GET', '/api/overview?from=2026-13-40');
  assert.equal(bad.status, 400);
  const ex = await api('GET', '/api/records/export?errorCode=DM', null, { raw: true });
  assert.equal(ex.status, 200);
  const wb = XLSX.read(Buffer.from(await ex.arrayBuffer()), { type: 'buffer' });
  assert.equal(XLSX.utils.sheet_to_json(wb.Sheets['SKU Audit Details']).length, dm.total);
});

t('follow-up counts follow the Settings rules and never invent statuses', async () => {
  const fu = (await api('GET', '/api/follow-ups')).body;
  assert.ok(fu.pt.pending > 0 && fu.pt.completed > 0);
  assert.equal(fu.pt.unmapped, 0);
  assert.ok(fu.items.every((i) => i.ptClass !== 'pending' || i.ageDays != null));
  const s = (await api('GET', '/api/settings')).body.settings;
  // change meaning of "checked": completed -> pending, counts must move
  const upd = await api('PUT', '/api/settings', { ptStatusMap: { ...s.ptStatusMap, checked: 'pending' } });
  assert.equal(upd.status, 200);
  const fu2 = (await api('GET', '/api/follow-ups')).body;
  assert.ok(fu2.pt.pending > fu.pt.pending);
  await api('PUT', '/api/settings', { ptStatusMap: s.ptStatusMap });
  assert.deepEqual((await api('GET', '/api/follow-ups')).body.pt, fu.pt);
});

t('suggestions come with evidence from the real numbers', async () => {
  const s = (await api('GET', '/api/suggestions')).body;
  assert.ok(s.suggestions.length > 0);
  assert.ok(s.suggestions.every((x) => x.title && x.detail && x.action && x.evidence));
  assert.ok(s.suggestions.some((x) => x.id === 'top-error-type' && /Data Missing/.test(x.title)));
  assert.equal(s.period.from, '2026-07-20');
});

t('weekly report: generated for a finished week, downloadable as Excel and PDF, custom range works', async () => {
  const made = await generateDueWeeklyReports(db, new Date('2026-07-28T10:00:00Z'));
  assert.equal(made.length, 2);                                 // weeks of 13 Jul and 20 Jul
  assert.equal((await generateDueWeeklyReports(db, new Date('2026-07-28T10:00:00Z'))).length, 0, 'not generated twice');
  assert.equal((await generateDueWeeklyReports(db, new Date('2026-07-20T00:30:00Z'))).length, 0);
  const list = (await api('GET', '/api/reports')).body;
  assert.equal(list.length, 2);
  const wk2 = list.find((r) => r.period_start === '2026-07-20');
  const rep = (await api('GET', `/api/reports/${wk2.id}`)).body;
  assert.equal(rep.overall.samples, 104);
  assert.equal(rep.overall.errorSkus, 31);
  assert.equal(rep.comparison.hasPrevious, true);
  assert.equal(rep.previous.from, '2026-07-13');
  assert.equal(rep.comparison.errorRate, 0);
  assert.equal(rep.topErrorTypes.length, 5);
  assert.equal(rep.topAttributes.length, 5);
  const x = await api('GET', `/api/reports/${wk2.id}/excel`, null, { raw: true });
  const wb = XLSX.read(Buffer.from(await x.arrayBuffer()), { type: 'buffer' });
  assert.deepEqual(wb.SheetNames, ['Summary', 'Product Team', 'Product Team - attributes', 'Audit Team', 'Top Errors', 'Top Attributes', 'Suggestions']);
  const p = await api('GET', `/api/reports/${wk2.id}/pdf`, null, { raw: true });
  const pdf = Buffer.from(await p.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 3000);
  const custom = await api('POST', '/api/reports', { from: '2026-07-14', to: '2026-07-21' });
  assert.equal(custom.status, 201);
  assert.equal((await api('POST', '/api/reports', { from: '2026-07-21', to: '2026-07-14' })).status, 400);
});

t('reports: one file, no empty reports, the list shows the numbers, delete', async () => {
  const file = await api('POST', '/api/reports', { kind: 'file', uploadId: globalThis.__upId });
  assert.equal(file.status, 201);
  const rep = (await api('GET', `/api/reports/${file.body.id}`)).body;
  assert.equal(rep.kind, 'file'); assert.equal(rep.scope.uploadId, globalThis.__upId);
  assert.equal(rep.period.label, SAMPLE);
  assert.equal(rep.overall.samples, (await api('GET', `/api/overview?uploadId=${globalThis.__upId}`)).body.kpis.samples);   // same numbers as the dashboard for that file
  const pdf = await api('GET', `/api/reports/${file.body.id}/pdf`, null, { raw: true });
  assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-disposition'), /audit-report-.*\.pdf/);
  const row = (await api('GET', '/api/reports')).body.find((r) => r.id === file.body.id);
  assert.deepEqual([row.kind, row.fileName, row.samples, row.errorSkus], ['file', SAMPLE, rep.overall.samples, rep.overall.errorSkus]);
  // a whole month: 1st to last day, compared with the month before, listed as a month report
  const month = await api('POST', '/api/reports', { kind: 'custom', from: '2026-07-01', to: '2026-07-31' });
  assert.equal(month.status, 201);
  const mr = (await api('GET', `/api/reports/${month.body.id}`)).body;
  assert.deepEqual([mr.scope.type, mr.previous.from, mr.previous.to], ['month', '2026-06-01', '2026-06-30']);
  assert.equal((await api('GET', '/api/reports')).body.find((r) => r.id === month.body.id).kind, 'month');
  const feb = await api('POST', '/api/reports', { kind: 'custom', from: '2026-07-01', to: '2026-07-20' });   // part of a month stays "dates"
  assert.equal((await api('GET', `/api/reports/${feb.body.id}`)).body.scope.type, 'dates');
  await api('DELETE', `/api/reports/${month.body.id}`); await api('DELETE', `/api/reports/${feb.body.id}`);
  // a week / dates without any audit data: refused with a plain reason, nothing saved
  const before = (await api('GET', '/api/reports')).body.length;
  const empty = await api('POST', '/api/reports', { kind: 'weekly', from: '2030-01-07', to: '2030-01-07' });
  assert.equal(empty.status, 400); assert.match(empty.body.error, /no audit data/i);
  assert.equal((await api('POST', '/api/reports', { kind: 'file' })).status, 400);
  assert.equal((await api('POST', '/api/reports', { kind: 'file', uploadId: 99999 })).status, 400);
  assert.equal((await api('GET', '/api/reports')).body.length, before);
  // delete
  assert.equal((await api('DELETE', `/api/reports/${file.body.id}`)).status, 200);
  assert.equal((await api('GET', `/api/reports/${file.body.id}`)).status, 404);
  assert.equal((await api('DELETE', `/api/reports/${file.body.id}`)).status, 404);
});

t('bad files give clear messages and are listed in the upload history', async () => {
  const fake = await api('POST', '/api/uploads', form('notes.xlsx', Buffer.from('this is not a spreadsheet')));
  assert.equal(fake.body.files[0].failed, true);
  assert.match(fake.body.files[0].error, /does not look like a real spreadsheet/);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name', 'Value'], ['a', 1]]), 'Sheet1');
  const nocol = await api('POST', '/api/uploads', form('wrong.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })));
  assert.match(nocol.body.files[0].error, /audit column headings \(SKU ID and SKU Build By, …\) in columns A to N/);
  const txt = await api('POST', '/api/uploads', form('data.txt', Buffer.from('x')));
  assert.equal(txt.status, 400);
  const hist = (await api('GET', '/api/uploads')).body;
  assert.ok(hist.some((h) => h.status === 'failed' && h.error));
  assert.ok(hist.some((h) => h.status === 'imported'));
  const rep = await api('GET', `/api/uploads/${globalThis.__upId}/report`, null, { raw: true });
  assert.equal(rep.status, 200);
});

t('missing audit date blocks import; undo removes an import', async () => {
  const buf = variant((rows) => { for (let k = 1; k < rows.length; k++) rows[k][0] = 'Z' + rows[k][0]; });
  const res = await api('POST', '/api/uploads', form('no_date_in_name.xlsx', buf));
  const f = res.body.files[0];
  assert.ok(f.analysis.blockers.some((b) => /audit date/i.test(b)));
  assert.equal((await api('POST', `/api/uploads/${f.id}/commit`, {})).status, 400);
  const c = await api('POST', `/api/uploads/${f.id}/commit`, { auditDate: '2026-08-03' });
  assert.equal(c.status, 200);
  assert.equal((await api('GET', '/api/overview')).body.kpis.skus, 1665);
  assert.equal((await api('POST', `/api/uploads/${f.id}/undo`, {})).status, 200);
  assert.equal((await api('GET', '/api/overview')).body.kpis.skus, 1110);
});

t('roles: viewer is read-only, leader can upload but not change settings, admin manages users', async () => {
  const mk = (username, role) => api('POST', '/api/users', { username, name: username, role, password: 'another-long-pass-1' });
  assert.equal((await mk('vera', 'viewer')).status, 201);
  assert.equal((await mk('lena', 'leader')).status, 201);
  assert.equal((await api('POST', '/api/users', { username: 'weak', name: 'w', role: 'viewer', password: 'short' })).status, 400);
  const adminCookie = cookie;
  cookie = '';
  assert.equal((await api('POST', '/api/auth/login', { username: 'vera', password: 'wrong' })).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { username: 'vera', password: 'another-long-pass-1' })).status, 200);
  assert.equal((await api('GET', '/api/overview')).status, 200);
  assert.equal((await api('POST', '/api/uploads', form(SAMPLE, fs.readFileSync(samplePath)))).status, 403);
  assert.equal((await api('PUT', '/api/settings', { minSample: 3 })).status, 403);
  assert.equal((await api('GET', '/api/users')).status, 403);
  assert.equal((await api('POST', '/api/reports', { from: '2026-07-13', to: '2026-07-19' })).status, 403);
  cookie = '';
  await api('POST', '/api/auth/login', { username: 'lena', password: 'another-long-pass-1' });
  assert.equal((await api('POST', '/api/uploads', form(SAMPLE, fs.readFileSync(samplePath)))).status, 201);
  assert.equal((await api('PUT', '/api/settings', { minSample: 3 })).status, 403);
  assert.equal((await api('POST', '/api/reports', { from: '2026-07-13', to: '2026-07-19' })).status, 201);
  cookie = adminCookie;
  assert.equal((await api('PUT', '/api/settings', { minSample: 3 })).status, 200);
  const team = (await api('GET', '/api/content-team')).body;
  assert.equal(team.members.find((m) => m.name === 'Subaranjana T').level, 'improve'); // 4 samples is now enough
  assert.equal((await api('PUT', '/api/settings', { minSample: 99999 })).status, 400);
  await api('PUT', '/api/settings', { minSample: 5 });
  // cannot remove the last admin
  const users = (await api('GET', '/api/users')).body;
  const admin = users.find((u) => u.role === 'admin');
  assert.equal((await api('PATCH', `/api/users/${admin.id}`, { active: false })).status, 400);
});
