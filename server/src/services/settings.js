// Settings and error-type legend live in the database. These defaults only seed an empty database;
// every value can be changed by an Admin in Settings. Nothing here is a reference figure from a sample file.
import { z } from 'zod';

export const DEFAULT_ERROR_TYPES = [
  ['DE', 'Data Error (wrong value)', 1, 'Cross-check every captured value against the source and confirm it belongs to this exact SKU/model (not an accessory, parent product or sibling SKU).'],
  ['DM', 'Data Missing', 1, 'Work from an attribute checklist: look through every part of the source (HTML specs & features tabs, PDF tables, line diagrams, images) before leaving an attribute blank.'],
  ['RBE', 'Rule-Based Error', 1, 'Re-read the schema definition and allowed values (LOV) for the attribute before capturing; log a decision for values that are not in the LOV.'],
  ['SRE', 'Source Error', 1, 'Follow the source order: manufacturer website / manufacturer PDF first, and check that links open before submitting.'],
  ['RE', 'Raw Value Error', 1, 'Copy raw values exactly as written in the source; do not reword them.'],
  ['UM', 'Unit Missing', 1, "Always capture the unit with numeric values and check it against the schema's allowed units."],
  ['UE', 'Unit Error', 1, 'Check units against the schema list and double-check any conversion.'],
  ['CAE', 'Case Error', 1, 'Follow the capitalisation rules in the style guide; review build values before submitting.'],
  ['SE', 'Spelling Error', 1, 'Run a spell-check and copy text from the source instead of retyping it.'],
  ['SPE', 'Special Character / Spacing Error', 1, 'Check symbols, separators and double spaces against the style guide.'],
  ['FE', 'Format Error', 1, 'Follow formatting rules for separators and number formats; keep raw and build values consistent.'],
  ['SG', 'Suggestion (not an error)', 0, ''],
  ['OK', 'OK (no error)', 0, ''],
];

export const DEFAULT_SETTINGS = {
  timezone: 'Asia/Kolkata',
  errorTargetPct: 15,        // a content member is "on target" at or below this error percentage
  minSample: 5,              // fewer audited samples than this = percentage is shown with a "few samples" warning
  categoryMinSample: 3,      // audited SKUs a person needs in a category before they count as proven (or not) there
  watchMarginPct: 15,       // error % up to target + this margin = "keep an eye on"; above it = "needs improvement"
  ptStatusMap: {             // PT status text (lower case) -> completed | pending   (please confirm these meanings)
    'updated': 'completed',
    'checked': 'completed',
    'not updated': 'pending',
    'updated/not updated': 'pending',
  },
  blankPtIsPending: false,   // false: an audited finding with an empty PT Status is shown as "No status recorded"
  reauditOkWords: ['ok', 'okay', 'done', 'resolved', 'fine'],
  // true: an audit error is counted only when the re-audit has checked it (re-audit comment written: "ok" or the re-auditor's notes)
  // and PT did not answer "Not Updated". Otherwise it is "not confirmed" and NOT counted (the audit itself may be wrong).
  countErrorsAfterReaudit: false,
  ageingWarnDays: 7,         // pending cases older than this are called out
  dedupeIncludeDate: false,  // include the audit date when deciding if two records are the same
  weeklyReportAuto: true,
  weeklyReportHour: 6,       // generate Monday's report at/after this hour in the configured time zone
};

export const settingsSchema = z.object({
  timezone: z.string().min(1).max(64),
  errorTargetPct: z.number().min(0).max(100),
  minSample: z.number().int().min(1).max(1000),
  watchMarginPct: z.number().min(0).max(100),
  categoryMinSample: z.number().int().min(1).max(1000),
  ptStatusMap: z.record(z.string().max(100), z.enum(['completed', 'pending'])),
  blankPtIsPending: z.boolean(),
  reauditOkWords: z.array(z.string().max(50)).max(50),
  countErrorsAfterReaudit: z.boolean(),
  ageingWarnDays: z.number().int().min(1).max(365),
  dedupeIncludeDate: z.boolean(),
  weeklyReportAuto: z.boolean(),
  weeklyReportHour: z.number().int().min(0).max(23),
}).strict();

export async function seedReferenceData(db) {
  const n = await db.get('SELECT COUNT(*) AS n FROM error_types');
  if (!n.n) for (const [code, name, isErr, tip] of DEFAULT_ERROR_TYPES) {
    await db.run('INSERT INTO error_types (code, name, is_error, tip, verified) VALUES (?,?,?,?,0)', [code, name, isErr, tip]);
  }
}

export async function getSettings(db) {
  const rows = await db.all(`SELECT key, value FROM settings WHERE key <> 'smtp'`); // the mail server (with its password) is read only by services/mailer.js
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) { try { out[r.key] = JSON.parse(r.value); } catch { /* keep default */ } }
  return out;
}
export async function saveSettings(db, values) {
  for (const [k, v] of Object.entries(values)) {
    await db.run('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [k, JSON.stringify(v)]);
  }
}

/** code -> { code, name, isError, tip, verified }.
 *  The map also carries the counting rule `afterReaudit` (Settings -> countErrorsAfterReaudit), so every page that counts
 *  errors applies it the same way (the loader reads it). */
export async function getErrorTypes(db) {
  const rows = await db.all('SELECT code, name, is_error, tip, verified FROM error_types ORDER BY code');
  const map = new Map();
  for (const r of rows) map.set(r.code, { code: r.code, name: r.name, isError: !!r.is_error, tip: r.tip || '', verified: !!r.verified });
  const rule = await db.get(`SELECT value FROM settings WHERE key = 'countErrorsAfterReaudit'`);
  let after = DEFAULT_SETTINGS.countErrorsAfterReaudit; try { if (rule) after = JSON.parse(rule.value) === true; } catch { /* default */ }
  map.afterReaudit = after;
  return map;
}
