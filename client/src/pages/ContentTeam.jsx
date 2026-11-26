import { useState } from 'react';
import { useApi } from '../lib/api.js';
import { useFilters } from '../lib/filters.jsx';
import { pct, num, weekLabel } from '../lib/format.js';
import { Async, Card, DataTable, Drawer, Info, Kpi, LevelBadge, PageHeader, Tabs, AttrNotice } from '../components/ui.jsx';

const NA_ATTR = 'Not available: no file in this selection has attribute columns (Att 1, Raw Val 1, Build Val 1 …). Upload the file that has them (re-uploading an older file adds them).';
import FilterBar from '../components/FilterBar.jsx';
import { useDetails } from '../components/Details.jsx';
import FeedbackDrawer from '../components/Feedback.jsx';
import BulkEmail from '../components/BulkEmail.jsx';
import { useAuth } from '../lib/auth.js';
import SourceChecks from '../components/SourceChecks.jsx';
import { Columns, HBar, LEVEL_COLOR, Trend, codeColor } from '../components/charts.jsx';

const ALLOWED = ['from', 'to', 'week', 'month', 'builderId', 'auditorId', 'uploadId', 'project'];

export default function ContentTeam() {
  const { params } = useFilters(ALLOWED);
  const st = useApi('/api/content-team', params);
  return (
    <>
      <PageHeader title="Product Team Performance" subtitle="How well each person's SKUs did when the Audit Team checked them. Lower error percentage is better." />
      <FilterBar show={['period', 'builder', 'auditor', 'file', 'project']} />
      <Async state={st} emptyWhen={(d) => !d.members.length}>{(d) => <Body d={d} params={params} />}</Async>
    </>
  );
}

