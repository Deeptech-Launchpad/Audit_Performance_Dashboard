import { Router } from 'express';
import { z } from 'zod';
import { wrap, HttpError } from '../lib/http.js';
import { need } from './auth.js';
import { hashPassword, ROLES } from '../lib/auth.js';
import { getSettings, saveSettings, settingsSchema, getErrorTypes } from '../services/settings.js';
import { refreshTracking } from '../services/followup.js';
import { isValidTz } from '../lib/dates.js';

const role = z.enum(['admin', 'manager', 'leader', 'viewer']);
const pw = z.string().min(10, 'Password must be at least 10 characters').max(200);

export function adminRouter(db) {
  const r = Router();

  /* ---- settings (everyone can read, only Admin can change) ---- */
  r.get('/settings', need('view'), wrap(async (req, res) => {
    res.json({ settings: await getSettings(db), errorTypes: [...(await getErrorTypes(db)).values()] });
  }));
  r.put('/settings', need('settings'), wrap(async (req, res) => {
    const merged = settingsSchema.parse({ ...(await getSettings(db)), ...req.body });
    if (!isValidTz(merged.timezone)) throw new HttpError(400, 'That time zone name is not recognised (example: Asia/Kolkata).');
    merged.ptStatusMap = Object.fromEntries(Object.entries(merged.ptStatusMap).map(([k, v]) => [k.trim().toLowerCase(), v]).filter(([k]) => k));
    await saveSettings(db, merged);
    await refreshTracking(db, merged); // PT / re-audit meanings changed -> re-classify every record
    res.json({ settings: merged });
  }));
  r.put('/error-types', need('settings'), wrap(async (req, res) => {
    const list = z.array(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_-]{0,9}$/), name: z.string().trim().min(1).max(100), isError: z.boolean(), tip: z.string().max(500).default(''), verified: z.boolean().default(false) })).max(100).parse(req.body);
    await db.tx(async (tx) => {
      for (const e of list) await tx.run(`INSERT INTO error_types (code, name, is_error, tip, verified) VALUES (?,?,?,?,?)
        ON CONFLICT(code) DO UPDATE SET name = excluded.name, is_error = excluded.is_error, tip = excluded.tip, verified = excluded.verified`, [e.code, e.name, e.isError ? 1 : 0, e.tip, e.verified ? 1 : 0]);
    });
    res.json({ errorTypes: [...(await getErrorTypes(db)).values()] });
  }));

  /* ---- users (Admin) ---- */
  r.get('/users', need('users'), wrap(async (req, res) => {
    const rows = await db.all('SELECT id, username, display_name, role, active, is_developer, created_at FROM users ORDER BY username');
    res.json(rows.map((u) => ({ id: u.id, username: u.username, name: u.display_name, role: u.role, roleLabel: ROLES[u.role], active: !!u.active, developer: !!Number(u.is_developer), createdAt: u.created_at })));
  }));
  r.post('/users', need('users'), wrap(async (req, res) => {
    const b = z.object({ username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/), name: z.string().trim().min(1).max(100), role, password: pw }).parse(req.body);
    if (await db.get('SELECT id FROM users WHERE username = ?', [b.username])) throw new HttpError(409, 'That username is already taken.');
    const id = await db.insert('INSERT INTO users (username, display_name, password_hash, role, active, created_at) VALUES (?,?,?,?,1,?)', [b.username, b.name, await hashPassword(b.password), b.role, new Date().toISOString()]);
    res.status(201).json({ id });
  }));
  r.patch('/users/:id(\\d+)', need('users'), wrap(async (req, res) => {
    const b = z.object({ name: z.string().trim().min(1).max(100).optional(), role: role.optional(), active: z.boolean().optional(), developer: z.boolean().optional(), password: pw.optional() }).parse(req.body);
    const u = await db.get('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (!u) throw new HttpError(404, 'User not found.');
    const newRole = b.role ?? u.role; const newActive = b.active ?? !!u.active;
    if (u.role === 'admin' && (newRole !== 'admin' || !newActive)) {
      const n = await db.get(`SELECT COUNT(*) AS n FROM users WHERE role='admin' AND active=1 AND id <> ?`, [u.id]);
      if (!n.n) throw new HttpError(400, 'There must always be at least one active Admin.');
    }
    await db.run('UPDATE users SET display_name=?, role=?, active=? WHERE id=?', [b.name ?? u.display_name, newRole, newActive ? 1 : 0, u.id]);
    if (b.developer !== undefined) await db.run('UPDATE users SET is_developer=? WHERE id=?', [b.developer ? 1 : 0, u.id]);
    if (b.password) await db.run('UPDATE users SET password_hash=? WHERE id=?', [await hashPassword(b.password), u.id]);
    if (!newActive || b.password) await db.run('DELETE FROM sessions WHERE user_id = ?', [u.id]);
    res.json({ ok: true });
  }));
  return r;
}
