// Weekly / custom report: builds a snapshot (JSON) that is stored, and rendered to Excel or PDF on demand.
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { loadRecords, dataBounds } from '../analytics/loader.js';
import { metrics, contentTeam, auditTeam, errorAnalysis, followUps, typeBreakdown, attributeBreakdown, pct, r2 } from '../analytics/compute.js';
import { buildSuggestions } from '../analytics/suggestions.js';
import { getSettings, getErrorTypes } from './settings.js';
import { addDays, fmtRange, nowIn, weekStart, weekEnd, previousPeriod, isWholeMonth } from '../lib/dates.js';
import { bad } from '../lib/http.js';
import { addLogoToXlsx, logoPng } from './reportLogo.js';

const none = {};

/** Period to analyse + the period it is compared with (the previous Monday-Saturday week, or the equal-length period before a custom range) */
export function periodPair(from, to) {
  const p = previousPeriod(from, to);
  return { cur: { from, to, label: fmtRange(from, to) }, prev: { from: p.from, to: p.to, label: fmtRange(p.from, p.to) } };
}

/** The file a file report covers, and the file it is compared with: the nearest earlier file (by audit date) of the same project. */
async function filePair(db, uploadId, errTypes) {
  const up = await db.get(`SELECT id, original_name, audit_date, project FROM uploads WHERE id = ? AND status = 'imported'`, [uploadId]);
  if (!up) throw bad('That file is not an imported upload.');
  const curRecs = await loadRecords(db, { ...none, uploadId: up.id }, errTypes);
  if (!curRecs.length) throw bad('This upload only updated records of an earlier upload of the same file. Choose that earlier upload instead.');
  const first = (up.project || '').trim().split(/\s+/)[0] || '';
  const before = await db.all(`SELECT u.id, u.original_name, u.audit_date, u.project FROM uploads u WHERE u.status = 'imported' AND u.id <> ? AND u.audit_date < ?
    AND EXISTS (SELECT 1 FROM audit_records r WHERE r.upload_id = u.id) ORDER BY u.audit_date DESC, u.id DESC`, [up.id, up.audit_date || '']);
  const prevUp = before.find((u) => ((u.project || '').trim().split(/\s+/)[0] || '') === first) || null;
  const prevRecs = prevUp ? await loadRecords(db, { ...none, uploadId: prevUp.id }, errTypes) : [];
  const dates = curRecs.map((r) => r.auditDate).sort();
  const pd = prevRecs.map((r) => r.auditDate).sort();
  return {
    curRecs, prevRecs,
    cur: { from: dates[0], to: dates[dates.length - 1], label: up.original_name },
    prev: prevUp ? { from: pd[0], to: pd[pd.length - 1], label: prevUp.original_name } : { from: dates[0], to: dates[0], label: 'no earlier file of this project' },
    scope: { type: 'file', uploadId: up.id, fileName: up.original_name, project: up.project || '', previousFile: prevUp?.original_name || null },
  };
}

