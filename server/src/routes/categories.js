import { Router } from 'express';
import { wrap } from '../lib/http.js';
import { need } from './auth.js';
import { parseFilters, loadRecords } from '../analytics/loader.js';
import { categoryPerformance, groupPerformance } from '../analytics/categories.js';
import { projectGroup } from '../lib/project.js';
import { getSettings, getErrorTypes } from '../services/settings.js';

export function categoriesRouter(db) {
  const r = Router();

  r.get('/', need('view'), wrap(async (req, res) => {
    const f = parseFilters(req.query);
    const [settings, errTypes] = await Promise.all([getSettings(db), getErrorTypes(db)]);
    const recs = await loadRecords(db, { from: f.from, to: f.to, project: f.project, uploadId: f.uploadId, auditorId: f.auditorId }, errTypes);
    const perf = categoryPerformance(recs, settings);
    // "By project": the same cards per project, using the project's first word (Grainger, Analog …) like the Project filter
    const ups = await db.all('SELECT id, project FROM uploads');
    const projOf = new Map(ups.map((u) => [u.id, projectGroup(u.project) || 'No project']));
    perf.projects = groupPerformance(recs, settings, (x) => projOf.get(x.uploadId) || 'No project');
    // files in this selection that were imported without a PIM Taxonomy column (they cannot contribute to categories);
    // a file that has the column but a few blank cells is fine
    const ids = [...new Set(recs.filter((x) => !x.taxonomyKnown).map((x) => x.uploadId))];
    const missingFiles = ids.length ? (await db.all(`SELECT id, original_name AS name FROM uploads WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY audit_date, id`, ids)).map((u) => ({ id: u.id, name: u.name })) : [];
    res.json({ ...perf, missingFiles, empty: recs.length === 0 });
  }));

  return r;
}
