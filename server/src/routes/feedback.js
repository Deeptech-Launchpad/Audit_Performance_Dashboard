import { Router } from 'express';
import { z } from 'zod';
import { wrap, HttpError } from '../lib/http.js';
import { need } from './auth.js';
import { parseFilters } from '../analytics/loader.js';
import { buildFeedback, feedbackToPdf, groupMembers } from '../services/feedback.js';
import { getMailConfig, publicMailConfig, saveMailConfig, mailSchema, sendMail } from '../services/mailer.js';

const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const emailField = z.string().trim().max(200).refine((v) => v === '' || emailOk(v), 'That does not look like an email address.');
const pdfName = (fb) => `audit-${fb.kind === 'appreciation' ? 'results' : 'feedback'}-${fb.member.name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'member'}-${fb.period.from}_to_${fb.period.to}.pdf`;

// Anyone who can view the dashboard can read the suggestions; saving an email address and sending a message
// is a "report" action (Audit Team Leader, Audit Manager, Admin). Bulk sending and the mail server settings are for the Admin.
export function feedbackRouter(db) {
  const r = Router();
  r.use(need('view'));
  const build = (req, builderId = Number(req.params.builderId)) => {
    const f = parseFilters(req.query);
    return buildFeedback(db, { builderId, from: f.from, to: f.to, sender: req.user.name });
  };

  // ---- mail server (Admin) ----
  r.get('/mail/settings', need('settings'), wrap(async (req, res) => res.json(publicMailConfig(await getMailConfig(db)))));
  r.put('/mail/settings', need('settings'), wrap(async (req, res) => res.json(publicMailConfig(await saveMailConfig(db, mailSchema.parse(req.body))))));
  r.post('/mail/test', need('settings'), wrap(async (req, res) => {
    const { to } = z.object({ to: emailField }).parse(req.body);
    if (!to) throw new HttpError(400, 'Type the address to send the test email to.');
    await sendMail(db, { to, subject: 'Audit Performance – test email', text: 'This is a test email from the Audit Performance dashboard.\n\nIf you can read this, email sending is set up correctly.' });
    res.json({ ok: true });
  }));
  r.get('/mail/status', wrap(async (req, res) => res.json({ ready: publicMailConfig(await getMailConfig(db)).ready })));

  // ---- one person ----
  r.get('/:builderId(\\d+)', wrap(async (req, res) => res.json(await build(req))));
  r.get('/:builderId(\\d+)/pdf', wrap(async (req, res) => {
    const fb = await build(req);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${pdfName(fb)}"` });
    res.send(await feedbackToPdf(fb));
  }));
  // remember where this person's feedback should be sent
  r.put('/:builderId(\\d+)/email', need('report'), wrap(async (req, res) => {
    const { email } = z.object({ email: emailField }).parse(req.body);
    const done = await db.run('UPDATE employees SET email = ? WHERE id = ?', [email || null, Number(req.params.builderId)]);
    if (!done.changes) throw new HttpError(404, 'Team member not found.');
    res.json({ email });
  }));
  // send this person's message (the edited text, if any) with their PDF report attached
  r.post('/:builderId(\\d+)/send', need('report'), wrap(async (req, res) => {
    const body = z.object({ email: emailField, message: z.string().max(20000).optional() }).parse(req.body);
    const id = Number(req.params.builderId);
    const fb = await build(req, id);
    const to = body.email || fb.email;
    if (!to) throw new HttpError(400, `Add ${fb.member.name}'s email address first.`);
    if (body.email && body.email !== fb.email) await db.run('UPDATE employees SET email = ? WHERE id = ?', [body.email, id]);
    await sendMail(db, { to, subject: fb.subject, text: body.message?.trim() ? body.message : fb.message, attachments: [{ filename: pdfName(fb), content: await feedbackToPdf(fb) }] });
    res.json({ ok: true, to });
  }));

  // ---- many people at once (Admin) ----
  const groupQ = z.enum(['achieved', 'improve']);
  r.get('/bulk/:group', need('settings'), wrap(async (req, res) => {
    const group = groupQ.parse(req.params.group); const f = parseFilters(req.query);
    res.json({ group, members: await groupMembers(db, { group, from: f.from, to: f.to }), mail: publicMailConfig(await getMailConfig(db)).ready });
  }));
  r.post('/bulk/:group', need('settings'), wrap(async (req, res) => {
    const group = groupQ.parse(req.params.group); const f = parseFilters(req.query);
    const body = z.object({ ids: z.array(z.number().int().positive()).max(500), emails: z.record(z.string(), emailField).default({}) }).parse(req.body);
    const members = (await groupMembers(db, { group, from: f.from, to: f.to })).filter((m) => body.ids.includes(m.id)); // only people really in the group
    const results = [];
    for (const m of members) {
      const typed = body.emails[String(m.id)];
      if (typed && typed !== m.email) await db.run('UPDATE employees SET email = ? WHERE id = ?', [typed, m.id]);
      const to = typed || m.email;
      if (!to) { results.push({ id: m.id, name: m.name, ok: false, error: 'No email address' }); continue; }
      try {
        const fb = await buildFeedback(db, { builderId: m.id, from: f.from, to: f.to, sender: req.user.name });
        await sendMail(db, { to, subject: fb.subject, text: fb.message, attachments: [{ filename: pdfName(fb), content: await feedbackToPdf(fb) }] });
        results.push({ id: m.id, name: m.name, to, ok: true });
      } catch (e) {
        results.push({ id: m.id, name: m.name, to, ok: false, error: e.message || 'Not sent' });
        if (e.status === 400 && /not set up/i.test(e.message)) break; // no mail server: stop at once
      }
    }
    res.json({ sent: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length, results });
  }));
  return r;
}
