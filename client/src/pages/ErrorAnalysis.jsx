import { useMemo } from 'react';
import { useApi } from '../lib/api.js';
import { useFilters } from '../lib/filters.jsx';
import { num, pct, weekLabel } from '../lib/format.js';
import { Async, Card, DataTable, Info, Kpi, PageHeader } from '../components/ui.jsx';
import FilterBar from '../components/FilterBar.jsx';
import { useDetails } from '../components/Details.jsx';
import { HBar, Stacked, codeColor } from '../components/charts.jsx';

const ALLOWED = ['from', 'to', 'week', 'month', 'builderId', 'auditorId', 'uploadId', 'project', 'errorCode'];

export default function ErrorAnalysis() {
  const { params } = useFilters(ALLOWED);
  const st = useApi('/api/errors', params);
  return (
    <>
      <PageHeader title="Error Analysis" subtitle="What kinds of mistakes happen, where, and who is repeating them. Click a bar or number to see the SKUs behind it." />
      <FilterBar show={['period', 'builder', 'auditor', 'file', 'project', 'errorCode']} />
      <Async state={st} emptyWhen={(d) => d.totals.classifications === 0} empty={<div className="card"><div className="empty"><h3>No errors found</h3>There are no audit errors for these filters. Try a wider time period.</div></div>}>
        {(d) => <Body d={d} params={params} />}
      </Async>
    </>
  );
}

