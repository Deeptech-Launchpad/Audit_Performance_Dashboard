import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { useFilters, useMeta } from '../lib/filters.jsx';
import { LEVELS, num, pct, weekLabel } from '../lib/format.js';
import FilterBar from '../components/FilterBar.jsx';
import { AnimatedValue, Async, AttrNotice, Card, Info, PageHeader } from '../components/ui.jsx';
import { useDetails } from '../components/Details.jsx';
import ChampionFab from '../components/ChampionFab.jsx';
import { ErrorTrend, ListRow, MistakeList, Seg, StatTile, rateTone } from '../components/OverviewParts.jsx';

const KEYS = ['from', 'to', 'week', 'month', 'builderId', 'auditorId', 'uploadId', 'project'];

const NA_ATTR = 'Attributes enriched / audited come from the attribute columns (Att 1, Raw Val 1, Build Val 1 …) of the uploaded files. “Not available” means no file in this selection has them. If only some files have them, the numbers use just those files and say so. Upload the other files again to add their attribute counts.';

/** the same page with the current filters kept (and optionally one more filter) */
function withFilters(pathname, extra = {}) {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return { pathname, search: p.toString() ? `?${p}` : '' };
}
/** link to a page with the same filters plus one person picked */
function personLink(pathname, key, id) {
  const p = new URLSearchParams(window.location.search); p.delete('builderId'); p.delete('auditorId'); if (id != null) p.set(key, String(id));
  return { pathname, search: p.toString() ? `?${p}` : '' };
}
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

/** The top area: the verdict in words and the one number that matters. Nothing else. */
function Hero({ d, margin }) {
  const { user } = useAuth(); const k = d.kpis;
  const first = String(user?.name || '').split(/\s+/)[0];
  const tone = rateTone(k.errorRate, d.target, margin);
  return (
    <section className={`hero ${tone ? `tone-${tone}` : ''}`} aria-label="Team summary">
      <div className="hero-main" role="status">
        <div className="hero-eyebrow">{greeting()}{first ? `, ${first}` : ''}</div>
        {k.samples
          ? <h2 className="hero-title">{tone === 'good' ? <><span className="hero-ok">✔</span> The team achieved the target.</> : 'The team is above the error target.'}</h2>
          : <><h2 className="hero-title">Nothing was audited here yet.</h2><p className="hero-sentence">No SKUs were audited in this selection, so there is no error percentage to show.</p></>}
      </div>
      <div className="hero-fig">
        <div className="hero-fig-lbl">Team error rate <Info text="SKUs with errors ÷ samples audited × 100. A SKU with several mistakes still counts once." /></div>
        <div className="hero-num" aria-label={`Team error rate ${pct(k.errorRate)}`}><AnimatedValue value={pct(k.errorRate)} /></div>
        <div className="hero-status">
          {tone && <span className={`badge ${LEVELS[tone].cls}`}><span aria-hidden="true">{LEVELS[tone].icon}</span> {LEVELS[tone].label}</span>}
          <span className="hero-target">Target: {d.target}% or lower</span>
        </div>
      </div>
    </section>
  );
}

