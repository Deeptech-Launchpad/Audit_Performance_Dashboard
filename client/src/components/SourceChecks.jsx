// "Check mistakes at the source" inside a Product Team member's panel.
// Per SKU with errors: the attribute the auditor marked wrong, the auditor's correction for it (from the audit comment),
// the text taken from the source (Raw Val), and one click that opens the source with that text highlighted:
//   web page -> browser text-highlight link;  PDF -> the app's own PDF view (/source-view) which finds and marks it.
import { useState } from 'react';
import { useApi } from '../lib/api.js';
import { useMeta } from '../lib/filters.jsx';
import { date } from '../lib/format.js';
import { highlightUrl, isPdfLink, pdfViewUrl } from '../lib/highlight.js';
import { Async, Card } from './ui.jsx';

const FIRST = 6;

/** quietly copy the text too (a fallback for pages that hide or changed their text); must run inside the click */
function copyText(text) {
  const box = document.createElement('textarea'); box.value = text; box.setAttribute('readonly', ''); box.style.position = 'fixed'; box.style.opacity = '0';
  document.body.appendChild(box); box.select();
  try { document.execCommand('copy'); } catch { /* not allowed: nothing else to do */ }
  box.remove();
}
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
const safe = (url) => /^https?:\/\//i.test(url);

/** one source button. With text to look for: PDF -> the app's PDF view, web page -> highlight link. Without: the original as it is. */
function SourceLink({ link, label, value, extras = [], a, item, primary }) {
  if (!safe(link.url)) return null;
  const pdf = isPdfLink(link); const find = !!value || extras.length > 0;
  const atPage = link.page && !link.url.includes('#') ? `${link.url}#page=${link.page}` : link.url;
  const href = !find ? atPage : pdf ? pdfViewUrl({ recordId: item.id, link, value, extras, attribute: a?.name || 'Source', skuId: item.skuId }) : highlightUrl(atPage, value, extras);
  const text = label || (find ? (pdf ? 'Open PDF & highlight' : 'Open page & highlight') : (pdf ? 'Open PDF' : 'Open page'));
  return (
    <span className="src-link">
      <a className={`btn small${primary ? ' primary' : ''}`} href={href} target="_blank" rel="noopener noreferrer" title={link.url} onClick={() => value && copyText(value)}>
        {text}{link.page ? ` · page ${link.page}` : ''} ↗</a>
      <span className="src-host">{pdf ? 'PDF · ' : ''}{host(link.url)}</span>
    </span>
  );
}

