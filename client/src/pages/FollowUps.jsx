import { useMemo, useState } from 'react';
import { useApi } from '../lib/api.js';
import { useFilters } from '../lib/filters.jsx';
import { date, num, PT_CLASS, REAUDIT } from '../lib/format.js';
import FilterBar from '../components/FilterBar.jsx';
import { Alert, Async, Card, DataTable, Kpi, PageHeader } from '../components/ui.jsx';
import { Columns } from '../components/charts.jsx';
import { CodeTags, useDetails } from '../components/Details.jsx';

const SHOW = ['period', 'builder', 'auditor', 'file', 'project', 'errorCode', 'ptStatus'];
const PT_CHIPS = [['all', 'All'], ['pending', 'Pending'], ['completed', 'Done'], ['none', 'No status recorded']];
const RA_CHIPS = [['all', 'All'], ['pending', 'Pending'], ['passed', 'OK'], ['issues', 'Issues found'], ['not_due', 'Not due yet']];
const COUNTED = { yes: ['Counted', 'good', 'The re-audit confirmed it, so this error is in the error numbers.'], waiting: ['Not counted yet', 'watch', 'Re-audit not done yet, or PT answered “Not Updated” – left out of the error numbers.'], none: ['No error', 'few', 'No error code on this case (for example only a suggestion).'] };

function Chips({ label, value, onChange, items }) {
  return (
    <div className="row gap-s" role="group" aria-label={label}>
      <span className="muted small">{label}:</span>
      {items.map(([k, text]) => <button key={k} type="button" className={`btn small ${value === k ? 'primary' : ''}`} aria-pressed={value === k} onClick={() => onChange(k)}>{text}</button>)}
    </div>
  );
}

