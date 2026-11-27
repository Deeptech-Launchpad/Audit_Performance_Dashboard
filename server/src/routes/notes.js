// Feedback board: Audit Managers write bugs / feature requests, the developer replies and marks them done.
// Only accounts marked "Developer" (Settings -> Users) and Audit Managers can see it; only the developer can reply / change status.
import { Router } from 'express';
import { z } from 'zod';
import { wrap, HttpError } from '../lib/http.js';

const isDev = (u) => !!u?.developer;
/** Developer accounts and Audit Managers only. */
function board(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Please sign in.'));
  if (!isDev(req.user) && req.user.role !== 'manager') return next(new HttpError(403, 'The Feedback board is only for the developer and Audit Managers.'));
  next();
}

const KIND = z.enum(['bug', 'feature', 'other']);
const STATUS = z.enum(['new', 'in_progress', 'done', 'wont_do']);
const OPEN = ['new', 'in_progress'];

const SELECT = `SELECT n.*, cu.display_name AS author, du.display_name AS doner
  FROM notes n LEFT JOIN users cu ON cu.id = n.created_by LEFT JOIN users du ON du.id = n.done_by`;
const shape = (n, user) => ({
  id: Number(n.id), kind: n.kind, title: n.title, details: n.details, page: n.page, priority: n.priority, status: n.status, reply: n.reply,
  author: n.author || '(removed user)', createdBy: n.created_by == null ? null : Number(n.created_by), createdAt: n.created_at, updatedAt: n.updated_at,
  doneAt: n.done_at, doneBy: n.doner || null,
  mine: n.created_by != null && Number(n.created_by) === user.id,
});

export function notesRouter(db) {
  const r = Router();
  const load = async (id) => { const n = await db.get(`${SELECT} WHERE n.id = ?`, [id]); if (!n) throw new HttpError(404, 'Note not found.'); return n; };

  r.get('/', board, wrap(async (req, res) => {
    const rows = await db.all(`${SELECT} ORDER BY n.created_at DESC, n.id DESC`);
    const counts = { open: 0, done: 0, wont_do: 0, all: rows.length };
    for (const n of rows) { if (OPEN.includes(n.status)) counts.open++; else if (n.status === 'done') counts.done++; else counts.wont_do++; }
    res.json({ notes: rows.map((n) => shape(n, req.user)), counts, canManage: isDev(req.user) });
  }));

  // just the number of open notes (sidebar badge)
  r.get('/count', board, wrap(async (req, res) => {
    const row = await db.get(`SELECT COUNT(*) AS n FROM notes WHERE status IN ('new','in_progress')`);
    res.json({ open: Number(row.n) });
  }));

  r.post('/', board, wrap(async (req, res) => {
    const b = z.object({ kind: KIND, details: z.string().trim().min(3, 'Please write your note (3+ characters).').max(5000),
      page: z.string().trim().min(1, 'Please choose the page.').max(80) }).parse(req.body);
    const now = new Date().toISOString();
    const id = await db.insert('INSERT INTO notes (kind, title, details, page, priority, status, reply, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [b.kind, '', b.details, b.page, 'normal', 'new', '', req.user.id, now, now]);
    res.status(201).json({ note: shape(await load(id), req.user) });
  }));

  r.patch('/:id(\\d+)', board, wrap(async (req, res) => {
    const n = await load(req.params.id);
    const manager = isDev(req.user);
    const mine = n.created_by != null && Number(n.created_by) === req.user.id;
    const b = z.object({ kind: KIND.optional(), details: z.string().trim().min(3, 'Please write your note (3+ characters).').max(5000).optional(),
      page: z.string().trim().min(1).max(80).optional(), status: STATUS.optional(), reply: z.string().trim().max(5000).optional() }).parse(req.body);
    if (!manager) {
      if (!mine) throw new HttpError(403, 'You can only change your own notes.');
      if (n.status !== 'new') throw new HttpError(400, 'The developer has already started on this note, so it can no longer be changed. Add a new note instead.');
      if (b.status !== undefined || b.reply !== undefined) throw new HttpError(403, 'Only the developer can change the status or reply.');
    }
    const next = { ...n, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) };
    const now = new Date().toISOString();
    let doneAt = n.done_at, doneBy = n.done_by;
    if (b.status && b.status !== n.status) {
      if (b.status === 'done' || b.status === 'wont_do') { doneAt = now; doneBy = req.user.id; } else { doneAt = null; doneBy = null; }
    }
    await db.run('UPDATE notes SET kind=?, title=?, details=?, page=?, priority=?, status=?, reply=?, updated_at=?, done_at=?, done_by=? WHERE id=?',
      [next.kind, next.title, next.details, next.page, next.priority, next.status, next.reply, now, doneAt, doneBy, n.id]);
    res.json({ note: shape(await load(n.id), req.user) });
  }));

  r.delete('/:id(\\d+)', board, wrap(async (req, res) => {
    const n = await load(req.params.id);
    const mine = n.created_by != null && Number(n.created_by) === req.user.id;
    if (!isDev(req.user) && !(mine && n.status === 'new')) throw new HttpError(403, 'You can only delete your own notes that the developer has not started yet.');
    await db.run('DELETE FROM notes WHERE id = ?', [n.id]);
    res.json({ ok: true });
  }));
  return r;
}
