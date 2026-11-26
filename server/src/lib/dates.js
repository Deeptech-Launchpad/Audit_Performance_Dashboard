// Date helpers. Audit dates are plain calendar dates (YYYY-MM-DD) so they never shift with time zones.
// The configured time zone is only used for "what is today" and "is it Monday yet".
const MS = 86400000;
export const isoDate = (d) => d.toISOString().slice(0, 10);
export const parseISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const isValidISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && isoDate(parseISO(s)) === s;
export const addDays = (s, n) => isoDate(new Date(parseISO(s).getTime() + n * MS));
export const diffDays = (a, b) => Math.round((parseISO(a) - parseISO(b)) / MS);
/** Monday of the week containing the date */
export function weekStart(s) { const dow = (parseISO(s).getUTCDay() + 6) % 7; return addDays(s, -dow); }
/** The working week is Monday to Saturday (6 days). Sunday is not part of any week. */
export const WEEK_DAYS = 6;
export const weekEnd = (s) => addDays(weekStart(s), WEEK_DAYS - 1);
/** true when from..to is exactly one calendar month (1st to last day) */
export const isWholeMonth = (from, to) => from.slice(8) === '01' && from.slice(0, 7) === to.slice(0, 7) && addDays(to, 1).slice(8) === '01';
/** The period to compare a period with: the same number of days just before it.
 *  A Monday-to-Saturday week is compared with the previous Monday-to-Saturday week (not with a block shifted by 6 days that would start on a Tuesday),
 *  and a whole calendar month with the whole month before it. */
export function previousPeriod(from, to) {
  if (weekStart(from) === from && diffDays(to, from) === WEEK_DAYS - 1) { const pf = addDays(from, -7); return { from: pf, to: weekEnd(pf) }; }
  if (isWholeMonth(from, to)) { const pt = addDays(from, -1); return { from: `${pt.slice(0, 7)}-01`, to: pt }; }
  const len = diffDays(to, from) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}
export const monthOf = (s) => s.slice(0, 7);

/** Today's calendar date and weekday (0 = Monday) in the given IANA time zone */
export function nowIn(tz, at = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  } catch { return nowIn('UTC', at); }
  const g = (t) => parts.find((p) => p.type === t).value;
  const date = `${g('year')}-${g('month')}-${g('day')}`;
  return { date, hour: Number(g('hour')), weekdayMon0: (parseISO(date).getUTCDay() + 6) % 7 };
}
export const isValidTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

/** Looks for a date in a file name, e.g. "..._071526_A2.ods" = 15 Jul 2026 (MMDDYY) or "2026-07-15". Returns null if none. */
export function dateFromFilename(name) {
  const tries = []; let m;
  const r8 = /(?<!\d)(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/g; while ((m = r8.exec(name))) tries.push([+m[1], +m[2], +m[3]]);
  const r6 = /(?<!\d)(\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/g; while ((m = r6.exec(name))) tries.push([2000 + +m[3], +m[1], +m[2]]);
  let found = null;
  for (const [y, mo, d] of tries) { const dt = new Date(Date.UTC(y, mo - 1, d)); if (dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && y >= 2015 && y <= 2099) found = isoDate(dt); }
  return found;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(s) { if (!s) return ''; const d = parseISO(s); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
export const fmtRange = (a, b) => (a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`);
