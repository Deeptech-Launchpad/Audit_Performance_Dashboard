// Rule-based improvement suggestions. Every suggestion is produced by a rule that looks at calculated numbers and
// carries its `evidence`, so a reader can see exactly what it is based on. Nothing is guessed or "AI generated".
//
// Future AI: add another provider to PROVIDERS. A provider is `async (ctx) => Suggestion[]` and receives the same
// calculated numbers (ctx.cur, ctx.prev, ...). AI output should be labelled source: 'ai' and shown separately.
import { metrics, contentTeam, errorAnalysis, followUps, typeBreakdown, attributeBreakdown, pct, r2 } from './compute.js';

const sev = { high: 0, medium: 1, low: 2, good: 3 };
const f1 = (x) => (x == null ? '—' : `${r2(x)}%`);

const RULES = [
  // 1. team error % up or down
  ({ cur, prev, s }) => {
    const a = metrics(cur.recs), b = metrics(prev.recs);
    if (a.samples < s.minSample || b.samples < s.minSample) return [];
    const d = r2(a.errorRate - b.errorRate); if (Math.abs(d) < 1) return [];
    const up = d > 0;
    return [{ id: 'team-trend', severity: up ? 'high' : 'good', title: up ? `The team's error percentage went up compared with ${prev.label}` : `The team's error percentage improved compared with ${prev.label}`,
      detail: `Error percentage was ${f1(b.errorRate)} (${b.errorSkus} of ${b.samples} audited SKUs) in ${prev.label} and is ${f1(a.errorRate)} (${a.errorSkus} of ${a.samples}) in ${cur.label}.`,
      action: up ? 'Review the most common errors below and share them with the team.' : 'Keep the current practices and share what worked.', evidence: { current: a.errorRate, previous: b.errorRate, diffPoints: d } }];
  },
  // 2. most common error type
  ({ cur, errTypes }) => {
    const t = typeBreakdown(cur.recs, errTypes); const total = t.reduce((a, x) => a + x.classifications, 0);
    if (!t.length || total < 3) return [];
    const top = t[0]; const tip = errTypes.get(top.code)?.tip;
    return [{ id: 'top-error-type', severity: 'medium', title: `${top.name} is the most common error in ${cur.label}`,
      detail: `${top.classifications} of ${total} error classifications (${f1(pct(top.classifications, total))}) on ${top.skus} SKUs.`,
      action: tip || `Plan a short refresher on how to avoid "${top.name}".`, evidence: { code: top.code, classifications: top.classifications, total } }];
  },
  // 3. repeated errors per person (same attribute on 2+ SKUs)
  ({ cur, errTypes }) => {
    const ea = errorAnalysis(cur.recs, errTypes);
    return ea.repeated.filter((r) => r.kind === 'attribute' && r.skus >= 2).slice(0, 5).map((r) => ({
      id: `repeat-${r.builderId}-${r.label}`, severity: r.skus >= 3 ? 'high' : 'medium', title: `${r.builder} has repeated errors in "${r.label}"`,
      detail: `Errors in this attribute on ${r.skus} different SKUs in ${cur.label}${Object.keys(r.codes).length ? ` (types: ${Object.entries(r.codes).map(([c, n]) => `${c} ×${n}`).join(', ')})` : ''}.`,
      action: `Walk through the rules for "${r.label}" with ${r.builder} and re-check their other SKUs for the same mistake.`, evidence: { person: r.builder, attribute: r.label, skus: r.skus } }));
  },
  // 4. members above target
  ({ cur, errTypes, s }) => contentTeam(cur.recs, errTypes, s).filter((m) => m.level === 'improve').slice(0, 5).map((m) => ({
    id: `improve-${m.id}`, severity: 'high', title: `${m.name} has a high error rate (${f1(m.errorRate)})`,
    detail: `${m.errorSkus} of ${m.samples} audited SKUs had errors; the set error rate is ${s.errorTargetPct}% or lower. Most common: ${m.topTypes.map((t) => t.name).join(', ') || '—'}.`,
    action: `Coaching on ${m.topTypes[0]?.name || 'the most common errors'}${m.topAttributes[0] ? `, especially "${m.topAttributes[0].attribute}"` : ''}.`, evidence: { person: m.name, errorRate: m.errorRate, samples: m.samples } })),
  // 5. person got worse week-on-week
  ({ cur, errTypes, s }) => contentTeam(cur.recs, errTypes, s).filter((m) => m.change && m.change.diff >= 15 && m.samples >= s.minSample).slice(0, 3).map((m) => ({
    id: `worse-${m.id}`, severity: 'medium', title: `${m.name}'s error rate rose by ${m.change.diff} points`,
    detail: `From ${f1(m.change.from)} (week of ${m.change.weekFrom}) to ${f1(m.change.to)} (week of ${m.change.weekTo}).`, action: 'Check what changed (new category, new source type) and support them.', evidence: m.change })),
  // 6. few samples
  ({ cur, errTypes, s }) => {
    const few = contentTeam(cur.recs, errTypes, s).filter((m) => m.level === 'few');
    return few.length ? [{ id: 'few-samples', severity: 'low', title: `${few.length} team member${few.length > 1 ? 's have' : ' has'} too few audited samples to judge fairly`,
      detail: `${few.map((m) => `${m.name} (${m.samples})`).join(', ')} – fewer than ${s.minSample} samples.`, action: 'Audit more of their SKUs before drawing conclusions from their error percentage.', evidence: { minSample: s.minSample } }] : [];
  },
  // 7. pending follow-ups
  ({ cur, prev, today, s }) => {
    const a = followUps(cur.recs, today, s), b = followUps(prev.recs, today, s); const out = [];
    if (a.reaudit.pending > 0) {
      const up = prev.recs.length && a.reaudit.pending > b.reaudit.pending;
      out.push({ id: 'reaudit-pending', severity: up ? 'high' : 'medium', title: up ? 'Pending re-audit cases have increased' : `${a.reaudit.pending} re-audit case${a.reaudit.pending > 1 ? 's are' : ' is'} still pending`,
        detail: `${a.reaudit.pending} cases have PT marked as fixed but no re-audit comment yet${prev.recs.length ? ` (${b.reaudit.pending} in ${prev.label})` : ''}.`, action: 'Schedule the re-audits so fixed items are verified.', evidence: { current: a.reaudit.pending, previous: b.reaudit.pending } });
    }
    if (a.pt.pending > 0) {
      const up = prev.recs.length && a.pt.pending > b.pt.pending;
      out.push({ id: 'pt-pending', severity: up ? 'high' : 'medium', title: up ? 'Pending PT cases have increased' : `${a.pt.pending} PT case${a.pt.pending > 1 ? 's are' : ' is'} still pending`,
        detail: `PT status is "not updated" or "partly updated" on ${a.pt.pending} cases${prev.recs.length ? ` (${b.pt.pending} in ${prev.label})` : ''}.`, action: 'Follow up with the PT team on open cases.', evidence: { current: a.pt.pending, previous: b.pt.pending } });
    }
    if (a.pt.not_recorded > 0) out.push({ id: 'pt-not-recorded', severity: 'low', title: `${a.pt.not_recorded} audit finding${a.pt.not_recorded > 1 ? 's have' : ' has'} no PT status recorded`,
      detail: 'The PT Status column is empty for these audited findings, so the dashboard cannot tell whether they were fixed.', action: 'Ask the auditors to fill in PT Status so follow-up can be tracked.', evidence: { count: a.pt.not_recorded } });
    if (a.olderThanWarn > 0) out.push({ id: 'ageing', severity: 'medium', title: `${a.olderThanWarn} pending case${a.olderThanWarn > 1 ? 's are' : ' is'} older than ${s.ageingWarnDays} days`,
      detail: 'Age is counted from the audit date of the file the case came from.', action: 'Clear the oldest cases first.', evidence: { count: a.olderThanWarn } });
    return out;
  },
  // 8. one attribute dominates
  ({ cur }) => {
    const at = attributeBreakdown(cur.recs); const errSkus = new Set(cur.recs.filter((r) => r.sampled && r.errs.length).map((r) => r.skuId)).size;
    if (!at.length || errSkus < 5) return [];
    const top = at.find((x) => x.attribute.toLowerCase() !== 'all') || at[0]; const share = pct(top.skus, errSkus);
    return share >= 20 ? [{ id: 'top-attribute', severity: 'medium', title: `"${top.attribute}" appears in ${f1(share)} of error SKUs`, detail: `${top.skus} of ${errSkus} SKUs with errors involve this attribute.`,
      action: `Provide extra training on "${top.attribute}" (definition, allowed values, where to find it in the source).`, evidence: { attribute: top.attribute, skus: top.skus, errorSkus: errSkus } }] : [];
  },
  // 9. good performance
  ({ cur, errTypes, s }) => contentTeam(cur.recs, errTypes, s).filter((m) => m.id != null && m.level === 'good' && m.errorSkus === 0 && m.samples >= s.minSample).slice(0, 3).map((m) => ({
    id: `great-${m.id}`, severity: 'good', title: `${m.name} had no errors in ${m.samples} audited SKUs`, detail: 'Well done – a good example to share with the team.', action: 'Recognise the good work.', evidence: { person: m.name, samples: m.samples } })),
];

const PROVIDERS = [async (ctx) => RULES.flatMap((rule) => rule(ctx))];

export async function buildSuggestions(ctx) {
  const all = (await Promise.all(PROVIDERS.map((p) => p(ctx)))).flat().map((x) => ({ source: 'rules', ...x }));
  return all.sort((a, b) => sev[a.severity] - sev[b.severity]);
}
