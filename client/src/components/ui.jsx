import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { ANIMATE } from '../lib/motion.js';
import { LEVELS, num } from '../lib/format.js';

const ICONS = {
  overview: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  audit: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  error: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  table: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  report: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8M8 9h2',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  x: 'M18 6L6 18M6 6l12 12', menu: 'M3 6h18M3 12h18M3 18h18', logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  chart: 'M3 3v18h18M7 14l4-4 3 3 5-6',
  note: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 8h8M8 12h5',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M17.9 17.9A10.8 10.8 0 0 1 12 20c-7 0-11-8-11-8a19.8 19.8 0 0 1 5.1-5.9M9.9 4.2A10 10 0 0 1 12 4c7 0 11 8 11 8a19.9 19.9 0 0 1-2.2 3.2M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
};
export const Icon = ({ name, size }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name] || ICONS.chart} /></svg>
);

/** Password box with an eye button to show / hide what was typed. Takes the same props as <input>. */
export function PasswordInput(props) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw-wrap">
      <input {...props} type={show ? 'text' : 'password'} />
      <button type="button" className="pw-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'} aria-pressed={show}><Icon name={show ? 'eyeOff' : 'eye'} size={17} /></button>
    </span>
  );
}
/** (i) help bubble. Drawn on top of the whole page (not inside the card), above the button, or below it when there is no room above
 *  (for example under the sticky filter bar), so it is never hidden or cut off. */
