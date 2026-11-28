// Turns request filters into SQL and loads audit records (with their error codes and attributes).
import { weekStart, weekEnd, parseISO, isoDate, isValidISO } from '../lib/dates.js';
import { bad } from '../lib/http.js';
import { l1Category } from '../services/parser.js';

const str = (v) => (v == null ? '' : String(Array.isArray(v) ? v[0] : v).trim());
const int = (v) => { const n = parseInt(str(v), 10); return Number.isFinite(n) ? n : null; };

/** Reads the shared filter query-string. A week or month, when given, wins over a from/to range. */
export function parseFilters(q = {}) {
  const f = { from: null, to: null, builderId: int(q.builderId), auditorId: int(q.auditorId), uploadId: int(q.uploadId), project: str(q.project) || null, errorCode: str(q.errorCode).toUpperCase() || null,
    attribute: str(q.attribute) || null, ptStatus: str(q.ptStatus) || null, ptClass: str(q.ptClass) || null, reauditState: str(q.reauditState) || null, q: str(q.q) || null, skuId: str(q.skuId) || null,
    unconfirmed: str(q.unconfirmed) === '1' }; // only audited records whose errors are not counted yet (re-audit rule)
  const week = str(q.week), month = str(q.month), from = str(q.from), to = str(q.to);
  if (week) { if (!isValidISO(week)) throw bad('Week must be a date (YYYY-MM-DD).'); f.from = weekStart(week); f.to = weekEnd(f.from); } // a week = Monday to Saturday
  else if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw bad('Month must look like 2026-07.');
    const first = `${month}-01`; if (!isValidISO(first)) throw bad('Month is not valid.');
    const d = parseISO(first); const last = isoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
    f.from = first; f.to = last;
  } else {
    if (from) { if (!isValidISO(from)) throw bad('"From" date is not valid.'); f.from = from; }
    if (to) { if (!isValidISO(to)) throw bad('"To" date is not valid.'); f.to = to; }
    if (f.from && f.to && f.from > f.to) throw bad('"From" date is after the "To" date.');
  }
  return f;
}

function where(f, { dateOnly = false } = {}) {
  const c = []; const p = [];
  if (f.from) { c.push('r.audit_date >= ?'); p.push(f.from); }
  if (f.to) { c.push('r.audit_date <= ?'); p.push(f.to); }
  if (!dateOnly) {
    if (f.builderId != null) { c.push('r.content_employee_id = ?'); p.push(f.builderId); }
    if (f.auditorId != null) { c.push('r.auditor_id = ?'); p.push(f.auditorId); }
    if (f.uploadId != null) { c.push('r.upload_id = ?'); p.push(f.uploadId); }
    // A project is picked by its first word ("Grainger" = every file whose project name starts with Grainger). A full project name still matches itself exactly.
    if (f.project) { c.push(`(up.project = ? OR lower(up.project) LIKE lower(?) ESCAPE '\\')`); p.push(f.project, f.project.replace(/[\\%_]/g, '\\$&') + ' %'); } // lower(): same result in SQLite and PostgreSQL
    if (f.errorCode) { c.push('EXISTS (SELECT 1 FROM error_classifications x WHERE x.audit_record_id = r.id AND x.code = ?)'); p.push(f.errorCode); }
    if (f.attribute) { c.push('EXISTS (SELECT 1 FROM record_attributes x WHERE x.audit_record_id = r.id AND lower(x.attribute) = lower(?))'); p.push(f.attribute); }
    if (f.ptStatus) {
      if (f.ptStatus === '__none__') c.push(`COALESCE(TRIM(r.pt_status), '') = ''`);
      else { c.push('lower(TRIM(r.pt_status)) = lower(?)'); p.push(f.ptStatus); }
    }
    if (f.ptClass) { c.push('pt.status_class = ?'); p.push(f.ptClass); }
    if (f.reauditState) { c.push('ra.state = ?'); p.push(f.reauditState); }
    if (f.skuId) { c.push('r.sku_id = ?'); p.push(f.skuId); }
    if (f.q) { c.push('lower(r.sku_id) LIKE ?'); p.push('%' + f.q.toLowerCase().replace(/[%_]/g, '') + '%'); }
  }
  return { sql: c.length ? 'WHERE ' + c.join(' AND ') : '', params: p };
}

const BASE = `SELECT r.id, r.upload_id, r.sku_id, r.audit_date, r.week_start, r.month, r.is_sampled, r.has_findings, r.sample_flag, r.error_raw, r.attribute_field,
    r.audit_comments, r.pt_status, r.pt_comments, r.reaudit_comments, r.gap_similar, r.pt_response, r.cfb_attribute, r.cfb_comments,
    b.id AS builder_id, b.name AS builder, a.id AS auditor_id, a.name AS auditor, pt.status_class AS pt_class, ra.state AS ra_state,
    up.has_unsampled, r.attrs_enriched, r.taxonomy
  FROM audit_records r
  LEFT JOIN employees b ON b.id = r.content_employee_id LEFT JOIN employees a ON a.id = r.auditor_id
  LEFT JOIN pt_tracking pt ON pt.audit_record_id = r.id LEFT JOIN reaudit_tracking ra ON ra.audit_record_id = r.id
  JOIN uploads up ON up.id = r.upload_id`;