function Body({ d, params }) {
  const { openRecords } = useDetails(); const { can } = useAuth();
  const [sel, setSel] = useState(null); const [fb, setFb] = useState(null); const [view, setView] = useState('sku'); const [bulk, setBulk] = useState(null);
  const improve = d.members.filter((m) => m.level === 'improve');
  const achieved = d.members.filter((m) => m.level === 'good' && m.id != null);
  const chart = d.members.filter((m) => m.errorRate != null).sort((a, b) => b.errorRate - a.errorRate).map((m) => ({ name: m.name, value: m.errorRate, level: m.level }));

  const cols = [
    { key: 'rank', label: 'Rank', title: 'Position by error percentage, lowest first. Only people with enough audited SKUs are ranked.', sort: (m) => m.rank ?? 999, render: (m) => m.rank ?? <span className="muted" title="Too few audited SKUs to rank fairly">–</span> },
    { key: 'name', label: 'Name', render: (m) => <button className="btn link" onClick={() => setSel(m)}>{m.name}</button> },
    { key: 'skus', label: 'Total SKUs', num: true, title: 'All SKUs this person built in the period (needs the file to also list non-audited SKUs)', sort: (m) => (m.skusAvailable ? m.skus : null), render: (m) => (m.skusAvailable ? num(m.skus) : <span className="muted" title="The uploaded file lists only audited SKUs, so the total cannot be counted.">Not available</span>) },
    { key: 'samples', label: 'Audited', num: true, title: 'SKUs the Audit Team actually checked' },
    { key: 'sampleRate', label: 'Audited %', num: true, sort: (m) => m.sampleRate, render: (m) => (m.skusAvailable ? pct(m.sampleRate) : <span className="muted">Not available</span>) },
    { key: 'errorSkus', label: 'SKUs with errors', num: true, title: 'Each SKU counted once, even if it has several errors' },
    { key: 'errorRate', label: 'Error %', num: true, sort: (m) => m.errorRate, render: (m) => <b>{pct(m.errorRate)}</b> },
    { key: 'classifications', label: <>Error classifications <Info text="The number of individual errors recorded. One SKU can have several errors (for example Data Missing and Data Error), so this can be higher than 'SKUs with errors'." /></>, num: true },
    { key: 'level', label: 'Status', sort: (m) => ({ improve: 0, watch: 1, few: 2, good: 3, none: 4 })[m.level], render: (m) => <LevelBadge level={m.level} /> },
    { key: 'topTypes', label: 'Most common mistakes', sort: false, render: (m) => (m.topTypes.length ? m.topTypes.map((t) => <span key={t.code} className="tag" title={t.name}>{t.code} ×{t.classifications}</span>) : <span className="muted">None</span>) },
    { key: 'fb', label: 'Email', sort: false, render: (m) => (m.id == null ? null : <button className={`btn small nowrap ${m.level === 'improve' || m.level === 'good' ? 'primary' : ''}`} onClick={(e) => { e.stopPropagation(); setFb(m); }}>{m.level === 'good' ? '🎉 Appreciate' : m.level === 'improve' ? '✉ Send feedback' : '✉ Feedback'}</button>) },
  ];

  // attribute based: how many attributes each person filled in, how many were audited, how many were wrong
  const na = (m, v) => (m.attrsAvailable ? (m.attrsPartial ? <>{v}<span title={`Based on ${m.attrCoverage.skus} of ${m.attrCoverage.of} of this person's SKUs: only the files that have attribute columns.`}> *</span></> : v) : <span className="muted" title={NA_ATTR}>Not available</span>);
  const feedbackCol = cols[cols.length - 1];
  const attrCols = [
    cols[1],
    { key: 'attrsEnriched', label: <>Attributes enriched <Info text="Attributes that have a value (Raw Val / Build Val) on this person's SKUs, audited or not." /></>, num: true, sort: (m) => m.attrsEnriched, render: (m) => na(m, num(m.attrsEnriched)) },
    { key: 'attrsAudited', label: <>Attributes audited <Info text="Enriched attributes of the audited SKUs, plus attributes the auditor said were left empty." /></>, num: true, sort: (m) => m.attrsAudited, render: (m) => na(m, num(m.attrsAudited)) },
    { key: 'attrErrors', label: <>Attributes with errors <Info text="Attributes the auditor marked wrong (Attribute/Field column). An attribute on one SKU counts once." /></>, num: true },
    { key: 'attrErrorRate', label: 'Attribute error %', num: true, sort: (m) => m.attrErrorRate, render: (m) => na(m, <b>{pct(m.attrErrorRate)}</b>) },
    { key: 'otherFieldErrors', label: <>Other fields <Info text="Names in Attribute/Field that are not attributes of the SKU, for example “Source” or “All”." /></>, num: true },
    { key: 'level', label: 'SKU status', sort: (m) => ({ improve: 0, watch: 1, few: 2, good: 3, none: 4 })[m.level], render: (m) => <LevelBadge level={m.level} /> },
    feedbackCol,
  ];

  return (
    <>
      <div className="grid g-kpi mb">
        <Kpi label="SKUs audited" value={num(d.team.samples)} sub={d.team.skusAvailable ? `of ${num(d.team.skus)} SKUs built` : 'Total SKUs: Not available'} info="Audited SKUs are the ones the Audit Team picked and checked. Errors can only be found in these." />
        <Kpi label="Team error percentage" value={pct(d.team.errorRate)} sub={`${num(d.team.errorSkus)} SKUs with errors`} tone={d.team.errorRate == null ? undefined : d.team.errorRate <= d.target ? 'good' : d.team.errorRate <= d.target + d.watchMargin ? 'watch' : 'improve'} info="SKUs with errors ÷ SKUs audited × 100. A SKU with several errors is counted once." />
        <Kpi label="Attributes audited" value={d.team.attrsAvailable ? num(d.team.attrsAudited) : 'Not available'} sub={d.team.attrsAvailable ? `${num(d.team.attrErrors)} with errors` : undefined} info={NA_ATTR} />
        <Kpi label="Attribute error %" value={d.team.attrsAvailable ? pct(d.team.attrErrorRate) : 'Not available'} info="Attributes with errors ÷ attributes audited × 100." />
        <Kpi label="Target" value={`${d.target}% or lower`} sub={`Needs improvement above ${d.target + d.watchMargin}%`} info="Set by the Admin in Settings." />
      </div>

      {can('users') && (achieved.length > 0 || improve.length > 0) && (
        <Card className="mb" title="Email the team" info="Admin only. Sends one personal email to each person in the group – their own numbers, message and PDF report – in one go. You can check and change the list before sending.">
          <div className="row">
            <button className="btn primary" disabled={!achieved.length} onClick={() => setBulk('achieved')}>🎉 Appreciate everyone who achieved the target ({achieved.length})</button>
            <button className="btn danger" disabled={!improve.length} onClick={() => setBulk('improve')}>✉ Feedback to everyone who needs improvement ({improve.length})</button>
          </div>
        </Card>
      )}

      {improve.length > 0 && (
        <Card className="mb" title="Needs improvement" info="These people are well above the target error percentage. Open their feedback to see suggestions based on their own errors and send them the report.">
          <div className="grid" style={{ gap: 8 }}>{improve.map((m) => (
            <div key={m.id ?? m.name} className="row gap-s">
              <button className="btn small danger" onClick={() => setSel(m)}>▲ {m.name} – {pct(m.errorRate)} <span className="muted">({m.errorSkus} of {m.samples})</span></button>
              <span className="small muted">most common: {m.topTypes.map((t) => t.name).slice(0, 2).join(', ') || '—'}</span>
              <span className="grow" />
              {m.id != null && <button className="btn small primary" onClick={() => setFb(m)}>✉ Suggestions &amp; send feedback</button>}
            </div>))}</div>
        </Card>
      )}

      <Card title="Everyone at a glance" className="mb" info="Click a column heading to sort, or a name to see the full picture for that person." flush>
        <div className="card-b">
          <Tabs value={view} onChange={setView} items={[['sku', 'SKU based'], ['attr', 'Attribute based']]} />
          <DataTable key={view} columns={view === 'sku' ? cols : attrCols} rows={d.members} pageSize={15} rowKey={(m) => m.id ?? m.name} onRowClick={setSel} />
          {view === 'attr' && <><AttrNotice files={d.attrMissingFiles} /><p className="muted small">Attribute based counts the individual attributes inside the SKUs (colour, weight, size …) instead of whole SKUs. Attribute error % = attributes with errors ÷ attributes audited. A * means the number uses only the files that have attribute columns (hover for how many SKUs).</p></>}
        </div>
        {d.members.some((m) => m.level === 'few') && <p className="muted small" style={{ padding: '0 16px 14px', margin: 0 }}>◔ “Too few samples”: fewer than {d.minSample} SKUs were audited, so the percentage may swing a lot. Treat it as an early signal, not a verdict.</p>}
      </Card>

      <Card title="Error percentage by person" info={`Each bar is SKUs with errors ÷ SKUs audited. Green is at or below the ${d.target}% target, amber is slightly above, red is well above, grey means too few samples.`}>
        {chart.length ? <HBar data={chart} colorOf={(r) => LEVEL_COLOR[r.level]} fmt={(v) => pct(v)} label="Error %" width={150} /> : <div className="empty">No audited SKUs yet.</div>}
        <div className="legend"><span><i style={{ background: 'var(--good)' }} />Achieved target (≤ {d.target}%)</span><span><i style={{ background: 'var(--watch)' }} />Keep an eye on</span><span><i style={{ background: 'var(--improve)' }} />Needs improvement</span><span><i style={{ background: 'var(--few)' }} />Too few samples</span></div>
      </Card>

      {sel && <MemberDrawer m={sel} d={d} params={params} onClose={() => setSel(null)} openRecords={openRecords} onFeedback={() => { const m = sel; setSel(null); setFb(m); }} />}
      {fb && <FeedbackDrawer member={fb} params={params} onClose={() => setFb(null)} />}
      {bulk && <BulkEmail group={bulk} params={params} onClose={() => setBulk(null)} />}
    </>
  );
}

