import { useMemo, useState } from 'react';
import { useApi } from '../lib/api.js';
import { useFilters } from '../lib/filters.jsx';
import { num, pct, weekLabel } from '../lib/format.js';
import { AttrNotice, Alert, Async, Card, DataTable, Drawer, Info, Kpi, PageHeader } from '../components/ui.jsx';
import FilterBar from '../components/FilterBar.jsx';
import { Columns, SLOTS, Stacked } from '../components/charts.jsx';

const ALLOWED = ['from', 'to', 'week', 'month', 'builderId', 'auditorId', 'uploadId', 'project'];
const color = (i) => (i < SLOTS.length ? SLOTS[i] : 'var(--cx)');
const noStatus = (a) => a.pt.notRecorded + a.pt.unmapped;
const reDone = (a) => a.reaudit.passed + a.reaudit.issues;

export default function AuditTeam() {
  const { params } = useFilters(ALLOWED);
  const st = useApi('/api/audit-team', params);
  return (
    <>
      <PageHeader title="Audit Team Activity" subtitle="How much each auditor checked, and how their findings are being followed up." />
      <FilterBar show={['period', 'builder', 'auditor', 'file', 'project']} />
      <Alert kind="info"><b>Please note:</b> “Errors found” shows workload, not quality. A higher number does not mean a better or worse auditor. The quality of the SKUs themselves (error percentage) is on the Product Team page.</Alert>
      <div className="mt"><Async state={st} emptyWhen={(d) => !d.auditors.length}>{(d) => <><AttrNotice files={d.attrMissingFiles} /><Body d={d} /></>}</Async></div>
    </>
  );
}

function Body({ d }) {
  const [sel, setSel] = useState(null);
  const A = d.auditors;
  const weeks = useMemo(() => {
    const set = new Set(A.flatMap((a) => a.weekly.map((w) => w.week)));
    return [...set].sort().map((week) => { const row = { week }; A.forEach((a, i) => { row['a' + i] = a.weekly.find((w) => w.week === week)?.records || 0; }); return row; });
  }, [A]);
  const total = (f) => A.reduce((s, a) => s + f(a), 0);

  const cols = [
    { key: 'name', label: 'Auditor', render: (a) => <button className="btn link" onClick={() => setSel(a)}>{a.name}</button> },
    { key: 'skusAudited', label: 'SKUs audited', num: true, title: 'Different SKUs this auditor checked' },
    { key: 'records', label: 'Audit records', num: true, title: 'Rows this auditor handled' },
    { key: 'share', label: 'Share of team workload', sort: (a) => a.share, render: (a) => (<div className="row gap-s" style={{ flexWrap: 'nowrap' }}><div className="bar" style={{ width: 80 }}><i style={{ width: `${a.share || 0}%` }} /></div><span className="nowrap">{pct(a.share)}</span></div>) },
    { key: 'classifications', label: <>Errors found <Info text="Individual errors the auditor recorded. This shows workload, not performance." /></>, num: true },
    { key: 'errorSkus', label: 'SKUs with errors found', num: true },
    { key: 'byType', label: 'Error types found', sort: false, render: (a) => (a.byType.length ? a.byType.map((t) => <span key={t.code} className="tag" title={t.name}>{t.code} ×{t.classifications}</span>) : <span className="muted">None</span>) },
    { key: 'pt', label: 'PT follow-up', sort: (a) => a.pt.pending, render: (a) => <span className="nowrap">✔ {a.pt.completed} done · ● {a.pt.pending} pending{noStatus(a) > 0 && <> · ? {noStatus(a)} no status</>}</span> },
    { key: 'reaudit', label: 'Re-audit', sort: (a) => a.reaudit.pending, render: (a) => <span className="nowrap">✔ {reDone(a)} done · ● {a.reaudit.pending} pending</span> },
    { key: 'attrsAudited', label: <>Attributes audited <Info text="Attributes that had a value on the SKUs this auditor audited (plus attributes they flagged as left empty). Attribute-based workload." /></>, num: true, sort: (a) => a.attrsAudited, render: (a) => (a.attrsAvailable ? num(a.attrsAudited) : <span className="muted" title="The uploaded file has no attribute columns.">Not available</span>) },
    { key: 'attrErrors', label: <>Attributes with errors found <Info text="Attributes this auditor marked wrong. Workload, not quality." /></>, num: true },
    { key: 'ptResponses', label: <>PT responded <Info text="Cases where the PT Response column (L) has text." /></>, num: true, render: (a) => `${a.ptResponses} of ${a.cases}` },
    { key: 'pendingCases', label: <>Pending cases <Info text="Cases waiting on PT or on a re-audit." /></>, num: true, render: (a) => (a.pendingCases ? <b style={{ color: 'var(--watch)' }}>{a.pendingCases}</b> : 0) },
    { key: 'closedCases', label: <>Completed cases <Info text="Cases where PT has fixed the issue and the re-audit has been written." /></>, num: true },
  ];

  return (
    <>
      <div className="grid g-kpi mb">
        <Kpi label="Auditors" value={num(A.length)} />
        <Kpi label="SKUs audited" value={num(total((a) => a.skusAudited))} info="Sum across auditors. A SKU checked by two auditors counts twice." />
        <Kpi label="Audit records" value={num(d.totalRecords)} />
        <Kpi label="Pending cases" value={num(total((a) => a.pendingCases))} tone={total((a) => a.pendingCases) ? 'watch' : 'good'} info="Cases waiting on PT or on a re-audit." />
        <Kpi label="Completed cases" value={num(total((a) => a.closedCases))} tone="good" />
      </div>

      <Card className="mb" title="Auditors" info="Click a name for more detail. Click a heading to sort." flush>
        <div className="card-b"><DataTable columns={cols} rows={A} pageSize={15} rowKey={(a) => a.id} onRowClick={setSel} initialSort={{ key: 'records', dir: 'desc' }} /></div>
      </Card>

      <div className="grid g2">
        <Card title="Who handled how much" info="Audit records are rows the auditor worked on. SKUs audited counts each SKU once.">
          <Columns data={A.map((a) => ({ name: a.name, records: a.records, skusAudited: a.skusAudited }))} xKey="name" height={260}
            keys={[{ key: 'records', name: 'Audit records', color: 'var(--c1)' }, { key: 'skusAudited', name: 'SKUs audited', color: 'var(--c3)' }]} />
        </Card>
        <Card title="Weekly audit activity" info="Audit records handled in each week, one colour per auditor.">
          {weeks.length ? (
            <Stacked data={weeks} xKey="week" xFmt={weekLabel} height={260} keys={A.map((a, i) => ({ key: 'a' + i, name: a.name, color: color(i) }))} />
          ) : <div className="empty">No activity.</div>}
        </Card>
      </div>

      {sel && <AuditorDrawer a={sel} onClose={() => setSel(null)} />}
    </>
  );
}

