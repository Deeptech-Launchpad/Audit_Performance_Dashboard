import crypto from 'node:crypto';
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'));
  const want = Buffer.from(keyHex, 'hex');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export const ROLES = { admin: 'Admin', manager: 'Audit Manager', leader: 'Audit Team Leader', viewer: 'Viewer' };
// What each role may do. Every route names the permission it needs.
export const PERMISSIONS = {
  view: ['admin', 'manager', 'leader', 'viewer'],
  upload: ['admin', 'manager', 'leader'],
  undoUpload: ['admin', 'manager'],
  report: ['admin', 'manager', 'leader'],
  settings: ['admin'],
  users: ['admin'],
};
export const can = (role, perm) => (PERMISSIONS[perm] || []).includes(role);