/** kind: 'weekly' | 'custom' (dates) | 'file' (one uploaded file, compared with the file before it). */
export async function buildReport(db, { from, to, kind, uploadId }) {
  const settings = await getSettings(db); const errTypes = await getErrorTypes(db);
  const today = nowIn(settings.timezone).date;
  let cur, prev, curRecs, prevRecs, scope;
  if (kind === 'file') ({ cur, prev, curRecs, prevRecs, scope } = await filePair(db, uploadId, errTypes));
  else {
    if (!from || !to || from > to) throw bad('Choose a valid date range.');
    ({ cur, prev } = periodPair(from, to));
    curRecs = await loadRecords(db, { ...none, from: cur.from, to: cur.to }, errTypes);
    prevRecs = await loadRecords(db, { ...none, from: prev.from, to: prev.to }, errTypes);
    scope = { type: kind === 'weekly' ? 'week' : isWholeMonth(cur.from, cur.to) ? 'month' : 'dates' };
  }
  const m = metrics(curRecs), pm = metrics(prevRecs);
  const fu = followUps(curRecs, today, settings);
  const ea = errorAnalysis(curRecs, errTypes);
  const content = contentTeam(curRecs, errTypes, settings);
  const diff = (a, b) => (!prevRecs.length || a == null || b == null ? null : r2(a - b)); // no previous data = no comparison
  const suggestions = await buildSuggestions({ cur: { recs: curRecs, label: 'this period' }, prev: { recs: prevRecs, label: 'the previous period' }, errTypes, s: settings, today });
  const notes = [];
  if (!curRecs.length) notes.push('No audit records were found in this period.');
  if (!prevRecs.length) notes.push(kind === 'file' ? 'There is no earlier file of this project, so no comparison is shown.' : 'There is no data in the previous period, so no comparison is shown.');
  for (const c of content.filter((x) => x.level === 'few')) notes.push(`${c.name}: only ${c.samples} audited sample(s) – the error percentage is not reliable yet.`);
  return {
    kind, scope, period: cur, previous: prev, generatedAt: new Date().toISOString(), timezone: settings.timezone,
    target: settings.errorTargetPct, minSample: settings.minSample, afterReaudit: !!errTypes.afterReaudit,
    overall: m, previousOverall: pm,
    comparison: { skus: m.skusAvailable && pm.skusAvailable ? diff(m.skus, pm.skus) : null, samples: diff(m.samples, pm.samples), errorSkus: diff(m.errorSkus, pm.errorSkus), errorRate: diff(m.errorRate, pm.errorRate), sampleRate: diff(m.sampleRate, pm.sampleRate), classifications: diff(m.classifications, pm.classifications), attrErrors: diff(m.attrErrors, pm.attrErrors), attrErrorRate: m.attrsAvailable && pm.attrsAvailable ? diff(m.attrErrorRate, pm.attrErrorRate) : null, hasPrevious: prevRecs.length > 0 },
    reconciliation: { classifications: m.classifications, errorSkus: m.errorSkus, extra: m.classifications - m.errorSkus },
    content: content.map(({ weekly, byType, ...c }) => ({ ...c, byType: byType.map((t) => ({ code: t.code, name: t.name, classifications: t.classifications, skus: t.skus })) })),
    audit: auditTeam(curRecs, errTypes).map(({ weekly, ...a }) => a),
    topErrorTypes: ea.byType.slice(0, 5), topAttributes: ea.topAttributes.slice(0, 5).map((a) => ({ attribute: a.attribute, skus: a.skus })),
    followUps: { pt: fu.pt, reaudit: fu.reaudit, ageing: fu.ageing, olderThanWarn: fu.olderThanWarn, previous: (() => { const p = followUps(prevRecs, today, settings); return { pt: p.pt, reaudit: p.reaudit }; })() },
    suggestions, notes,
  };
}

export async function saveReport(db, summary, { userId, auto }) {
  const row = summary.kind === 'weekly' ? await db.get(`SELECT id FROM weekly_reports WHERE kind='weekly' AND period_start = ?`, [summary.period.from]) : null;
  if (row) {
    await db.run('UPDATE weekly_reports SET generated_at=?, generated_by=?, summary_json=?, period_end=? WHERE id=?', [summary.generatedAt, auto ? null : userId, JSON.stringify(summary), summary.period.to, row.id]);
    return row.id;
  }
  // the table only knows 'weekly' and 'custom'; a file report is stored as 'custom' and keeps kind 'file' inside its summary
  return db.insert('INSERT INTO weekly_reports (kind, period_start, period_end, generated_at, generated_by, summary_json) VALUES (?,?,?,?,?,?)',
    [summary.kind === 'weekly' ? 'weekly' : 'custom', summary.period.from, summary.period.to, summary.generatedAt, auto ? null : userId, JSON.stringify(summary)]);
}