export default function Overview() {
  const { params } = useFilters(KEYS);
  const st = useApi('/api/overview', params);
  const meta = useMeta();
  const { openRecords } = useDetails();
  const [tiles, setTiles] = useState('sku');
  const margin = meta?.settings?.watchMarginPct ?? 15;
  return (
    <>
      <PageHeader title="Overview" subtitle="How the Product Team and Audit Team are doing – readable in about 30 seconds." />
      <FilterBar show={['period', 'builder', 'auditor', 'file', 'project']} />
      <Async state={st} emptyWhen={(d) => d.empty}>{(d) => {
        const k = d.kpis; const target = d.target;
        const wk = d.weekly.map((w) => ({ ...w, label: weekLabel(w.week) }));
        const mistakesTotal = d.errorTypes.reduce((a, t) => a + t.classifications, 0);
        return (
          <>
            <Hero d={d} margin={margin} />

            <div className="ov-bar"><Seg label="Kind of numbers" value={tiles} onChange={setTiles} items={[['sku', 'SKU based'], ['attr', 'Attribute based']]} />
              {tiles === 'attr' && <Info text="A SKU has many attributes (colour, weight, size …). Enriched = attributes that have a value. Audited = the enriched attributes of audited SKUs, plus attributes the auditor said were left empty. With errors = attributes the auditor marked wrong (each attribute once per SKU). Error % = with errors ÷ audited." />}</div>

            {tiles === 'sku' ? (
              <div className="stat-grid" key="sku">
                <StatTile label="Total SKUs" value={k.skusAvailable ? num(k.skus) : 'Not available'} sub={k.skusAvailable ? 'in the uploaded files' : 'The file(s) list only audited SKUs'}
                  info={k.skusAvailable ? 'Different SKU IDs in the uploaded files (column A).' : 'Total SKUs can only be counted when the uploaded file also lists the SKUs that were not audited (Sample empty). At least one uploaded file lists only audited SKUs, so the total cannot be worked out.'} />
                <StatTile label="Samples audited" value={num(k.samples)} sub="SKUs the Audit Team checked" info="Different SKU IDs where the Sample column (C) is filled – the SKUs the Audit Team checked." />
                <StatTile label="Sample audit %" value={k.skusAvailable ? pct(k.sampleRate) : 'Not available'} sub={k.skusAvailable ? 'of SKUs were audited' : 'needs the total number of SKUs'}
                  info="Samples audited ÷ total SKUs × 100. Not available when total SKUs cannot be counted." />
                <StatTile label="SKUs with errors" value={num(k.errorSkus)} tone={k.errorSkus ? 'improve' : 'good'} to={withFilters('/errors')} hint="Error Analysis"
                  sub={k.afterReaudit ? 'confirmed by re-audit' : 'audited SKUs with a mistake'}
                  info={k.afterReaudit
                    ? `Audited SKUs with at least one error that the re-audit confirmed: re-audit comment written (“ok” or the re-auditor’s notes) and PT did not answer “Not Updated”. A SKU with 3 errors still counts as 1 SKU.${k.waitingSkus ? ` ${k.waitingSkus} more SKU${k.waitingSkus === 1 ? ' has' : 's have'} errors that are not confirmed yet (re-audit pending, or PT “Not Updated”); they are left out, because the audit itself may be wrong.` : ''} The rule is in Settings → Rules.`
                    : 'Audited SKUs with at least one error. A SKU with 3 errors still counts as 1 SKU.'} />
                {k.afterReaudit && (
                  <StatTile label="Errors not confirmed" value={num(k.waitingSkus)} tone={k.waitingSkus ? 'watch' : 'good'} sub="re-audit pending or PT “Not Updated” – not counted" hint="See the SKUs"
                    onClick={k.waitingSkus ? () => openRecords({ title: 'Errors not counted yet (not confirmed by re-audit)', params: { ...params, unconfirmed: '1' } }) : undefined}
                    info="Audited SKUs whose errors are not counted yet: the re-audit comment is still empty, or PT answered “Not Updated”. They are left out of every number because the audit itself may be wrong. Once the re-audit confirms them (and the file is uploaded again), they are counted." />
                )}
                <StatTile label="Error classifications" value={num(k.classifications)} sub={d.reconciliation.extra > 0 ? `${d.reconciliation.extra} more than SKUs with errors` : 'same as SKUs with errors'} to={withFilters('/errors')} hint="Error Analysis"
                  info="Each mistake the auditor recorded on a SKU is one classification. A SKU can have several: for example ‘Data Missing’ + ‘Data Error’ on one SKU = 2 classifications but still only 1 SKU with errors. That is why this number can be higher than ‘SKUs with errors’." />
                <StatTile label="Pending PT cases" value={num(k.pendingPt)} tone={k.pendingPt ? 'watch' : 'good'} sub={k.ptNotRecorded ? `+ ${k.ptNotRecorded} with no status recorded` : 'waiting for the PT team'} hint="See the SKUs"
                  onClick={k.pendingPt ? () => openRecords({ title: 'PT cases still waiting', params: { ...params, ptClass: 'pending' } }) : undefined}
                  info="Audit findings whose PT status says the correction is not (fully) done. Meaning of each status is set in Settings." />
                <StatTile label="Pending re-audits" value={num(k.pendingReaudit)} tone={k.pendingReaudit ? 'watch' : 'good'} sub="fixed, but not re-checked yet" hint="See the SKUs"
                  onClick={k.pendingReaudit ? () => openRecords({ title: 'Re-audits still to do', params: { ...params, reauditState: 'pending' } }) : undefined}
                  info="PT has fixed the item but there is no re-audit comment yet." />
              </div>
            ) : (
              <div key="attr">
                <AttrNotice files={d.attrMissingFiles} />
                <div className="stat-grid">
                  <StatTile label="Attributes enriched" value={k.attrsAvailable ? num(k.attrsEnriched) : 'Not available'} info={NA_ATTR}
                    sub={k.attrsAvailable ? (k.attrsPartial ? `from ${num(k.attrCoverage.skus)} of ${num(k.attrCoverage.of)} SKUs (files with attribute data)` : 'attributes with a value') : 'file has no attribute columns'} />
                  <StatTile label="Attributes audited" value={k.attrsAvailable ? num(k.attrsAudited) : 'Not available'} sub={k.attrsAvailable ? 'on the audited SKUs' : undefined} info={NA_ATTR} />
                  <StatTile label="Attributes with errors" value={num(k.attrErrors)} tone={k.attrErrors ? 'improve' : 'good'} to={withFilters('/errors')} hint="See which attributes"
                    sub={k.otherFieldErrors ? `+ ${k.otherFieldErrors} other field${k.otherFieldErrors === 1 ? '' : 's'} (e.g. Source)` : 'marked wrong by the auditors'}
                    info="Attributes named in the Attribute/Field column that are real attributes of the SKU. One attribute on one SKU counts once, however many error codes it has. Names that are not attributes of the SKU (like ‘Source’ or ‘All’) are shown separately." />
                  <StatTile label="Attribute error %" value={k.attrsAvailable ? pct(k.attrErrorRate) : 'Not available'} sub="with errors ÷ audited" info={NA_ATTR} />
                </div>
              </div>)}

            <div className="ov-main">
              <Card title="Error % week by week" info="SKUs with errors ÷ samples audited, for each week. The dashed line is the target.">
                {wk.length ? <ErrorTrend data={wk} target={target} /> : <div className="empty">No weekly data yet.</div>}
                {wk.length === 1 && <p className="muted small">Only one week of data so far – the trend appears after more files are uploaded.</p>}
              </Card>
              <Card title="Most common mistakes" info="How many times each kind of mistake was recorded by the auditors (error classifications). One SKU can have more than one. Click a row to open Error Analysis for that mistake.">
                {d.errorTypes.length ? <MistakeList types={d.errorTypes} total={mistakesTotal} linkFor={(code) => withFilters('/errors', { errorCode: code })} />
                  : <div className="empty">No mistakes were recorded in this selection.</div>}
                {d.errorTypes.length > 0 && <p className="muted small mt-s">{num(mistakesTotal)} mistakes on {num(k.errorSkus)} SKUs.</p>}
              </Card>
            </div>

            <div className="grid g2 mt">
              <Card title="Top 3 – Product Team" info={`Up to three people whose error percentage (SKUs with errors ÷ audited SKUs) is at or under the target of ${target}%, lowest first. Only people with at least ${d.top.minSample} audited SKUs are counted, so a lucky small sample does not win. If fewer than three people are under the target, fewer are shown.`}>
                {d.top.content.length ? (
                  <ol className="lr-list">{d.top.content.map((m, i) => (
                    <ListRow key={m.id ?? m.name} n={i + 1} name={m.name} to={personLink('/content', 'builderId', m.id)} valueText={pct(m.errorRate)} line={`${m.errorSkus} of ${m.samples} audited SKUs had errors`} />))}</ol>
                ) : d.top.ranked ? <div className="empty">Nobody is at or under the {target}% target yet.</div>
                  : <div className="empty">Nobody has {d.top.minSample} or more audited SKUs yet, so nobody can be ranked fairly.</div>}
                <div className="mt-s"><Link to={withFilters('/content')}>See everyone on the Product Team page →</Link></div>
              </Card>
              <Card title="Top 3 – Audit Team" info="The three auditors who found the most error types. Every error type an auditor recorded counts once, so a SKU with two error types counts as 2. Auditors who found none are not listed.">
                {d.top.audit.length ? (
                  <ol className="lr-list">{d.top.audit.map((a, i) => (
                    <ListRow key={a.id} n={i + 1} name={a.name} to={personLink('/audit', 'auditorId', a.id)} valueText={`${num(a.classifications)} error type${a.classifications === 1 ? '' : 's'}`} line={`found on ${num(a.errorSkus)} of ${num(a.skusAudited)} audited SKUs`} />))}</ol>
                ) : <div className="empty">No auditor found any errors in this selection.</div>}
                <div className="mt-s"><Link to={withFilters('/audit')}>See everyone on the Audit Team page →</Link></div>
              </Card>
            </div>
          </>
        );
      }}</Async>
      <ChampionFab />
    </>
  );
}
