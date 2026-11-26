// Reads an uploaded workbook (.ods / .xlsx / .xls) and turns it into audit rows.
//
// STRICT SOURCE RULES
//  * Only columns A:N of a sheet are ever read (the 14 audit columns). Everything to the right (product/PIM columns,
//    helper columns, pre-calculated tables) is ignored, as are other sheets that do not have the audit headers.
//  * The sheet and header row are found from the column headers, never from a sheet name or a fixed position.
//  * Summary tables / dashboards inside the workbook are never read and never used for any number.
//  * Original text is kept as written (only leading/trailing spaces are trimmed).
import * as XLSX from 'xlsx';

export const COLUMN_LIMIT = 14; // A..N
export const COL_LETTER = (i) => String.fromCharCode(65 + i);
export const norm = (s) => String(s ?? '').toLowerCase().replace(/[_\s]+/g, ' ').replace(/[^a-z0-9/# ]/g, '').replace(/\s+/g, ' ').trim();
export const clean = (v) => { const s = String(v ?? '').trim(); return /^(nan|null|undefined)$/i.test(s) ? '' : s; };

// The 14 source columns. `syn` are accepted header spellings (matched within A:N only).
export const FIELDS = {
  skuId: { label: 'SKU ID', required: true, syn: ['sku id', 'sku', 'sku no', 'sku number', 'item id'] },
  builder: { label: 'SKU Build By', required: true, syn: ['sku build by', 'build by', 'built by', 'sku built by', 'sku builder', 'builder'] },
  sample: { label: 'Sample', syn: ['sample', 'sampled', 'sample type', 'audit sample'] },
  auditor: { label: 'Audit By', syn: ['audit by', 'audited by', 'auditor', 'auditor name'] },
  errorType: { label: 'Error Type', syn: ['error type', 'error code', 'error codes', 'error types'] },
  attribute: { label: 'Attribute/Field', syn: ['attribute/field', 'attribute / field', 'attribute field'] },
  auditComments: { label: 'Audit Comments', syn: ['audit comments', 'audit comment', 'auditor comments', 'auditor comment'] },
  ptStatus: { label: 'PT Status', syn: ['pt status'] },
  ptComments: { label: 'PT Comments', syn: ['pt comments', 'pt comment'] },
  reauditComments: { label: 'Re-Audit Comments', syn: ['reaudit comments', 're audit comments', 'reaudit comment', 're-audit comments'] },
  gapSimilar: { label: 'Gap/Similar', syn: ['gap/similar', 'gap / similar', 'gap similar'] },
  ptResponse: { label: 'PT Response', syn: ['pt response'] },
  cfbAttribute: { label: 'CFB Attribute', syn: ['cfb attribute'] },
  cfbComments: { label: 'CFB Comments', syn: ['cfb comments', 'cfb comment'] },
};
export const AUDIT_FIELD_KEYS = Object.keys(FIELDS);
const SYN = Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, f.syn.map(norm)]));

/** header row (already limited to A:N) -> { fieldKey: columnIndex } */
export function autoMap(headerRow) {
  const hdr = headerRow.slice(0, COLUMN_LIMIT).map(norm); const idx = {}; const used = new Set();
  for (const k of Object.keys(FIELDS)) {
    for (const s of SYN[k]) { const i = hdr.findIndex((h, j) => h === s && !used.has(j)); if (i >= 0) { idx[k] = i; used.add(i); break; } }
  }
  return idx;
}

export class ReadError extends Error {}

export function readWorkbook(buffer, filename) {
  if (!/\.(ods|xlsx|xls)$/i.test(filename)) throw new ReadError('This is not a supported file type. Please upload an .ods, .xlsx or .xls file.');
  // check the file really is a spreadsheet container (zip = xlsx/ods, OLE = xls) before parsing
  const zip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  const ole = buffer.length > 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  if (!zip && !ole) throw new ReadError('This file does not look like a real spreadsheet (its content does not match its extension). Open it in Excel/LibreOffice and save it again as .xlsx or .ods.');
  try {
    return XLSX.read(buffer, { type: 'buffer', cellFormula: false, cellHTML: false, cellStyles: false, dense: false });
  } catch (e) {
    const m = String(e?.message || e);
    if (/password|encrypt/i.test(m)) throw new ReadError('This file is password-protected. Remove the password, save it, and upload again.');
    throw new ReadError('This file could not be opened. It may be damaged or still locked by Excel. Save a fresh copy (.xlsx or .ods) and try again.');
  }
}

