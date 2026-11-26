import { ANIMATE } from '../lib/motion.js';
// Chart building blocks (Recharts). One axis per chart, thin marks, recessive grid, tooltips on hover.
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export const SLOTS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)', 'var(--c7)', 'var(--c8)'];
// Error codes keep the same colour on every page. Codes beyond the 8 colour slots use grey and are always labelled.
const PRIORITY = ['DE', 'DM', 'RBE', 'SRE', 'RE', 'UM', 'UE', 'CAE'];
export const codeColor = (code) => { const i = PRIORITY.indexOf(code); return i >= 0 ? SLOTS[i] : 'var(--cx)'; };
export const LEVEL_COLOR = { good: 'var(--good)', watch: 'var(--watch)', improve: 'var(--improve)', few: 'var(--few)', none: 'var(--few)' };

export function Tip({ active, payload, label, fmt, labelFmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <b>{labelFmt ? labelFmt(label, payload) : label}</b>
      {payload.filter((p) => p.value != null).map((p) => (
        <div key={p.dataKey}><span style={{ color: p.color || p.stroke || p.fill }}>●</span> {p.name}: <b style={{ display: 'inline' }}>{fmt ? fmt(p.value, p) : p.value}</b></div>
      ))}
    </div>
  );
}

/** Horizontal bars, one value per category. */
export function HBar({ data, nameKey = 'name', valueKey = 'value', color = 'var(--c1)', colorOf, onClick, height, fmt, label = 'Value', width = 150, domainMax }) {
  const h = height || Math.max(120, data.length * 30 + 20);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 36, top: 4, bottom: 4 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} domain={[0, domainMax || 'auto']} />
        <YAxis type="category" dataKey={nameKey} width={width} tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 12, fill: 'var(--ink-2)' }} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<Tip fmt={fmt} />} />
        <Bar isAnimationActive={ANIMATE} animationDuration={750} dataKey={valueKey} name={label} radius={[0, 4, 4, 0]} maxBarSize={18} onClick={onClick ? (d) => onClick(d) : undefined} cursor={onClick ? 'pointer' : undefined} label={{ position: 'right', fontSize: 12, fill: 'var(--ink-2)', formatter: fmt }}>
          {data.map((d, i) => <Cell key={i} fill={colorOf ? colorOf(d) : color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Lines over time. lines: [{key, name, color}] ; target: draws a dashed reference line. */
export function Trend({ data, xKey, lines, yFmt = (v) => v, height = 260, target, targetLabel, xFmt, yMax }) {
  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ left: 0, right: 16, top: 10, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickFormatter={xFmt} />
          <YAxis tickLine={false} axisLine={false} tickFormatter={yFmt} width={44} domain={[0, yMax || 'auto']} />
          <Tooltip content={<Tip fmt={(v) => yFmt(v)} labelFmt={xFmt} />} />
          {target != null && <ReferenceLine y={target} stroke="var(--ink-3)" strokeDasharray="5 4" label={{ value: targetLabel || 'Target', position: 'insideTopRight', fontSize: 11, fill: 'var(--ink-3)' }} />}
          {lines.map((l) => <Line isAnimationActive={ANIMATE} animationDuration={750} key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: l.color }} activeDot={{ r: 6 }} connectNulls />)}
          {lines.length > 1 && <Legend iconType="plainline" wrapperStyle={{ fontSize: 12.5 }} />}
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}

/** Stacked vertical bars. keys: [{key, name, color}] */
export function Stacked({ data, xKey, keys, height = 260, xFmt }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 0, right: 16, top: 10, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickFormatter={xFmt} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={36} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<Tip labelFmt={xFmt} />} />
        <Legend wrapperStyle={{ fontSize: 12.5 }} iconType="square" />
        {keys.map((k) => <Bar isAnimationActive={ANIMATE} animationDuration={750} key={k.key} dataKey={k.key} name={k.name} stackId="s" fill={k.color} stroke="var(--surface)" strokeWidth={2} maxBarSize={44} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical grouped bars (e.g. samples vs SKUs per week) */
export function Columns({ data, xKey, keys, height = 260, xFmt, fmt }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 0, right: 16, top: 10, bottom: 0 }} barGap={4}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickFormatter={xFmt} />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={36} />
        <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<Tip labelFmt={xFmt} fmt={fmt} />} />
        {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 12.5 }} iconType="square" />}
        {keys.map((k) => <Bar isAnimationActive={ANIMATE} animationDuration={750} key={k.key} dataKey={k.key} name={k.name} fill={k.color} radius={[4, 4, 0, 0]} maxBarSize={36} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}
