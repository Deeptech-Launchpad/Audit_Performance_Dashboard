// The company logo on the report files: the .xlsx carries the picture on its first sheet and still reads normally; the PDF carries an image.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { addLogoToXlsx, logoPng } from '../src/services/reportLogo.js';

test('the logo picture is shipped with the server', () => {
  const png = logoPng();
  assert.ok(png && png.subarray(1, 4).toString() === 'PNG');
});

test('Excel: the picture parts are added to the first sheet only, and every cell is still readable', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[], [], ['Audit Performance Report'], ['SKUs', 5]]), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Name'], ['Ann']]), 'Product Team');
  const out = addLogoToXlsx(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  const zip = XLSX.CFB.read(out, { type: 'buffer' });
  // the names really written into the file (read from the zip's own directory; the library invents an extra one when reading)
  const parts = []; for (let i = out.indexOf('PK\x01\x02'); i >= 0; i = out.indexOf('PK\x01\x02', i + 46)) parts.push(out.subarray(i + 46, i + 46 + out.readUInt16LE(i + 28)).toString());
  for (const p of ['xl/media/image1.png', 'xl/drawings/drawing1.xml', 'xl/drawings/_rels/drawing1.xml.rels', 'xl/worksheets/_rels/sheet1.xml.rels']) assert.ok(parts.includes(p), p);
  assert.deepEqual(parts.filter((p) => !/^(\[Content_Types\]\.xml|_rels\/|docProps\/|xl\/)/.test(p) || p.includes('Sh33tJ5')), [], 'no stray entry that Excel would reject');
  const text = (p) => Buffer.from(XLSX.CFB.find(zip, p).content).toString('utf8');
  assert.match(text('/xl/worksheets/sheet1.xml'), /<drawing r:id="rId1"\/><\/worksheet>$/);
  assert.doesNotMatch(text('/xl/worksheets/sheet2.xml'), /<drawing /);
  assert.match(text('/[Content_Types].xml'), /drawing1\.xml/);
  assert.ok(Buffer.from(XLSX.CFB.find(zip, '/xl/media/image1.png').content).equals(logoPng()));
  const back = XLSX.read(out, { type: 'buffer' });
  assert.deepEqual(back.SheetNames, ['Summary', 'Product Team']);
  assert.equal(back.Sheets.Summary.A3.v, 'Audit Performance Report');
  assert.equal(back.Sheets.Summary.B4.v, 5);
});