/** Rows of a sheet, columns A:N only. Row index i = spreadsheet row i+1 (blank rows are kept so row numbers are true). */
function sheetRows(wb, name) {
  const ws = wb.Sheets[name]; if (!ws || !ws['!ref']) return [];
  const rg = XLSX.utils.decode_range(ws['!ref']);
  const end = { r: rg.e.r, c: Math.min(rg.e.c, COLUMN_LIMIT - 1) };
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: true, range: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: end }) });
}

/** Finds, by column headers only, every sheet that holds the audit table. Best match first. */
export function detectTable(wb) {
  const tables = [];
  for (const name of wb.SheetNames) {
    const aoa = sheetRows(wb, name); let best = null;
    for (let r = 0; r < Math.min(30, aoa.length); r++) {
      const idx = autoMap(aoa[r]); const n = Object.keys(idx).length;
      if (idx.skuId == null || idx.builder == null) continue; // the two columns every audit table must have
      if (!best || n > best.matched) best = { name, aoa, headerRow: r, idx, matched: n, rowCount: aoa.length - r - 1 };
    }
    if (best) tables.push(best);
  }
  tables.sort((a, b) => b.matched - a.matched || b.rowCount - a.rowCount);
  return { usable: tables, sheetNames: wb.SheetNames };
}

/* ---------------------------------------------------------------------------------------------------------------
   ATTRIBUTE COLUMNS (the one deliberate exception to "A:N only", chosen by the user for attribute-based numbers).
   Right of column N the file lists, per SKU, up to ~100 attribute slots:  "Att 1", "Raw Val 1", "Build Val 1", "UOM 1" …
   Nothing else beyond N is read. Per SKU we only COUNT:
     assigned  = slots whose "Att n" cell has an attribute name
     enriched  = assigned slots that also have a Raw Val or Build Val   (the attribute was actually filled in)
   If the headings are not found the file simply has no attribute counts ("Not available").
--------------------------------------------------------------------------------------------------------------- */
const ATT_RE = /^att(?:ribute)?[\s_.:-]*(\d+)$/i; const RAW_RE = /^raw[\s_.-]*val(?:ue)?[\s_.:-]*(\d+)$/i; const BUILD_RE = /^build[\s_.-]*val(?:ue)?[\s_.:-]*(\d+)$/i;
const cellText = (ws, r, c) => { const x = ws[XLSX.utils.encode_cell({ r, c })]; return x && x.v !== undefined ? clean(x.w ?? x.v) : ''; };
const attrKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function readAttributeColumns(wb, table) {
  const ws = wb.Sheets[table.name]; if (!ws || !ws['!ref']) return null;
  const rg = XLSX.utils.decode_range(ws['!ref']); const hr = table.headerRow; const slots = {};
  for (let c = COLUMN_LIMIT; c <= rg.e.c; c++) {
    const h = cellText(ws, hr, c); let m;
    if ((m = ATT_RE.exec(h))) (slots[m[1]] ||= {}).att = c; else if ((m = RAW_RE.exec(h))) (slots[m[1]] ||= {}).raw = c; else if ((m = BUILD_RE.exec(h))) (slots[m[1]] ||= {}).build = c;
  }
  const usable = Object.values(slots).filter((s) => s.att != null && (s.raw != null || s.build != null));
  if (!usable.length) return null;
  const rows = new Map();
  for (let r = hr + 1; r <= rg.e.r; r++) {
    const assigned = new Set(); const enriched = new Set();
    for (const s of usable) {
      const name = cellText(ws, r, s.att); if (!name) continue;
      assigned.add(attrKey(name));
      if ((s.raw != null && cellText(ws, r, s.raw)) || (s.build != null && cellText(ws, r, s.build))) enriched.add(attrKey(name));
    }
    rows.set(r + 1, { assigned, enriched });
  }
  return { slotCount: usable.length, rows };
}

