// The company logo on the weekly report files (server/assets/altiusnxt-logo.png, 640 x 172).
// If the picture is missing, or the workbook does not look as expected, the report is produced without it (never broken).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'altiusnxt-logo.png');
const RATIO = 172 / 640;
const EMU = 9525; // Excel's unit for one screen pixel

export function logoPng() { try { return fs.readFileSync(FILE); } catch { return null; } }

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Puts the logo at the top-left of the FIRST sheet (that sheet must keep its first two rows empty).
 *  The spreadsheet library cannot place pictures itself, so the picture parts are added to the .xlsx package here. */
export function addLogoToXlsx(buffer, { width = 120 } = {}) {
  const png = logoPng(); if (!png) return buffer;
  const zip = XLSX.CFB.read(buffer, { type: 'buffer' });
  const entry = (p) => XLSX.CFB.find(zip, p);
  const text = (p) => (entry(p) ? Buffer.from(entry(p).content).toString('utf8') : null);
  const replace = (p, s) => { const e = entry(p); e.content = Buffer.from(s, 'utf8'); e.size = e.content.length; };
  const sheet = text('/xl/worksheets/sheet1.xml'); const types = text('/[Content_Types].xml');
  if (!sheet || !types || !sheet.includes('xmlns:r=') || !sheet.includes('</worksheet>') || sheet.includes('<drawing ') || entry('/xl/worksheets/_rels/sheet1.xml.rels')) return buffer;

  const cx = width * EMU; const cy = Math.round(width * RATIO) * EMU;
  const drawing = `${XML}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${REL}">`
    + `<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>${2 * EMU}</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>${2 * EMU}</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/>`
    + `<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo" descr="AltiusNxt"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>`
    + `<xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>`
    + `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`;
  const add = (p, data) => XLSX.CFB.utils.cfb_add(zip, p, Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'));
  add('/xl/media/image1.png', png);
  add('/xl/drawings/drawing1.xml', drawing);
  add('/xl/drawings/_rels/drawing1.xml.rels', `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/image" Target="../media/image1.png"/></Relationships>`);
  add('/xl/worksheets/_rels/sheet1.xml.rels', `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  replace('/xl/worksheets/sheet1.xml', sheet.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>')); // <drawing> is the last element these sheets can have
  let t = types;
  if (!t.includes('Extension="png"')) t = t.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
  if (!t.includes('/xl/drawings/drawing1.xml')) t = t.replace('</Types>', '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
  replace('/[Content_Types].xml', t);
  return XLSX.CFB.write(zip, { fileType: 'zip', type: 'buffer', compression: true });
}