/** "Weekly report: 7 Sep 2026 – 12 Sep 2026" / "File report: <name>" / "Report for dates: …" (used in the files) */
export const reportTitle = (r) => (r.kind === 'file' ? `File report: ${r.period.label}` : `${r.kind === 'weekly' ? 'Weekly report' : r.scope?.type === 'month' ? 'Monthly report' : 'Report for dates'}: ${r.period.label}`);

/** Generates the weekly report for every finished week (Mon–Sat) that has data but no report yet. Safe to call repeatedly.
 *  A week counts as finished once the next Monday has come (Sunday is a day off, not part of any week), from the configured hour. */
export async function generateDueWeeklyReports(db, at = new Date()) {
  const s = await getSettings(db); if (!s.weeklyReportAuto) return [];
  const now = nowIn(s.timezone, at);
  if (now.weekdayMon0 === 0 && now.hour < s.weeklyReportHour) return []; // Monday, but not yet time
  const weeks = await db.all('SELECT DISTINCT week_start AS w FROM audit_records ORDER BY week_start');
  const have = new Set((await db.all(`SELECT period_start FROM weekly_reports WHERE kind='weekly'`)).map((r) => r.period_start));
  const made = [];
  for (const { w } of weeks) {
    if (addDays(w, 7) > now.date || have.has(w)) continue; // next Monday not here yet (week still running), or the report exists
    const summary = await buildReport(db, { from: w, to: weekEnd(w), kind: 'weekly' });
    made.push(await saveReport(db, summary, { auto: true }));
  }
  return made;
}

/** Weekly reports saved while a week still ended on Sunday are rebuilt for Monday-Saturday (same creator and creation time). Runs at start-up; does nothing once they are all converted. */
export async function refreshWeeklyPeriods(db) {
  const rows = await db.all(`SELECT id, period_start, period_end, generated_at FROM weekly_reports WHERE kind = 'weekly'`);
  let n = 0;
  for (const r of rows) {
    const end = weekEnd(r.period_start);
    if (r.period_end === end) continue;
    const summary = await buildReport(db, { from: r.period_start, to: end, kind: 'weekly' });
    summary.generatedAt = r.generated_at;
    await db.run('UPDATE weekly_reports SET period_end = ?, summary_json = ? WHERE id = ?', [end, JSON.stringify(summary), r.id]);
    n++;
  }
  return n;
}

export { weekStart, dataBounds };