export default function FollowUps() {
  const { params } = useFilters(['from', 'to', 'week', 'month', 'builderId', 'auditorId', 'uploadId', 'project', 'errorCode', 'ptStatus']);
  const st = useApi('/api/follow-ups', params);
  const { openSku } = useDetails();
  const [pt, setPt] = useState('all'); const [ra, setRa] = useState('all');

  const rows = useMemo(() => (st.data?.items || []).filter((r) => {
    if (pt === 'pending' && r.ptClass !== 'pending') return false;
    if (pt === 'completed' && r.ptClass !== 'completed') return false;
    if (pt === 'none' && r.ptClass !== 'not_recorded') return false;
    if (ra !== 'all' && r.reaudit !== ra) return false;
    return true;
  }), [st.data, pt, ra]);

  const columns = [
    { key: 'skuId', label: 'SKU ID', render: (r) => <b>{r.skuId}</b> },
    { key: 'builder', label: 'Product team member' },
    { key: 'auditor', label: 'Auditor', render: (r) => r.auditor || '—' },
    { key: 'auditDate', label: 'Audit date', render: (r) => <span className="nowrap">{date(r.auditDate)}</span> },
    { key: 'codes', label: 'Error type', sort: (r) => r.codes.join(','), render: (r) => <CodeTags codes={r.codes} /> },
    { key: 'ptClass', label: 'PT status', sort: (r) => PT_CLASS[r.ptClass], render: (r) => <>{r.ptRaw || <span className="muted">(empty)</span>} <span className={`badge ${r.ptClass === 'completed' ? 'good' : r.ptClass === 'pending' ? 'watch' : 'few'}`}>{PT_CLASS[r.ptClass]}</span></> },
    { key: 'reaudit', label: 'Re-audit', sort: (r) => REAUDIT[r.reaudit], render: (r) => <span className={`badge ${r.reaudit === 'pending' ? 'watch' : r.reaudit === 'passed' ? 'good' : r.reaudit === 'issues' ? 'improve' : 'few'}`}>{REAUDIT[r.reaudit]}</span> },
    { key: 'ptComments', label: 'PT comments', render: (r) => <div className="clip" title={r.ptComments}>{r.ptComments || <span className="muted">—</span>}</div> },
    { key: 'ptResponse', label: 'PT response', render: (r) => <div className="clip" title={r.ptResponse}>{r.ptResponse || <span className="muted">—</span>}</div> },
    { key: 'reauditComments', label: 'Re-audit comments', render: (r) => <div className="clip" title={r.reauditComments}>{r.reauditComments || <span className="muted">—</span>}</div> },
    { key: 'ageDays', label: 'Days waiting', num: true, title: 'Days since the audit date, for cases still pending', render: (r) => (r.ageDays == null ? '—' : r.ageDays) },
    ...(st.data?.afterReaudit ? [{ key: 'counted', label: 'Error counted?', sort: (r) => r.counted, render: (r) => <span className={`badge ${COUNTED[r.counted][1]}`} title={COUNTED[r.counted][2]}>{COUNTED[r.counted][0]}</span> }] : []),
  ];

  return (
    <>
      <PageHeader title="PT & Re-Audit" subtitle="Which audit findings have been fixed by PT, and which fixes have been re-checked by the auditors?" />
      <FilterBar show={SHOW} />
      <Async state={st} emptyWhen={(d) => d.cases === 0} empty={<div className="card"><div className="empty"><h3>No cases to follow up</h3>No audited findings match these filters. Try widening the filters.</div></div>}>{(d) => (
        <>
          <div className="grid g-kpi mb">
            <Kpi label="PT pending" value={num(d.pt.pending)} tone={d.pt.pending ? 'watch' : 'good'} info="Cases where the PT Status says the fix is not done or only partly done (for example “Not Updated” or “Updated/Not Updated”)." />
            <Kpi label="PT done" value={num(d.pt.completed)} tone="good" info="Cases where the PT Status says the correction was made (for example “Updated” or “Checked”). Admin can change these meanings in Settings." />
            <Kpi label="No PT status recorded" value={num(d.pt.not_recorded)} info="Audit findings where the PT Status column is empty. The system cannot tell if these were fixed, so they are NOT counted as pending (unless an Admin changes this in Settings)." />
            <Kpi label="Re-audit pending" value={num(d.reaudit.pending)} tone={d.reaudit.pending ? 'watch' : 'good'} info="PT says the fix is done, but there is no Re-Audit Comment yet." />
            <Kpi label="Re-audit done" value={num(d.reaudit.passed + d.reaudit.issues)} sub={`${num(d.reaudit.passed)} OK · ${num(d.reaudit.issues)} with issues`} info="Cases that already have a Re-Audit Comment. “OK” means the comment is only words like ok / okay / done; any other comment is the re-auditor’s notes, shown as “issues found”. Use the Re-audit buttons above the table to list each group." />
            <Kpi label={`Waiting over ${d.warnDays} days`} value={num(d.olderThanWarn)} tone={d.olderThanWarn ? 'improve' : 'good'} info="Pending PT or re-audit cases older than the limit set in Settings." />
          </div>

          {d.afterReaudit && (
            <div className="mb"><Alert kind="info">Errors are counted only after the re-audit: a case counts when the re-audit comment is written (OK or notes) and PT did not answer “Not Updated”. The column “Error counted?” in the table shows this for each case.</Alert></div>
          )}
          {Object.keys(d.unmappedValues || {}).length > 0 && (
            <div className="mb"><Alert kind="warn"><b>Some PT status texts are not recognised:</b> {Object.entries(d.unmappedValues).map(([t, n]) => `“${t}” (${n})`).join(', ')}. They are shown as “Unrecognised status” and are not counted as done or pending. An Admin can say what they mean in Settings → Rules → PT status meanings.</Alert></div>
          )}

          <Card title="How long are cases waiting?" info="Age is counted from the audit date of the uploaded file to today. The files themselves do not contain a PT date, so a case from an older file shows a long wait even if PT acted recently.">
            {d.ageing.every((b) => !b.pt && !b.reaudit) ? <div className="empty">Nothing is waiting. 🎉</div> : (
            <Columns data={d.ageing} xKey="label" height={220} keys={[{ key: 'pt', name: 'PT pending', color: 'var(--c1)' }, { key: 'reaudit', name: 'Re-audit pending', color: 'var(--c2)' }]} />)}
            <p className="muted small">Age = days from the audit date of the uploaded file until today ({date(d.today)}). Only cases that are still pending are shown.</p>
          </Card>

          <Card title={`Cases (${num(rows.length)})`} className="mt" info="Click a row to see the SKU’s full history, including PT comments and re-audit comments."
            actions={<span className="muted small">Click a row to view PT comments & re-audit comments</span>}>
            <div className="row mb">
              <Chips label="PT" value={pt} onChange={setPt} items={PT_CHIPS} />
              <Chips label="Re-audit" value={ra} onChange={setRa} items={RA_CHIPS} />
            </div>
            <DataTable columns={columns} rows={rows} pageSize={15} onRowClick={(r) => openSku(r.skuId)} rowKey={(r) => r.id} initialSort={{ key: 'ageDays', dir: 'desc' }} empty="No cases match the chips you selected." />
          </Card>
        </>
      )}</Async>
    </>
  );
}
