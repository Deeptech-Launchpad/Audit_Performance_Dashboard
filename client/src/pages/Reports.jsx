import { useEffect, useState } from 'react';
import { api, download, useApi } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { useMeta } from '../lib/filters.jsx';
import { addDays, date, dateTime, num, pct, weekLabel } from '../lib/format.js';
import { Alert, Async, Card, Delta, Icon, LevelBadge, PageHeader } from '../components/ui.jsx';

const range = (a, b) => (a === b ? date(a) : `${date(a)} – ${date(b)}`);
const SEV = { high: '!', medium: '•', low: 'i', good: '✔' };
const SEV_LABEL = { high: 'Important', medium: 'Worth doing', low: 'For information', good: 'Good news' };

function Table({ head, rows, num: numCols = [] }) {
  return (
    <div className="tbl-wrap"><table className="tbl">
      <thead><tr>{head.map((h, i) => <th key={h} className={numCols.includes(i) ? 'num' : ''}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={numCols.includes(j) ? 'num' : ''}>{c}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

const KIND = { weekly: ['Week', 'info'], month: ['Month', 'watch'], custom: ['Dates', 'few'], file: ['File', 'good'] };
/** a report made for one whole calendar month is shown as a month report */
const kindOf = (r) => (r.kind === 'file' ? 'file' : r.scope?.type === 'month' ? 'month' : r.kind);
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const titleOf = (r) => (r.kind === 'file' ? r.period.label : kindOf(r) === 'month' ? monthName(r.period.from.slice(0, 7)) : range(r.period.from, r.period.to));
const kindWord = (k) => ({ weekly: 'this week', month: 'this month', file: 'this file' }[k] || 'these dates');

/** The headline in plain words + 4 numbers, at the top of every report */
function Glance({ r }) {
  const o = r.overall, c = r.comparison;
  const better = c.hasPrevious && c.errorRate != null ? (c.errorRate < 0 ? 'better' : c.errorRate > 0 ? 'worse' : 'the same') : null;
  const prevWord = { file: 'the previous file', weekly: 'the week before', month: 'the month before' }[kindOf(r)] || 'the period before';
  return (
    <div className="rep-glance mb">
      <p className="rep-say">
        In {kindWord(kindOf(r))}, <b>{num(o.samples)}</b> SKUs were audited and <b>{num(o.errorSkus)}</b> had errors – an error rate of <b>{pct(o.errorRate)}</b>
        {o.errorRate != null && <> ({o.errorRate <= r.target ? 'within' : 'above'} the {r.target}% error rate)</>}.
        {better && better !== 'the same' && <> That is <b className={better === 'better' ? 'rep-good' : 'rep-bad'}>{Math.abs(c.errorRate)} points {better}</b> than {prevWord}.</>}
        {better === 'the same' && <> The same as {prevWord}.</>}
        {r.afterReaudit && <span className="muted"> Only errors confirmed by the re-audit are counted.</span>}
      </p>
      <div className="rep-tiles">
        <div><span>SKUs audited</span><b>{num(o.samples)}</b></div>
        <div><span>SKUs with errors</span><b>{num(o.errorSkus)}</b></div>
        <div><span>Error rate</span><b>{pct(o.errorRate)}</b>{c.errorRate != null && c.hasPrevious && <Delta diff={c.errorRate} unit=" pts" goodWhen="down" />}</div>
        <div><span>PT / re-audit pending</span><b>{num(r.followUps.pt.pending)} / {num(r.followUps.reaudit.pending)}</b></div>
      </div>
    </div>
  );
}

function ReportView({ id, canDelete, onDeleted }) {
  const st = useApi(`/api/reports/${id}`);
  const [busy, setBusy] = useState(''); const [err, setErr] = useState('');
  async function get(kind) {
    setBusy(kind); setErr('');
    try { await download(`/api/reports/${id}/${kind}`, {}, `audit-report.${kind === 'excel' ? 'xlsx' : 'pdf'}`); } catch (e) { setErr(e.message); }
    setBusy('');
  }
  async function remove() {
    if (!window.confirm('Delete this report? The audit data is not affected; you can create the report again at any time.')) return;
    setBusy('del'); setErr('');
    try { await api.del(`/api/reports/${id}`); onDeleted(); } catch (e) { setErr(e.message); setBusy(''); }
  }
  return (
    <Async state={st}>{(r) => {
      const o = r.overall, p = r.previousOverall, c = r.comparison, fu = r.followUps;
      const an = (m, k) => (m.attrsAvailable === true ? num(m[k]) : 'Not available'); // attribute counts need the file's attribute columns
      const rowsWow = [
        ['Total SKUs', o.skusAvailable === false ? 'Not available' : num(o.skus), p.skusAvailable === false ? 'Not available' : num(p.skus), c.skus, ' ', 'up'],
        ['Samples audited', num(o.samples), num(p.samples), c.samples, ' ', 'up'],
        ['Sample audit %', o.skusAvailable === false ? 'Not available' : pct(o.sampleRate), p.skusAvailable === false ? 'Not available' : pct(p.sampleRate), c.sampleRate, ' pts', 'up'],
        ['SKUs with errors', num(o.errorSkus), num(p.errorSkus), c.errorSkus, ' ', 'down'],
        ['Error % (SKUs with errors ÷ samples audited)', pct(o.errorRate), pct(p.errorRate), c.errorRate, ' pts', 'down'],
        ['Error classifications (error codes)', num(o.classifications), num(p.classifications), c.classifications, ' ', 'down'],
        ['Attributes enriched', an(o, 'attrsEnriched'), an(p, 'attrsEnriched'), null, ' ', 'up'],
        ['Attributes audited', an(o, 'attrsAudited'), an(p, 'attrsAudited'), null, ' ', 'up'],
        ['Attributes with errors', num(o.attrErrors), num(p.attrErrors), c.attrErrors, ' ', 'down'],
        ['Attribute error % (with errors ÷ audited)', o.attrsAvailable === true ? pct(o.attrErrorRate) : 'Not available', p.attrsAvailable === true ? pct(p.attrErrorRate) : 'Not available', c.attrErrorRate, ' pts', 'down'],
        ['PT pending cases', num(fu.pt.pending), num(fu.previous.pt.pending), c.hasPrevious ? fu.pt.pending - fu.previous.pt.pending : null, ' ', 'down'],
        ['Re-audit pending cases', num(fu.reaudit.pending), num(fu.previous.reaudit.pending), c.hasPrevious ? fu.reaudit.pending - fu.previous.reaudit.pending : null, ' ', 'down'],
      ];
      return (
        <div id="report-preview">
          <div className="rep-head mb">
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row gap-s"><span className={`badge ${KIND[kindOf(r)]?.[1] || 'few'}`}>{KIND[kindOf(r)]?.[0] || 'Report'} report</span>
                {r.kind === 'file' && <span className="muted small">audit dates {range(r.period.from, r.period.to)}</span>}</div>
              <h2 className="rep-title">{titleOf(r)}</h2>
              <div className="muted small">Compared with {r.kind === 'file' ? r.previous.label : range(r.previous.from, r.previous.to)} · created {dateTime(r.generatedAt)} · error rate {r.target}% or lower</div>
            </div>
            <div className="row gap-s rep-actions">
              <button className="btn primary" onClick={() => get('pdf')} disabled={!!busy}><Icon name="download" /> {busy === 'pdf' ? 'Preparing…' : 'PDF'}</button>
              <button className="btn" onClick={() => get('excel')} disabled={!!busy}><Icon name="download" /> {busy === 'excel' ? 'Preparing…' : 'Excel'}</button>
              <button className="btn" onClick={() => window.print()}>Print</button>
              {canDelete && <button className="btn danger" onClick={remove} disabled={!!busy}>{busy === 'del' ? 'Deleting…' : 'Delete'}</button>}
            </div>
          </div>
          {err && <div className="mb"><Alert kind="error">{err}</Alert></div>}
          <Glance r={r} />
          {r.notes.length > 0 && <div className="mb"><Alert kind="warn"><b>Please note</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{r.notes.map((n) => <li key={n}>{n}</li>)}</ul></Alert></div>}

          <Card title="1. Overall team performance" info={r.kind === 'file' ? '“Change” compares this file with the earlier file of the same project. For error numbers, going down is good.' : '“Change” compares this period with the period just before it. For error numbers, going down is good.'}>
            <Table head={['Measure', r.kind === 'file' ? 'This file' : 'This period', r.kind === 'file' ? 'Previous file' : 'Previous period', 'Change']} num={[1, 2, 3]}
              rows={rowsWow.map(([label, a, b, diff, unit, good]) => [label, a, c.hasPrevious ? b : '—', diff == null ? '—' : <Delta key={label} diff={diff} unit={unit} goodWhen={good} />])} />
            <p className="muted small mt-s">{num(r.reconciliation.classifications)} error codes were recorded on {num(r.reconciliation.errorSkus)} SKUs{r.reconciliation.extra > 0 ? `. The ${num(r.reconciliation.extra)} extra come from SKUs that have more than one error code: such a SKU counts once as a “SKU with errors”, but once per code as an “error classification”.` : '.'}</p>
            {!c.hasPrevious && <p className="muted small">There is no data in the previous period, so no comparison is shown.</p>}
          </Card>

          <Card title="2. Product team – individual performance" className="mt">
            <Table head={['Name', 'Total SKUs', 'Samples', 'With errors', 'Error %', 'Status', 'Most common mistakes']} num={[1, 2, 3, 4]}
              rows={r.content.map((m) => [<b key="n">{m.name}</b>, m.skusAvailable === false ? 'Not available' : num(m.skus), num(m.samples), num(m.errorSkus), pct(m.errorRate), <LevelBadge key="l" level={m.level} />, m.topTypes.map((t) => `${t.name} (${t.classifications})`).join(', ') || '—'])} />
          </Card>

          <Card title="2b. Product team – attribute based" className="mt" info="Counts the individual attributes inside the SKUs. Not available when the uploaded file has no attribute columns (reports created before attributes were counted also show Not available).">
            <Table head={['Name', 'Attributes enriched', 'Attributes audited', 'With errors', 'Attribute error %']} num={[1, 2, 3, 4]}
              rows={r.content.map((m) => [<b key="n">{m.name}</b>, an(m, 'attrsEnriched'), an(m, 'attrsAudited'), num(m.attrErrors), m.attrsAvailable === true ? pct(m.attrErrorRate) : 'Not available'])} />
          </Card>

          <Card title="3. Audit team – individual activity" className="mt" info="What each auditor did in this report: SKUs audited, error types found, and the follow-up cases still open.">
            <Table head={['Auditor', 'SKUs audited', 'Records', 'Errors found', 'PT pending', 'Re-audit pending', 'Closed cases']} num={[1, 2, 3, 4, 5, 6]}
              rows={r.audit.map((a) => [<b key="n">{a.name}</b>, num(a.skusAudited), num(a.records), num(a.classifications), num(a.pt.pending), num(a.reaudit.pending), num(a.closedCases)])} />
          </Card>

          <div className="grid g2 mt">
            <Card title="4. Top 5 error types"><Table head={['Error type', 'Count', 'Share']} num={[1, 2]} rows={r.topErrorTypes.map((t) => [`${t.name} (${t.code})`, num(t.classifications), pct(t.share)])} /></Card>
            <Card title="5. Top 5 attributes with errors"><Table head={['Attribute', 'SKUs']} num={[1]} rows={r.topAttributes.map((t) => [t.attribute, num(t.skus)])} /></Card>
          </div>

          <Card title="6. Pending PT and re-audit cases" className="mt">
            <Table head={['', 'This period', 'Previous period']} num={[1, 2]} rows={[
              ['PT pending', num(fu.pt.pending), num(fu.previous.pt.pending)], ['PT done', num(fu.pt.completed), num(fu.previous.pt.completed)], ['No PT status recorded', num(fu.pt.not_recorded), num(fu.previous.pt.not_recorded)],
              ['Re-audit pending', num(fu.reaudit.pending), num(fu.previous.reaudit.pending)], ['Re-audit done', num(fu.reaudit.passed + fu.reaudit.issues), num(fu.previous.reaudit.passed + fu.previous.reaudit.issues)],
              [`Pending for more than the ageing limit`, num(fu.olderThanWarn), '—']]} />
          </Card>

          <Card title="7. Improvement suggestions" className="mt" info="Every suggestion comes from a rule applied to the real numbers shown above. Nothing is guessed.">
            {r.suggestions.length === 0 ? <p className="muted">No suggestions: nothing in this period crossed a rule threshold.</p> : r.suggestions.map((s) => (
              <div key={s.id} className={`sugg ${s.severity}`}>
                <span className="dot" aria-label={SEV_LABEL[s.severity]} title={SEV_LABEL[s.severity]}>{SEV[s.severity]}</span>
                <div><div className="t">{s.title}</div><div className="d">{s.detail}</div><div className="a"><b>What to do:</b> {s.action}</div></div>
              </div>))}
          </Card>
        </div>
      );
    }}</Async>
  );
}

const MAKE = [
  ['weekly', 'A week', 'One Monday–Saturday week, compared with the week before.'],
  ['month', 'A month', 'One whole month (for example 1–30 September), compared with the month before.'],
  ['file', 'A file', 'Everything in one uploaded audit file, compared with the earlier file of the same project.'],
  ['custom', 'Any dates', 'Any dates you choose, compared with the same number of days just before.'],
];

/** "Create a report": three clear choices, and only weeks / files that really have data can be picked */
function Maker({ meta, busy, onCreate }) {
  const [mode, setMode] = useState('weekly');
  const weeks = meta.weeks || []; const files = meta.uploads || [];
  const months = meta.months || [];
  const [week, setWeek] = useState(weeks[0] || ''); const [file, setFile] = useState(files[0]?.id || ''); const [month, setMonth] = useState(months[0] || '');
  const last = meta.bounds.last;
  const [from, setFrom] = useState(last ? addDays(last, -6) : ''); const [to, setTo] = useState(last || '');
  const monthEnd = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  // the two date boxes never block each other: if From goes past To (or the other way round), the other box follows
  const pickFrom = (v) => { setFrom(v); if (v && to && v > to) setTo(v); };
  const pickTo = (v) => { setTo(v); if (v && from && v < from) setFrom(v); };
  const ready = mode === 'weekly' ? !!week : mode === 'file' ? !!file : mode === 'month' ? !!month : !!(from && to);
  const go = () => onCreate(mode === 'weekly' ? { kind: 'weekly', from: week, to: week } : mode === 'file' ? { kind: 'file', uploadId: Number(file) }
    : mode === 'month' ? { kind: 'custom', from: `${month}-01`, to: monthEnd(month) } : { kind: 'custom', from, to });
  return (
    <div className="rep-make">
      <div className="seg" role="tablist" aria-label="What should the report cover?">
        {MAKE.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{label}</button>)}
      </div>
      <p className="muted small rep-hint">{MAKE.find((m) => m[0] === mode)[2]}</p>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        {mode === 'weekly' && (weeks.length
          ? <div className="field"><label htmlFor="r-week">Week</label><select id="r-week" value={week} onChange={(e) => setWeek(e.target.value)}>{weeks.map((w) => <option key={w} value={w}>{weekLabel(w)} {String(w).slice(0, 4)}</option>)}</select></div>
          : <span className="muted">No week has audit data yet.</span>)}
        {mode === 'month' && (months.length
          ? <div className="field"><label htmlFor="r-month">Month</label><select id="r-month" value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}</select></div>
          : <span className="muted">No month has audit data yet.</span>)}
        {mode === 'file' && (files.length
          ? <div className="field" style={{ minWidth: 0, flex: '1 1 320px', maxWidth: 560 }}><label htmlFor="r-file">File</label><select id="r-file" value={file} onChange={(e) => setFile(e.target.value)} style={{ width: '100%' }}>{files.map((u) => <option key={u.id} value={u.id}>{u.name} · {date(u.auditDate)}</option>)}</select></div>
          : <span className="muted">No file has been imported yet.</span>)}
        {mode === 'custom' && <>
          <div className="field"><label htmlFor="r-from">From</label><input id="r-from" type="date" value={from} onChange={(e) => pickFrom(e.target.value)} /></div>
          <div className="field"><label htmlFor="r-to">To</label><input id="r-to" type="date" value={to} onChange={(e) => pickTo(e.target.value)} /></div>
        </>}
        <button className="btn primary" disabled={!!busy || !ready} onClick={go}>{busy ? 'Creating…' : 'Create report'}</button>
      </div>
    </div>
  );
}

export default function Reports() {
  const { can } = useAuth(); const meta = useMeta();
  const list = useApi('/api/reports');
  const [sel, setSel] = useState(null); const [show, setShow] = useState('all');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);
  // open the newest report when nothing is chosen (first visit, or after a delete); a report just created is opened by create()
  useEffect(() => { if (sel == null && list.data?.length) setSel(list.data[0].id); }, [list.data, sel]);

  async function create(body) {
    setBusy(true); setMsg(null);
    try { const { id } = await api.post('/api/reports', body); setMsg({ kind: 'ok', text: 'Report created – it is open below.' }); list.reload(); setSel(id); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); }
    setBusy(false);
  }
  const rows = (list.data || []).filter((r) => show === 'all' || r.kind === show);

  return (
    <>
      <PageHeader title="Weekly Reports" subtitle="A summary of how the teams performed, ready to download as PDF or Excel. Weekly reports are made automatically every Monday." />
      {can('report') ? (
        <Card title="Create a report" className="mb" info="A report for each finished Monday–Saturday week is also created automatically every Monday. Creating the same week again updates it.">
          <Maker meta={meta} busy={busy} onCreate={create} />
          {msg && <div className="mt-s"><Alert kind={msg.kind}>{msg.text}</Alert></div>}
        </Card>
      ) : <div className="mb"><Alert kind="info">Only Audit Team Leaders, Audit Managers and Admins can create reports. You can open and download the existing ones.</Alert></div>}

      <div className="grid rep-layout">
        <Card title="Saved reports" flush>
          <div className="rep-filter" role="group" aria-label="Show">
            {[['all', 'All'], ['weekly', 'Weeks'], ['month', 'Months'], ['file', 'Files'], ['custom', 'Dates']].map(([k, label]) => <button key={k} type="button" className={`btn small ${show === k ? 'primary' : ''}`} aria-pressed={show === k} onClick={() => setShow(k)}>{label}</button>)}
          </div>
          <Async state={list} emptyWhen={(d) => d.length === 0} empty={<div className="empty"><h3>No reports yet</h3>Reports appear here once a week has finished, or when you create one.</div>}>{() => (
            rows.length ? (
              <div role="listbox" aria-label="Reports" className="rep-list">{rows.map((r) => (
                <button key={r.id} role="option" aria-selected={sel === r.id} onClick={() => setSel(r.id)} className={`rep-item ${sel === r.id ? 'on' : ''}`}>
                  <div className="row gap-s" style={{ flexWrap: 'nowrap' }}><span className={`badge ${KIND[r.kind]?.[1] || 'few'}`}>{KIND[r.kind]?.[0] || 'Report'}</span>
                    <b className="rep-item-t" title={r.fileName || ''}>{r.kind === 'file' ? r.fileName : r.kind === 'month' ? monthName(r.period_start.slice(0, 7)) : range(r.period_start, r.period_end)}</b></div>
                  <div className="rep-item-n">{r.samples == null ? '' : r.samples ? `${num(r.samples)} audited · ${num(r.errorSkus)} with errors (${pct(r.errorRate)})` : 'No audit data in this report'}</div>
                  <div className="muted small">{r.auto ? 'Made automatically' : `Made by ${r.generated_by}`} · {dateTime(r.generated_at)}</div>
                </button>))}</div>
            ) : <div className="empty">No {{ file: 'file', weekly: 'week', month: 'month' }[show] || 'date'} reports yet.</div>
          )}</Async>
        </Card>
        <div style={{ minWidth: 0 }}>{sel ? <ReportView key={sel} id={sel} canDelete={can('report')} onDeleted={() => { setSel(null); setMsg({ kind: 'ok', text: 'Report deleted.' }); list.reload(); }} /> : <Card><div className="empty">Select a report to see it here.</div></Card>}</div>
      </div>
      <style>{`@media print { .main > .page-head, .main > .card, .main > .mb, .rep-layout > .card, .rep-actions, .searchbar { display: none !important; } .rep-layout { display: block !important; } }`}</style>
    </>
  );
}
