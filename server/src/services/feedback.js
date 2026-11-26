// Personal feedback for ONE product team member: their own numbers, rule-based suggestions from their own errors,
// the SKUs to re-check and a ready-to-send message. Everything is calculated from their audit records (columns A:N).
import PDFDocument from 'pdfkit';
import { loadRecords } from '../analytics/loader.js';
import { contentTeam } from '../analytics/compute.js';
import { getSettings, getErrorTypes } from './settings.js';
import { fmtRange, fmtDate } from '../lib/dates.js';
import { bad } from '../lib/http.js';
import { logoPng } from './reportLogo.js';

const LEVEL = { good: 'Achieved target', watch: 'Slightly above target', improve: 'Needs improvement', few: 'Too few audited SKUs to judge', none: 'No audited SKUs' };
const sev = { high: 0, medium: 1, low: 2, good: 3 };
const f1 = (x) => (x == null ? '—' : `${Math.round(x * 100) / 100}%`);
const cut = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const normComment = (t) => String(t || '').toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/["'“”‘’()]/g, '').replace(/\s+/g, ' ').replace(/[\s.;,]+$/g, '').trim();

/** Suggestions for one person, each with the figures it is based on. Nothing is guessed. */
export function personSuggestions(m, recs, errTypes, s) {
  const out = []; const push = (x) => out.push({ source: 'rules', ...x });
  const errRecs = recs.filter((r) => r.sampled && r.errs.length);

  if (m.level === 'improve' || m.level === 'watch') {
    push({ id: 'status', severity: m.level === 'improve' ? 'high' : 'medium', title: `Your error rate is ${f1(m.errorRate)} – the target is ${s.errorTargetPct}% or lower`,
      detail: `${m.errorSkus} of your ${m.samples} audited SKUs had at least one error.`, action: 'Go through the SKUs listed in this report, correct them, and check your other SKUs for the same mistakes before submitting.', evidence: { errorRate: m.errorRate, samples: m.samples, errorSkus: m.errorSkus } });
  } else if (m.level === 'good') {
    push({ id: 'status', severity: 'good', title: `Your error rate is ${f1(m.errorRate)} – within the ${s.errorTargetPct}% target`, detail: `${m.errorSkus} of ${m.samples} audited SKUs had errors.`, action: 'Keep it up.', evidence: { errorRate: m.errorRate } });
  } else if (m.level === 'few') {
    push({ id: 'few', severity: 'low', title: `Only ${m.samples} of your SKUs were audited`, detail: `With fewer than ${s.minSample} audited SKUs the percentage can swing a lot, so treat it as an early signal.`, action: 'Use the points below as guidance; more audited SKUs will give a fairer picture.', evidence: { samples: m.samples } });
  }

  m.byType.slice(0, 2).filter((t, i) => i === 0 || t.classifications >= 2).forEach((t) => {
    const tip = errTypes.get(t.code)?.tip;
    push({ id: `type-${t.code}`, severity: t.classifications >= 3 ? 'high' : 'medium', title: `${t.name} (${t.code}) is ${m.byType[0].code === t.code ? 'your most common mistake' : 'also frequent'}`,
      detail: `Recorded ${t.classifications} time${t.classifications === 1 ? '' : 's'} on ${t.skus} SKU${t.skus === 1 ? '' : 's'}.`, action: tip || `Take extra care to avoid "${t.name}" before you submit.`, evidence: { code: t.code, classifications: t.classifications, skus: t.skus } });
  });

  const attr = new Map();
  for (const r of errRecs) for (const a of r.attrs) { const k = a.toLowerCase(); const o = attr.get(k) || { name: a, skus: new Set() }; o.skus.add(r.skuId); attr.set(k, o); }
  [...attr.values()].filter((o) => o.skus.size >= 2 && o.name.toLowerCase() !== 'all').sort((a, b) => b.skus.size - a.skus.size).slice(0, 3).forEach((o) => {
    push({ id: `attr-${o.name}`, severity: o.skus.size >= 3 ? 'high' : 'medium', title: `Repeated errors in "${o.name}"`, detail: `Auditors found errors in this attribute on ${o.skus.size} different SKUs.`,
      action: `Re-read the rules for "${o.name}" and re-check your other SKUs for the same mistake.`, evidence: { attribute: o.name, skus: o.skus.size } });
  });

  const cm = new Map();
  for (const r of errRecs) {
    const k = normComment(r.auditComments); if (k.length < 12) continue;
    const o = cm.get(k) || { comment: r.auditComments, skus: new Set() }; o.skus.add(r.skuId); cm.set(k, o);
  }
  [...cm.values()].filter((o) => o.skus.size >= 2).sort((a, b) => b.skus.size - a.skus.size).slice(0, 2).forEach((o, i) => {
    push({ id: `comment-${i}`, severity: 'medium', title: `The auditors wrote the same comment on ${o.skus.size} of your SKUs`, detail: `“${cut(o.comment, 220)}”`, action: 'Apply this correction to all your SKUs that have the same issue.', evidence: { skus: o.skus.size } });
  });

  if (m.change && Math.abs(m.change.diff) >= 5) {
    const up = m.change.diff > 0;
    push({ id: 'change', severity: up ? 'medium' : 'good', title: up ? `Your error rate went up by ${Math.abs(m.change.diff)} points` : `Your error rate improved by ${Math.abs(m.change.diff)} points`,
      detail: `From ${f1(m.change.from)} (week of ${fmtDate(m.change.weekFrom)}) to ${f1(m.change.to)} (week of ${fmtDate(m.change.weekTo)}).`, action: up ? 'Think about what changed (new category, new source type) and ask your lead for help if needed.' : 'Good progress – keep doing what is working.', evidence: m.change });
  }

  const open = recs.filter((r) => r.reaudit === 'issues');
  if (open.length) push({ id: 'reaudit', severity: 'high', title: `The re-audit still found issues on ${new Set(open.map((r) => r.skuId)).size} of your SKUs`, detail: 'After the correction was made, the re-audit comments still list problems.', action: 'Read the re-audit comments for these SKUs (listed below) and fix them.', evidence: { skus: new Set(open.map((r) => r.skuId)).size } });

  return out.sort((a, b) => sev[a.severity] - sev[b.severity]);
}

/** Appreciation for someone who achieved the target: warm, specific (their own numbers), short. */
function composeAppreciation(fb, sender) {
  const m = fb.member; const L = [];
  const clean = m.errorSkus === 0;
  L.push(`Hi ${m.name},`, '',
    `Congratulations! 🎉 You achieved your audit target for ${fb.period.label}.`, '',
    clean ? `All ${m.samples} of your SKUs that were audited came through without a single error – an excellent result.`
      : `Of your ${m.samples} audited SKUs, only ${m.errorSkus} had an error, which is an error rate of ${f1(m.errorRate)} against a target of ${fb.target}% or lower.`,
    ...(m.rank ? [`You are ranked #${m.rank} in the Product Team for this period.`] : []), '',
    'Your results',
    `- SKUs audited: ${m.samples}`, `- SKUs with errors: ${m.errorSkus} (${f1(m.errorRate)})`,
    ...(m.attrsAvailable && m.attrsAudited ? [`- Attributes audited: ${m.attrsAudited}, of which ${m.attrErrors} had an error (${f1(m.attrErrorRate)})`] : []),
    `- Status: ${LEVEL.good}`, '');
  const good = fb.suggestions.filter((x) => x.severity === 'good' && x.id !== 'status');
  if (good.length) { L.push('What is going especially well'); good.forEach((x) => L.push(`- ${x.title}`)); L.push(''); }
  if (fb.skusToCheck.length) {
    L.push(`To make it even better, please take a quick look at ${fb.skusToCheck.length === 1 ? 'this SKU' : `these ${fb.skusToCheck.length} SKUs`}:`);
    fb.skusToCheck.slice(0, 5).forEach((s) => L.push(`- ${s.skuId}: ${s.codes.join(' + ')}${s.attribute ? ` – ${cut(s.attribute, 60)}` : ''}`));
    L.push('');
  }
  L.push('Thank you for your careful work and attention to detail – it makes a real difference to the quality of our data. Keep up the great work!', '', 'Best regards,', sender || '');
  return L.join('\n');
}

function composeMessage(fb, sender) {
  if (fb.member.level === 'good') return composeAppreciation(fb, sender);
  const m = fb.member; const L = [];
  L.push(`Hi ${m.name},`, '', `Here is your audit feedback for ${fb.period.label}.`, '', 'Summary',
    `- SKUs audited: ${m.samples}`, `- SKUs with errors: ${m.errorSkus}${m.errorRate == null ? '' : ` (${f1(m.errorRate)}; target ${fb.target}% or lower)`}`,
    `- Error classifications: ${m.classifications}`,
    ...(m.attrsAvailable ? [`- Attributes enriched: ${m.attrsEnriched}`, `- Attributes audited: ${m.attrsAudited}`, `- Attributes with errors: ${m.attrErrors}${m.attrErrorRate == null ? '' : ` (${f1(m.attrErrorRate)} of audited attributes)`}`] : [`- Attributes with errors: ${m.attrErrors}`]),
    `- Status: ${LEVEL[m.level]}`, '');
  const todo = fb.suggestions.filter((x) => x.severity !== 'good');
  const good = fb.suggestions.filter((x) => x.severity === 'good');
  if (todo.length) { L.push('What to work on'); todo.forEach((x, i) => { L.push(`${i + 1}. ${x.title}`, `   ${x.action}`); }); L.push(''); }
  if (good.length) { L.push('What is going well'); good.forEach((x) => L.push(`- ${x.title}`)); L.push(''); }
  if (fb.skusToCheck.length) {
    L.push('SKUs to check');
    fb.skusToCheck.slice(0, 10).forEach((s) => L.push(`- ${s.skuId}: ${s.codes.join(' + ')}${s.attribute ? ` – ${cut(s.attribute, 60)}` : ''}${s.comment ? ` – “${cut(s.comment, 110)}”` : ''}`));
    if (fb.skusToCheck.length > 10) L.push(`…and ${fb.skusToCheck.length - 10} more (see the attached report).`);
    L.push('');
  }
  L.push('Please let me know if you have any questions.', '', 'Thank you,', sender || '');
  return L.join('\n');
}

export async function buildFeedback(db, { builderId, from, to, sender }) {
  const [settings, errTypes] = await Promise.all([getSettings(db), getErrorTypes(db)]);
  const emp = await db.get('SELECT id, name, email FROM employees WHERE id = ?', [builderId]);
  if (!emp) throw bad('Team member not found.');
  const recs = await loadRecords(db, { from, to, builderId }, errTypes, { text: true });
  if (!recs.length) throw bad('There are no audit records for this person in the selected period.');
  const m = contentTeam(recs, errTypes, settings)[0];
  const dates = recs.map((r) => r.auditDate).sort();
  const period = { from: from || dates[0], to: to || dates[dates.length - 1] }; period.label = fmtRange(period.from, period.to);
  const skusToCheck = recs.filter((r) => r.sampled && r.errs.length).map((r) => ({
    skuId: r.skuId, auditDate: r.auditDate, codes: r.errs, attribute: r.attributeField, comment: r.auditComments, auditor: r.auditor || '',
    ptStatus: r.ptRaw, reaudit: r.reaudit, reauditComments: r.reauditComments })).sort((a, b) => a.skuId.localeCompare(b.skuId));
  const fb = {
    member: { id: emp.id, name: emp.name, samples: m.samples, errorSkus: m.errorSkus, errorRate: m.errorRate, classifications: m.classifications, level: m.level, levelLabel: LEVEL[m.level], rank: m.rank ?? null,
      attrsAvailable: m.attrsAvailable, attrsEnriched: m.attrsEnriched, attrsAudited: m.attrsAudited, attrErrors: m.attrErrors, attrErrorRate: m.attrErrorRate,
      topTypes: m.topTypes.map((t) => ({ code: t.code, name: t.name, classifications: t.classifications })) },
    email: emp.email || '', period, target: settings.errorTargetPct, minSample: settings.minSample,
    suggestions: personSuggestions(m, recs, errTypes, settings), skusToCheck, generatedAt: new Date().toISOString(),
  };
  fb.message = composeMessage(fb, sender);
  fb.kind = m.level === 'good' ? 'appreciation' : 'feedback';
  fb.subject = fb.kind === 'appreciation' ? `Congratulations – you achieved your audit target (${period.label})` : `Audit feedback – ${period.label}`;
  return fb;
}

/** Product Team members in one group for the bulk email: 'achieved' (at or under the target) or 'improve' (needs improvement). */
export async function groupMembers(db, { group, from, to }) {
  const [settings, errTypes] = await Promise.all([getSettings(db), getErrorTypes(db)]);
  const recs = await loadRecords(db, { from, to }, errTypes);
  const want = group === 'achieved' ? 'good' : 'improve';
  const members = contentTeam(recs, errTypes, settings).filter((m) => m.id != null && m.level === want);
  const emails = new Map((await db.all('SELECT id, email FROM employees')).map((e) => [e.id, e.email || '']));
  return members.map((m) => ({ id: m.id, name: m.name, level: m.level, errorRate: m.errorRate, samples: m.samples, errorSkus: m.errorSkus, email: emails.get(m.id) || '' }))
    .sort((a, b) => (group === 'achieved' ? a.errorRate - b.errorRate : b.errorRate - a.errorRate) || a.name.localeCompare(b.name));
}

export function feedbackToPdf(fb) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Audit feedback – ${fb.member.name}` } });
  const chunks = []; doc.on('data', (d) => chunks.push(d));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const W = doc.page.width - 80; const INK = '#1b2433', MUTE = '#5b667a', BRAND = '#1f5fbf';
  const h = (t) => { doc.moveDown(0.7).font('Helvetica-Bold').fontSize(13).fillColor(BRAND).text(t); doc.moveDown(0.3).fillColor(INK); };
  const p = (t, o = {}) => doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size || 10).fillColor(o.color || INK).text(t, { width: W, ...o });
  const m = fb.member;
  const logo = logoPng(); if (logo) doc.image(logo, 40 + W - 100, 36, { width: 100 });
  doc.font('Helvetica-Bold').fontSize(19).fillColor(INK).text(m.level === 'good' ? 'Audit results – target achieved' : 'Audit feedback');
  p(`${m.name}  |  ${fb.period.label}`, { color: MUTE });
  h('Summary');
  [['SKUs audited', m.samples], ['SKUs with errors', m.errorSkus], ['Error percentage', `${f1(m.errorRate)}  (target ${fb.target}% or lower)`], ['Error classifications', m.classifications],
    ...(m.attrsAvailable ? [['Attributes enriched', m.attrsEnriched], ['Attributes audited', m.attrsAudited], ['Attributes with errors', `${m.attrErrors}${m.attrErrorRate == null ? '' : `  (${f1(m.attrErrorRate)} of audited attributes)`}`]] : [['Attributes with errors', m.attrErrors]]),
    ['Status', m.levelLabel]]
    .forEach(([k, v]) => { doc.font('Helvetica').fontSize(10).fillColor(MUTE).text(k, 40, doc.y, { continued: true, width: 170 }).fillColor(INK).font('Helvetica-Bold').text(`   ${v}`); });
  p('A SKU with several errors counts once as a SKU with errors, but once per error in "error classifications".', { color: MUTE, size: 8.5 });
  h('What to work on');
  if (!fb.suggestions.length) p('Nothing to flag for this period.');
  fb.suggestions.forEach((s) => { p(`${s.severity === 'good' ? '+' : '•'} ${s.title}`, { bold: true }); p(s.detail, { color: MUTE, size: 9, indent: 10 }); if (s.action) p(`Do: ${s.action}`, { size: 9, indent: 10 }); doc.moveDown(0.3); });
  h(`SKUs to check (${fb.skusToCheck.length})`);
  fb.skusToCheck.forEach((s) => {
    if (doc.y > doc.page.height - 90) doc.addPage();
    p(`${s.skuId}  –  ${s.codes.join(' + ')}${s.attribute ? `  –  ${cut(s.attribute, 90)}` : ''}`, { bold: true, size: 9.5 });
    if (s.comment) p(`Auditor: ${cut(s.comment, 400)}`, { size: 9, indent: 10, color: MUTE });
    if (s.reauditComments) p(`Re-audit: ${cut(s.reauditComments, 300)}`, { size: 9, indent: 10, color: MUTE });
    doc.moveDown(0.25);
  });
  doc.end();
  return done;
}
