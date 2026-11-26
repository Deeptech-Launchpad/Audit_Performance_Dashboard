import { Router } from 'express';
import { z } from 'zod';
import { wrap, HttpError } from '../lib/http.js';
import { need } from './auth.js';
import { buildReport, saveReport, reportToExcel, reportToPdf } from '../services/reports.js';
import { dataBounds } from '../analytics/loader.js';
import { weekStart, weekEnd, addDays, isValidISO, nowIn, fmtRange } from '../lib/dates.js';
import { getSettings } from '../services/settings.js';

const date = z.string().refine(isValidISO, 'Use a valid date (YYYY-MM-DD)');
const fileSafe = (s) => String(s || '').replace(/\.(ods|xlsx|xls)$/i, '').replace(/[^\w .()-]+/g, '_').slice(0, 70);

export function reportsRouter(db) {
  const r = Router();
  // The list shows what each report is about and its headline numbers, so the right one can be picked without opening each.
  r.get('/', need('view'), wrap(async (req, res) => {
    const rows = await db.all(`SELECT w.id, w.kind, w.period_start, w.period_end, w.generated_at, w.summary_json, u.display_name AS generated_by FROM weekly_reports w LEFT JOIN users u ON u.id = w.generated_by ORDER BY w.period_start DESC, w.id DESC LIMIT 200`);
    res.json(rows.map(({ summary_json, ...x }) => {
      let s = null; try { s = JSON.parse(summary_json); } catch { s = null; }
      const kind = s?.kind === 'file' ? 'file' : s?.scope?.type === 'month' ? 'month' : x.kind;
      return { ...x, kind, auto: !x.generated_by, fileName: s?.scope?.fileName || null,
        samples: s?.overall?.samples ?? null, errorSkus: s?.overall?.errorSkus ?? null, errorRate: s?.overall?.errorRate ?? null };
    }));
  }));
  const load = async (id) => {
    const row = await db.get('SELECT * FROM weekly_reports WHERE id = ?', [id]);
    if (!row) throw new HttpError(404, 'Report not found.');
    return JSON.parse(row.summary_json);
  };
  const name = (rep) => (rep.kind === 'file' ? `audit-report-${fileSafe(rep.period.label)}` : `audit-report-${rep.period.from}_to_${rep.period.to}`);
  r.get('/:id(\\d+)', need('view'), wrap(async (req, res) => res.json(await load(req.params.id))));
  r.get('/:id(\\d+)/excel', need('view'), wrap(async (req, res) => {
    const rep = await load(req.params.id);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${name(rep)}.xlsx"` });
    res.send(reportToExcel(rep));
  }));
  r.get('/:id(\\d+)/pdf', need('view'), wrap(async (req, res) => {
    const rep = await load(req.params.id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name(rep)}.pdf"` });
    res.send(await reportToPdf(rep));
  }));
  r.delete('/:id(\\d+)', need('report'), wrap(async (req, res) => {
    const done = await db.run('DELETE FROM weekly_reports WHERE id = ?', [Number(req.params.id)]);
    if (!done.changes) throw new HttpError(404, 'Report not found.');
    res.json({ ok: true });
  }));

  /** a report about nothing helps nobody: refuse it with a plain reason */
  const refuseEmpty = (summary, what) => { if (!summary.overall.skus) throw new HttpError(400, `There is no audit data for ${what}, so no report was made. Choose a week or file that has data.`); };

  // A week (Monday-Saturday), any dates, or one uploaded file
  r.post('/', need('report'), wrap(async (req, res) => {
    const body = z.object({ from: date.optional(), to: date.optional(), kind: z.enum(['custom', 'weekly', 'file']).default('custom'), uploadId: z.number().int().positive().optional() }).parse(req.body);
    const bounds = await dataBounds(db);
    if (!bounds.records) throw new HttpError(400, 'There is no audit data yet. Upload an audit file first.');
    let summary;
    if (body.kind === 'file') {
      if (!body.uploadId) throw new HttpError(400, 'Choose a file.');
      summary = await buildReport(db, { kind: 'file', uploadId: body.uploadId });
    } else {
      let { from, to } = body;
      if (!from || !to) throw new HttpError(400, 'Choose the dates.');
      if (body.kind === 'weekly') { from = weekStart(from); to = weekEnd(from); }
      summary = await buildReport(db, { from, to, kind: body.kind });
      refuseEmpty(summary, body.kind === 'weekly' ? `the week ${fmtRange(from, to)}` : fmtRange(from, to));
    }
    const id = await saveReport(db, summary, { userId: req.user.id, auto: false });
    res.status(201).json({ id });
  }));
  // Shortcut: the last finished week
  r.post('/last-week', need('report'), wrap(async (req, res) => {
    const s = await getSettings(db);
    const from = addDays(weekStart(nowIn(s.timezone).date), -7);
    const summary = await buildReport(db, { from, to: weekEnd(from), kind: 'weekly' });
    refuseEmpty(summary, `last week (${fmtRange(from, weekEnd(from))})`);
    res.status(201).json({ id: await saveReport(db, summary, { userId: req.user.id, auto: false }) });
  }));
  return r;
}
