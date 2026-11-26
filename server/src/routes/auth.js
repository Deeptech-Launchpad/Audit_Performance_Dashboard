import { Router } from 'express';
import { z } from 'zod';
import { HttpError, wrap } from '../lib/http.js';
import { hashPassword, verifyPassword, newToken, sha256, can, ROLES } from '../lib/auth.js';
import { config } from '../config.js';

const COOKIE = 'audit_session';
const readCookie = (req, name) => {
  const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(name + '='));
  if (!m) return null;
  try { return decodeURIComponent(m.slice(name.length + 1)); } catch { return null; } // a damaged cookie means "not signed in", never a server error
};
const iso = (d) => d.toISOString();

export function attachUser(db) {
  return wrap(async (req, res, next) => {
    const token = readCookie(req, COOKIE);
    req.user = null;
    if (token) {
      const row = await db.get(`SELECT u.id, u.username, u.display_name, u.role, u.active, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, [sha256(token)]);
      if (row && row.active && row.expires_at > iso(new Date())) req.user = { id: row.id, username: row.username, name: row.display_name, role: row.role };
    }
    next();
  });
}
/** Route guard: `need('upload')` etc. */
export const need = (perm) => (req, res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please sign in.'));
  if (!can(req.user.role, perm)) return next(new HttpError(403, 'Your role does not allow this action.'));
  next();
};

const pwSchema = z.string().min(10, 'Password must be at least 10 characters').max(200);
const loginSchema = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) });
const setupSchema = z.object({ username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/, 'Username can use letters, numbers, . _ -'), displayName: z.string().trim().min(1).max(100), password: pwSchema });

// very small in-memory brake against password guessing
const fails = new Map();
const tooMany = (key) => { const f = fails.get(key); return f && f.n >= 8 && Date.now() - f.t < 15 * 60e3; };
const noteFail = (key) => { const f = fails.get(key); if (f && Date.now() - f.t < 15 * 60e3) { f.n++; } else fails.set(key, { n: 1, t: Date.now() }); };

export async function startSession(db, res, userId) {
  const token = newToken(); const now = new Date(); const exp = new Date(now.getTime() + config.sessionDays * 86400e3);
  await db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)', [sha256(token), userId, iso(now), iso(exp)]);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/', expires: exp });
}
export const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, roleLabel: ROLES[u.role] });

export function authRouter(db) {
  const r = Router();
  r.get('/status', wrap(async (req, res) => {
    const n = await db.get('SELECT COUNT(*) AS n FROM users');
    res.json({ needsSetup: n.n === 0, user: req.user ? publicUser(req.user) : null });
  }));
  // First run only: create the first Admin. Refused as soon as any user exists.
  r.post('/setup', wrap(async (req, res) => {
    const body = setupSchema.parse(req.body);
    const id = await db.tx(async (tx) => {
      const n = await tx.get('SELECT COUNT(*) AS n FROM users');
      if (n.n > 0) throw new HttpError(409, 'Setup has already been completed.');
      return tx.insert('INSERT INTO users (username, display_name, password_hash, role, active, created_at) VALUES (?,?,?,?,1,?)', [body.username, body.displayName, await hashPassword(body.password), 'admin', iso(new Date())]);
    });
    await startSession(db, res, id);
    res.status(201).json({ user: publicUser({ id, username: body.username, name: body.displayName, role: 'admin' }) });
  }));
  r.post('/login', wrap(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const key = `${req.ip}|${username.toLowerCase()}`;
    if (tooMany(key)) throw new HttpError(429, 'Too many failed sign-in attempts. Please wait 15 minutes and try again.');
    const u = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    const ok = u && u.active && (await verifyPassword(password, u.password_hash));
    if (!ok) { noteFail(key); throw new HttpError(401, 'Wrong username or password.'); }
    fails.delete(key);
    await startSession(db, res, u.id);
    await db.run('DELETE FROM sessions WHERE expires_at < ?', [iso(new Date())]);
    res.json({ user: publicUser({ id: u.id, username: u.username, name: u.display_name, role: u.role }) });
  }));
  r.post('/logout', wrap(async (req, res) => {
    const token = readCookie(req, COOKIE);
    if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  }));
  r.post('/password', need('view'), wrap(async (req, res) => {
    const body = z.object({ current: z.string().min(1), next: pwSchema }).parse(req.body);
    const u = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!(await verifyPassword(body.current, u.password_hash))) throw new HttpError(400, 'Your current password is not correct.');
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(body.next), u.id]);
    const token = readCookie(req, COOKIE);
    await db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [u.id, sha256(token || '')]);
    res.json({ ok: true });
  }));
  return r;
}