const noLinks = (s) => String(s || '').replace(/[“”"]?(?:https?:\/\/|www\.)[^\s“”"|<>]+[“”"]?/gi, '').replace(/\s{2,}/g, ' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '');
/** "Source" (or "Extract") in Attribute/Field is not an attribute: the auditor says the SOURCE itself was wrong */
const isSourceName = (n) => /^(source|sources|source ?(url|link|page)|extract|url)$/i.test(String(n).trim());

function Attribute({ a, item }) {
  const own = a.links.filter((l) => safe(l.url));
  const product = item.productLinks.filter((l) => safe(l.url));
  const auditor = a.auditorLinks.filter((l) => safe(l.url));
  const extra = item.auditorLinks.filter((l) => safe(l.url));
  const note = noLinks(a.note);
  let n = 0; const primary = () => n++ === 0;
  return (
    <div className="src-attr">
      <div className="src-name"><span className="src-x" aria-hidden="true">✕</span>{a.name}<span className="src-flag">marked wrong</span></div>
      <dl className="src-facts">
        {note && <><dt>Auditor’s correction</dt><dd className="src-fix">{note}</dd></>}
        <dt>Text on the source</dt>
        <dd>{a.value ? <mark className="src-mark">{a.value}</mark>
          : <span className="muted">{!item.saved ? 'Not in the uploaded file.' : a.matched ? 'No source text was captured for this attribute.' : 'The file has no attribute with this name on this SKU.'}</span>}</dd>
      </dl>
      <div className="src-links">
        {/* 1. the source the auditor checked this attribute against (link written in the auditor's note) */}
        {auditor.map((l, i) => <SourceLink key={`a${i}`} link={l} value={a.value} extras={a.hints} a={a} item={item} primary={primary()} label={`Open auditor’s source${a.value || a.hints.length ? ' & highlight' : ''}`} />)}
        {/* 2. the attribute's own source (where the value was captured) */}
        {own.map((l, i) => <SourceLink key={`o${i}`} link={l} value={a.value} extras={a.hints} a={a} item={item} primary={primary()} label={auditor.length ? 'Source used by the member' : i > 0 ? `Source ${i + 1}` : undefined} />)}
        {/* 3. no own link: the product's pages */}
        {!own.length && product.map((l, i) => <SourceLink key={`p${i}`} link={l} value={a.value} extras={a.hints} a={a} item={item} primary={primary()} label={auditor.length || i > 0 ? `${l.kind === 'pdf' ? 'Product PDF' : 'Product page'}${product.length > 1 ? ` ${i + 1}` : ''}` : undefined} />)}
        {/* 4. a source the auditor pointed to for the whole SKU ("Pls change source URL …") */}
        {!auditor.length && extra.map((l, i) => <SourceLink key={`e${i}`} link={l} value={a.value} extras={a.hints} a={a} item={item} primary={primary()} label={`Auditor’s source${extra.length > 1 ? ` ${i + 1}` : ''}`} />)}
        {n === 0 && <span className="src-note">The file has no source link for this.</span>}
        {n > 0 && !own.length && !auditor.length && product.length > 0 && <span className="src-note">No link for this attribute – using the product’s own page.</span>}
      </div>
    </div>
  );
}

/** the auditor marked the SOURCE wrong (Source error, or "Source" in Attribute/Field): show the correct source they found next to the one used */
function SourceBlock({ item, title = 'Source' }) {
  const found = item.auditorLinks.filter((l) => safe(l.url));
  const used = item.productLinks.filter((l) => safe(l.url) && !found.some((f) => f.url === l.url));
  const note = noLinks(item.comment);
  return (
    <div className="src-attr">
      <div className="src-name"><span className="src-x" aria-hidden="true">✕</span>{title}<span className="src-flag">marked wrong</span></div>
      <dl className="src-facts">
        {note && <><dt>Auditor’s note</dt><dd className="src-fix">{note}</dd></>}
        <dt>Correct source</dt>
        <dd>{found.length ? <span className="src-links tight">{found.map((l, i) => <SourceLink key={i} link={l} item={item} primary label={`Open correct source${found.length > 1 ? ` ${i + 1}` : ''}`} />)}</span>
          : <span className="muted">The auditor did not write a link.</span>}</dd>
        {used.length > 0 && <><dt>Source used</dt><dd><span className="src-links tight">{used.map((l, i) => <SourceLink key={i} link={l} item={item} label={`${l.kind === 'pdf' ? 'Product PDF' : 'Product page'}${used.length > 1 ? ` ${i + 1}` : ''}`} />)}</span></dd></>}
      </dl>
    </div>
  );
}

export default function SourceChecks({ member, params }) {
  const st = useApi(`/api/content-team/${member.id}/source-checks`, params);
  const meta = useMeta();
  const [all, setAll] = useState(false);
  const codeName = (c) => meta?.errorTypes?.find((t) => t.code === c)?.name || c;
  /** one entry per ATTRIBUTE with an error (same rule as "Attributes with errors": one per SKU and attribute) */
  const split = (items) => {
    const rows = []; const seen = new Set(); const other = [];
    for (const item of items) {
      const real = item.attributes.filter((a) => a.isAttribute);
      for (const a of real) { const k = `${item.skuId}|${a.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`; if (!seen.has(k)) { seen.add(k); rows.push({ item, a }); } }
      if (!real.length || item.attributes.some((a) => !a.isAttribute)) other.push(item);
    }
    return { rows, other };
  };
  const typeTag = (item) => (item.codes.length === 1
    ? <span className="tag" title={codeName(item.codes[0])}>{codeName(item.codes[0])}</span>
    : <span className="tag" title="The SKU has several error types; the file does not say which one belongs to this attribute">{item.codes.map(codeName).join(' or ')}</span>);
  return (
    <Card title="Check mistakes at the source" className="mb" info="One entry per attribute the auditor marked wrong (Attribute/Field column) – the same count as “Attributes with errors”. Each shows the auditor’s correction (from Audit Comments), the text the uploaded file captured from the source (Raw Val) and the best source link. Web pages open with that text highlighted by the browser (Chrome, Edge, Firefox); PDFs open in this website’s PDF view with the text marked. Mistakes that are not an attribute (a wrong source, or no attribute named) are listed separately below.">
      <p className="src-how">Click <b>Open &amp; highlight</b>: the source opens in a new tab, scrolled to the text with it highlighted.</p>
      <Async state={st}>{(d) => { const { rows, other } = split(d.items); return (!d.items.length ? <div className="empty">No SKUs with errors in this selection.</div> : (
        <>
          {d.missingFiles.length > 0 && <div className="alert warn mb">No source links saved yet for: {d.missingFiles.join(', ')}. Upload {d.missingFiles.length === 1 ? 'that file' : 'those files'} again on the “Upload Audit Files” page to add them (records are updated, not added twice).</div>}
          <p className="src-count"><b>{rows.length}</b> attribute{rows.length === 1 ? '' : 's'} with errors</p>
          {rows.length > 0 ? (
            <ul className="src-list">
              {(all ? rows : rows.slice(0, FIRST)).map(({ item, a }) => (
                <li key={`${item.id}-${a.name}`} className="src-item">
                  <Attribute a={a} item={item} />
                  <div className="src-meta"><span className="muted small">SKU</span> <b className="src-sku">{item.skuId}</b>{typeTag(item)}<span className="muted small">{date(item.auditDate)}</span></div>
                  {item.comment && <details className="src-comment"><summary>Auditor’s full comment</summary><p>{item.comment}</p></details>}
                </li>))}
            </ul>
          ) : <div className="empty">The auditor did not name an attribute on these SKUs.</div>}
          {rows.length > FIRST && <button type="button" className="btn small link" onClick={() => setAll((v) => !v)}>{all ? 'Show fewer' : `Show all ${rows.length} attributes with errors`}</button>}
          {other.length > 0 && (
            <details className="src-other">
              <summary>Other mistakes – not an attribute ({other.length} SKU{other.length === 1 ? '' : 's'})</summary>
              <ul className="src-list">
                {other.map((item) => (
                  <li key={item.id} className="src-item">
                    <div className="src-head"><b className="src-sku">{item.skuId}</b>{item.codes.map((c) => <span key={c} className="tag" title={codeName(c)}>{codeName(c)}</span>)}<span className="muted small">{date(item.auditDate)}</span></div>
                    {item.attributes.some((a) => !a.isAttribute && isSourceName(a.name)) || (!item.attributes.length && item.auditorLinks.length)
                      ? <SourceBlock item={item} title={item.attributes.find((a) => !a.isAttribute)?.name || 'Source (no attribute named)'} />
                      : item.attributes.filter((a) => !a.isAttribute).length
                        ? item.attributes.filter((a) => !a.isAttribute).map((a) => <div key={a.name} className="src-attr"><div className="src-name"><span className="src-x" aria-hidden="true">✕</span>{a.name}<span className="src-flag">marked wrong</span></div><div className="muted small mt-s">Not an attribute of this SKU in the file.</div></div>)
                        : <div className="src-attr muted">The auditor did not name an attribute for this SKU.</div>}
                    {item.comment && <details className="src-comment"><summary>Auditor’s full comment</summary><p>{item.comment}</p></details>}
                  </li>))}
              </ul>
            </details>
          )}
          <p className="src-foot">If nothing is marked (the website changed or hides its text), the text is already copied: press <kbd>Ctrl</kbd> + <kbd>F</kbd>, <kbd>Ctrl</kbd> + <kbd>V</kbd> on that page.</p>
        </>
      )); }}</Async>
    </Card>
  );
}
