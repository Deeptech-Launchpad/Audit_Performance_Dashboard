import { useFilters, useMeta } from '../lib/filters.jsx';
import { date, monthLabel, weekLabel } from '../lib/format.js';

/** Global filters. `show` picks which ones make sense on the current page. Changing any of them reloads the page's numbers and charts. */
export default function FilterBar({ show = ['period', 'builder', 'auditor'], allowed }) {
  const meta = useMeta();
  const keys = allowed || ['from', 'to', 'week', 'month', 'builderId', 'auditorId', 'uploadId', 'project', 'errorCode', 'ptStatus'].filter((k) => (
    (k === 'from' || k === 'to' || k === 'week' || k === 'month') ? show.includes('period') : show.includes({ builderId: 'builder', auditorId: 'auditor', uploadId: 'file', project: 'project', errorCode: 'errorCode', ptStatus: 'ptStatus' }[k])));
  const { values: v, set, clear, active } = useFilters(keys);
  const mode = v.week ? 'week' : v.month ? 'month' : v.from || v.to ? 'range' : 'all';
  const changeMode = (m) => {
    if (m === 'all') set({ week: '', month: '', from: '', to: '' });
    if (m === 'week') set({ week: meta.weeks[0] || '' });
    if (m === 'month') set({ month: meta.months[0] || '' });
    if (m === 'range') set({ from: meta.bounds.first || '', to: meta.bounds.last || '' });
  };
  const sel = (key, label, options, help) => (
    <div className="field"><label htmlFor={`f-${key}`}>{label}</label>
      <select id={`f-${key}`} value={v[key]} onChange={(e) => set({ [key]: e.target.value })} title={(v[key] && options.find(([val]) => String(val) === String(v[key]))?.[1]) || help}>
        <option value="">All</option>{options.map(([val, text]) => <option key={val} value={val}>{text}</option>)}
      </select></div>
  );
  // Projects are listed by their first word only (Grainger, Analog ...). An older link that still carries a full project name keeps showing it, so the box never looks like "All" while a filter is on.
  const projectOptions = (meta.projectGroups || []).map((p) => [p.name, p.name]);
  if (v.project && !projectOptions.some(([val]) => val === v.project)) projectOptions.push([v.project, v.project]);
  return (
    <div className="card filters" role="search" aria-label="Filters">
      {show.includes('period') && (<>
        <div className="field"><label htmlFor="f-mode">Time period</label>
          <select id="f-mode" value={mode} onChange={(e) => changeMode(e.target.value)}>
            <option value="all">All dates</option><option value="week">A week</option><option value="month">A month</option><option value="range">Date range</option></select></div>
        {mode === 'week' && <div className="field"><label htmlFor="f-week">Week</label><select id="f-week" value={v.week} onChange={(e) => set({ week: e.target.value })}>{meta.weeks.map((w) => <option key={w} value={w}>{weekLabel(w)}</option>)}</select></div>}
        {mode === 'month' && <div className="field"><label htmlFor="f-month">Month</label><select id="f-month" value={v.month} onChange={(e) => set({ month: e.target.value })}>{meta.months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></div>}
        {mode === 'range' && (<>
          <div className="field"><label htmlFor="f-from">From</label><input id="f-from" type="date" value={v.from} max={v.to || undefined} onChange={(e) => set({ from: e.target.value })} /></div>
          <div className="field"><label htmlFor="f-to">To</label><input id="f-to" type="date" value={v.to} min={v.from || undefined} onChange={(e) => set({ to: e.target.value })} /></div></>)}
      </>)}
      {show.includes('project') && sel('project', 'Project', projectOptions, 'Show only the files of one project (named by its first word, for example Grainger)')}
      {show.includes('builder') && sel('builderId', 'Product team member', meta.builders.map((b) => [b.id, b.name]))}
      {show.includes('auditor') && sel('auditorId', 'Auditor', meta.auditors.map((b) => [b.id, b.name]))}
      {show.includes('file') && sel('uploadId', 'File', (meta.uploads || []).map((u) => [u.id, `${date(u.auditDate)} · ${u.name}`]), 'Show only the records that came from one uploaded file')}
      {show.includes('errorCode') && sel('errorCode', 'Error type', meta.errorTypes.filter((t) => t.isError).map((t) => [t.code, `${t.name} (${t.code})`]))}
      {show.includes('ptStatus') && sel('ptStatus', 'PT status', [['__none__', '(no status recorded)'], ...meta.ptStatuses.map((s) => [s, s])])}
      {active.length > 0 && <button className="btn small" onClick={clear}>Clear filters</button>}
      {/* the File box stays compact; the chosen file's FULL name is shown on one slim line below */}
      {show.includes('file') && v.uploadId && (() => { const u = (meta.uploads || []).find((x) => String(x.id) === String(v.uploadId)); return u ? (
        <div className="file-chip" role="status"><span className="file-chip-k">File</span><span className="file-chip-n">{u.name}</span><span className="muted">· {date(u.auditDate)}</span>
          <button type="button" className="file-chip-x" aria-label="Show all files" title="Show all files" onClick={() => set({ uploadId: '' })}>×</button></div>) : null; })()}
    </div>
  );
}
