import { Router } from 'express';
import * as XLSX from 'xlsx';
import { wrap, HttpError } from '../lib/http.js';
import { need } from './auth.js';
import { parseFilters, loadRecords, dataBounds } from '../analytics/loader.js';
import { overview, contentTeam, auditTeam, errorAnalysis, followUps, weeklyTrend, dailyTrend, metrics, byErrorsFound } from '../analytics/compute.js';
import { buildSuggestions } from '../analytics/suggestions.js';
import { getSettings, getErrorTypes } from '../services/settings.js';
import { nowIn, weekStart, weekEnd, previousPeriod, fmtRange } from '../lib/dates.js';
import { groupProjects } from '../lib/project.js';
import { sourceChecks, fetchSourcePdf } from '../services/sources.js';

async function ctx(db, req, { text = false } = {}) {
  const f = parseFilters(req.query);
  const [settings, errTypes] = await Promise.all([getSettings(db), getErrorTypes(db)]);
  const recs = await loadRecords(db, f, errTypes, { text });
  return { f, settings, errTypes, recs, today: nowIn(settings.timezone).date };
}

/** Files in the current selection that were imported without attribute columns (they are left out of the attribute numbers). */
async function attrMissingFiles(db, recs) {
  const ids = [...new Set(recs.filter((r) => r.attrsEnriched == null).map((r) => r.uploadId))];
  if (!ids.length) return [];
  return (await db.all(`SELECT id, original_name AS name FROM uploads WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY audit_date, id`, ids)).map((u) => ({ id: u.id, name: u.name }));
}

