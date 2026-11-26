// A copy of each uploaded file exactly as it was uploaded, so "Open in Excel" can open the FULL original file (every sheet and column).
// Stored once per file content (name = SHA-256 fingerprint, the same one the uploads table keeps), next to the database in data/originals.
// Nothing here is read for any dashboard number: those still come only from the imported rows.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../config.js';

const DIR = process.env.ORIGINALS_DIR
  || (process.env.NODE_TEST_CONTEXT ? path.join(os.tmpdir(), 'audit-originals-test') : path.join(path.dirname(config.dbPath), 'originals'));
const ext = (name) => (/\.(ods|xlsx|xls)$/i.exec(String(name)) || ['', 'xlsx'])[1].toLowerCase();
const fileFor = (hash, name) => (/^[a-f0-9]{64}$/.test(String(hash)) ? path.join(DIR, `${hash}.${ext(name)}`) : null);

export function saveOriginal(hash, name, buffer) {
  const f = fileFor(hash, name); if (!f) return;
  try { fs.mkdirSync(DIR, { recursive: true }); if (!fs.existsSync(f)) fs.writeFileSync(f, buffer); } catch (e) { console.warn('Could not keep a copy of the uploaded file:', e.message); }
}

/** the stored original of an upload row, or null when it was uploaded before copies were kept */
export function findOriginal(up) {
  const f = fileFor(up?.file_hash, up?.original_name);
  return f && fs.existsSync(f) ? { file: f, ext: ext(up.original_name) } : null;
}

export const ORIGINALS_DIR = DIR;
