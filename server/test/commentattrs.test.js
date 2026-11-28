// Attribute errors named in the Audit Comments (every auditor's format), checked against the SKU's own attribute list.
// Examples are real comments from "Grainger 2026_NPI_Flight Group 50" (Nov 2026).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { commentAttributes } from '../src/services/commentAttrs.js';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seedReferenceData } from '../src/services/settings.js';
import { backfillCommentAttributes } from '../src/services/importer.js';

const C = (comment, names) => commentAttributes(comment, names);

test('Suresh format: <Name>comment, <Name.comment; "value move to <X>" does not count X', () => {
  assert.deepEqual(C('<Color>Silver, <Service Height – Maximum>Check data type', ['Color', 'Service Height - Maximum', 'Width']), ['Color', 'Service Height - Maximum']);
  assert.deepEqual(C('<Battery Chemistry>Lithium-Ion, <Cutting Width.10 in, <Number of Speed Settings>3, <Speed Settings>Variable', ['Speed Settings', 'Number of Speed Settings', 'Cutting Width', 'Battery Chemistry']),
    ['Battery Chemistry', 'Cutting Width', 'Number of Speed Settings', 'Speed Settings']);
  assert.deepEqual(C('<For Container Type>Dividable Grid Container, <Overall Width>Value Move to <Overall Height>, <Product Type>Divider as per LOV', ['For Container Type', 'Overall Width', 'Overall Height', 'Product Type']),
    ['For Container Type', 'Overall Width', 'Product Type'], 'Overall Height is only where the value should go');
  assert.deepEqual(C('<Blade Length>value move to <Diameter>', ['Blade Length', 'Diameter']), ['Blade Length']);
});

test('Sathish format: spaces inside < >, "<Name." and a missing "<"', () => {
  assert.deepEqual(C('< Compatible Brand > SawStop , < Compatible Product Type > T-Glide Rip Fences', ['Compatible Brand', 'Compatible Product Type']), ['Compatible Brand', 'Compatible Product Type']);
  assert.deepEqual(C('<Battery Chemistry. Li-Ion , , Charger Manufacturer Part Number . Not Applicable , /, Safety Features >Overload Protection', ['Battery Chemistry', 'Charger Manufacturer Part Number', 'Safety Features']),
    ['Battery Chemistry', 'Charger Manufacturer Part Number', 'Safety Features']);
  assert.deepEqual(C('<Cap Flexibility> Not stated; the pads are bendable < Cap Material > EVA foam, <Product Type> Elbow Pad', ['Cap Flexibility', 'Cap Material', 'Product Type']), ['Cap Flexibility', 'Cap Material', 'Product Type']);
});

test('Gokul format: Name>>comment | Name>>comment; values with "|" are not names', () => {
  assert.deepEqual(C('Includes>>Sheath | Sheath Material>>"Sheath: FRN" kindly raise query | Handle Color>>"Color-Black" not directly mentioned', ['Includes', 'Sheath Material', 'Handle Color', 'Color']), ['Includes', 'Sheath Material', 'Handle Color']);
  assert.deepEqual(C('Color Temperature>>3500 K | 4000 K | 5000 K | Lamp Type>>duplicated with "For Bulb Type" kindly mention', ['Color Temperature', 'Lamp Type', 'For Bulb Type', 'Color']), ['Color Temperature', 'Lamp Type']);
  assert.deepEqual(C('Hutch Depth , Hutch Height>>hutch image available', ['Hutch Depth', 'Hutch Height']), ['Hutch Depth', 'Hutch Height']);
});

test('names that are not attributes of the SKU are never returned (fields, typos, other SKUs)', () => {
  assert.deepEqual(C('<PT_Manufacturer Name> wrong , <Color> Balck , < Disposability > Extracted value describes handle material', ['Color', 'Disposability']), ['Color', 'Disposability']);
  assert.deepEqual(C('<Colour> Black', ['Color']), []);
  assert.deepEqual(C('<Color Family> White', ['Color', 'Color Family']), ['Color Family'], '"Color" alone is not counted inside "Color Family"');
  assert.deepEqual(C('ok', ['Color']), []);
  assert.deepEqual(C('', ['Color']), []);
});