function Body({ d, params }) {
  const { openRecords, openSku } = useDetails();
  const open = (title, extra) => openRecords({ title, params: { ...params, ...extra } });
  const pick = (x) => x.payload || x;
  const extra = d.totals.classifications - d.totals.errorSkus;

  const typeRows = d.byType.map((t) => ({ name: `${t.name} (${t.code})`, value: t.classifications, code: t.code, label: t.name }));
  const attrRows = d.topAttributes.map((a) => ({ name: a.attribute, value: a.skus, attribute: a.attribute }));

  // errors by week: top 6 types get their own colour, the rest are grouped as "Other"
  const topCodes = d.byType.slice(0, 6).map((t) => t.code);
  const hasOther = d.byType.length > 6;
  const weekRows = useMemo(() => d.byWeek.map((w) => {
    const row = { week: w.week }; let used = 0;
    topCodes.forEach((c) => { row[c] = w[c] || 0; used += w[c] || 0; });
    row.Other = w.total - used; return row;
  }), [d.byWeek]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekKeys = [...topCodes.map((c) => ({ key: c, name: d.byType.find((t) => t.code === c)?.name || c, color: codeColor(c) })), ...(hasOther ? [{ key: 'Other', name: 'Other types', color: 'var(--cx)' }] : [])];

  const freqCols = [
    { key: 'name', label: 'Error type', render: (t) => <button className="btn link" onClick={() => open(`${t.name} errors`, { errorCode: t.code })}>{t.name} <span className="tag">{t.code}</span></button> },
    { key: 'classifications', label: 'Times recorded', num: true },
    { key: 'share', label: 'Share', num: true, sort: (t) => t.share, render: (t) => (<div className="row gap-s" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}><div className="bar" style={{ width: 70 }}><i style={{ width: `${t.share || 0}%`, background: codeColor(t.code) }} /></div><span>{pct(t.share)}</span></div>) },
    { key: 'skus', label: 'SKUs affected', num: true },
  ];

  const memberCols = [
    { key: 'name', label: 'Product team member' },
    ...d.codes.map((c) => ({ key: c, label: c, num: true, title: d.byType.find((t) => t.code === c)?.name, sort: (m) => m.codes[c] || 0,
      render: (m) => (m.codes[c] ? <button className="btn link" disabled={m.id == null} onClick={() => open(`${m.name} – ${c}`, { builderId: m.id, errorCode: c })}>{m.codes[c]}</button> : <span className="muted">·</span>) })),
    { key: 'total', label: 'Total', num: true, render: (m) => <b>{m.total}</b> },
    { key: 'skus', label: 'SKUs', num: true, title: 'Different SKUs with errors' },
  ];

  const auditorCols = [
    { key: 'name', label: 'Auditor' },
    ...d.codes.map((c) => ({ key: c, label: c, num: true, title: d.byType.find((t) => t.code === c)?.name, sort: (m) => m.codes[c] || 0,
      render: (m) => (m.codes[c] ? <button className="btn link" disabled={m.id == null} onClick={() => open(`${m.name} – ${c}`, { auditorId: m.id, errorCode: c })}>{m.codes[c]}</button> : <span className="muted">·</span>) })),
    { key: 'total', label: 'Total', num: true, render: (m) => <b>{m.total}</b> },
    { key: 'skus', label: 'SKUs', num: true, title: 'Different SKUs with errors' },
  ];

  const repCols = [
    { key: 'builder', label: 'Who' },
    { key: 'kind', label: 'Repeats', render: (r) => (r.kind === 'attribute' ? 'Same field' : 'Same error type'), sort: (r) => r.kind },
    { key: 'label', label: 'Which', render: (r) => (r.kind === 'attribute' ? r.label : <><span className="tag">{r.label}</span> {d.byType.find((t) => t.code === r.label)?.name}</>) },
    { key: 'skus', label: 'On how many SKUs', num: true },
    { key: 'go', label: '', sort: false, render: (r) => <button className="btn small" disabled={r.builderId == null} onClick={() => open(`${r.builder} – ${r.label}`, r.kind === 'attribute' ? { builderId: r.builderId, attribute: r.label } : { builderId: r.builderId, errorCode: r.label })}>See SKUs</button> },
  ];

  return (
    <>
      {d.unrecognisedCodes.length > 0 && (
        <div className="alert warn mb"><div><b>Some error codes are not in the error list.</b> {d.unrecognisedCodes.map((u) => `${u.code} (${u.rows} rows)`).join(', ')} {d.unrecognisedCodes.length === 1 ? 'is' : 'are'} <b>not counted as errors</b>. An Admin can add {d.unrecognisedCodes.length === 1 ? 'it' : 'them'} in Settings → Error types, and every number will update.</div></div>)}
      <div className="grid g-kpi mb">
        <Kpi label="SKUs with errors" value={num(d.totals.errorSkus)} info="Each SKU counted once, even if it has several errors." />
        <Kpi label="Attributes with errors" value={num(d.attributeTotals?.attrErrors ?? 0)} sub={d.attributeTotals?.otherFieldErrors ? `+ ${d.attributeTotals.otherFieldErrors} other field(s)` : undefined} info="Attributes the auditor marked wrong (each attribute once per SKU). The bar chart and table below show which ones." />
        <Kpi label="Error classifications" value={num(d.totals.classifications)} info="Each mistake recorded on a SKU is one classification. One SKU can have several (for example ‘Data Missing’ + ‘Data Error’ = 2 classifications on 1 SKU)." />
      </div>
      <div className="alert info mb">
        <div><b>Why two numbers?</b> “SKUs with errors” counts every affected SKU once. “Error classifications” counts every error recorded. A SKU with two errors (for example Data Error + Data Missing) is <b>one</b> SKU with errors but <b>two</b> classifications.
          {extra > 0 ? ` Here ${num(d.totals.classifications)} classifications fall on ${num(d.totals.errorSkus)} SKUs, so ${num(extra)} extra come from SKUs that have more than one error.` : ''}</div>
      </div>

      <div className="grid g2 mb">
        <Card title="Which errors happen most" info="Number of times each error type was recorded. Click a bar to see the SKUs.">
          <HBar data={typeRows} colorOf={(r) => codeColor(r.code)} width={210} label="Times recorded" onClick={(x) => { const r = pick(x); open(`${r.label} errors`, { errorCode: r.code }); }} />
        </Card>
        <Card title="Top 10 fields with the most errors" info="The attribute/field named by the auditor, counted by number of SKUs. Click a bar to see the SKUs.">
          {attrRows.length ? <HBar data={attrRows} width={220} label="SKUs" onClick={(x) => { const r = pick(x); open(`Errors in “${r.attribute}”`, { attribute: r.attribute }); }} /> : <div className="empty">No field names were recorded.</div>}
        </Card>
      </div>

      <Card className="mb" title="Most frequent errors" info="Share = this error type ÷ all errors recorded." flush>
        <div className="card-b"><DataTable columns={freqCols} rows={d.byType} pageSize={15} rowKey={(t) => t.code} initialSort={{ key: 'classifications', dir: 'desc' }} /></div>
      </Card>

      <Card className="mb" title="Errors by product team member" info="Numbers are errors recorded. Click a number to see those SKUs." flush>
        <div className="card-b"><DataTable columns={memberCols} rows={d.byMember} pageSize={15} rowKey={(m) => m.name} initialSort={{ key: 'total', dir: 'desc' }} /></div>
      </Card>

      <Card className="mb" title="Errors found by each auditor" info="Errors each auditor recorded, by type. This shows what was found, not how good the auditor is. Click a number to see those SKUs." flush>
        <div className="card-b"><DataTable columns={auditorCols} rows={d.byAuditor} pageSize={15} rowKey={(m) => m.name} initialSort={{ key: 'total', dir: 'desc' }} /></div>
      </Card>

      <Card className="mb" title="Recurring issues in the auditors’ comments" info="The same audit comment (links ignored) written on 2 or more SKUs. It explains what keeps going wrong, in the auditors’ own words (Audit Comments column).">
        {d.recurringComments.length ? (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Audit comment</th><th className="num">SKUs</th><th>Error types</th><th>Who built them</th><th>Example SKUs</th></tr></thead>
            <tbody>{d.recurringComments.map((c, i) => (
              <tr key={i}><td style={{ maxWidth: 420 }}><div className="clip" title={c.comment}>{c.comment}</div></td><td className="num"><b>{c.skus}</b></td>
                <td>{Object.keys(c.codes).map((k) => <span key={k} className="tag">{k}</span>)}</td>
                <td className="small">{Object.entries(c.builders).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, k]) => `${n} (${k})`).join(', ')}</td>
                <td>{c.exampleSkus.map((s) => <button key={s} className="btn link" onClick={() => openSku(s)}>{s}</button>)}</td></tr>))}</tbody></table></div>
        ) : <div className="empty">No comment was repeated on 2 or more SKUs in this selection.</div>}
      </Card>

      <Card className="mb" title="Errors by week" info="Errors recorded in each week. Colours match the error types above.">
        {weekRows.length ? <Stacked data={weekRows} xKey="week" xFmt={weekLabel} keys={weekKeys} height={280} /> : <div className="empty">No data.</div>}
      </Card>

      <Card title="Repeated errors" info="The same person making the same kind of mistake on 2 or more SKUs (3 or more for error types). Good candidates for coaching." flush>
        <div className="card-b"><DataTable columns={repCols} rows={d.repeated} pageSize={10} rowKey={(r) => `${r.kind}|${r.builder}|${r.label}`} empty="No repeated mistakes found in this period." initialSort={{ key: 'skus', dir: 'desc' }} /></div>
      </Card>
    </>
  );
}
