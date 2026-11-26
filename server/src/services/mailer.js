// Sending email through the company's own mail server (SMTP). The Admin enters the server details once in Settings -> Email.
// The mail password is kept on the server only: it is never sent back to the browser (the page only learns that one is saved).
// Environment variables SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / SMTP_FROM / SMTP_FROM_NAME win over Settings (useful when hosted).
import nodemailer from 'nodemailer';
import { z } from 'zod';
import { HttpError } from '../lib/http.js';

export const mailSchema = z.object({
  host: z.string().trim().max(200),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().max(200),
  pass: z.string().max(500).optional(),            // empty / missing = keep the saved password
  fromAddress: z.string().trim().max(200).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'The “from” address does not look like an email address.'),
  fromName: z.string().trim().max(100),
}).strict();

const DEFAULTS = { host: '', port: 587, secure: false, user: '', pass: '', fromAddress: '', fromName: 'Audit Performance' };

export async function getMailConfig(db) {
  const row = await db.get(`SELECT value FROM settings WHERE key = 'smtp'`);
  let c = { ...DEFAULTS }; try { if (row) c = { ...c, ...JSON.parse(row.value) }; } catch { /* defaults */ }
  const e = process.env;
  if (e.SMTP_HOST) c.host = e.SMTP_HOST;
  if (e.SMTP_PORT) c.port = Number(e.SMTP_PORT) || c.port;
  if (e.SMTP_SECURE) c.secure = e.SMTP_SECURE === 'true';
  if (e.SMTP_USER) c.user = e.SMTP_USER;
  if (e.SMTP_PASS) c.pass = e.SMTP_PASS;
  if (e.SMTP_FROM) c.fromAddress = e.SMTP_FROM;
  if (e.SMTP_FROM_NAME) c.fromName = e.SMTP_FROM_NAME;
  return c;
}
export const mailReady = (c) => !!(c.host && c.fromAddress && (!c.user || c.pass)) || process.env.MAIL_TEST === '1'; // a username needs its password
/** what the browser may see */
export const publicMailConfig = (c) => ({ host: c.host, port: c.port, secure: c.secure, user: c.user, fromAddress: c.fromAddress, fromName: c.fromName, hasPassword: !!c.pass, ready: mailReady(c) });

export async function saveMailConfig(db, input) {
  const old = await getMailConfig(db);
  const next = { ...old, ...input, pass: input.pass ? input.pass : old.pass };
  await db.run(`INSERT INTO settings (key, value) VALUES ('smtp', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [JSON.stringify(next)]);
  return next;
}

/** In tests (MAIL_TEST=1) nothing leaves the machine: messages are kept here so tests can read them. */
export const testOutbox = [];

export async function sendMail(db, { to, subject, text, attachments = [] }) {
  const c = await getMailConfig(db);
  if (!mailReady(c)) throw new HttpError(400, 'Email sending is not set up yet. An Admin can add the mail server in Settings → Email.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to || ''))) throw new HttpError(400, 'There is no valid email address for this person.');
  const from = c.fromAddress ? `"${(c.fromName || 'Audit Performance').replace(/"/g, '')}" <${c.fromAddress}>` : 'audit-performance@localhost';
  if (process.env.MAIL_TEST === '1') { testOutbox.push({ from, to, subject, text, attachments: attachments.map((a) => a.filename) }); return { ok: true }; }
  const transport = nodemailer.createTransport({ host: c.host, port: c.port, secure: c.secure, auth: c.user ? { user: c.user, pass: c.pass } : undefined, connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 30000 });
  try {
    await transport.sendMail({ from, to, subject, text, attachments });
    return { ok: true };
  } catch (e) {
    const m = String(e?.message || e);
    const plain = /auth|535|534|login/i.test(m) ? 'The mail server did not accept the username or password.'
      : /ENOTFOUND|EAI_AGAIN/i.test(m) ? 'The mail server name could not be found.'
        : /ECONNREFUSED|ETIMEDOUT|timeout/i.test(m) ? 'The mail server did not answer (check the server name and port).'
          : /certificate|self.signed|wrong version|SSL|TLS/i.test(m) ? 'Secure connection failed (check the port and the "secure connection" setting).'
            : 'The mail server refused the message.';
    throw new HttpError(502, `${plain} (${m.slice(0, 160)})`);
  } finally { transport.close?.(); }
}