/* ------------------------------------------------------------ upload: column F + comment, SG rows, existing uploads */
process.env.AUDIT_NO_LAUNCH = '1';
let db, server, base; let cookie = '';
const H = { 'x-requested-with': 'audit-app' };
async function call(method, url, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(base + url, { method, headers: { ...H, ...(body && !isForm ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return res.json();
}
before(async () => {
  db = await openDb({ client: 'sqlite', path: ':memory:' });
  await seedReferenceData(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  await call('POST', '/api/auth/setup', { username: 'admin', displayName: 'Admin', password: 'correct-horse-9' });
});
after(() => { server?.close(); });

const HEAD = ['SKU ID', 'SKU Build By', 'Sample', 'Audit By', 'Error Type', 'Attribute/Field', 'Audit Comments', 'Gap/Similar', 'PT Status', 'PT Comments', 'Re-Audit Comments', 'Re_Gap/Similar', 'PT Response', 'CFB Attr/Comments',
  'Att 1', 'Raw Val 1', 'Build Val 1', 'Att 2', 'Raw Val 2', 'Build Val 2', 'Att 3', 'Raw Val 3', 'Build Val 3', 'Att 4', 'Raw Val 4', 'Build Val 4'];
const att = (...pairs) => pairs.flatMap(([n, v]) => [n, v, v]);
const ROWS = [
  // F names 1, comment names 3 (one already in F)  -> 3 attribute errors
  ['SKU1', 'Ann', 'FA', 'Suresh N', 'DM', 'Battery Platform', '<Battery Platform>20V MAX, <Flow – Maximum>1.7, <Number of Chargers Included>0', '', '', '', '', '', '', '', ...att(['Battery Platform', '18V'], ['Flow - Maximum', '1.5'], ['Number of Chargers Included', ''], ['Color', 'Red'])],
  // F empty, comment names 2 + a field that is not an attribute -> 2
  ['SKU2', 'Ann', 'FA', 'Sathishkumar S', 'DM|DE', '', '<PT_Manufacturer Name> wrong , <Color> Balck , < Disposability > handle material', '', '', '', '', '', '', '', ...att(['Color', 'Black'], ['Disposability', 'Reusable'], ['Size', 'L'], ['Style', 'A'])],
  // SG = suggestion: not counted at all
  ['SKU3', 'Bob', 'FA', 'Gokul Prakash G', 'SG', '', 'Overall Depth>>23.25" | Overall Width>>41.75"', '', '', '', '', '', '', '', ...att(['Overall Depth', '23'], ['Overall Width', '41'], ['Color', 'Red'], ['Size', 'L'])],
  // OK row
  ['SKU4', 'Bob', 'FA', 'Suresh N', '', '', 'ok', '', '', '', '', '', '', '', ...att(['Color', 'Red'], ['Size', 'L'], ['Style', 'A'], ['Width', '2'])],
];
const book = () => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEAD, ...ROWS]), 'Data'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); };

test('upload: attribute errors = column F + attributes named in the comment (SG / OK rows not counted)', async () => {
  const f = new FormData(); f.append('files', new Blob([book()]), 'FG_comments.xlsx');
  const staged = await call('POST', '/api/uploads', f);
  const id = staged.files[0].id;
  await call('POST', `/api/uploads/${id}/commit`, { auditDate: '2026-11-18', project: 'Grainger' });
  const ct = await call('GET', '/api/content-team');
  assert.equal(ct.team.attrErrors, 5, '3 (SKU1) + 2 (SKU2)');
  const sku2 = await call('GET', '/api/skus/SKU2');
  assert.deepEqual(sku2.history[0].attributes, [{ name: 'Color', fromComment: true }, { name: 'Disposability', fromComment: true }]);
  const sku1 = await call('GET', '/api/skus/SKU1');
  assert.deepEqual(sku1.history[0].attributes.map((a) => [a.name, a.fromComment]), [['Battery Platform', false], ['Flow - Maximum', true], ['Number of Chargers Included', true]]);
  globalThis.__caUpload = id;
});

test('files imported earlier are read again once from the kept original (only comment attributes are added)', async () => {
  // simulate an upload made before this change: remove the comment attributes and the version mark
  await db.run('DELETE FROM record_attributes WHERE from_comment = 1');
  await db.run('UPDATE uploads SET comment_attrs_v = NULL');
  assert.equal((await call('GET', '/api/content-team')).team.attrErrors, 1, 'only column F before');
  const r = await backfillCommentAttributes(db);
  assert.equal(r.files, 1); assert.equal(r.added, 4);
  assert.equal((await call('GET', '/api/content-team')).team.attrErrors, 5);
  assert.equal((await backfillCommentAttributes(db)).files, 0, 'runs once per file');
  const n = await db.get('SELECT COUNT(*) AS n FROM record_attributes'); assert.equal(Number(n.n), 5, 'nothing added twice');
});
