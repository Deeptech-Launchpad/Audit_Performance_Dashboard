// "Open in Excel" for people who use the dashboard on the SAME computer that runs it (http://localhost:3000):
// the server saves the file in a temporary folder and asks Windows to open it with the program that owns .xlsx (Excel).
// Anyone using the dashboard from another computer never triggers this: they get a normal download instead.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** True only when the browser really is on this computer: the connection comes from the machine itself, the address typed was localhost,
 *  and no reverse proxy is in between. */
export function isLocalRequest(req) {
  const ra = req.socket?.remoteAddress || '';
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ra);
  const host = String(req.headers?.host || '').toLowerCase().replace(/:\d+$/, '');
  return loopback && ['localhost', '127.0.0.1', '[::1]'].includes(host) && !req.headers?.['x-forwarded-for'];
}

const DIR = path.join(os.tmpdir(), 'audit-platform-open');
/** Saves a copy under a unique name (an open Excel file locks its name) and removes copies older than a day. */
export function saveTempCopy(filename, buffer) {
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of fs.readdirSync(DIR)) { try { const p = path.join(DIR, f); if (Date.now() - fs.statSync(p).mtimeMs > 86400e3) fs.unlinkSync(p); } catch { /* ignore */ } }
  const safe = String(filename).replace(/[^\w .()\-]+/g, '_');
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '-');
  const full = path.join(DIR, /\.(xlsx|xls|ods)$/i.test(safe) ? safe.replace(/\.(xlsx|xls|ods)$/i, ` ${stamp}.$1`) : `${safe} ${stamp}.xlsx`);
  fs.writeFileSync(full, buffer);
  return full;
}

/** Opens the file with its default program. Returns false when launching is switched off (tests). */
export function openWithDefaultApp(file) {
  if (process.env.AUDIT_NO_LAUNCH === '1') return false;
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [file]] : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => { /* the caller already told the user where the file is */ });
  child.unref();
  return true;
}