export function dataRouter(db) {
  const r = Router();
  r.use(need('view'));

  r.get('/meta', wrap(async (req, res) => {
    const [settings, errTypes, bounds] = await Promise.all([getSettings(db), getErrorTypes(db), dataBounds(db)]);
    const people = (role) => db.all(`SELECT e.id, e.name FROM employees e JOIN employee_roles x ON x.employee_id = e.id WHERE x.role = ? ORDER BY e.name`, [role]);
    const weeks = (await db.all('SELECT DISTINCT week_start AS w FROM audit_records ORDER BY week_start DESC')).map((x) => x.w);
    const months = (await db.all('SELECT DISTINCT month AS m FROM audit_records ORDER BY month DESC')).map((x) => x.m);
    const ptStatuses = (await db.all(`SELECT DISTINCT TRIM(pt_status) AS s FROM audit_records WHERE TRIM(COALESCE(pt_status,'')) <> '' ORDER BY 1`)).map((x) => x.s);
    // imported files that still have records (newest audit date first) for the "File" filter
    const uploads = (await db.all(`SELECT u.id, u.original_name, u.audit_date, u.project, COUNT(r.id) AS records FROM uploads u JOIN audit_records r ON r.upload_id = u.id
      WHERE u.status = 'imported' GROUP BY u.id, u.original_name, u.audit_date, u.project ORDER BY u.audit_date DESC, u.id DESC`)).map((u) => ({ id: u.id, name: u.original_name, auditDate: u.audit_date, project: u.project, records: u.records }));
    const projects = (await db.all(`SELECT u.project AS name, COUNT(DISTINCT u.id) AS files FROM uploads u JOIN audit_records r ON r.upload_id = u.id
      WHERE u.status = 'imported' AND u.project IS NOT NULL GROUP BY u.project ORDER BY u.project`)).map((p) => ({ name: p.name, files: p.files }));
    res.json({
      uploads, projects, projectGroups: groupProjects(projects), builders: await people('content'), auditors: await people('auditor'), weeks, months, ptStatuses, bounds,
      errorTypes: [...errTypes.values()], today: nowIn(settings.timezone).date,
      settings: { errorTargetPct: settings.errorTargetPct, minSample: settings.minSample, watchMarginPct: settings.watchMarginPct, timezone: settings.timezone, ageingWarnDays: settings.ageingWarnDays },
    });
  }));

  // One search box for the whole app: people (product team / auditors), projects, files and SKU IDs
  r.get('/search', wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ people: [], projects: [], files: [], skus: [] });
    const like = '%' + q.toLowerCase().replace(/[%_]/g, '') + '%';
    const people = await db.all(`SELECT e.id, e.name, x.role FROM employees e JOIN employee_roles x ON x.employee_id = e.id WHERE lower(e.name) LIKE ? ORDER BY e.name, x.role LIMIT 12`, [like]);
    // projects are listed by their first word only (Grainger, Analog ...), the same as the Project filter
    const projects = groupProjects(await db.all(`SELECT u.project AS name, COUNT(DISTINCT u.id) AS files FROM uploads u JOIN audit_records r ON r.upload_id = u.id
      WHERE u.status = 'imported' AND u.project IS NOT NULL GROUP BY u.project`)).filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 6);
    const files = await db.all(`SELECT u.id, u.original_name AS name, u.audit_date AS "auditDate" FROM uploads u WHERE u.status = 'imported' AND lower(u.original_name) LIKE ? ORDER BY u.audit_date DESC LIMIT 6`, [like]);
    // names in quotes: PostgreSQL would otherwise return "skuid" / "auditdate" (SQLite keeps the case either way)
    const skus = await db.all(`SELECT r.sku_id AS "skuId", b.name AS builder FROM audit_records r LEFT JOIN employees b ON b.id = r.content_employee_id
      WHERE lower(r.sku_id) LIKE ? GROUP BY r.sku_id, b.name ORDER BY r.sku_id LIMIT 8`, [like]);
    res.json({ people, projects, files, skus });
  }));

  // Champions of one week (Mon-Sat) for the floating champion button on the Overview. Ignores the page filters: it is the whole team's week.
  //   Product Team: lowest error % among people with enough audited SKUs that week (same fairness rule as everywhere).
  //   Audit Team:   the auditor who found the most error types that week (same order as the Overview "Top 3 - Audit Team"; user's rule, 2026-11-26).
  // Default = the latest week that has data (uploaded data is not always from this calendar week). Worked out fresh on every request.
  r.get('/champions', wrap(async (req, res) => {
    const [settings, errTypes] = await Promise.all([getSettings(db), getErrorTypes(db)]);
    const weeks = (await db.all('SELECT DISTINCT week_start AS w FROM audit_records ORDER BY week_start DESC LIMIT 16')).map((x) => x.w);
    if (!weeks.length) return res.json({ week: null, weeks: [], product: [], audit: [], minSample: settings.minSample, teamErrorRate: null });
    const asked = String(req.query.week || '').trim();
    const start = asked ? weekStart(parseFilters({ week: asked }).from) : weeks[0];
    const recs = await loadRecords(db, { from: start, to: weekEnd(start) }, errTypes);
    const totalRecords = recs.filter((x) => x.auditorId != null).length;
    const product = contentTeam(recs, errTypes, settings).filter((m) => m.rank != null).slice(0, 3)
      .map((m) => ({ id: m.id, name: m.name, errorRate: m.errorRate, samples: m.samples, errorSkus: m.errorSkus }));
    const audit = auditTeam(recs, errTypes).filter((a) => a.classifications > 0).sort(byErrorsFound).slice(0, 3)
      .map((a) => ({ id: a.id, name: a.name, classifications: a.classifications, errorSkus: a.errorSkus, skusAudited: a.skusAudited, records: a.records, cases: a.cases, closedCases: a.closedCases, sharePct: totalRecords ? Math.round((a.records / totalRecords) * 100) : null }));
    res.json({ week: { start, end: weekEnd(start) }, weeks, latest: start === weeks[0], teamErrorRate: metrics(recs).errorRate, minSample: settings.minSample, product, audit });
  }));

  r.get('/overview', wrap(async (req, res) => {
    const c = await ctx(db, req);
    const o = overview(c.recs, c.errTypes, c.settings, c.today);
    const w = o.weekly.filter((x) => x.samples > 0);
    o.weekCompare = w.length ? { latest: w[w.length - 1], previous: w.length > 1 ? w[w.length - 2] : null } : null;
    let previous = null;
    if (c.f.from && c.f.to) {
      const pp = previousPeriod(c.f.from, c.f.to); // a Monday-Saturday week is compared with the Monday-Saturday week before it
      // Same filters as the current numbers (project, person, error type...) so the comparison is like for like. Only the file filter is dropped: one file sits in one period.
      const pr = await loadRecords(db, { ...c.f, uploadId: null, from: pp.from, to: pp.to }, c.errTypes);
      previous = pr.length ? { ...metrics(pr), label: fmtRange(pp.from, pp.to) } : null;
    }
    res.json({ ...o, previous, target: c.settings.errorTargetPct, empty: c.recs.length === 0, attrMissingFiles: await attrMissingFiles(db, c.recs) });
  }));

  r.get('/content-team', wrap(async (req, res) => {
    const c = await ctx(db, req);
    res.json({ members: contentTeam(c.recs, c.errTypes, c.settings), team: metrics(c.recs), target: c.settings.errorTargetPct, minSample: c.settings.minSample, watchMargin: c.settings.watchMarginPct, attrMissingFiles: await attrMissingFiles(db, c.recs) });
  }));
  // The attributes marked wrong for one Product Team member, with the source links the uploaded files hold for them (same page filters).
  r.get('/content-team/:id/source-checks', wrap(async (req, res) => {
    const id = parseInt(req.params.id, 10); if (!Number.isFinite(id)) throw new HttpError(400, 'Unknown person.');
    const c = await ctx(db, { query: { ...req.query, builderId: String(id) } });
    res.json(await sourceChecks(db, c.recs));
  }));
  // The original PDF of a saved source link, for the in-app "find and highlight" view (only links saved for that record).
  r.get('/source-file', wrap(async (req, res) => {
    const id = parseInt(req.query.rec, 10); const url = String(req.query.u || '');
    if (!Number.isFinite(id) || !url) throw new HttpError(400, 'Unknown link.');
    const pdf = await fetchSourcePdf(db, id, url);
    res.set({ 'Content-Type': 'application/pdf', 'Cache-Control': 'private, max-age=600' }).send(pdf);
  }));
  r.get('/audit-team', wrap(async (req, res) => {
    const c = await ctx(db, req);
    res.json({ auditors: auditTeam(c.recs, c.errTypes), totalRecords: c.recs.filter((x) => x.auditorId != null).length, attrMissingFiles: await attrMissingFiles(db, c.recs) });
  }));
  r.get('/errors', wrap(async (req, res) => {
    const c = await ctx(db, req, { text: true });
    res.json(errorAnalysis(c.recs, c.errTypes));
  }));
  r.get('/follow-ups', wrap(async (req, res) => {
    const c = await ctx(db, req, { text: true });
    res.json({ ...followUps(c.recs, c.today, c.settings), warnDays: c.settings.ageingWarnDays, afterReaudit: !!c.errTypes.afterReaudit });
  }));
  r.get('/trend', wrap(async (req, res) => {
    const c = await ctx(db, req);
    res.json({ weekly: weeklyTrend(c.recs), daily: dailyTrend(c.recs) });
  }));

  // Suggestions compare the chosen dates with the period just before. With no dates chosen: latest week with data vs the week before.
  r.get('/suggestions', wrap(async (req, res) => {
    const f = parseFilters(req.query);
    const [settings, errTypes, bounds] = await Promise.all([getSettings(db), getErrorTypes(db), dataBounds(db)]);
    if (!bounds.last) return res.json({ period: null, suggestions: [] });
    let from = f.from, to = f.to, curLabel, prevLabel;
    if (from || to) { from = from || bounds.first; to = to || bounds.last; curLabel = 'this period'; prevLabel = 'the previous period'; }
    else { from = weekStart(bounds.last); to = weekEnd(from); curLabel = 'the latest week'; prevLabel = 'the week before'; }
    const { from: pf, to: pt } = previousPeriod(from, to);
    const base = { builderId: f.builderId, auditorId: f.auditorId };
    const [cur, prev] = [await loadRecords(db, { ...base, from, to }, errTypes), await loadRecords(db, { ...base, from: pf, to: pt }, errTypes)];
    const suggestions = await buildSuggestions({ cur: { recs: cur, label: curLabel }, prev: { recs: prev, label: prevLabel }, errTypes, s: settings, today: nowIn(settings.timezone).date });
    res.json({ period: { from, to, label: fmtRange(from, to), name: curLabel }, previous: { from: pf, to: pt, label: fmtRange(pf, pt), name: prevLabel, hasData: prev.length > 0 }, suggestions });
  }));

  /* ---- SKU audit details ---- */
  const SORT = { skuId: 'skuId', builder: 'builder', auditor: 'auditor', auditDate: 'auditDate', errorRaw: 'errorRaw', attributeField: 'attributeField', ptRaw: 'ptRaw', ptClass: 'ptClass' };
  const rowOut = (x) => ({ id: x.id, skuId: x.skuId, auditDate: x.auditDate, builder: x.builder, sampled: x.sampled, sample: x.sampleFlag, auditor: x.auditor || '', errorType: x.errorRaw, attribute: x.attributeField,
    auditComments: x.auditComments, ptStatus: x.ptRaw, ptComments: x.ptComments, reauditComments: x.reauditComments, gapSimilar: x.gapSimilar, ptResponse: x.ptResponse, cfbAttribute: x.cfbAttribute, cfbComments: x.cfbComments,
    ptClass: x.ptClass, reaudit: x.reaudit, codes: x.codes, errorCodes: x.errs,
    attributes: (x.attrInfo || []).filter((a) => a.isAttribute).map((a) => ({ name: a.name, fromComment: !!a.fromComment })) });
  const sorted = (recs, key, dir) => { const k = SORT[key] || 'auditDate'; const m = dir === 'asc' ? 1 : -1; return recs.slice().sort((a, b) => m * String(a[k] ?? '').localeCompare(String(b[k] ?? ''), undefined, { numeric: true }) || a.id - b.id); };

  r.get('/records', wrap(async (req, res) => {
    const c = await ctx(db, req, { text: true });
    const page = Math.max(1, parseInt(req.query.page, 10) || 1); const size = Math.min(200, Math.max(5, parseInt(req.query.pageSize, 10) || 25));
    const all = sorted(c.recs, req.query.sort, req.query.dir === 'asc' ? 'asc' : 'desc');
    res.json({ total: all.length, page, pageSize: size, rows: all.slice((page - 1) * size, page * size).map(rowOut) });
  }));
  r.get('/records/export', wrap(async (req, res) => {
    const c = await ctx(db, req, { text: true });
    const all = sorted(c.recs, req.query.sort, req.query.dir === 'asc' ? 'asc' : 'desc');
    if (all.length > 100000) throw new HttpError(413, 'Too many rows to export at once. Narrow the filters.');
    const head = ['SKU ID', 'Audit Date', 'SKU Build By', 'Sample', 'Audit By', 'Error Type', 'Attribute/Field', 'Audit Comments', 'PT Status', 'PT Comments', 'Re-Audit Comments', 'Gap/Similar', 'PT Response', 'CFB Attribute', 'CFB Comments'];
    const aoa = [head, ...all.map((x) => [x.skuId, x.auditDate, x.builder, x.sampleFlag, x.auditor || '', x.errorRaw, x.attributeField, x.auditComments, x.ptRaw, x.ptComments, x.reauditComments, x.gapSimilar, x.ptResponse, x.cfbAttribute, x.cfbComments])];
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = head.map((h, i) => ({ wch: i > 6 ? 40 : 18 }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'SKU Audit Details');
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="sku-audit-details.xlsx"' });
    res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }));

  r.get('/skus/:id', wrap(async (req, res) => {
    const id = String(req.params.id);
    const sku = await db.get('SELECT * FROM skus WHERE sku_id = ?', [id]);
    if (!sku) throw new HttpError(404, 'SKU not found.');
    const errTypes = await getErrorTypes(db);
    const mine = await loadRecords(db, { skuId: id }, errTypes, { text: true });
    const ups = await db.all(`SELECT u.id, u.original_name FROM uploads u WHERE u.id IN (SELECT upload_id FROM audit_records WHERE sku_id = ?)`, [id]);
    const upName = Object.fromEntries(ups.map((u) => [u.id, u.original_name]));
    res.json({ sku: { skuId: sku.sku_id },
      history: mine.map((x) => ({ ...rowOut(x), file: upName[x.uploadId] || '' })) });
  }));

  return r;
}
