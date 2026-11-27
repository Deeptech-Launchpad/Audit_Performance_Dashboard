// Building blocks of the Overview page (kept small on purpose: the page is meant to be read in about 10 seconds).
// Styles are in overview.css. Nothing here calculates audit numbers: the page passes in what the server already worked out.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ANIMATE } from '../lib/motion.js';
import { num, pct } from '../lib/format.js';
import { AnimatedValue, Info } from './ui.jsx';
import { Tip, codeColor } from './charts.jsx';

/** good / watch / improve for a team-level error rate */
export function rateTone(rate, target, margin) {
  if (rate == null) return null;
  return rate <= target ? 'good' : rate <= target + margin ? 'watch' : 'improve';
}

/** Two-way switch (pill tabs) */
export function Seg({ value, onChange, items, label }) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {items.map(([k, text]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{text}</button>))}
    </div>
  );
}

/** Ranked list of the most common mistakes: name, a bar, the count and its share. Each row opens Error Analysis for that mistake. */
export function MistakeList({ types, total, linkFor, limit = 6 }) {
  const [all, setAll] = useState(false);
  const rows = all ? types : types.slice(0, limit); const max = Math.max(1, ...types.map((t) => t.classifications));
  return (
    <>
      <ul className="mix">
        {rows.map((t) => (
          <li key={t.code}>
            <Link to={linkFor(t.code)} className="mix-row" title={`${t.name}: ${t.classifications} mistakes on ${t.skus} SKU${t.skus === 1 ? '' : 's'}. Click to see them.`}>
              <span className="mix-dot" style={{ background: codeColor(t.code) }} aria-hidden="true" />
              <span className="mix-name">{t.name}<span className="mix-code">{t.code}</span></span>
              <span className="mix-bar"><i className={ANIMATE ? 'anim' : ''} style={{ '--w': `${(t.classifications / max) * 100}%`, background: codeColor(t.code) }} /></span>
              <span className="mix-val"><b>{num(t.classifications)}</b><span className="muted"> · {pct(total ? (t.classifications / total) * 100 : null, 0)}</span></span>
            </Link>
          </li>))}
      </ul>
      {types.length > limit && <button type="button" className="btn small link mix-more" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${types.length} kinds`}</button>}
    </>
  );
}

/** A key number. The whole tile is one click target (a stretched button/link) so the (i) help button inside it stays a separate control. */
export function StatTile({ label, value, sub, info, tone, to, onClick, hint }) {
  const act = to || onClick;
  const ariaGo = `${label}: ${typeof value === 'string' ? value : num(value)}. ${hint || 'Open details'}`;
  return (
    <div className={`stat ${tone ? `tone-${tone}` : ''} ${act ? 'clickable' : ''}`}>
      {to && <Link className="stat-hit" to={to} aria-label={ariaGo} title={hint} />}
      {onClick && <button type="button" className="stat-hit" onClick={onClick} aria-label={ariaGo} title={hint} />}
      <div className="stat-lbl">{label}{info && <Info text={info} />}</div>
      <div className={`stat-val ${typeof value === 'string' && /[a-z]/i.test(value) ? 'is-text' : ''}`}><AnimatedValue value={value} /></div>
      {sub && <div className="stat-sub">{sub}</div>}
      {act && <span className="stat-go" aria-hidden="true">↗</span>}
    </div>
  );
}

/** Weekly error % with the target line */
export function ErrorTrend({ data, target, height = 250 }) {
  const maxRate = Math.max(0, ...data.map((d) => d.errorRate || 0));
  const yMax = Math.ceil(Math.max(target * 1.6, maxRate * 1.2, 10) / 5) * 5;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ left: 0, right: 16, top: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="ov-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--c1)', stopOpacity: 0.26 }} /><stop offset="100%" style={{ stopColor: 'var(--c1)', stopOpacity: 0.02 }} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} padding={{ left: 26, right: 26 }} />
        <YAxis tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} width={44} domain={[0, yMax]} />
        <ReferenceLine y={target} stroke="var(--ink-3)" strokeDasharray="5 4" label={{ value: `Error rate ${target}%`, position: 'insideTopRight', fontSize: 11, fill: 'var(--ink-3)' }} />
        <Tooltip content={<Tip fmt={(v) => `${v}%`} />} />
        <Area isAnimationActive={ANIMATE} animationDuration={900} type="monotone" dataKey="errorRate" name="Error %" stroke="var(--c1)" strokeWidth={2.5} fill="url(#ov-area)" connectNulls
          dot={{ r: 4.5, strokeWidth: 2, stroke: 'var(--surface)', fill: 'var(--c1)' }} activeDot={{ r: 7, strokeWidth: 2, stroke: 'var(--surface)' }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** One line of a Top 5 list: rank, name (a link), a short note, and the figure on the right. */
export function ListRow({ n, name, to, line, valueText }) {
  return (
    <li className="lr">
      <span className="lr-n">{n}</span>
      <div className="lr-main"><Link to={to} className="lr-name">{name}</Link><div className="lr-line">{line}</div></div>
      <b className="lr-val">{valueText}</b>
    </li>
  );
}
