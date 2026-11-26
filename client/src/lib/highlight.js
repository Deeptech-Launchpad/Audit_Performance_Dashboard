// Turning a captured source value into "open and highlight" links.
//  * Web page: a text-highlight link (…#:~:text=…). Chrome, Edge and Firefox open the page scrolled to the text with it marked.
//    If the text is not on the page (site changed / hides it), the page simply opens normally.
//  * PDF: browsers cannot mark text in a PDF from a link, so the app's own PDF view (/source-view) finds and marks it.

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** a captured value can hold several values ("A;B" or "A|B") */
export const valueParts = (value) => clean(value).split(/\s*[;|]\s*/).filter(Boolean);
const words = (s) => s.split(' ').filter(Boolean);
const trimEnds = (s) => clean(s).replace(/^[\s:;,.\-–]+|[\s:;,]+$/g, '');

/** what to look for, best first: the whole value, "label: value" as two pieces, then each listed value */
export function searchTerms(value) {
  const v = trimEnds(value); const out = [];
  const add = (t) => { t = trimEnds(t); if (t.length >= 2 && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t); };
  if (!v) return out;
  add(v);
  const m = /^([^:]{2,40}):\s*(.+)$/.exec(v); if (m) add(m[2]);
  for (const p of valueParts(v)) add(p);
  return out.slice(0, 6);
}

const enc = (s) => encodeURIComponent(s).replace(/-/g, '%2D');
/** one text directive: short text as is, long text as "first words … last words" (the browser marks everything in between) */
function directive(t) {
  const w = words(t);
  if (t.length <= 80 || w.length <= 8) return enc(t);
  return `${enc(w.slice(0, 4).join(' '))},${enc(w.slice(-4).join(' '))}`;
}

/** web link that opens the page with the value highlighted. `extras` = words from the auditor's note (looked for after the captured value). */
export function highlightUrl(url, value, extras = []) {
  if ((!value && !extras.length) || /:~:/.test(url)) return url;
  const v = trimEnds(value); const dirs = [];
  const push = (d) => { if (d && !dirs.includes(d)) dirs.push(d); };
  for (const t of searchTerms(v)) push(directive(t));
  const m = /^([^:]{2,40}):\s*(.{1,80})$/.exec(v); if (m) push(`${enc(trimEnds(m[1]))},${enc(trimEnds(m[2]))}`); // label and value in two table cells
  for (const x of extras) { const t = trimEnds(x); if (t.length >= 2) push(directive(t)); }
  if (!dirs.length) return url;
  return `${url}${url.includes('#') ? '' : '#'}:~:${dirs.slice(0, 8).map((d) => `text=${d}`).join('&')}`;
}

/** links that are surely PDFs (marked as PDF in the file, have a page number, or end in .pdf) */
export const isPdfLink = (link) => link.kind === 'pdf' || link.page != null || /\.pdf(?:$|[?#/&])/i.test(link.url);

/** the app's PDF view for one saved link */
export function pdfViewUrl({ recordId, link, value, extras = [], attribute, skuId }) {
  const q = new URLSearchParams({ rec: String(recordId), u: link.url });
  if (link.page) q.set('p', String(link.page));
  if (value) q.set('v', String(value).slice(0, 1000));
  if (extras.length) q.set('x', extras.join('\n').slice(0, 800));
  if (attribute) q.set('a', attribute);
  if (skuId) q.set('s', skuId);
  return `/source-view?${q}`;
}