export function Info({ text }) {
  const btn = useRef(null); const pop = useRef(null); const [at, setAt] = useState(null);
  const show = () => { const r = btn.current?.getBoundingClientRect(); if (r) setAt({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom }); };
  const hide = () => setAt(null);
  useLayoutEffect(() => {
    const el = pop.current; if (!at || !el) return;
    const h = el.offsetHeight, w = el.offsetWidth;
    const bar = document.querySelector('.filters'); const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    const limit = Math.max(8, barBottom > 0 && barBottom < at.top ? barBottom + 6 : 8);
    let top = at.top - h - 8; if (top < limit) top = at.bottom + 8;
    el.style.top = `${Math.min(top, window.innerHeight - h - 8)}px`;
    el.style.left = `${Math.min(Math.max(8, at.x - w / 2), window.innerWidth - w - 8)}px`;
    el.style.visibility = 'visible';
  }, [at]);
  useEffect(() => {
    if (!at) return undefined;
    window.addEventListener('scroll', hide, true); window.addEventListener('resize', hide);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
  }, [at]);
  return (
    <span className="info" onMouseEnter={show} onMouseLeave={hide}>
      <button ref={btn} type="button" className="info-btn" aria-label="More information" onFocus={show} onBlur={hide} onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (at) hide(); else show(); }}>i</button>
      {at && createPortal(<span ref={pop} className="info-pop info-float" role="tooltip">{text}</span>, document.body)}
    </span>
  );
}
export const PageHeader = ({ title, subtitle, children }) => (
  <div className="page-head"><div className="grow"><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{children}</div>
);
export const Card = ({ title, info, actions, children, className = '', flush }) => (
  <section className={`card ${className}`}>
    {(title || actions) && <div className="card-h"><h3>{title}</h3>{info && <Info text={info} />}<span className="grow" />{actions}</div>}
    <div className={flush ? '' : 'card-b'}>{children}</div>
  </section>
);
/** Numbers on the summary cards count up from 0 when they appear ("1,110", "29.8%" …). Anything else is shown as is. */
export function AnimatedValue({ value }) {
  const parsed = typeof value === 'number' ? { n: value, dec: 0, suffix: '' } : (typeof value === 'string' ? (() => {
    const m = /^(\d[\d,]*)(\.\d+)?(%?)$/.exec(value.trim()); return m ? { n: Number(`${m[1].replace(/,/g, '')}${m[2] || ''}`), dec: m[2] ? m[2].length - 1 : 0, suffix: m[3] } : null; })() : null);
  const [shown, setShown] = useState(parsed && ANIMATE ? 0 : null); const [done, setDone] = useState(!parsed || !ANIMATE);
  const target = parsed?.n;
  useEffect(() => {
    if (!parsed || !ANIMATE) { setDone(true); return undefined; }
    setDone(false); let raf; const t0 = performance.now(); const dur = 850;
    const tick = (t) => { const p = Math.min(1, (t - t0) / dur); setShown(target * (1 - (1 - p) ** 3)); if (p < 1) raf = requestAnimationFrame(tick); else setDone(true); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  if (done || shown == null) return <>{value}</>;
  return <>{shown.toLocaleString('en-IN', { minimumFractionDigits: parsed.dec, maximumFractionDigits: parsed.dec })}{parsed.suffix}</>;
}
export function Kpi({ label, value, sub, info, tone, delta }) {
  return (
    <div className={`card kpi ${tone ? 'tone-' + tone : ''}`}>
      <div className="lbl">{label}{info && <Info text={info} />}</div>
      <div className="val"><AnimatedValue value={value} />{delta}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
/** "▲ 3.2 pts" - `goodWhen` says which direction is an improvement */
export function Delta({ diff, unit = ' pts', goodWhen = 'down' }) {
  if (diff == null) return null;
  if (Math.abs(diff) < 0.05) return <span className="delta flat">no change</span>;
  const up = diff > 0; const good = (goodWhen === 'down') !== up;
  return <span className={`delta ${good ? 'up-good' : 'up-bad'}`} title="Compared with the previous period">{up ? '▲' : '▼'} {Math.abs(diff).toFixed(1).replace(/\.0$/, '')}{unit}</span>;
}
export const LevelBadge = ({ level }) => { const l = LEVELS[level] || LEVELS.none; return <span className={`badge ${l.cls}`} title={l.help}><span aria-hidden="true">{l.icon}</span> {l.label}</span>; };
export const Loading = () => <div className="loading" role="status" aria-label="Loading"><span className="spinner" /></div>;
export const ErrorBox = ({ error, retry }) => (
  <div className="alert error" role="alert"><div className="grow"><b>Could not load this page.</b> {error?.message}</div>{retry && <button className="btn small" onClick={retry}>Try again</button>}</div>
);
export const Empty = ({ title = 'Nothing to show', children }) => <div className="empty"><h3>{title}</h3><div>{children}</div></div>;
/** Placeholder shapes (with a soft shimmer) shown while a page loads, instead of a spinner. */
export const Skeleton = () => (
  <div aria-busy="true" aria-label="Loading">
    <div className="grid g-kpi">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton" style={{ height: 112, animationDelay: `${i * 80}ms` }} />)}</div>
    <div className="grid g2 mt"><div className="skeleton" style={{ height: 280 }} /><div className="skeleton" style={{ height: 280 }} /></div>
  </div>
);
export function Async({ state, children, emptyWhen, empty }) {
  if (state.loading && !state.data) return <Skeleton />;
  if (state.error) return <ErrorBox error={state.error} retry={state.reload} />;
  if (!state.data) return null;
  if (emptyWhen && emptyWhen(state.data)) return empty || <Empty title="No audit data yet">Upload an audit file on the “Upload Audit Files” page, or widen the filters above.</Empty>;
  return <div style={{ opacity: state.loading ? 0.6 : 1, transition: 'opacity .15s' }}>{children(state.data)}</div>;
}

export function Drawer({ title, onClose, children, wide }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="drawer-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title} style={wide ? { width: 'min(960px,100%)' } : undefined}>
        <div className="row mb"><h2 className="grow" style={{ fontSize: 18 }}>{title}</h2><button className="btn small" onClick={onClose} aria-label="Close"><Icon name="x" /> Close</button></div>
        {children}
      </aside>
    </div>
  );
}
export function Modal({ title, onClose, children }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="drawer-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row mb"><h2 className="grow" style={{ fontSize: 18 }}>{title}</h2><button className="btn small" onClick={onClose}><Icon name="x" /> Close</button></div>
        {children}
      </div>
    </div>
  );
}
export const Tabs = ({ value, onChange, items }) => (
  <div className="tabs" role="tablist">{items.map(([k, label]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{label}</button>)}</div>
);
/** Warns when some files in the current selection were imported without attribute counts (they are left out of the attribute numbers). */
export function AttrNotice({ files }) {
  if (!files?.length) return null;
  return (
    <div className="alert warn mb" role="status"><div>
      <b>Attribute numbers leave out {files.length} file{files.length === 1 ? '' : 's'}</b>: {files.map((f) => f.name).join(', ')}. {files.length === 1 ? 'It is' : 'They are'} in the dashboard, but the attribute counts were not saved when {files.length === 1 ? 'it was' : 'they were'} first uploaded (the file itself has the attribute columns). Upload {files.length === 1 ? 'it' : 'them'} once more on <Link to="/upload">Upload Audit Files</Link>: the rows show as “Updated details” and the attribute counts are added. Nothing is duplicated.
    </div></div>
  );
}
export const Alert =({ kind = 'info', children }) => <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : undefined}><div>{children}</div></div>;

export function Pager({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <div className="pager muted">{num(total)} {total === 1 ? 'row' : 'rows'}</div>;
  const from = (page - 1) * pageSize + 1, to = Math.min(total, page * pageSize);
  return (
    <div className="pager">
      <button className="btn small" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Previous</button>
      <span>Page {page} of {num(pages)} · showing {num(from)}–{num(to)} of {num(total)}</span>
      <button className="btn small" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next ›</button>
    </div>
  );
}

/** Small client-side table: click a heading to sort, pages of `pageSize` rows.
 *  columns: [{ key, label, render?(row), num?, sort?(row) -> sortable value, title? }] */
export function DataTable({ columns, rows, pageSize = 15, onRowClick, initialSort, empty = 'No rows to show.', rowKey }) {
  const [sort, setSort] = useState(initialSort || null); const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [rows]);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key); const get = col?.sort || ((r) => r[sort.key]);
    return rows.slice().sort((a, b) => {
      const x = get(a), y = get(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return sort.dir === 'asc' ? c : -c;
    });
  }, [rows, sort, columns]);
  const view = sorted.slice((page - 1) * pageSize, page * pageSize);
  if (!rows.length) return <div className="empty">{empty}</div>;
  const toggle = (c) => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.num ? 'desc' : 'asc' }));
  return (
    <>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr>{columns.map((c) => (
          <th key={c.key} className={`${c.num ? 'num' : ''} ${c.sort !== false ? 'sortable' : ''}`} onClick={c.sort === false ? undefined : () => toggle(c)} title={c.title} aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
            {c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>))}</tr></thead>
        <tbody>{view.map((r, i) => (
          <tr key={rowKey ? rowKey(r) : i} className={onRowClick ? 'clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined}>
            {columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : r[c.key]}</td>)}
          </tr>))}</tbody>
      </table></div>
      <Pager page={page} pageSize={pageSize} total={rows.length} onPage={setPage} />
    </>
  );
}
