// Category-Based Performance Tracking: who is strongest in which category, and a plan for assigning future SKUs.
// A category is the L1 part of the PIM Taxonomy (text before the first ">"). Everything is calculated from the audit records.
//
// For one person in one category:
//   SKUs built      = distinct SKUs they built in that category (experience / volume)
//   audited         = how many of those SKUs were audited (the evidence)
//   error %         = SKUs with errors / audited
//   tier  strong    = audited >= categoryMinSample AND error % <= target             -> proven, prefer for new SKUs
//         ok        = audited >= categoryMinSample AND error % <= target + margin    -> acceptable
//         weak      = audited >= categoryMinSample AND error % above that            -> needs support / fewer SKUs
//         early     = audited between 1 and categoryMinSample-1                      -> too little evidence, early signal only
//         untested  = built SKUs here but none audited                               -> no evidence
import { metrics } from './compute.js';

const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const TIER_ORDER = { strong: 0, ok: 1, early: 2, untested: 3, weak: 4 };

/** The same "who does best" cards for any grouping (category, project …). keyOf(record) -> group name, or null to leave the record out. */
export function groupPerformance(recs, s, keyOf, onMember = () => {}) {
  const target = s.errorTargetPct, margin = s.watchMarginPct ?? 15, minCat = s.categoryMinSample ?? 3;
  const tierOf = (m) => (!m.samples ? 'untested' : m.samples < minCat ? 'early' : m.errorRate <= target ? 'strong' : m.errorRate <= target + margin ? 'ok' : 'weak');
  const cats = new Map();
  for (const r of recs) { const name = keyOf(r); if (!name) continue; const k = name.toLowerCase(); const o = cats.get(k) || { name, recs: [] }; o.recs.push(r); cats.set(k, o); }
  return [...cats.values()].map((c) => {
    const byP = new Map(); for (const r of c.recs) { const k = r.builderId ?? r.builder; if (!byP.has(k)) byP.set(k, []); byP.get(k).push(r); }
    const members = [...byP.values()].map((rs) => {
      const m = metrics(rs); const tier = tierOf(m);
      return { id: rs[0].builderId, name: rs[0].builder, skus: m.skus, samples: m.samples, errorSkus: m.errorSkus, errorRate: m.errorRate, classifications: m.classifications,
        attrErrorRate: m.attrErrorRate, attrsAvailable: m.attrsAvailable, tier };
    }).sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]
      || (a.tier === 'untested' ? 0 : (a.errorRate ?? 101) - (b.errorRate ?? 101)) || b.samples - a.samples || b.skus - a.skus || a.name.localeCompare(b.name));
    const total = metrics(c.recs);
    const named = members.filter((x) => x.id != null); // a blank "SKU Build By" is never recommended for new SKUs
    const strong = named.filter((x) => x.tier === 'strong');
    let recommended = strong.slice(0, 3); let basis = 'proven';
    if (!recommended.length) {   // nobody proven yet: offer the best available, clearly labelled
      const next = named.find((x) => x.tier === 'ok') || named.find((x) => x.tier === 'early');
      recommended = next ? [next] : []; basis = next ? 'best available' : 'none suitable'; // none suitable = the category has history, but everyone needs support or was not audited
    }
    for (const x of members) onMember(x, c.name);
    return { name: c.name, skus: total.skus, samples: total.samples, errorSkus: total.errorSkus, errorRate: total.errorRate, members, recommended, basis,
      needsSupport: members.filter((x) => x.tier === 'weak') };
  }).sort((a, b) => b.skus - a.skus || a.name.localeCompare(b.name));
}

export function categoryPerformance(recs, s) {
  const target = s.errorTargetPct, margin = s.watchMarginPct ?? 15, minCat = s.categoryMinSample ?? 3;
  const withCat = recs.filter((r) => r.category);
  const people = new Map(); const person = (r) => { const k = r.builderId ?? r.builder; if (!people.has(k)) people.set(k, { id: r.builderId, name: r.builder, skus: new Set(), strong: [], ok: [], weak: [], early: [], untested: [] }); return people.get(k); };
  const categories = groupPerformance(withCat, s, (r) => r.category, (x, cat) => {
    const p = person({ builderId: x.id, builder: x.name }); p.skus.add(cat); p[x.tier].push({ category: cat, errorRate: x.errorRate, samples: x.samples, skus: x.skus });
  });

  const sortCat = (arr) => arr.sort((a, b) => (a.errorRate ?? 101) - (b.errorRate ?? 101) || b.samples - a.samples);
  const peopleOut = [...people.values()].map((p) => ({ id: p.id, name: p.name, categoriesWorked: p.skus.size, strong: sortCat(p.strong), ok: sortCat(p.ok), weak: sortCat(p.weak), early: sortCat(p.early), untested: p.untested }))
    .sort((a, b) => b.strong.length - a.strong.length || b.categoriesWorked - a.categoriesWorked || a.name.localeCompare(b.name));

  return {
    categories, people: peopleOut,
    settings: { target, margin, minCat },
    coverage: { skusWithCategory: new Set(withCat.map((r) => r.skuId)).size, skusTotal: new Set(recs.map((r) => r.skuId)).size },
    summary: {
      categories: categories.length,
      withProven: categories.filter((c) => c.basis === 'proven').length,
      noProven: categories.filter((c) => c.basis !== 'proven').length,
      expertPeople: peopleOut.filter((p) => p.strong.length).length,
    },
  };
}

