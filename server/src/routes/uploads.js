import fs from 'node:fs';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { wrap, HttpError } from '../lib/http.js';
import { need } from './auth.js';
import { config } from '../config.js';
import { l1Category } from '../services/parser.js';
import { isLocalRequest, saveTempCopy, openWithDefaultApp } from '../lib/local.js';
import { saveOriginal, findOriginal } from '../services/originals.js';
import { stageUpload, analyzeUpload, commitUpload, discardUpload, undoUpload, purgeStalePreviews } from '../services/importer.js';

const publicAnalysis = (a) => Object.fromEntries(Object.entries(a).filter(([k]) => !k.startsWith('_')));

const upload = multer({
  storage: multer.memoryStorage(), // files are parsed in memory; a copy of a readable file is kept in data/originals only for "Open in Excel"
  limits: { fileSize: config.maxUploadBytes, files: 10 },
  fileFilter: (req, file, cb) => (/\.(ods|xlsx|xls)$/i.test(file.originalname) ? cb(null, true) : cb(new HttpError(400, `"${file.originalname}" is not an .ods, .xlsx or .xls file.`))),
});

const commitSchema = z.object({
  auditDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  tableIndex: z.number().int().min(0).max(10).optional(),
  project: z.string().trim().max(120).optional(),
  decisions: z.record(z.string(), z.enum(['skip', 'update', 'import'])).default({}),
});