function MemberDrawer({ m, d, params, onClose, openRecords, onFeedback }) {
  const base = { ...params, builderId: m.id };
  const canList = m.id != null;
  const typeRows = m.byType.map((t) => ({ name: `${t.name} (${t.code})`, value: t.classifications, code: t.code, label: t.name }));
  const attrRows = (m.attrByType || []).map((t) => ({ name: t.mixed ? `${t.name} (${t.code.replace(/\|/g, ' or ')})` : `${t.name} (${t.code})`, value: t.attributes, code: t.code, label: t.name, mixed: t.mixed }));
  const [typeView, setTypeView] = useState('attr');
  const weekly = m.weekly.map((w) => ({ ...w }));
  return (
    <Drawer title={m.name} onClose={onClose} wide>
      <div className="row gap-s mb"><LevelBadge level={m.level} />{m.rank && <span className="muted">Rank {m.rank}</span>}{m.change && <span className={m.change.diff > 0 ? 'delta up-bad' : 'delta up-good'}>{m.change.diff > 0 ? '▲' : '▼'} {Math.abs(m.change.diff)} pts since the week of {weekLabel(m.change.weekFrom)}</span>}</div>
      {m.level === 'few' && <div className="alert warn mb">Only {m.samples} SKU{m.samples === 1 ? '' : 's'} audited – fewer than {d.minSample}. The percentage is not reliable yet.</div>}
      <div className="grid g-kpi mb">
        <Kpi label="Total SKUs" value={m.skusAvailable ? num(m.skus) : 'Not available'} info={m.skusAvailable ? undefined : 'The uploaded file lists only audited SKUs, so the total number assigned cannot be counted.'} />
        <Kpi label="Audited" value={num(m.samples)} sub={m.skusAvailable ? `${pct(m.sampleRate)} of their SKUs` : undefined} info="Audited % = audited SKUs ÷ total SKUs × 100" />
        <Kpi label="SKUs with errors" value={num(m.errorSkus)} sub={`Error % ${pct(m.errorRate)}`} info="Error % = SKUs with errors ÷ audited SKUs × 100" />
        <Kpi label="Error classifications" value={num(m.classifications)} info="Each mistake recorded on a SKU is one classification. One SKU can have several, so this can be higher than the number of SKUs with errors." />
      </div>

      <div className="grid g-kpi mb">
        <Kpi label="Attributes enriched" value={m.attrsAvailable ? num(m.attrsEnriched) : 'Not available'} info={m.attrsAvailable ? 'Attributes with a value on this person\'s SKUs.' : NA_ATTR} />
        <Kpi label="Attributes audited" value={m.attrsAvailable ? num(m.attrsAudited) : 'Not available'} info={m.attrsAvailable ? 'Enriched attributes of the audited SKUs plus attributes the auditor said were left empty.' : NA_ATTR} />
        <Kpi label="Attributes with errors" value={num(m.attrErrors)} sub={m.otherFieldErrors ? `+ ${m.otherFieldErrors} other field(s)` : undefined} info="Attributes the auditor marked wrong. One attribute on one SKU counts once." />
        <Kpi label="Attribute error %" value={m.attrsAvailable ? pct(m.attrErrorRate) : 'Not available'} info="Attributes with errors ÷ attributes audited × 100." />
      </div>

      <Card title="Mistakes by type" className="mb" info="Attributes: each attribute marked wrong counts once and gets its SKU’s error type, so the bars add up to “Attributes with errors”. When a SKU has two error types (e.g. DE | DM) the file does not say which attribute had which, so those attributes are shown together. Error codes on SKUs: each error code on a SKU counts once (adds up to “Error classifications”). Click a bar to see the SKUs.">
        <div className="row gap-s mb-s" role="group" aria-label="Count mistakes by">
          <button type="button" className={`btn small${typeView === 'attr' ? ' primary' : ''}`} aria-pressed={typeView === 'attr'} onClick={() => setTypeView('attr')}>Attributes ({num(m.attrErrors)})</button>
          <button type="button" className={`btn small${typeView === 'sku' ? ' primary' : ''}`} aria-pressed={typeView === 'sku'} onClick={() => setTypeView('sku')}>Error codes on SKUs ({num(m.classifications)})</button>
        </div>
        {(typeView === 'attr' ? attrRows : typeRows).length ? (
          <HBar data={typeView === 'attr' ? attrRows : typeRows} colorOf={(r) => (r.mixed ? 'var(--cx)' : codeColor(r.code))} width={typeView === 'attr' ? 240 : 200} label={typeView === 'attr' ? 'Attributes' : 'Errors'}
            onClick={canList ? (x) => { const r = x.payload || x; if (r.mixed) return; openRecords({ title: `${m.name} – ${r.label}`, params: { ...base, errorCode: r.code } }); } : undefined} />
        ) : <div className="empty">{typeView === 'attr' && m.classifications ? 'The auditor did not name an attribute on these SKUs.' : 'No errors recorded. 🎉'}</div>}
      </Card>

      {m.topAttributes.length > 0 && (
        <Card title="Fields where mistakes happen most" className="mb" info="The attribute/field named by the auditor, counted by number of SKUs.">
          <div className="pill-row">{m.topAttributes.map((a) => (
            <button key={a.attribute} className="btn small" disabled={!canList} onClick={() => openRecords({ title: `${m.name} – ${a.attribute}`, params: { ...base, attribute: a.attribute } })}>{a.attribute} <b>×{a.skus}</b></button>))}</div>
        </Card>
      )}

      {canList && m.errorSkus > 0 && <SourceChecks member={m} params={params} />}

      <Card title="Week by week" className="mb" info="Error percentage per week. The dashed line is the target.">
        {weekly.filter((w) => w.samples > 0).length ? (
          <>
            <Trend data={weekly} xKey="week" xFmt={weekLabel} lines={[{ key: 'errorRate', name: 'Error %', color: 'var(--c1)' }]} yFmt={(v) => `${v}%`} target={d.target} targetLabel={`Target ${d.target}%`} height={220} />
            <Columns data={weekly} xKey="week" xFmt={weekLabel} height={200} keys={[{ key: 'samples', name: 'Audited SKUs', color: 'var(--c3)' }, { key: 'errorSkus', name: 'SKUs with errors', color: 'var(--c2)' }]} />
          </>
        ) : <div className="empty">No audited SKUs in the selected period.</div>}
      </Card>

      <div className="row">
        {canList && <button className="btn primary" onClick={onFeedback}>✉ Suggestions &amp; send feedback</button>}
        <button className="btn" disabled={!canList} onClick={() => openRecords({ title: `${m.name} – all audited records`, params: base })}>See all of this person's records</button>
        <span className="muted small">To see only the SKUs with a particular mistake, click a bar above.</span>
      </div>
    </Drawer>
  );
}
