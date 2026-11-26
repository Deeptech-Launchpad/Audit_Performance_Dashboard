// All dashboard calculations. Pure functions: records in, numbers out. No database, no hard-coded names or reference values.
//
// Definitions (also explained to users in the app):
//   Total SKUs            = distinct SKU IDs
//   Samples audited       = distinct SKU IDs that were audited ("sampled")
//   SKUs with errors      = distinct audited SKU IDs having at least one error code      (never counts a SKU twice)
//   Error classifications = number of error codes recorded (one SKU can have several)   (separate metric)
//   Sample audit %        = samples audited / total SKUs x 100
//   Error %               = SKUs with errors / samples audited x 100
import { diffDays } from '../lib/dates.js';

export const pct = (n, d) => (d > 0 ? (n / d) * 100 : null);
export const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const sortDesc = (arr, key) => arr.sort((a, b) => b[key] - a[key] || String(a.name ?? a.label ?? '').localeCompare(String(b.name ?? b.label ?? '')));

export function metrics(recs) {
  const skus = new Set(), samples = new Set(), errSkus = new Set(), waitSkus = new Set(); let classifications = 0, waitingClassifications = 0;
  for (const r of recs) {
    skus.add(r.skuId);
    if (!r.sampled) continue;
    samples.add(r.skuId);
    if (r.errs.length) { errSkus.add(r.skuId); classifications += r.errs.length; }
    if (r.waitingErrs?.length) { waitSkus.add(r.skuId); waitingClassifications += r.waitingErrs.length; } // errors not counted yet: re-audit still to come
  }
  for (const s of errSkus) waitSkus.delete(s);
  // Total SKUs assigned can only be counted when every contributing file also lists the SKUs that were NOT audited.
  const skusAvailable = recs.every((r) => r.fullList);
  return { skus: skus.size, skusAvailable, samples: samples.size, errorSkus: errSkus.size, classifications, waitingSkus: waitSkus.size, waitingClassifications,
    sampleRate: skusAvailable ? r2(pct(samples.size, skus.size)) : null, errorRate: r2(pct(errSkus.size, samples.size)), ...attributeMetrics(recs) };
}

/** ATTRIBUTE-BASED numbers (the counterpart of the SKU-based ones). Per distinct SKU:
 *    enriched  = attributes that have a value (Raw/Build Val) - counts every SKU, audited or not
 *    audited   = enriched attributes of AUDITED SKUs + attributes the auditor flagged that were left empty (e.g. Data Missing),
 *                because the auditor looked at those too
 *    with errors = attributes named in "Attribute/Field" that are real attributes of the SKU (one per SKU and attribute)
 *    other fields = names in "Attribute/Field" that are not attributes of the SKU (e.g. "Source", "All")
 *    attribute error % = with errors / audited
 *  Enriched / audited / % use only the records from files that HAVE the attribute columns (attrCoverage says how many SKUs that is);
 *  they are "Not available" (null) only when no file in the selection has them. */