export const NOT_RECORDED = '(not recorded)';

/** Loads records matching the filters. `errTypes` decides which codes count as errors (so changing the legend recalculates everything). */
export async function loadRecords(db, f, errTypes, { text = false } = {}) {
  const w = where(f);
  const rows = await db.all(`${BASE} ${w.sql} ORDER BY r.audit_date, r.id`, w.params);
  if (!rows.length) return [];
  const wd = where(f, { dateOnly: true });
  const codes = await db.all(`SELECT c.audit_record_id AS id, c.code FROM error_classifications c JOIN audit_records r ON r.id = c.audit_record_id ${wd.sql} ORDER BY c.id`, wd.params);
  const attrs = await db.all(`SELECT c.audit_record_id AS id, c.attribute, c.is_attribute, c.was_enriched, c.from_comment FROM record_attributes c JOIN audit_records r ON r.id = c.audit_record_id ${wd.sql}`, wd.params);
  const cm = new Map(); for (const c of codes) { if (!cm.has(c.id)) cm.set(c.id, []); cm.get(c.id).push(c.code); }
  const am = new Map(); const ai = new Map();
  for (const a of attrs) {
    if (!am.has(a.id)) { am.set(a.id, []); ai.set(a.id, []); }
    am.get(a.id).push(a.attribute);
    ai.get(a.id).push({ name: a.attribute, isAttribute: !!a.is_attribute, wasEnriched: a.was_enriched == null ? null : !!a.was_enriched, fromComment: !!Number(a.from_comment) });
  }
  // Counting rule (Settings -> "count an error only after the re-audit"): audit finds the error -> PT fixes it -> re-audit checks it.
  // The error counts when the re-audit is done ("ok"-type comment, or the re-auditor's notes) AND PT did not answer "Not Updated"
  // (PT status pending = PT did not change it; with the re-audit agreeing, the audit itself was probably wrong). An empty PT status is fine.
  // Everything else is kept aside as `waitingErrs` and is not counted anywhere.
  const confirmed = (ra, pt) => !errTypes.afterReaudit || ((ra === 'passed' || ra === 'issues') && pt !== 'pending' && pt !== 'unmapped');
  const out = rows.map((r) => {
    const codeList = cm.get(r.id) || [];
    const realErrs = codeList.filter((c) => errTypes.get(c)?.isError === true);
    const ok = confirmed(r.ra_state, r.pt_class);
    const rec = {
      id: r.id, uploadId: r.upload_id, skuId: r.sku_id, auditDate: r.audit_date, weekStart: r.week_start, month: r.month,
      sampled: !!r.is_sampled, builderId: r.builder_id, builder: r.builder || NOT_RECORDED, auditorId: r.auditor_id, auditor: r.auditor || null,
      codes: codeList, errs: ok ? realErrs : [], waitingErrs: ok ? [] : realErrs, attrs: am.get(r.id) || [], attrInfo: ai.get(r.id) || [], attrsEnriched: r.attrs_enriched == null ? null : Number(r.attrs_enriched),
      taxonomy: r.taxonomy || '', taxonomyKnown: r.taxonomy != null, category: l1Category(r.taxonomy), // L1 category = first part of the PIM Taxonomy; null = unknown
      ptRaw: r.pt_status || '', ptClass: r.pt_class || 'not_applicable', reaudit: r.ra_state || 'not_due', isCase: (r.pt_class || 'not_applicable') !== 'not_applicable',
      fullList: !!r.has_unsampled, hasPtResponse: !!String(r.pt_response || '').trim(), // the file this record came from also lists SKUs that were not audited
    };
    if (text) Object.assign(rec, {
      errorRaw: r.error_raw || '', attributeField: r.attribute_field || '', auditComments: r.audit_comments || '', ptComments: r.pt_comments || '',
      reauditComments: r.reaudit_comments || '', gapSimilar: r.gap_similar || '', ptResponse: r.pt_response || '', cfbAttribute: r.cfb_attribute || '',
      cfbComments: r.cfb_comments || '', sampleFlag: r.sample_flag || '',
    });
    return rec;
  });
  return f.unconfirmed ? out.filter((r) => r.sampled && r.waitingErrs.length) : out;
}

export async function dataBounds(db) {
  const r = await db.get('SELECT MIN(audit_date) AS first, MAX(audit_date) AS last, COUNT(*) AS n FROM audit_records');
  return { first: r.first, last: r.last, records: r.n };
}