/* ---------------------------------------------------------------------------------------------------------------
   PIM TAXONOMY (second deliberate exception to "A:N only", for Category-Based Performance Tracking).
   The column is found by its HEADING ("PIM Taxonomy"), wherever it is (in the sample it is column R). Only that one column is read.
   Example value: "Abrasives > Blasting, Deburring and Sharpening > Dust Collectors, Air Filter Systems … > Metalworking Dust Collectors"
   The L1 category is the text before the first ">"  ->  "Abrasives".
--------------------------------------------------------------------------------------------------------------- */
const TAX_HEADINGS = ['pim taxonomy', 'pim taxonomy path', 'taxonomy'];
/** L1 category of a taxonomy path, or null */
export function l1Category(taxonomy) {
  const first = String(taxonomy ?? '').split('>')[0].replace(/\s+/g, ' ').trim();
  return first || null;
}
/** Finds the PIM Taxonomy column in the header row (any column) and returns Map(rowNo -> full taxonomy text), or null if there is none. */
export function readTaxonomyColumn(wb, table) {
  const ws = wb.Sheets[table.name]; if (!ws || !ws['!ref']) return null;
  const rg = XLSX.utils.decode_range(ws['!ref']); const hr = table.headerRow;
  let col = -1;
  for (const want of TAX_HEADINGS) { for (let c = 0; c <= rg.e.c && col < 0; c++) if (norm(cellText(ws, hr, c)) === want) col = c; if (col >= 0) break; }
  if (col < 0) return null;
  const rows = new Map();
  for (let r = hr + 1; r <= rg.e.r; r++) rows.set(r + 1, cellText(ws, r, col));
  return { column: XLSX.utils.encode_col(col), rows };
}