export function uploadsRouter(db) {
  const r = Router();

  r.get('/', need('view'), wrap(async (req, res) => {
    await purgeStalePreviews(db);
    const rows = await db.all(`SELECT u.id, u.original_name, u.project, u.status, u.audit_date, u.uploaded_at, u.imported_at, u.total_rows, u.imported_rows, u.updated_rows, u.skipped_rows, u.file_size, us.display_name AS uploaded_by,
      (SELECT COUNT(*) FROM audit_records r WHERE r.upload_id = u.id AND r.attrs_enriched IS NULL) AS no_attr,
      u.report_json FROM uploads u LEFT JOIN users us ON us.id = u.uploaded_by WHERE u.status <> 'discarded' ORDER BY u.id DESC LIMIT 300`);
    res.json(rows.map(({ report_json, ...x }) => ({ ...x, error: x.status === 'failed' ? (JSON.parse(report_json || '{}').error || 'Failed') : null })));
  }));

  // Step 1: read + check the files. Nothing is added to the audit data yet.
  r.post('/', need('upload'), upload.array('files', 10), wrap(async (req, res) => {
    if (!req.files?.length) throw new HttpError(400, 'Choose at least one file.');
    const out = [];
    for (const f of req.files) {
      const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
      const staged = await stageUpload(db, { buffer: f.buffer, filename: name, userId: req.user.id });
      if (!staged.failed) { const up = await db.get('SELECT file_hash FROM uploads WHERE id = ?', [staged.id]); saveOriginal(up?.file_hash, name, f.buffer); } // for "Open in Excel" (full file)
      if (staged.failed) out.push({ id: staged.id, fileName: name, failed: true, error: staged.error });
      else out.push({ id: staged.id, fileName: name, failed: false, analysis: publicAnalysis(await analyzeUpload(db, staged.id)) });
    }
    res.status(201).json({ files: out });
  }));

  r.get('/:id(\\d+)', need('view'), wrap(async (req, res) => {
    const up = await db.get('SELECT * FROM uploads WHERE id = ?', [req.params.id]);
    if (!up) throw new HttpError(404, 'Upload not found.');
    if (up.status === 'preview') return res.json({ status: up.status, analysis: publicAnalysis(await analyzeUpload(db, up.id)) });
    res.json({ status: up.status, fileName: up.original_name, auditDate: up.audit_date, report: up.report_json ? JSON.parse(up.report_json) : null });
  }));

  // Re-check duplicates after the date or sheet changed
  r.post('/:id(\\d+)/analyze', need('upload'), wrap(async (req, res) => {
    const body = z.object({ auditDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), tableIndex: z.number().int().min(0).max(10).optional() }).parse(req.body);
    res.json({ analysis: publicAnalysis(await analyzeUpload(db, Number(req.params.id), { auditDate: body.auditDate, tableIndex: body.tableIndex })) });
  }));

  // Step 2: import (one transaction: everything is saved or nothing is)
  r.post('/:id(\\d+)/commit', need('upload'), wrap(async (req, res) => {
    const body = commitSchema.parse(req.body);
    const result = await commitUpload(db, Number(req.params.id), { ...body, userId: req.user.id });
    res.json(result);
  }));
  // rename the project of an imported file (all dashboards follow)
  r.patch('/:id(\\d+)/project', need('upload'), wrap(async (req, res) => {
    const { project } = z.object({ project: z.string().trim().min(1, 'Type a project name.').max(120) }).parse(req.body);
    const done = await db.run(`UPDATE uploads SET project = ? WHERE id = ? AND status = 'imported'`, [project, Number(req.params.id)]);
    if (!done.changes) throw new HttpError(404, 'Only an imported file can be renamed.');
    res.json({ project });
  }));
  r.post('/:id(\\d+)/discard', need('upload'), wrap(async (req, res) => { await discardUpload(db, Number(req.params.id)); res.json({ ok: true }); }));
  r.post('/:id(\\d+)/undo', need('undoUpload'), wrap(async (req, res) => { await undoUpload(db, Number(req.params.id)); res.json({ ok: true }); }));

  // "Open in Excel": the rows this upload added, as an .xlsx (original columns A:N first, then date / project / category / attributes).
  // The original uploaded file itself is not kept (files are only read in memory), so this is rebuilt from what was imported.
  // When the original uploaded file is kept (data/originals), that FULL file is opened as it was uploaded; otherwise the A:N rebuild below.
  const TYPES = { ods: 'application/vnd.oasis.opendocument.spreadsheet', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  const buildExcel = async (id) => {
    const up = await db.get('SELECT * FROM uploads WHERE id = ?', [id]);
    if (!up || up.status !== 'imported') throw new HttpError(404, 'Only a completed import can be opened in Excel.');
    const orig = findOriginal(up);
    if (orig) return { filename: String(up.original_name).replace(/[^\w .()-]+/g, '_'), buffer: fs.readFileSync(orig.file), type: TYPES[orig.ext], original: true };
    const rows = await db.all(`SELECT r.sku_id, b.name AS builder, r.sample_flag, a.name AS auditor, r.error_raw, r.attribute_field, r.audit_comments, r.pt_status, r.pt_comments, r.reaudit_comments,
        r.gap_similar, r.pt_response, r.cfb_attribute, r.cfb_comments, r.audit_date, r.taxonomy, r.attrs_enriched
      FROM audit_records r LEFT JOIN employees b ON b.id = r.content_employee_id LEFT JOIN employees a ON a.id = r.auditor_id WHERE r.upload_id = ? ORDER BY r.id`, [up.id]);
    if (!rows.length) throw new HttpError(400, 'This upload only updated records that were added by an earlier upload of the same file. Open the earlier upload instead.');
    const head = ['SKU ID', 'SKU Build By', 'Sample', 'Audit By', 'Error Type', 'Attribute/Field', 'Audit Comments', 'PT Status', 'PT Comments', 'Re-Audit Comments', 'Gap/Similar', 'PT Response', 'CFB Attribute', 'CFB Comments',
      'Audit Date (entered at upload)', 'PIM Taxonomy', 'Category (L1)', 'Attributes enriched'];
    const aoa = [head, ...rows.map((x) => [x.sku_id, x.builder || '', x.sample_flag || '', x.auditor || '', x.error_raw || '', x.attribute_field || '', x.audit_comments || '', x.pt_status || '', x.pt_comments || '',
      x.reaudit_comments || '', x.gap_similar || '', x.pt_response || '', x.cfb_attribute || '', x.cfb_comments || '', x.audit_date, x.taxonomy || '', l1Category(x.taxonomy) || '', x.attrs_enriched ?? ''])];
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = head.map((h, i) => ({ wch: i === 0 ? 12 : i < 6 ? 20 : i < 14 ? 34 : 24 })); ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: head.length - 1 } }) };
    const about = XLSX.utils.aoa_to_sheet([['About this file'], [], ['Original file name', up.original_name], ['Project', up.project || ''], ['Audit date', up.audit_date || ''], ['Uploaded', up.uploaded_at], ['Rows in this sheet', rows.length], [],
      ['Note', 'The columns SKU ID to CFB Comments are the original columns A to N, with the text exactly as imported. The last four columns were added by the dashboard.'],
      ['', 'This is rebuilt from the dashboard data; the original uploaded file is not stored.']]); about['!cols'] = [{ wch: 22 }, { wch: 100 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Audit data'); XLSX.utils.book_append_sheet(wb, about, 'About this file');
    const base = String(up.original_name).replace(/\.(ods|xlsx|xls)$/i, '').replace(/[^\w .()-]+/g, '_').slice(0, 80);
    return { filename: `${base} (from dashboard).xlsx`, buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), type: TYPES.xlsx, original: false };
  };
  // Download (dashboard used from another computer, e.g. the live site): an .ods original is sent as an .xlsx copy with every sheet,
  // row and column, so a double-click opens it in Excel (older Excel cannot open .ods). ?original=1 sends the file exactly as uploaded.
  r.get('/:id(\\d+)/export', need('view'), wrap(async (req, res) => {
    let { filename, buffer, type } = await buildExcel(req.params.id);
    if (req.query.original !== '1' && /\.ods$/i.test(filename)) {
      try {
        const wb = XLSX.read(buffer, { type: 'buffer', cellStyles: true });
        buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellStyles: true, compression: true });
        filename = filename.replace(/\.ods$/i, '.xlsx'); type = TYPES.xlsx;
      } catch { /* cannot convert: send the original .ods */ }
    }
    res.set({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(buffer);
  }));
  // Same file, but opened straight in Excel on this computer. Only when the browser is on the same PC as the server; otherwise the page falls back to the download above.
  r.post('/:id(\\d+)/open-local', need('view'), wrap(async (req, res) => {
    if (!isLocalRequest(req)) return res.json({ opened: false, reason: 'remote' });
    const { filename, buffer, original } = await buildExcel(req.params.id);
    const file = saveTempCopy(filename, buffer);
    const launched = openWithDefaultApp(file);
    res.json({ opened: true, launched, file, original });
  }));

  r.get('/:id(\\d+)/report', need('view'), wrap(async (req, res) => {
    const up = await db.get('SELECT * FROM uploads WHERE id = ?', [req.params.id]);
    if (!up || !up.report_json) throw new HttpError(404, 'No processing report for this upload.');
    const rep = JSON.parse(up.report_json);
    const wb = XLSX.utils.book_new();
    const add = (n, aoa, w) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = w.map((x) => ({ wch: x })); XLSX.utils.book_append_sheet(wb, ws, n); };
    if (rep.error) add('Summary', [['File', up.original_name], ['Result', 'Failed'], ['Reason', rep.error]], [18, 90]);
    else {
      const c = rep.counts;
      add('Summary', [['File', rep.file], ['Sheet used', rep.sheet], ['Audit date', rep.auditDate], ['Uploaded', up.uploaded_at], [],
        ['Rows read', c.rowsRead], ['Blank rows ignored', c.blankRows], ['Records imported', c.imported], ['Records updated', c.updated], ['Records skipped', c.skipped], [],
        ['SKUs in file', rep.computed.skus], ['Samples audited', rep.computed.samples], ['SKUs with errors', rep.computed.errorSkus], ['Error classifications', rep.computed.classifications]], [24, 70]);
      add('Skipped', [['Row', 'SKU ID', 'Reason'], ...rep.skipped.map((s) => [s.rowNo, s.skuId, s.reason])], [8, 18, 90]);
      add('Updated', [['Row', 'SKU ID', 'Field', 'Old value', 'New value'], ...rep.updated.flatMap((u) => u.changes.map((d) => [u.rowNo, u.skuId, d.field, d.old, d.new]))], [8, 18, 22, 50, 50]);
      add('Warnings', [['Issue', 'Rows'], ...Object.entries(rep.validation.warnings || {}), [], ['Missing values', 'Rows'], ...Object.entries(rep.validation.missingValues || {})], [70, 10]);
      const d = rep.dataChecks || {};
      add('Data checks', [['Check (calculated only from columns A:N of the file)', 'Value'],
        ['Rows with data', d.rows], ['Distinct SKUs', d.skus], ['Audited samples (Sample column filled)', d.samples], ['SKUs with errors', d.errorSkus], ['Error classifications', d.classifications],
        ['Extra classifications from SKUs with several error codes', d.extraClassifications], ['Rows missing SKU Build By', d.missingBuilder],
        ['Rows with audit details but Sample empty (not counted as audited)', d.unsampledWithAuditDetails],
        ['Total SKUs available?', d.totalSkusAvailable ? 'Yes' : 'Not available – ' + (d.totalSkusNote || '')],
        [], ['Unrecognised error code', 'Rows (not counted as errors until added in Settings)'], ...(d.unrecognisedCodes || []).map((u) => [u.code, u.rows])], [64, 60]);
    }
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="upload-report-${up.id}.xlsx"` });
    res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }));
  return r;
}