/* ---------------------------------------------------------------- Excel */
const f = (v, suffix = '') => (v == null ? '—' : `${v}${suffix}`);
// Total SKUs assigned is only known when the uploaded files also list the SKUs that were not audited
const NA = 'Not available';
const sk = (m) => (m.skusAvailable === false ? NA : m.skus);
const sr = (m) => (m.skusAvailable === false ? NA : f(m.sampleRate, '%'));
// attribute-based numbers need the attribute columns of the file ("Not available" without them)
const an = (m, k) => (m.attrsAvailable === false ? NA : f(m[k]));
const ar = (m) => (m.attrsAvailable === false ? NA : f(m.attrErrorRate, '%'));
export function reportToExcel(r) {
  const wb = XLSX.utils.book_new();
  const add = (name, aoa, widths) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = (widths || []).map((w) => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31)); };
  const c = r.comparison, o = r.overall, p = r.previousOverall;
  add('Summary', [
    [], [], // room for the company logo
    ['Audit Performance Report'], [reportTitle(r)], ...(r.kind === 'file' ? [[`Audit dates in the file: ${fmtRange(r.period.from, r.period.to)}`]] : []), [`Compared with: ${r.previous.label}`], [`Created: ${r.generatedAt} (${r.timezone})`], [],
    ['Measure', 'This period', 'Previous period', 'Change'],
    ['Total SKUs', sk(o), sk(p), f(c.skus)], ['Samples audited', o.samples, p.samples, f(c.samples)], ['Sample audit %', sr(o), sr(p), f(c.sampleRate, ' pts')],
    ['SKUs with errors', o.errorSkus, p.errorSkus, f(c.errorSkus)], ['Error % (SKUs with errors ÷ samples audited)', f(o.errorRate, '%'), f(p.errorRate, '%'), f(c.errorRate, ' pts')],
    ['Error classifications (error codes recorded)', o.classifications, p.classifications, f(c.classifications)],
    ['Attributes enriched', an(o, 'attrsEnriched'), an(p, 'attrsEnriched'), ''], ['Attributes audited', an(o, 'attrsAudited'), an(p, 'attrsAudited'), ''],
    ['Attributes with errors', o.attrErrors, p.attrErrors, f(c.attrErrors)], ['Attribute error % (attributes with errors ÷ attributes audited)', ar(o), ar(p), f(c.attrErrorRate, ' pts')],
    ['Pending PT cases', r.followUps.pt.pending, r.followUps.previous.pt.pending, ''], ['Pending re-audit cases', r.followUps.reaudit.pending, r.followUps.previous.reaudit.pending, ''], [],
    ['Why classifications can be higher than SKUs with errors:', `${r.reconciliation.classifications} error codes were recorded on ${r.reconciliation.errorSkus} SKUs. A SKU with more than one error code is counted once as a SKU with errors and once per code as a classification.`],
    ...(r.notes.length ? [[], ['Notes'], ...r.notes.map((n) => [n])] : []),
  ], [48, 18, 18, 14]);
  add('Product Team', [['Name', 'Total SKUs', 'Samples audited', 'Sample %', 'SKUs with errors', 'Error %', 'Error classifications', 'Status', 'Rank', 'Most common mistakes'],
    ...r.content.map((m) => [m.name, sk(m), m.samples, m.skusAvailable === false ? NA : m.sampleRate, m.errorSkus, m.errorRate, m.classifications, LEVEL[m.level], m.rank ?? '', m.topTypes.map((t) => `${t.name} (${t.classifications})`).join('; ')])], [26, 11, 14, 10, 14, 10, 14, 20, 7, 60]);
  add('Product Team - attributes', [['Name', 'Attributes enriched', 'Attributes audited', 'Attributes with errors', 'Attribute error %', 'Other fields with errors'],
    ...r.content.map((m) => [m.name, an(m, 'attrsEnriched'), an(m, 'attrsAudited'), m.attrErrors, ar(m), m.otherFieldErrors])], [26, 18, 18, 22, 18, 24]);
  add('Audit Team', [['Auditor', 'SKUs audited', 'Audit records', 'Error classifications found', 'PT completed', 'PT pending', 'PT status missing', 'Re-audit done', 'Re-audit pending', 'Pending cases', 'Completed cases'],
    ...r.audit.map((a) => [a.name, a.skusAudited, a.records, a.classifications, a.pt.completed, a.pt.pending, a.pt.notRecorded + a.pt.unmapped, a.reaudit.passed + a.reaudit.issues, a.reaudit.pending, a.pendingCases, a.closedCases])], [26, 12, 13, 18, 13, 11, 15, 14, 15, 13, 14]);
  add('Top Errors', [['Error type', 'Code', 'Classifications', 'Share %', 'SKUs'], ...r.topErrorTypes.map((t) => [t.name, t.code, t.classifications, t.share, t.skus])], [34, 8, 15, 10, 8]);
  add('Top Attributes', [['Attribute', 'SKUs with errors'], ...r.topAttributes.map((t) => [t.attribute, t.skus])], [48, 16]);
  add('Suggestions', [['Priority', 'Suggestion', 'Evidence', 'What to do'], ...r.suggestions.map((s) => [SEV[s.severity], s.title, s.detail, s.action])], [12, 60, 80, 60]);
  return addLogoToXlsx(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
export const LEVEL = { good: 'Lowest error rate', watch: 'Moderate error rate', improve: 'High error rate', few: 'Too few samples', none: 'No audited samples' };
const SEV = { high: 'Important', medium: 'Worth doing', low: 'For information', good: 'Good news' };

/* ------------------------------------------------------------------ PDF */
export function reportToPdf(r) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: 'Audit Performance Report' } });
  const chunks = []; doc.on('data', (d) => chunks.push(d));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const W = doc.page.width - 80; const INK = '#1b2433', MUTE = '#5b667a', BRAND = '#1f5fbf';
  const h1 = (t) => { doc.moveDown(0.6).font('Helvetica-Bold').fontSize(13).fillColor(BRAND).text(t); doc.moveDown(0.3).fillColor(INK); };
  const para = (t, o = {}) => doc.font('Helvetica').fontSize(o.size || 9.5).fillColor(o.color || INK).text(t, { width: W, ...o });
  const table = (cols, rows) => { // cols: [{h, w, align}]
    const total = cols.reduce((a, c) => a + c.w, 0); const k = W / total;
    const rowH = (cells, bold) => Math.max(...cells.map((t, i) => doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).heightOfString(String(t ?? ''), { width: cols[i].w * k - 6 }))) + 6;
    const draw = (cells, bold, bg) => {
      const h = rowH(cells, bold); if (doc.y + h > doc.page.height - 50) doc.addPage();
      let x = 40; const y = doc.y;
      if (bg) doc.rect(40, y, W, h).fill(bg);
      cells.forEach((t, i) => { doc.fillColor(INK).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).text(String(t ?? ''), x + 3, y + 3, { width: cols[i].w * k - 6, align: cols[i].align || 'left' }); x += cols[i].w * k; });
      doc.y = y + h; doc.moveTo(40, doc.y).lineTo(40 + W, doc.y).strokeColor('#dde3ee').lineWidth(0.5).stroke();
    };
    draw(cols.map((c) => c.h), true, '#eef2f9'); rows.forEach((row) => draw(row, false));
    doc.x = 40; // back to the left margin (writing the last cell leaves the cursor in the right-hand column)
  };
  const o = r.overall, p = r.previousOverall, c = r.comparison;
  const logo = logoPng(); if (logo) doc.image(logo, 40 + W - 100, 36, { width: 100 }); // top right; does not move the text
  doc.font('Helvetica-Bold').fontSize(19).fillColor(INK).text('Audit Performance Report');
  para(`${reportTitle(r)}  |  compared with ${r.previous.label}`, { color: MUTE, width: W - 110 });
  para(`Created ${r.generatedAt.slice(0, 16).replace('T', ' ')} UTC  |  Error rate: ${r.target}% or lower`, { color: MUTE, size: 8.5 });

  h1('1. Overall team performance');
  table([{ h: 'Measure', w: 5 }, { h: 'This period', w: 2, align: 'right' }, { h: 'Previous', w: 2, align: 'right' }, { h: 'Change', w: 2, align: 'right' }], [
    ['Total SKUs', sk(o), sk(p), f(c.skus)], ['Samples audited', o.samples, p.samples, f(c.samples)], ['Sample audit %', sr(o), sr(p), f(c.sampleRate, ' pts')],
    ['SKUs with errors', o.errorSkus, p.errorSkus, f(c.errorSkus)], ['Error % (SKUs with errors ÷ samples audited)', f(o.errorRate, '%'), f(p.errorRate, '%'), f(c.errorRate, ' pts')],
    ['Error classifications (error codes)', o.classifications, p.classifications, f(c.classifications)],
    ['Attributes enriched', an(o, 'attrsEnriched'), an(p, 'attrsEnriched'), ''], ['Attributes audited', an(o, 'attrsAudited'), an(p, 'attrsAudited'), ''],
    ['Attributes with errors', o.attrErrors, p.attrErrors, f(c.attrErrors)], ['Attribute error % (with errors ÷ audited)', ar(o), ar(p), f(c.attrErrorRate, ' pts')],
    ['Pending PT cases', r.followUps.pt.pending, r.followUps.previous.pt.pending, ''], ['Pending re-audit cases', r.followUps.reaudit.pending, r.followUps.previous.reaudit.pending, '']]);
  para(`Note: ${r.reconciliation.classifications} error codes were recorded on ${r.reconciliation.errorSkus} SKUs. A SKU with several error codes counts once as a SKU with errors but once per code as a classification.`, { color: MUTE, size: 8.5 });
  if (!c.hasPrevious) para('There is no data in the previous period, so no comparison can be shown.', { color: MUTE, size: 8.5 });

  h1('2. Product Team – individual performance');
  table([{ h: 'Name', w: 4 }, { h: 'SKUs', w: 1.3, align: 'right' }, { h: 'Samples', w: 1.5, align: 'right' }, { h: 'With errors', w: 1.6, align: 'right' }, { h: 'Error %', w: 1.4, align: 'right' }, { h: 'Status', w: 3 }, { h: 'Most common mistakes', w: 5 }],
    r.content.map((m) => [m.name, sk(m), m.samples, m.errorSkus, f(m.errorRate, '%'), LEVEL[m.level], m.topTypes.map((t) => `${t.code} ×${t.classifications}`).join(', ')]));

  h1('2b. Product Team – attribute based');
  table([{ h: 'Name', w: 4 }, { h: 'Attributes enriched', w: 2.6, align: 'right' }, { h: 'Attributes audited', w: 2.6, align: 'right' }, { h: 'With errors', w: 2, align: 'right' }, { h: 'Attribute error %', w: 2.6, align: 'right' }],
    r.content.map((m) => [m.name, an(m, 'attrsEnriched'), an(m, 'attrsAudited'), m.attrErrors, ar(m)]));
  para('Attribute error % = attributes with errors ÷ attributes audited. "Not available" means the uploaded file has no attribute columns.', { color: MUTE, size: 8.5 });

  h1('3. Audit Team – individual activity');
  table([{ h: 'Auditor', w: 4 }, { h: 'SKUs audited', w: 2, align: 'right' }, { h: 'Records', w: 1.5, align: 'right' }, { h: 'Errors found', w: 2, align: 'right' }, { h: 'PT pending', w: 1.8, align: 'right' }, { h: 'Re-audit pending', w: 2.2, align: 'right' }, { h: 'Closed cases', w: 2, align: 'right' }],
    r.audit.map((a) => [a.name, a.skusAudited, a.records, a.classifications, a.pt.pending, a.reaudit.pending, a.closedCases]));
  para('Errors found shows workload, not quality: a higher number does not mean a better or worse auditor.', { color: MUTE, size: 8.5 });

  h1('4. Top 5 error types');
  table([{ h: 'Error type', w: 6 }, { h: 'Code', w: 1.5 }, { h: 'Count', w: 1.5, align: 'right' }, { h: 'Share', w: 1.5, align: 'right' }], r.topErrorTypes.map((t) => [t.name, t.code, t.classifications, f(t.share, '%')]));
  h1('5. Top 5 attributes with errors');
  table([{ h: 'Attribute', w: 8 }, { h: 'SKUs', w: 1.5, align: 'right' }], r.topAttributes.map((t) => [t.attribute, t.skus]));

  h1('6. Improvement suggestions');
  if (!r.suggestions.length) para('No suggestions: nothing in this period crossed a rule threshold.');
  r.suggestions.forEach((s) => { para(`• ${s.title}`, { size: 10 }); para(s.detail, { color: MUTE, size: 8.5, indent: 10 }); para(`Do: ${s.action}`, { size: 8.5, indent: 10 }); doc.moveDown(0.3); });
  if (r.notes.length) { h1('Notes'); r.notes.forEach((n) => para('• ' + n, { size: 8.5, color: MUTE })); }
  doc.end();
  return done;
}