/* ---------------------------------------------------------------------------------------------------------------
   SOURCE LINKS (third deliberate exception to "A:N only", for "Check mistakes at the source" on the Product Team page).
   Read ONLY for rows that name something in Attribute/Field (column F), and only these columns (found by heading):
     per attribute slot n :  "Raw Val n" (the captured value), "PT_Source URL Link n", "PT_Source Page# n"
     per SKU              :  "PT_Data Source URL_1/2", "PT_PDF Source URL_1/2", "PT_PDF Page#_1/2"
   Only web links (http / https) are kept. Nothing is guessed: no link in the file = no link shown.
--------------------------------------------------------------------------------------------------------------- */
const SLOT_URL_RE = /^(?:pt[\s_.-]*)?source[\s_.-]*url[\s_.-]*link[\s_.:#-]*(\d+)$/i; const SLOT_PAGE_RE = /^(?:pt[\s_.-]*)?source[\s_.-]*page[\s_.#:-]*(\d+)$/i;
const SKU_URL_RE = /^(?:pt[\s_.-]*)?(data|pdf)[\s_.-]*source[\s_.-]*url[\s_.:#-]*(\d+)$/i; const SKU_PAGE_RE = /^(?:pt[\s_.-]*)?pdf[\s_.-]*page[\s_.#:-]*(\d+)$/i;
/** the key used to match a name in Attribute/Field with an attribute of the SKU (ignores case, spacing and punctuation such as – vs -) */
export const sourceKey = (s) => attrKey(s);
/** every web link written in a cell (a cell can hold several, separated by | or spaces); falls back to the cell's hidden hyperlink */
function cellLinks(ws, r, c) {
  if (c == null) return [];
  const cell = ws[XLSX.utils.encode_cell({ r, c })]; const text = cellText(ws, r, c);
  let found = text.match(/(?:https?:\/\/|www\.)[^\s|"<>]+/gi) || [];
  if (!found.length && /^(?:https?:\/\/)/i.test(cell?.l?.Target || '')) found = [cell.l.Target];
  return [...new Set(found.map((u) => u.replace(/[.,;]+$/, '')).map((u) => (/^www\./i.test(u) ? `https://${u}` : u)).filter((u) => u.length <= 2000))].slice(0, 5);
}
const pageNo = (s) => { const m = /\d{1,5}/.exec(String(s)); return m ? Number(m[0]) : null; };

/** Map(rowNo -> {attrs: {key: {value, links:[{url,page}]}}, product: [{kind, url, page}]}) for rows that name an attribute, or null if the file has no source link columns. */
export function readSourceColumns(wb, table) {
  const ws = wb.Sheets[table.name]; if (!ws || !ws['!ref'] || table.idx.attribute == null) return null;
  const rg = XLSX.utils.decode_range(ws['!ref']); const hr = table.headerRow; const slots = {}; const sku = {};
  for (let c = COLUMN_LIMIT; c <= rg.e.c; c++) {
    const h = cellText(ws, hr, c); let m;
    if ((m = ATT_RE.exec(h))) (slots[m[1]] ||= {}).att ??= c;
    else if ((m = RAW_RE.exec(h))) (slots[m[1]] ||= {}).raw ??= c;
    else if ((m = SLOT_URL_RE.exec(h))) (slots[m[1]] ||= {}).url ??= c;
    else if ((m = SLOT_PAGE_RE.exec(h))) (slots[m[1]] ||= {}).page ??= c;
    else if ((m = SKU_URL_RE.exec(h))) (sku[`${m[1].toLowerCase()}${m[2]}`] ||= { kind: m[1].toLowerCase(), n: m[2] }).url ??= c;
    else if ((m = SKU_PAGE_RE.exec(h))) (sku[`pdf${m[1]}`] ||= { kind: 'pdf', n: m[1] }).page ??= c;
  }
  const attSlots = Object.values(slots).filter((s) => s.att != null);
  const skuCols = Object.values(sku).filter((s) => s.url != null).sort((a, b) => a.kind.localeCompare(b.kind) || a.n - b.n);
  if (!attSlots.some((s) => s.url != null) && !skuCols.length) return null;
  const rows = new Map();
  for (let r = hr + 1; r <= rg.e.r; r++) {
    const wanted = new Set(splitAttributes(cellText(ws, r, table.idx.attribute)).map(attrKey).filter(Boolean));
    if (!wanted.size) continue;
    const attrs = {};
    for (const s of attSlots) {
      const name = cellText(ws, r, s.att); if (!name) continue;
      const k = attrKey(name); if (!wanted.has(k)) continue;
      const o = (attrs[k] ||= { value: '', links: [] });
      const value = s.raw != null ? cellText(ws, r, s.raw).slice(0, 1000) : '';
      if (value && !o.value) o.value = value;
      const page = s.page != null ? pageNo(cellText(ws, r, s.page)) : null;
      for (const url of cellLinks(ws, r, s.url)) if (!o.links.some((l) => l.url === url && l.page === page)) o.links.push({ url, page });
    }
    const product = [];
    for (const s of skuCols) { const page = s.page != null ? pageNo(cellText(ws, r, s.page)) : null; for (const url of cellLinks(ws, r, s.url)) if (!product.some((l) => l.url === url)) product.push({ kind: s.kind, url, page }); }
    rows.set(r + 1, { attrs, product });
  }
  return { rows };
}

const NOT_SAMPLED = /^(no|n|0|-|na|n\/a|nil|none)$/i;
const NO_CODE = /^(n\/?a|nil|none|-|no error|no errors)$/i;
/** "DE | DM" -> ['DE','DM'].  Text that is not shaped like a code (e.g. a sentence) is returned in `rejected` and never counted. */
export const splitCodes = (cell) => {
  const t = clean(cell);
  if (!t || NO_CODE.test(t)) return { codes: [], rejected: [] };
  const toks = t.toUpperCase().split(/[|,;&+\n/]+/).map((x) => x.trim()).filter(Boolean);
  const codes = []; const rejected = [];
  for (const x of toks) {
    if (/^[A-Z][A-Z0-9_-]{0,9}$/.test(x)) { if (!codes.includes(x)) codes.push(x); } else rejected.push(x);
  }
  return { codes, rejected };
};
export const splitAttributes = (cell) => {
  const out = []; const seen = new Set();
  for (const a of clean(cell).split(/[|;\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const k = a.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(a); }
  }
  return out;
};

/** Parse the table into row objects + validation findings. Pure: no database access. */
export function parseTable(table, attr = null, tax = null, src = null) {
  const { aoa, headerRow, idx, name } = table;
  const missingRequired = Object.keys(FIELDS).filter((k) => FIELDS[k].required && idx[k] == null);
  const missingOptional = AUDIT_FIELD_KEYS.filter((k) => !FIELDS[k].required && idx[k] == null);
  const rows = []; const skipped = []; const missingCounts = {}; let blankRows = 0;
  const get = (r, k) => (idx[k] == null ? '' : clean(r[idx[k]]));

  for (let i = headerRow + 1; i < aoa.length; i++) {
    const r = aoa[i]; const rowNo = i + 1; // true spreadsheet row number
    const o = {}; for (const k of Object.keys(idx)) o[k] = get(r, k);
    if (!Object.values(o).some(Boolean)) { blankRows++; continue; }
    if (!o.skuId) { skipped.push({ rowNo, skuId: '', reason: 'SKU ID is empty' }); continue; }
    const { codes, rejected } = splitCodes(o.errorType);
    const attrs = splitAttributes(o.attribute);
    // A SKU is an audited sample ONLY when the Sample column says so. Audit details without it are reported, never assumed.
    const sampleFlag = o.sample && !NOT_SAMPLED.test(o.sample) ? o.sample : '';
    const sampled = !!sampleFlag;
    const hasAuditDetails = !!(o.auditor || codes.length || o.auditComments);
    const rowWarn = [];
    if (!o.builder) rowWarn.push('SKU Build By is empty');
    if (rejected.length) rowWarn.push(`Error Type has text that is not an error code (${rejected.join(', ')}) – not counted`);
    if (!sampled && hasAuditDetails) rowWarn.push('Audit details found but Sample is empty – not counted as an audited sample');
    if (sampled && !o.auditor) rowWarn.push('Sample is marked but Audit By is empty');
    if (sampled && codes.some((c) => c !== 'OK' && c !== 'SG') && !attrs.length) rowWarn.push('Error found but Attribute/Field is empty');
    if (!o.builder) missingCounts.builder = (missingCounts.builder || 0) + 1;
    if (sampled && !o.auditor) missingCounts.auditor = (missingCounts.auditor || 0) + 1;
    // attribute counts: how many attributes this SKU has filled in, and what kind of field each error attribute (column F) is
    const ad = attr ? attr.rows.get(rowNo) : null;
    const attrsEnriched = attr ? (ad ? ad.enriched.size : 0) : null;
    const attrDetail = attrs.map((nm) => {
      const k = attrKey(nm);
      if (k === 'all') return { name: nm, isAttribute: 0, wasEnriched: null };            // "All" = the whole SKU, not one attribute
      if (!attr) return { name: nm, isAttribute: 1, wasEnriched: null };                  // no attribute list in the file: cannot check
      const isAttribute = ad && ad.assigned.has(k) ? 1 : 0;                              // not in the SKU's list (e.g. "Source", "Page Number") = other field
      return { name: nm, isAttribute, wasEnriched: isAttribute ? (ad.enriched.has(k) ? 1 : 0) : null };
    });
    rows.push({
      rowNo, skuId: o.skuId, builder: o.builder, sampleFlag, sampled, auditor: o.auditor, attrsEnriched, attrDetail,
      taxonomy: tax ? (tax.rows.get(rowNo) || '') : null,    // null = this file has no PIM Taxonomy column
      sourceInfo: src?.rows.has(rowNo) ? JSON.stringify(src.rows.get(rowNo)) : null, // null = no attribute named, or the file has no source link columns
      errorRaw: o.errorType, codes, attrs, attributeField: o.attribute,
      auditComments: o.auditComments, ptStatus: o.ptStatus, ptComments: o.ptComments, reauditComments: o.reauditComments,
      gapSimilar: o.gapSimilar, ptResponse: o.ptResponse, cfbAttribute: o.cfbAttribute, cfbComments: o.cfbComments,
      warnings: rowWarn,
    });
  }
  const warnCounts = {};
  for (const r of rows) for (const w of r.warnings) { const k = w.replace(/\(.*\)/, '(…)'); warnCounts[k] = (warnCounts[k] || 0) + 1; }
  return {
    sheet: name, headerRow: headerRow + 1,
    columnsFound: Object.fromEntries(Object.entries(idx).map(([k, i]) => [FIELDS[k].label, `${COL_LETTER(i)}: ${aoa[headerRow][i]}`])),
    missingRequired: missingRequired.map((k) => FIELDS[k].label), missingOptional: missingOptional.map((k) => FIELDS[k].label),
    attributeColumns: attr ? { found: true, slots: attr.slotCount } : { found: false, slots: 0 },
    taxonomyColumn: tax ? { found: true, column: tax.column } : { found: false, column: null },
    rows, skipped, blankRows, warnCounts, missingCounts,
    // whether the file lists SKUs that were NOT sampled: needed to know the total number of SKUs assigned
    listsUnsampledSkus: rows.some((r) => !r.sampled),
  };
}
