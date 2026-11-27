const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const pct = (x, d = 1) => (x == null ? '—' : `${Number(x).toFixed(d).replace(/\.0+$/, '')}%`);
export const num = (x) => (x == null ? '—' : Number(x).toLocaleString('en-IN'));
export function date(s) { if (!s) return ''; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; }
export function dateShort(s) { if (!s) return ''; const [, m, d] = String(s).slice(0, 10).split('-').map(Number); return `${d} ${MON[m - 1]}`; }
export function addDays(s, n) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
/** "13–18 Jul" for the week starting on a Monday: Monday to Saturday (Sunday is not part of a week) */
export function weekLabel(w) { if (!w) return ''; const e = addDays(w, 5); const [, m1, d1] = w.split('-').map(Number); const [, m2, d2] = e.split('-').map(Number); return m1 === m2 ? `${d1}–${d2} ${MON[m1 - 1]}` : `${d1} ${MON[m1 - 1]} – ${d2} ${MON[m2 - 1]}`; }
export function monthLabel(m) { const [y, mo] = m.split('-').map(Number); return `${MON[mo - 1]} ${y}`; }
export function dateTime(iso) { if (!iso) return ''; const d = new Date(iso); return `${date(iso.slice(0, 10))}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`; }
export const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + 's'}`;
export const bytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export const LEVELS = {
  good: { label: 'Lowest error rate', icon: '✔', cls: 'good', help: 'Error rate is at or below the set error rate – lowest error rate.' },
  watch: { label: 'Moderate error rate', icon: '●', cls: 'watch', help: 'A little above the set error rate.' },
  improve: { label: 'High error rate', icon: '▲', cls: 'improve', help: 'Well above the set error rate.' },
  few: { label: 'Too few samples', icon: '◔', cls: 'few', help: 'Not enough audited SKUs yet to judge fairly.' },
  none: { label: 'Nothing audited', icon: '–', cls: 'few', help: 'No SKUs were audited in this period.' },
};
export const PT_CLASS = { completed: 'Done', pending: 'Pending', not_recorded: 'No status recorded', unmapped: 'Unrecognised status', not_applicable: '—' };
export const REAUDIT = { passed: 'Re-audited – OK', issues: 'Re-audited – issues found', pending: 'Re-audit pending', not_due: 'Not due yet' };
export const ROLE_LABEL = { admin: 'Admin', manager: 'Audit Manager', leader: 'Audit Team Leader', viewer: 'Viewer' };