function AuditorDrawer({ a, onClose }) {
  return (
    <Drawer title={a.name} onClose={onClose} wide>
      <div className="grid g-kpi mb">
        <Kpi label="SKUs audited" value={num(a.skusAudited)} />
        <Kpi label="Audit records" value={num(a.records)} sub={`${pct(a.share)} of team workload`} />
        <Kpi label="Errors found" value={num(a.classifications)} sub={`on ${num(a.errorSkus)} SKUs`} info="Workload measure – not a quality score." />
        <Kpi label="Suggestions given" value={num(a.suggestions)} info="Notes marked as suggestions (not counted as errors)." />
      </div>
      <div className="grid g2 mb">
        <Card title="PT follow-up" info="What happened after this auditor raised a finding.">
          <dl className="kv"><dt>Done</dt><dd>{a.pt.completed}</dd><dt>Pending</dt><dd>{a.pt.pending}</dd><dt>No status recorded</dt><dd>{a.pt.notRecorded}</dd>{a.pt.unmapped > 0 && <><dt>Unrecognised status</dt><dd>{a.pt.unmapped}</dd></>}</dl>
        </Card>
        <Card title="Re-audit follow-up" info="Re-audits are due once PT says the issue is fixed.">
          <dl className="kv"><dt>Re-audited – OK</dt><dd>{a.reaudit.passed}</dd><dt>Re-audited – issues found</dt><dd>{a.reaudit.issues}</dd><dt>Re-audit pending</dt><dd>{a.reaudit.pending}</dd><dt>Not due yet</dt><dd>{a.reaudit.notDue}</dd></dl>
        </Card>
      </div>
      <Card className="mb" title="Cases" info="A case is an audited SKU with a finding or a PT status.">
        <dl className="kv"><dt>Total cases</dt><dd>{a.cases}</dd><dt>Completed</dt><dd>{a.closedCases}</dd><dt>Pending</dt><dd>{a.pendingCases}</dd><dt>Other (no status yet / not due)</dt><dd>{a.otherCases}</dd></dl>
      </Card>
      <Card className="mb" title="Error types found">
        {a.byType.length ? <div className="pill-row">{a.byType.map((t) => <span key={t.code} className="tag">{t.name} ({t.code}) ×{t.classifications}</span>)}</div> : <div className="muted">None recorded.</div>}
      </Card>
      <Card title="Weekly activity">
        {a.weekly.length ? <Columns data={a.weekly} xKey="week" xFmt={weekLabel} height={220} keys={[{ key: 'records', name: 'Audit records', color: 'var(--c1)' }, { key: 'skus', name: 'SKUs', color: 'var(--c3)' }]} /> : <div className="empty">No activity.</div>}
      </Card>
    </Drawer>
  );
}
