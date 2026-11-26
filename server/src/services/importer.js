// Upload pipeline:  stage (read + validate, nothing saved to the audit data)  ->  analyze (duplicates, cross-check)
//                   ->  commit (one database transaction)  ->  report.
import crypto from 'node:crypto';
import { readWorkbook, detectTable, parseTable, readAttributeColumns, readTaxonomyColumn, readSourceColumns, l1Category, ReadError, FIELDS } from './parser.js';

// Bump when the way a file is read changes: older, still-unreviewed previews must be uploaded again.
const PARSER_VERSION = 6;
import { getErrorTypes, getSettings } from './settings.js';
import { classifyFollowUp, writeTracking } from './followup.js';
import { dateFromFilename, isValidISO, weekStart, monthOf, parseISO } from '../lib/dates.js';
import { bad } from '../lib/http.js';
import { suggestProject } from '../lib/project.js';

/** Imports made before projects existed get a project suggested from their file name (editable in Upload history). */
export async function backfillProjects(db) {
  const rows = await db.all(`SELECT id, original_name FROM uploads WHERE project IS NULL AND status = 'imported'`);
  for (const r of rows) await db.run('UPDATE uploads SET project = ? WHERE id = ?', [suggestProject(r.original_name), r.id]);
  return rows.length;
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nz = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const now = () => new Date().toISOString();

// fields compared to decide "identical" vs "changed"  (row property -> DB column, label)
const COMPARE = [
  ['builder', 'builder', 'SKU Build By'], ['sampleFlag', 'sample_flag', 'Sample'], ['auditor', 'auditor', 'Audit By'],
  ['errorRaw', 'error_raw', 'Error Type'], ['attributeField', 'attribute_field', 'Attribute/Field'],
  ['auditComments', 'audit_comments', 'Audit Comments'], ['ptStatus', 'pt_status', 'PT Status'], ['ptComments', 'pt_comments', 'PT Comments'],
  ['reauditComments', 'reaudit_comments', 'Re-Audit Comments'], ['gapSimilar', 'gap_similar', 'Gap/Similar'],
  ['ptResponse', 'pt_response', 'PT Response'], ['cfbAttribute', 'cfb_attribute', 'CFB Attribute'], ['cfbComments', 'cfb_comments', 'CFB Comments'],
  ['attrsEnriched', 'attrs_enriched', 'Attributes enriched'], ['taxonomy', 'taxonomy', 'PIM Taxonomy'],
  ['sourceInfo', 'source_info', 'Source links'],
];

/** Fingerprint of "the same audit finding". Follow-up fields (PT, re-audit, comments) are NOT part of it, so a later
 *  version of the same file is recognised as the same record and can update it instead of adding it twice.
 *  One SKU with several errors is ONE record carrying several error codes, so legitimate multiple errors are never lost. */
export function recordKey(row, auditDate, includeDate) {
  const parts = [nz(row.skuId).toLowerCase(), nz(row.auditor).toLowerCase(), [...row.codes].sort().join(','), row.attrs.map((a) => a.toLowerCase()).sort().join(';')];
  if (includeDate) parts.push(auditDate || '');
  return sha(parts.join('|')).slice(0, 32);
}

/* ------------------------------------------------------------------ stage */
export async function stageUpload(db, { buffer, filename, userId }) {
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const base = { original_name: filename, file_hash: hash, file_size: buffer.length, uploaded_by: userId, uploaded_at: now() };
  const fail = async (message) => {
    const report = { error: message };
    const id = await db.insert(`INSERT INTO uploads (original_name, file_hash, file_size, status, uploaded_by, uploaded_at, report_json) VALUES (?,?,?,?,?,?,?)`,
      [base.original_name, hash, base.file_size, 'failed', userId, base.uploaded_at, JSON.stringify(report)]);
    return { id, failed: true, error: message };
  };
  let wb;
  try { wb = readWorkbook(buffer, filename); } catch (e) { if (e instanceof ReadError) return fail(e.message); throw e; }
  const { usable } = detectTable(wb);
  if (!usable.length) {
    const need = Object.values(FIELDS).filter((f) => f.required).map((f) => f.label).join(' and ');
    return fail(`Could not find the audit table. No sheet has the audit column headings (${need}, …) in columns A to N. Only columns A to N are read; check that the first row of your audit sheet has the 14 audit headings.`);
  }
  const tables = usable.slice(0, 4).map((t) => parseTable(t, readAttributeColumns(wb, t), readTaxonomyColumn(wb, t), readSourceColumns(wb, t)));
  const staged = { v: PARSER_VERSION, tables, chosen: 0, sheetNames: wb.SheetNames, nameDate: dateFromFilename(filename) };
  const id = await db.insert(`INSERT INTO uploads (original_name, file_hash, file_size, sheet_name, header_row, audit_date, status, uploaded_by, uploaded_at, total_rows, staged_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  [filename, hash, buffer.length, tables[0].sheet, tables[0].headerRow, staged.nameDate, 'preview', userId, base.uploaded_at, tables[0].rows.length, JSON.stringify(staged)]);
  return { id, failed: false };
}

/* ---------------------------------------------------------------- analyze */
async function loadExisting(db, skuIds) {
  const map = new Map(); const uniq = [...new Set(skuIds)];
  for (let i = 0; i < uniq.length; i += 400) {
    const chunk = uniq.slice(i, i + 400);
    const rows = await db.all(`SELECT r.*, b.name AS builder, a.name AS auditor FROM audit_records r
      LEFT JOIN employees b ON b.id = r.content_employee_id LEFT JOIN employees a ON a.id = r.auditor_id
      WHERE r.sku_id IN (${chunk.map(() => '?').join(',')})`, chunk);
    for (const r of rows) { if (!map.has(r.sku_id)) map.set(r.sku_id, []); map.get(r.sku_id).push(r); }
  }
  return map;
}

function diffFields(row, ex) {
  const out = [];
  for (const [prop, col, label] of COMPARE) {
    if (prop === 'attrsEnriched' && row.attrsEnriched == null) continue; // a file without attribute columns says nothing about attributes: never a "change", never overwrites
    if (prop === 'taxonomy' && row.taxonomy == null) continue;           // same for a file without a PIM Taxonomy column
    if (prop === 'sourceInfo' && row.sourceInfo == null) continue;       // same for source links
    // the stored links are technical text, so the review screen only says that they changed
    if (nz(row[prop]) !== nz(ex[col])) out.push(prop === 'sourceInfo' ? { field: label, old: ex[col] ? 'saved earlier' : '', new: 'from this file' } : { field: label, old: nz(ex[col]), new: nz(row[prop]) });
  }
  return out;
}

function summarise(rows, errTypes) {
  // only codes the error list (Settings) marks as errors count; blank, unknown and non-error codes (SG, OK) never do
  const isErr = (c) => errTypes.get(c)?.isError === true;
  const skus = new Set(rows.map((r) => r.skuId)); const samples = new Set(); const errSkus = new Set();
  const byCode = {}; let cls = 0; const byPerson = new Map();
  const person = (n) => { const k = (n || '(not recorded)').toLowerCase(); if (!byPerson.has(k)) byPerson.set(k, { name: n || '(not recorded)', skus: new Set(), samples: new Set(), errorSkus: new Set() }); return byPerson.get(k); };
  const multi = [];
  for (const r of rows) {
    const p = person(r.builder); p.skus.add(r.skuId);
    if (!r.sampled) continue;
    samples.add(r.skuId); p.samples.add(r.skuId);
    const errs = r.codes.filter(isErr);
    if (errs.length) { errSkus.add(r.skuId); p.errorSkus.add(r.skuId); cls += errs.length; if (errs.length > 1) multi.push({ skuId: r.skuId, builder: r.builder, codes: errs }); }
    for (const c of errs) byCode[c] = (byCode[c] || 0) + 1;
  }
  return { skus: skus.size, samples: samples.size, errorSkus: errSkus.size, classifications: cls, byCode, multi,
    people: [...byPerson.values()].map((p) => ({ name: p.name, skus: p.skus.size, samples: p.samples.size, errorSkus: p.errorSkus.size })) };
}

/** Checks that use ONLY the audit rows (columns A:N) - nothing from any summary table in the workbook. */
function dataChecks(rows, sum, errTypes, hasUnsampled, attributeColumns, taxonomyColumn) {
  const unrecognised = {};
  for (const r of rows) for (const c of r.codes) if (!errTypes.has(c)) unrecognised[c] = (unrecognised[c] || 0) + 1;
  return {
    rows: rows.length, skus: sum.skus, samples: sum.samples, errorSkus: sum.errorSkus, classifications: sum.classifications,
    extraClassifications: sum.classifications - sum.errorSkus, multiErrorSkus: sum.multi,
    totalSkusAvailable: hasUnsampled,
    totalSkusNote: hasUnsampled ? '' : 'Every row in this file is an audited sample, so the file does not show how many SKUs were assigned in total. Total SKUs and the sample audit percentage are shown as “Not available”.',
    unsampledWithAuditDetails: rows.filter((r) => !r.sampled && (r.auditor || r.codes.length || r.auditComments)).length,
    unrecognisedCodes: Object.entries(unrecognised).map(([code, rows]) => ({ code, rows })),
    missingBuilder: rows.filter((r) => !r.builder).length,
    categories: (() => {
      const found = !!taxonomyColumn?.found; const cats = new Set(rows.map((r) => l1Category(r.taxonomy)?.toLowerCase()).filter(Boolean)); // spelling/case differences are one category
      return { columnFound: found, column: taxonomyColumn?.column || null, count: cats.size, skusWithoutCategory: found ? rows.filter((r) => !l1Category(r.taxonomy)).length : rows.length,
        note: found ? '' : 'No “PIM Taxonomy” column was found, so this file cannot be used for Category Performance.' };
    })(),
    attributes: {
      columnsFound: !!attributeColumns?.found, slots: attributeColumns?.slots || 0,
      enrichedTotal: attributeColumns?.found ? rows.reduce((a, r) => a + (r.attrsEnriched || 0), 0) : null,
      note: attributeColumns?.found ? '' : 'No attribute columns (Att 1, Raw Val 1, Build Val 1 …) were found, so attributes enriched / audited and the attribute error % are Not available for this file.',
    },
  };
}

export async function analyzeUpload(db, uploadId, { auditDate, tableIndex } = {}) {
  const up = await db.get('SELECT * FROM uploads WHERE id = ?', [uploadId]);
  if (!up) throw bad('Upload not found');
  if (up.status !== 'preview') throw bad('This upload is no longer waiting for review.');
  const staged = JSON.parse(up.staged_json);
  if (staged.v !== PARSER_VERSION) {
    await db.run(`UPDATE uploads SET status='discarded', staged_json=NULL WHERE id = ?`, [uploadId]);
    throw bad('This preview was made by an older version of the reader. Please upload the file again.');
  }
  if (tableIndex != null && staged.tables[tableIndex]) staged.chosen = tableIndex;
  const date = auditDate !== undefined ? (auditDate || null) : up.audit_date;
  if (date && !isValidISO(date)) throw bad('The audit date is not a valid date (use YYYY-MM-DD).');
  const t = staged.tables[staged.chosen];
  const settings = await getSettings(db);
  const errTypes = await getErrorTypes(db);
  const existing = await loadExisting(db, t.rows.map((r) => r.skuId));
  const seen = new Map(); const review = []; const counts = { new: 0, identical: 0, changed: 0, conflict: 0, inFileDuplicate: 0, knownSku: 0 };
  const verdicts = {};
  for (const r of t.rows) {
    const key = recordKey(r, date, settings.dedupeIncludeDate);
    const ex = existing.get(r.skuId) || [];
    let v = 'new', def = 'import', reason = '', diff = [], target = null;
    if (seen.has(key)) {
      v = 'inFileDuplicate'; def = 'skip';
      const first = seen.get(key); const d = diffFields(r, { builder: first.builder, sample_flag: first.sampleFlag, auditor: first.auditor, error_raw: first.errorRaw, attribute_field: first.attributeField, audit_comments: first.auditComments, pt_status: first.ptStatus, pt_comments: first.ptComments, reaudit_comments: first.reauditComments, gap_similar: first.gapSimilar, pt_response: first.ptResponse, cfb_attribute: first.cfbAttribute, cfb_comments: first.cfbComments, attrs_enriched: first.attrsEnriched, taxonomy: first.taxonomy, source_info: first.sourceInfo });
      diff = d; reason = `Appears more than once in this file (first on row ${first.rowNo})${d.length ? ' with different details' : ''}.`;
    } else {
      seen.set(key, r);
      const same = ex.filter((e) => e.record_key === key);
      if (same.length) {
        const exact = same.find((e) => diffFields(r, e).length === 0);
        if (exact) { v = 'identical'; def = 'skip'; reason = 'Already imported with exactly the same details.'; target = exact.id; }
        else { v = 'changed'; def = 'update'; target = same[0].id; diff = diffFields(r, same[0]); reason = 'Same audit finding already imported, but some details are different (for example PT or re-audit progress).'; }
      } else if (ex.length) {
        const exSampled = ex.some((e) => e.is_sampled);
        if (!r.sampled) { v = 'knownSku'; def = 'skip'; reason = 'This SKU was imported before and this row has no audit result.'; }
        else if (exSampled) { v = 'conflict'; def = 'import'; reason = 'This SKU already has a different audit result. Import keeps both (shown in the SKU history).'; }
      }
    }
    counts[v === 'new' ? 'new' : v]++;
    verdicts[r.rowNo] = { v, def };
    if (v !== 'new') review.push({ rowNo: r.rowNo, skuId: r.skuId, builder: r.builder, auditor: r.auditor, codes: r.codes, verdict: v, defaultDecision: def, options: v === 'changed' ? ['update', 'skip', 'import'] : ['skip', 'import'], reason, diff, existingId: target });
  }
  const sum = summarise(t.rows, errTypes);
  const checks = dataChecks(t.rows, sum, errTypes, t.listsUnsampledSkus, t.attributeColumns, t.taxonomyColumn);
  const sameFile = await db.get(`SELECT id, imported_at, audit_date FROM uploads WHERE file_hash = ? AND status = 'imported' ORDER BY id DESC`, [up.file_hash]);
  const blockers = [];
  if (t.missingRequired.length) blockers.push(`Required column missing: ${t.missingRequired.join(', ')}`);
  if (!t.rows.length) blockers.push('The sheet has no usable rows.');
  if (!date) blockers.push('Choose the audit date for this file (no date was found in the file name).');
  const willImport = review.filter((x) => x.defaultDecision === 'import').length + counts.new;
  // A week is Monday to Saturday, so a Sunday audit date falls outside every weekly report. Say so instead of letting the rows quietly miss the report.
  const warnings = { ...t.warnCounts };
  if (date && parseISO(date).getUTCDay() === 0) warnings['The audit date is a Sunday. Weekly reports cover Monday to Saturday, so these rows will not be in a weekly report (they still count everywhere else). Change the date if it is a mistake.'] = t.rows.length;
  return {
    upload: { id: up.id, fileName: up.original_name, fileSize: up.file_size, auditDate: date, project: up.project || suggestProject(up.original_name), dateFromName: staged.nameDate, uploadedAt: up.uploaded_at },
    sheet: { used: t.sheet, headerRow: t.headerRow, index: staged.chosen, options: staged.tables.map((x, i) => ({ index: i, name: x.sheet, rows: x.rows.length })), allSheets: staged.sheetNames },
    columns: { found: t.columnsFound, missingRequired: t.missingRequired, missingOptional: t.missingOptional },
    counts: { rowsRead: t.rows.length + t.skipped.length, blankRows: t.blankRows, invalid: t.skipped.length, ...counts, willImport, willUpdate: review.filter((x) => x.defaultDecision === 'update').length },
    validation: { warnings, missingValues: Object.fromEntries(Object.entries(t.missingCounts).map(([k, n]) => [FIELDS[k].label, n])), skipped: t.skipped.slice(0, 200), unrecognisedCodes: checks.unrecognisedCodes },
    sameFileBefore: sameFile ? { uploadId: sameFile.id, importedAt: sameFile.imported_at, auditDate: sameFile.audit_date } : null,
    review: review.slice(0, 2000), reviewTotal: review.length,
    preview: t.rows.slice(0, 30).map((r) => ({ rowNo: r.rowNo, skuId: r.skuId, builder: r.builder, sample: r.sampleFlag, auditor: r.auditor, errorType: r.errorRaw, attribute: r.attributeField, ptStatus: r.ptStatus, warnings: r.warnings })),
    computed: { skus: sum.skus, samples: sum.samples, errorSkus: sum.errorSkus, classifications: sum.classifications, byCode: sum.byCode },
    dataChecks: checks,
    // `review` above is cut to 2000 rows for the screen; the import must see EVERY row that needs a decision (a long file uploaded again would otherwise add its later rows twice)
    blockers, _staged: staged, _verdicts: verdicts, _date: date, _reviewAll: review,
  };
}

/* ----------------------------------------------------------------- commit */
export async function commitUpload(db, uploadId, { auditDate, decisions = {}, tableIndex, userId, project }) {
  const a = await analyzeUpload(db, uploadId, { auditDate, tableIndex });
  if (a.blockers.length) throw bad(a.blockers[0]);
  const projectName = String(project ?? '').trim() || a.upload.project;
  if (projectName.length > 120) throw bad('The project name is too long (120 characters at most).');
  const settings = await getSettings(db);
  const errTypes = await getErrorTypes(db);
  const t = a._staged.tables[a._staged.chosen]; const date = a._date;
  const reviewMap = new Map(a._reviewAll.map((x) => [x.rowNo, x]));
  const res = { imported: 0, updated: 0, skipped: [], updatedRows: [], importedWithWarnings: 0 };

  await db.tx(async (tx) => {
    // Two clicks / two people importing the same preview must not add it twice: only the first one finds it still waiting.
    const still = await tx.get('SELECT status FROM uploads WHERE id = ?', [uploadId]);
    if (still?.status !== 'preview') throw bad('This upload was already imported or cancelled.');
    const empCache = new Map();
    const emp = async (name, role) => {
      const n = nz(name); if (!n) return null;
      const k = n.toLowerCase(); let id = empCache.get(k);
      if (!id) {
        const row = await tx.get('SELECT id FROM employees WHERE lower(name) = ?', [k]);
        id = row ? row.id : await tx.insert('INSERT INTO employees (name, active, created_at) VALUES (?,1,?)', [n, now()]);
        empCache.set(k, id);
      }
      await tx.run('INSERT INTO employee_roles (employee_id, role) VALUES (?,?) ON CONFLICT DO NOTHING', [id, role]);
      return id;
    };
    const write = async (r, existingId) => {
      const builderId = await emp(r.builder, 'content'); const auditorId = await emp(r.auditor, 'auditor');
      await tx.run('INSERT INTO skus (sku_id) VALUES (?) ON CONFLICT(sku_id) DO NOTHING', [r.skuId]);
      const hasFindings = r.codes.some((c) => c !== 'OK') ? 1 : 0;
      const vals = [builderId, auditorId, r.sampled ? 1 : 0, r.sampleFlag, r.errorRaw, r.attributeField, r.auditComments, r.ptStatus, r.ptComments, r.reauditComments, r.gapSimilar, r.ptResponse, r.cfbAttribute, r.cfbComments, hasFindings, r.attrsEnriched ?? null, r.taxonomy ?? null, r.sourceInfo ?? null];
      let id = existingId;
      if (id) {
        await tx.run(`UPDATE audit_records SET content_employee_id=?, auditor_id=?, is_sampled=?, sample_flag=?, error_raw=?, attribute_field=?, audit_comments=?, pt_status=?, pt_comments=?, reaudit_comments=?, gap_similar=?, pt_response=?, cfb_attribute=?, cfb_comments=?, has_findings=?, attrs_enriched=COALESCE(?, attrs_enriched), taxonomy=COALESCE(?, taxonomy), source_info=COALESCE(?, source_info) WHERE id=?`, [...vals, id]);
        await tx.run('DELETE FROM error_classifications WHERE audit_record_id = ?', [id]);
        if (r.attrsEnriched != null) await tx.run('DELETE FROM record_attributes WHERE audit_record_id = ?', [id]); // keep the stored attribute flags when this file has no attribute columns
      } else {
        id = await tx.insert(`INSERT INTO audit_records (upload_id, sku_id, record_key, audit_date, week_start, month, content_employee_id, auditor_id, is_sampled, sample_flag, error_raw, attribute_field, audit_comments, pt_status, pt_comments, reaudit_comments, gap_similar, pt_response, cfb_attribute, cfb_comments, has_findings, attrs_enriched, taxonomy, source_info)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [uploadId, r.skuId, recordKey(r, date, settings.dedupeIncludeDate), date, weekStart(date), monthOf(date), ...vals]);
      }
      for (const c of r.codes) await tx.run('INSERT INTO error_classifications (audit_record_id, code) VALUES (?,?)', [id, c]);
      if (!existingId || r.attrsEnriched != null) for (const at of r.attrDetail) await tx.run('INSERT INTO record_attributes (audit_record_id, attribute, is_attribute, was_enriched) VALUES (?,?,?,?)', [id, at.name, at.isAttribute, at.wasEnriched]);
      await writeTracking(tx, id, r, classifyFollowUp(r, settings));
      return id;
    };
    for (const r of t.rows) {
      const rev = reviewMap.get(r.rowNo);
      const dec = rev ? (decisions[r.rowNo] || rev.defaultDecision) : 'import';
      if (rev && !rev.options.includes(dec)) throw bad(`Row ${r.rowNo}: "${dec}" is not allowed for this record.`);
      if (dec === 'skip') { res.skipped.push({ rowNo: r.rowNo, skuId: r.skuId, reason: rev?.reason || 'Skipped by reviewer' }); continue; }
      if (dec === 'update') {
        await write(r, rev.existingId); res.updated++;
        res.updatedRows.push({ rowNo: r.rowNo, skuId: r.skuId, changes: rev.diff });
      } else { await write(r, null); res.imported++; if (r.warnings.length) res.importedWithWarnings++; }
    }
    for (const s of t.skipped) res.skipped.push({ rowNo: s.rowNo, skuId: s.skuId, reason: s.reason });
    const report = {
      file: a.upload.fileName, sheet: t.sheet, auditDate: date,
      counts: { rowsRead: a.counts.rowsRead, blankRows: a.counts.blankRows, imported: res.imported, updated: res.updated, skipped: res.skipped.length },
      skipped: res.skipped, updated: res.updatedRows, validation: a.validation, columns: a.columns, computed: a.computed, dataChecks: a.dataChecks,
      decisionsChanged: Object.keys(decisions).length,
    };
    await tx.run(`UPDATE uploads SET status='imported', imported_at=?, audit_date=?, sheet_name=?, header_row=?, total_rows=?, imported_rows=?, updated_rows=?, skipped_rows=?, has_unsampled=?, project=?, report_json=?, staged_json=NULL WHERE id=?`,
      [now(), date, t.sheet, t.headerRow, a.counts.rowsRead, res.imported, res.updated, res.skipped.length, t.listsUnsampledSkus ? 1 : 0, projectName, JSON.stringify(report), uploadId]);
  });
  return { imported: res.imported, updated: res.updated, skipped: res.skipped.length };
}

export async function discardUpload(db, uploadId) {
  await db.run(`UPDATE uploads SET status='discarded', staged_json=NULL WHERE id = ? AND status = 'preview'`, [uploadId]);
}

/** Remove everything a bad import added. (Records that this import only UPDATED are not reverted.) */
export async function undoUpload(db, uploadId) {
  const up = await db.get('SELECT * FROM uploads WHERE id = ?', [uploadId]);
  if (!up || up.status !== 'imported') throw bad('Only a completed import can be undone.');
  await db.tx(async (tx) => {
    await tx.run('DELETE FROM audit_records WHERE upload_id = ?', [uploadId]);
    await tx.run('DELETE FROM skus WHERE sku_id NOT IN (SELECT sku_id FROM audit_records)');
    await tx.run(`UPDATE uploads SET status='undone' WHERE id = ?`, [uploadId]);
  });
}

export async function purgeStalePreviews(db, hours = 24) {
  const cutoff = new Date(Date.now() - hours * 3600e3).toISOString();
  await db.run(`UPDATE uploads SET status='discarded', staged_json=NULL WHERE status='preview' AND uploaded_at < ?`, [cutoff]);
}
