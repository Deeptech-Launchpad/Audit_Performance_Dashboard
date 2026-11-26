// The original source PDF with the captured value found and marked in yellow (opened from "Check mistakes at the source").
// The PDF is the supplier's own file, fetched as it is; nothing in it is changed. Loaded only when this page is opened.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { api } from '../lib/api.js';
import { searchTerms } from '../lib/highlight.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** loose comparison: ignores case, spaces, ® ™ ©, and treats curly quotes / long dashes like plain ones */
const loose = (ch) => {
  const c = ch.toLowerCase();
  if (/\s/.test(c) || '®™©'.includes(c)) return '';
  if ('“”″„'.includes(c)) return '"';
  if ('‘’′'.includes(c)) return "'";
  if ('‐‑‒–—'.includes(c)) return '-';
  return c;
};
const looseText = (s) => [...String(s)].map(loose).join('');
/** page text in loose form + where each loose character came from (text piece, character) */
function indexItems(items) {
  const chars = []; const map = [];
  items.forEach((it, i) => { [...it.str].forEach((ch, k) => { for (const x of loose(ch)) { chars.push(x); map.push([i, k]); } }); });
  return { text: chars.join(''), map };
}
function findAll(idx, term) {
  const t = looseText(term); const out = []; if (t.length < 2) return out;
  for (let at = idx.text.indexOf(t); at >= 0 && out.length < 20; at = idx.text.indexOf(t, at + t.length)) out.push([at, at + t.length]);
  return out;
}