export function attributeMetrics(all) {
  // Only records from files that have the attribute columns can say anything about attributes enriched / audited.
  // When some files lack them, the attribute numbers use just the files that have them (numerator AND denominator), and the
  // coverage is reported so the screen can say "x of y SKUs". With no such file at all, only the error attributes (column F) are counted.
  const withAttr = all.filter((r) => r.attrsEnriched != null);
  const recs = withAttr.length ? withAttr : all;
  const skusWith = new Set(withAttr.map((r) => r.skuId)).size; const skusAll = new Set(all.map((r) => r.skuId)).size;
  const enrichedBySku = new Map(); const auditedSkus = new Set(); const errAttr = new Set(); const otherAttr = new Set(); const blankFlagged = new Set();
  for (const r of recs) {
    if (r.attrsEnriched != null) enrichedBySku.set(r.skuId, r.attrsEnriched); // newest record wins (records arrive oldest first)
    if (!r.sampled) continue;
    auditedSkus.add(r.skuId);
    if (!r.errs.length) continue;
    for (const a of r.attrInfo || []) {
      const key = `${r.skuId}\u0000${a.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
      if (!a.isAttribute) { otherAttr.add(key); continue; }
      errAttr.add(key);
      if (a.wasEnriched === false) blankFlagged.add(key);
    }
  }
  const attrsAvailable = withAttr.length > 0;
  let enriched = 0; for (const v of enrichedBySku.values()) enriched += v;
  let audited = 0; for (const s of auditedSkus) audited += enrichedBySku.get(s) || 0;
  audited += blankFlagged.size;
  return {
    attrsAvailable, attrsPartial: attrsAvailable && skusWith < skusAll, attrCoverage: { skus: skusWith, of: skusAll },
    attrsEnriched: attrsAvailable ? enriched : null, attrsAudited: attrsAvailable ? audited : null,
    attrErrors: errAttr.size, otherFieldErrors: otherAttr.size,
    attrErrorRate: attrsAvailable && audited > 0 ? r2(pct(errAttr.size, audited)) : null,
  };
}

export function levelFor(m, s) {
  if (!m.samples) return 'none';
  if (m.samples < s.minSample) return 'few';
  const e = m.errorRate;
  if (e <= s.errorTargetPct) return 'good';
  if (e <= s.errorTargetPct + (s.watchMarginPct ?? 15)) return 'watch';
  return 'improve';
}

const groupBy = (recs, f) => { const m = new Map(); for (const r of recs) { const k = f(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
const nameOf = (errTypes, c) => errTypes.get(c)?.name || c;

/** Mistakes by type, counted per ATTRIBUTE with an error (adds up to attributeMetrics().attrErrors: same records, same one-per-SKU-and-attribute rule).
 *  An attribute gets its SKU's error code. When the SKU has two or more codes (e.g. "DE|DM" with three attributes) the file does not say
 *  which attribute had which, so those attributes are counted together as "Data Error or Data Missing" (never guessed). */
export function attributeTypeBreakdown(all, errTypes) {
  const withAttr = all.filter((r) => r.attrsEnriched != null);
  const recs = withAttr.length ? withAttr : all;
  const seen = new Set(); const by = {};
  for (const r of recs) {
    if (!r.sampled || !r.errs.length) continue;
    const codes = [...new Set(r.errs)].sort(); const code = codes.join('|');
    for (const a of r.attrInfo || []) {
      if (!a.isAttribute) continue;
      const key = `${r.skuId}\u0000${a.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
      if (seen.has(key)) continue; seen.add(key);
      const o = (by[code] ||= { code, name: codes.map((c) => nameOf(errTypes, c)).join(' or '), mixed: codes.length > 1, attributes: 0 }); o.attributes++;
    }
  }
  return Object.values(by).sort((a, b) => a.mixed - b.mixed || b.attributes - a.attributes || a.code.localeCompare(b.code));
}

/** "Best auditor" order, used by the Overview Top 3 and the champion pop-up: most error types found, then more SKUs with errors, then more SKUs audited. */
export const byErrorsFound = (a, b) => b.classifications - a.classifications || b.errorSkus - a.errorSkus || b.skusAudited - a.skusAudited || String(a.name).localeCompare(String(b.name));

/** typeBreakdown: per error code -> classifications and distinct SKUs */
export function typeBreakdown(recs, errTypes) {
  const by = {};
  for (const r of recs) if (r.sampled) for (const c of r.errs) { const o = (by[c] ||= { code: c, name: nameOf(errTypes, c), classifications: 0, skuSet: new Set() }); o.classifications++; o.skuSet.add(r.skuId); }
  return sortDesc(Object.values(by).map(({ skuSet, ...o }) => ({ ...o, skus: skuSet.size })), 'classifications');
}

export function attributeBreakdown(recs) {
  const by = new Map();
  for (const r of recs) {
    if (!r.sampled || !r.errs.length) continue;
    for (const a of r.attrs) {
      const k = a.toLowerCase(); const o = by.get(k) || { attribute: a, skuSet: new Set(), classifications: 0, byBuilder: {} };
      o.skuSet.add(r.skuId); o.classifications += r.errs.length; inc(o.byBuilder, r.builder); by.set(k, o);
    }
  }
  return sortDesc([...by.values()].map(({ skuSet, ...o }) => ({ ...o, skus: skuSet.size, name: o.attribute })), 'skus');
}

export function weeklyTrend(recs) {
  return [...groupBy(recs, (r) => r.weekStart)].sort((a, b) => a[0].localeCompare(b[0])).map(([week, rs]) => ({ week, ...metrics(rs) }));
}
export function dailyTrend(recs) {
  return [...groupBy(recs, (r) => r.auditDate)].sort((a, b) => a[0].localeCompare(b[0])).map(([date, rs]) => ({ date, ...metrics(rs) }));
}

/* ------------------------------------------------------------- product team */
export function contentTeam(recs, errTypes, s) {
  const members = [];
  for (const [, rs] of groupBy(recs, (r) => r.builderId ?? 0)) {
    const m = metrics(rs); const attrs = attributeBreakdown(rs); const types = typeBreakdown(rs, errTypes);
    const weekly = weeklyTrend(rs);
    const w2 = weekly.filter((w) => w.samples > 0);
    const last = w2[w2.length - 1], prev = w2[w2.length - 2];
    members.push({
      id: rs[0].builderId, name: rs[0].builder, ...m, level: levelFor(m, s), lowSample: m.samples > 0 && m.samples < s.minSample,
      byType: types, attrByType: attributeTypeBreakdown(rs, errTypes), topTypes: types.slice(0, 3), topAttributes: attrs.slice(0, 5).map((a) => ({ attribute: a.attribute, skus: a.skus })),
      weekly: weekly.map((w) => ({ week: w.week, samples: w.samples, errorSkus: w.errorSkus, errorRate: w.errorRate, skus: w.skus })),
      change: last && prev && last.errorRate != null && prev.errorRate != null ? { from: prev.errorRate, to: last.errorRate, diff: r2(last.errorRate - prev.errorRate), weekFrom: prev.week, weekTo: last.week } : null,
    });
  }
  // ranking: lowest error % first among members with enough samples; the rest follow, unranked
  // (rows with no "SKU Build By" name are shown but never ranked: nobody can be named a top performer from a blank name)
  const ranked = members.filter((m) => m.samples >= s.minSample && m.id != null).sort((a, b) => a.errorRate - b.errorRate || b.samples - a.samples);
  ranked.forEach((m, i) => { m.rank = i + 1; });
  const rest = members.filter((m) => !ranked.includes(m)).sort((a, b) => b.samples - a.samples || a.name.localeCompare(b.name));
  return [...ranked, ...rest];
}

/* --------------------------------------------------------------- audit team */
export function auditTeam(recs, errTypes) {
  const withAuditor = recs.filter((r) => r.auditorId != null);
  const totalRecords = withAuditor.length;
  const out = [];
  for (const [, rs] of groupBy(withAuditor, (r) => r.auditorId)) {
    const audited = rs.filter((r) => r.sampled);
    const am = attributeMetrics(audited); // attribute-based workload of this auditor
    const types = typeBreakdown(audited, errTypes);
    const cases = rs.filter((r) => r.isCase);
    const pt = { completed: 0, pending: 0, notRecorded: 0, unmapped: 0 };
    const re = { passed: 0, issues: 0, pending: 0, notDue: 0 };
    let closed = 0, pending = 0;
    for (const c of cases) {
      if (c.ptClass === 'completed') pt.completed++; else if (c.ptClass === 'pending') pt.pending++; else if (c.ptClass === 'not_recorded') pt.notRecorded++; else pt.unmapped++;
      if (c.reaudit === 'passed') re.passed++; else if (c.reaudit === 'issues') re.issues++; else if (c.reaudit === 'pending') re.pending++; else re.notDue++;
      if (c.ptClass === 'completed' && (c.reaudit === 'passed' || c.reaudit === 'issues')) closed++;
      else if (c.ptClass === 'pending' || c.reaudit === 'pending') pending++;
    }
    out.push({
      id: rs[0].auditorId, name: rs[0].auditor,
      skusAudited: new Set(audited.map((r) => r.skuId)).size, records: rs.length, share: r2(pct(rs.length, totalRecords)),
      classifications: audited.reduce((a, r) => a + r.errs.length, 0), errorSkus: new Set(audited.filter((r) => r.errs.length).map((r) => r.skuId)).size,
      suggestions: audited.filter((r) => r.codes.some((c) => errTypes.get(c)?.isError === false && c !== 'OK')).length,
      ptResponses: cases.filter((c) => c.hasPtResponse).length,
      attrsAvailable: am.attrsAvailable, attrsAudited: am.attrsAudited, attrErrors: am.attrErrors, otherFieldErrors: am.otherFieldErrors,
      byType: types, pt, reaudit: re,
      cases: cases.length, closedCases: closed, pendingCases: pending, otherCases: cases.length - closed - pending,
      weekly: [...groupBy(rs, (r) => r.weekStart)].sort((a, b) => a[0].localeCompare(b[0])).map(([week, x]) => ({ week, records: x.length, skus: new Set(x.map((y) => y.skuId)).size })),
    });
  }
  return sortDesc(out, 'records');
}

/* ----------------------------------------------------------- error analysis */
export function errorAnalysis(recs, errTypes) {
  const audited = recs.filter((r) => r.sampled);
  const errRecs = audited.filter((r) => r.errs.length);
  const byType = typeBreakdown(audited, errTypes);
  const totalCls = byType.reduce((a, t) => a + t.classifications, 0);
  byType.forEach((t) => { t.share = r2(pct(t.classifications, totalCls)); });
  const attrs = attributeBreakdown(audited);
  const codes = byType.map((t) => t.code);

  const memberMap = new Map();
  for (const r of errRecs) {
    const m = memberMap.get(r.builder) || { name: r.builder, id: r.builderId, total: 0, skuSet: new Set(), codes: {} };
    for (const c of r.errs) { inc(m.codes, c); m.total++; } m.skuSet.add(r.skuId); memberMap.set(r.builder, m);
  }
  const byMember = sortDesc([...memberMap.values()].map(({ skuSet, ...m }) => ({ ...m, skus: skuSet.size })), 'total');

  const weekMap = new Map();
  for (const r of errRecs) { const w = weekMap.get(r.weekStart) || { week: r.weekStart, total: 0 }; for (const c of r.errs) { inc(w, c); w.total++; } weekMap.set(r.weekStart, w); }
  const byWeek = [...weekMap.values()].sort((a, b) => a.week.localeCompare(b.week));

  const audMap = new Map();
  for (const r of errRecs) {
    const k = r.auditor || '(not recorded)';
    const m = audMap.get(k) || { name: k, id: r.auditorId, total: 0, skuSet: new Set(), codes: {} };
    for (const c of r.errs) { inc(m.codes, c); m.total++; } m.skuSet.add(r.skuId); audMap.set(k, m);
  }
  const byAuditor = sortDesc([...audMap.values()].map(({ skuSet, ...m }) => ({ ...m, skus: skuSet.size })), 'total');

  // codes in the data that are not in the error list (Settings): never counted as errors, listed so an Admin can add them
  const unk = {};
  for (const r of audited) for (const c of r.codes) if (!errTypes.has(c)) { (unk[c] ||= { code: c, rows: 0, skuSet: new Set() }).rows++; unk[c].skuSet.add(r.skuId); }
  const unrecognisedCodes = Object.values(unk).map(({ skuSet, ...o }) => ({ ...o, skus: skuSet.size }));

  // recurring issues explained by the auditors' own words (column G): the same comment (links removed) on 2+ SKUs
  const normComment = (t) => String(t || '').toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').replace(/[\s.;,]+$/g, '').trim();
  const cm = new Map();
  for (const r of errRecs) {
    const k = normComment(r.auditComments).replace(/["'“”‘’()]/g, '').trim();
    if (k.length < 12) continue; // a comment that is only a link (or a word or two) says nothing about the issue
    const o = cm.get(k) || { comment: String(r.auditComments).trim(), skuSet: new Set(), codes: {}, builders: {}, attrs: {} };
    o.skuSet.add(r.skuId); for (const c of r.errs) inc(o.codes, c); inc(o.builders, r.builder); for (const a of r.attrs) inc(o.attrs, a); cm.set(k, o);
  }
  const recurringComments = [...cm.values()].filter((o) => o.skuSet.size >= 2)
    .map(({ skuSet, ...o }) => ({ ...o, skus: skuSet.size, exampleSkus: [...skuSet].slice(0, 4), name: o.comment }))
    .sort((a, b) => b.skus - a.skus).slice(0, 20);

  // repeated errors: the same person making the same kind of mistake on 2+ different SKUs
  const rep = new Map();
  for (const r of errRecs) {
    for (const a of r.attrs) { const k = `a|${r.builder}|${a.toLowerCase()}`; const o = rep.get(k) || { kind: 'attribute', builder: r.builder, builderId: r.builderId, label: a, skuSet: new Set(), codes: {} }; o.skuSet.add(r.skuId); for (const c of r.errs) inc(o.codes, c); rep.set(k, o); }
    for (const c of r.errs) { const k = `t|${r.builder}|${c}`; const o = rep.get(k) || { kind: 'type', builder: r.builder, builderId: r.builderId, label: c, skuSet: new Set(), codes: {} }; o.skuSet.add(r.skuId); rep.set(k, o); }
  }
  const repeated = sortDesc([...rep.values()].filter((o) => o.skuSet.size >= (o.kind === 'attribute' ? 2 : 3)).map(({ skuSet, ...o }) => ({ ...o, skus: skuSet.size, name: o.label })), 'skus').slice(0, 50);

  return { byType, topErrors: byType.slice(0, 5), byAttribute: attrs.slice(0, 50), topAttributes: attrs.slice(0, 10), byMember, byAuditor, byWeek, repeated, recurringComments, unrecognisedCodes, codes,
    totals: { classifications: totalCls, errorSkus: new Set(errRecs.map((r) => r.skuId)).size },
    attributeTotals: (({ attrErrors, otherFieldErrors }) => ({ attrErrors, otherFieldErrors }))(attributeMetrics(recs)) };
}

/* ------------------------------------------------------------- follow-ups */
export function followUps(recs, today, s) {
  const cases = recs.filter((r) => r.isCase);
  const pt = { completed: 0, pending: 0, not_recorded: 0, unmapped: 0 };
  const re = { passed: 0, issues: 0, pending: 0, not_due: 0 };
  const unmappedValues = {};
  for (const c of cases) { inc(pt, c.ptClass); inc(re, c.reaudit); if (c.ptClass === 'unmapped') inc(unmappedValues, c.ptRaw); }
  const ageOf = (r) => (today && r.auditDate ? Math.max(0, diffDays(today, r.auditDate)) : null);
  const pendingItems = cases.filter((r) => r.ptClass === 'pending' || r.reaudit === 'pending');
  const buckets = [['0–2 days', 0, 2], ['3–7 days', 3, 7], ['8–14 days', 8, 14], ['15+ days', 15, Infinity]].map(([label, lo, hi]) => ({
    label, pt: pendingItems.filter((r) => r.ptClass === 'pending' && ageOf(r) >= lo && ageOf(r) <= hi).length,
    reaudit: pendingItems.filter((r) => r.reaudit === 'pending' && ageOf(r) >= lo && ageOf(r) <= hi).length }));
  const old = pendingItems.filter((r) => ageOf(r) > s.ageingWarnDays).length;
  return { cases: cases.length, pt, reaudit: re, unmappedValues, ageing: buckets, olderThanWarn: old, today,
    items: cases.map((r) => ({ id: r.id, skuId: r.skuId, builder: r.builder, auditor: r.auditor, auditDate: r.auditDate, codes: r.codes, ptRaw: r.ptRaw, ptClass: r.ptClass, reaudit: r.reaudit, ptComments: r.ptComments || '', reauditComments: r.reauditComments || '', ptResponse: r.ptResponse || '',
      ageDays: r.ptClass === 'pending' || r.reaudit === 'pending' ? ageOf(r) : null,
      counted: r.errs.length > 0 ? 'yes' : r.waitingErrs?.length ? 'waiting' : 'none' })) }; // does this case add to the error numbers?
}

/* ----------------------------------------------------------------- overview */
export function overview(recs, errTypes, s, today) {
  const m = metrics(recs);
  const fu = followUps(recs, today, s);
  const multi = [];
  for (const r of recs) if (r.sampled && r.errs.length > 1) multi.push({ skuId: r.skuId, builder: r.builder, codes: r.errs });
  const members = contentTeam(recs, errTypes, s);
  const auditors = auditTeam(recs, errTypes);
  const levels = { good: 0, watch: 0, improve: 0, few: 0, none: 0 };
  for (const x of members) inc(levels, x.level);
  return {
    kpis: { ...m, pendingPt: fu.pt.pending, pendingReaudit: fu.reaudit.pending, ptNotRecorded: fu.pt.not_recorded, cases: fu.cases, afterReaudit: !!errTypes.afterReaudit },
    reconciliation: { classifications: m.classifications, errorSkus: m.errorSkus, extra: m.classifications - m.errorSkus, multiErrorSkus: multi },
    levels, content: members.map((x) => ({ id: x.id, name: x.name, samples: x.samples, errorSkus: x.errorSkus, errorRate: x.errorRate, level: x.level, rank: x.rank ?? null, skus: x.skus })),
    audit: auditors.map((x) => ({ id: x.id, name: x.name, skusAudited: x.skusAudited, records: x.records, pendingCases: x.pendingCases })),
    // Top 3 on the Overview.
    //   Product team: only people who are AT OR UNDER the error target (the same "on target" rule as everywhere), lowest error % first, among people with
    //                 enough audited SKUs (the same ranking as the Product Team page). Fewer than 3 people can show; nobody under the target = empty list.
    //   Audit team:   the auditors who FOUND THE MOST ERROR TYPES = error classifications recorded (a SKU with two error types counts 2).
    //                 Ties: more SKUs with errors, then more SKUs audited. Auditors who found none are left out.
    top: {
      content: members.filter((x) => x.rank != null && x.level === 'good').slice(0, 3).map((x) => ({ id: x.id, name: x.name, errorRate: x.errorRate, samples: x.samples, errorSkus: x.errorSkus, rank: x.rank })),
      ranked: members.filter((x) => x.rank != null).length, // people with enough audited SKUs to be ranked at all (tells "nobody ranked yet" from "nobody under the target")
      audit: auditors.filter((x) => x.classifications > 0).sort(byErrorsFound).slice(0, 3)
        .map((x) => ({ id: x.id, name: x.name, errorSkus: x.errorSkus, classifications: x.classifications, skusAudited: x.skusAudited, records: x.records })),
      minSample: s.minSample,
    },
    errorTypes: typeBreakdown(recs, errTypes), weekly: weeklyTrend(recs), daily: dailyTrend(recs),
  };
}