export default function SourceView() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const rec = q.get('rec'); const url = q.get('u') || ''; const filePage = parseInt(q.get('p'), 10) || null;
  const value = q.get('v') || ''; const attribute = q.get('a') || ''; const sku = q.get('s') || '';
  const extras = useMemo(() => (q.get('x') || '').split('\n').map((s) => s.trim()).filter((s) => s.length >= 2), [q]);
  const terms = useMemo(() => [...searchTerms(value), ...extras.filter((x) => !searchTerms(value).includes(x))], [value, extras]);
  const [doc, setDoc] = useState(null); const [error, setError] = useState(null);
  const [pages, setPages] = useState(null);          // loose text of every page
  const [hit, setHit] = useState(null);              // { page, term } or { page: null }
  const [page, setPage] = useState(null);
  const canvasRef = useRef(null); const marksRef = useRef(null); const [marks, setMarks] = useState([]);

  useEffect(() => { document.title = `${attribute || 'Source'} – ${sku || 'PDF'}`; }, [attribute, sku]);

  // 1. fetch the PDF through the app (the server only fetches links saved for this SKU)
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const res = await api.get('/api/source-file', { rec, u: url });
        const data = new Uint8Array(await res.arrayBuffer());
        const d = await pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 }).promise;
        if (!gone) setDoc(d);
      } catch (e) { if (!gone) setError(e?.message || 'The PDF could not be opened.'); }
    })();
    return () => { gone = true; };
  }, [rec, url]);

  // 2. read the text of every page, then look for the value: the page written in the file first, then all others
  useEffect(() => {
    if (!doc) return; let gone = false;
    (async () => {
      const all = [];
      for (let p = 1; p <= doc.numPages; p++) { const tc = await (await doc.getPage(p)).getTextContent(); all.push(tc.items.filter((x) => 'str' in x)); if (gone) return; }
      const idx = all.map(indexItems);
      const order = [...(filePage && filePage <= doc.numPages ? [filePage] : []), ...idx.map((_, i) => i + 1).filter((p) => p !== filePage)];
      let found = { page: null, term: null };
      outer: for (const term of terms) for (const p of order) if (findAll(idx[p - 1], term).length) { found = { page: p, term }; break outer; }
      if (gone) return;
      setPages(all.map((items, i) => ({ items, idx: idx[i] }))); setHit(found);
      setPage(found.page || (filePage && filePage <= doc.numPages ? filePage : 1));
    })().catch((e) => !gone && setError(e?.message || 'The PDF could not be read.'));
    return () => { gone = true; };
  }, [doc, filePage, terms]);

  // 3. draw the page and the yellow marks
  useEffect(() => {
    if (!doc || !page || !pages) return; let gone = false; let task;
    setMarks([]);
    (async () => {
      const pg = await doc.getPage(page);
      const width = Math.min(1100, document.documentElement.clientWidth - 32);
      const base = pg.getViewport({ scale: 1 }); const vp = pg.getViewport({ scale: width / base.width });
      const ratio = window.devicePixelRatio || 1; const c = canvasRef.current; if (!c || gone) return;
      c.width = Math.floor(vp.width * ratio); c.height = Math.floor(vp.height * ratio); c.style.width = `${vp.width}px`; c.style.height = `${vp.height}px`;
      task = pg.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      await task.promise;
      const { items, idx } = pages[page - 1]; const out = [];
      for (const [s, e] of hit?.term ? findAll(idx, hit.term) : []) {
        const byItem = new Map();
        for (let k = s; k < e; k++) { const [i, ch] = idx.map[k]; const r = byItem.get(i) || [ch, ch]; byItem.set(i, [Math.min(r[0], ch), Math.max(r[1], ch)]); }
        for (const [i, [a, b]] of byItem) {
          const it = items[i]; const len = Math.max(1, it.str.length);
          const tx = pdfjs.Util.transform(vp.transform, it.transform); const h = Math.hypot(tx[2], tx[3]); const w = it.width * vp.scale;
          out.push({ left: tx[4] + (w * a) / len, top: tx[5] - h, width: Math.max(4, (w * (b + 1 - a)) / len), height: h * 1.2 });
        }
      }
      if (!gone) setMarks(out);
    })().catch((e) => { if (!gone && e?.name !== 'RenderingCancelledException') setError(e?.message || 'The page could not be drawn.'); });
    return () => { gone = true; try { task?.cancel(); } catch { /* ignore */ } };
  }, [doc, page, pages, hit]);

  useEffect(() => { if (marks.length) marksRef.current?.firstChild?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [marks]);

  const original = filePage && !url.includes('#') ? `${url}#page=${filePage}` : url;
  const n = doc?.numPages || 0;
  // the website does not let the app read its PDF: open the original PDF itself (the right page) instead of leaving an error
  useEffect(() => {
    if (!error || !/^https?:\/\//i.test(url)) return undefined;
    const t = setTimeout(() => window.location.replace(original), 1800);
    return () => clearTimeout(t);
  }, [error, url, original]);
  return (
    <div className="sv">
      <header className="sv-bar">
        <div className="sv-what">
          <div className="sv-title">{attribute || 'Source'}{sku && <span className="sv-sku">SKU {sku}</span>}</div>
          {value && <div className="sv-look">Text from the source: <mark>{value.length > 160 ? `${value.slice(0, 158)}…` : value}</mark></div>}
          {extras.length > 0 && <div className="sv-look">Auditor’s words: {extras.map((x, i) => <mark key={i} style={{ marginRight: 6 }}>{x.length > 80 ? `${x.slice(0, 78)}…` : x}</mark>)}</div>}
          <div className="sv-status" role="status">
            {error ? <span className="sv-bad">{error} This website does not let the app read its PDF, so the text cannot be marked here. Opening the original PDF{filePage ? ` at page ${filePage}` : ''}…</span>
              : !hit ? 'Opening the PDF and looking for the text…'
                : hit.page ? <span className="sv-good">✔ Found on page {hit.page}{filePage && filePage !== hit.page ? ` (the file says page ${filePage})` : ''} – marked in yellow.</span>
                  : !terms.length ? <span>Showing page {page}{filePage ? ' as written in the file' : ''} (there is no text to look for).</span>
                  : <span className="sv-bad">This text was not found in the PDF (it may be a scanned picture, or worded differently). Showing page {page}{filePage ? ' as written in the file' : ''}.</span>}
          </div>
        </div>
        <div className="sv-tools">
          {n > 0 && <>
            <button className="btn small" disabled={!page || page <= 1} onClick={() => setPage((p) => p - 1)}>◀</button>
            <span className="sv-page">Page {page || '–'} of {n}</span>
            <button className="btn small" disabled={!page || page >= n} onClick={() => setPage((p) => p + 1)}>▶</button>
          </>}
          {/^https?:\/\//i.test(url) && <a className="btn small" href={original} target="_blank" rel="noopener noreferrer">Open original PDF ↗</a>}
        </div>
      </header>
      {!error && (
        <div className="sv-sheet">
          <div className="sv-canvas-wrap">
            <canvas ref={canvasRef} />
            <div ref={marksRef} className="sv-marks">{marks.map((m, i) => <span key={i} style={{ left: m.left, top: m.top, width: m.width, height: m.height }} />)}</div>
          </div>
        </div>
      )}
      {error && /^https?:\/\//i.test(url) && <p className="sv-fallback">You can still open the original: <a href={original} target="_blank" rel="noopener noreferrer">{url}</a></p>}
    </div>
  );
}
