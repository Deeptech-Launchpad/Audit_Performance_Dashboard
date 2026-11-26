// "Check mistakes at the source" (Product Team page). A pure lookup, nothing is worked out or guessed:
//   which attributes the auditor named on the SKUs with errors (column F)  +  what the uploaded file holds for exactly that attribute
//   + the part of the auditor's comment (column G) that is written for that attribute.
import { sourceKey } from './parser.js';
import { HttpError } from '../lib/http.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** the attribute name as a loose pattern: "Operating Pressure – Maximum" also matches "Operating Pressure - Maximum" */
const namePattern = (name) => String(name).trim().split(/[^A-Za-z0-9]+/).filter(Boolean).map(esc).join('[^A-Za-z0-9]+');

/**
 * The auditor's words for ONE attribute, taken from the whole audit comment. Auditors write e.g.
 *   "Container Size>>1 gal|Features>>Pls Capture from Salsify URL"   or   "<Overall Width> 10 in, <Overall Height> 9 in"
 * Returns '' when the comment does not name the attribute in one of these ways (nothing is guessed).
 */
export function noteFor(comment, name) {
  const text = String(comment || ''); const pat = namePattern(name);
  if (!text || !pat) return '';
  const m = new RegExp(`(?:^|[|<,;\\n]\\s*)${pat}\\s*(?:>>?|:|=)\\s*`, 'i').exec(text);
  if (!m) return '';
  let rest = text.slice(m.index + m[0].length);
  const cut = /\||<|\n|,\s*,|,\s*[^,<>|\n]{2,60}>/.exec(rest); if (cut) rest = rest.slice(0, cut.index);
  return rest.replace(/^[\s>:=-]+|[\s,;]+$/g, '').slice(0, 300);
}

/** web links the auditor wrote in a comment ("Found-https://…pdf", "refer pdf “https://…”"); cut-off or broken ones are dropped */
export function commentLinks(text) {
  const out = [];
  for (const raw of String(text || '').match(/(?:https?:\/\/|www\.)[^\s“”"'’‘|<>]+/gi) || []) {
    const u = (/^www\./i.test(raw) ? `https://${raw}` : raw).replace(/[.,;:)\]]+$/, '');
    try { const x = new URL(u); if (/^https?:$/.test(x.protocol) && x.hostname.includes('.') && !out.includes(u)) out.push(u); } catch { /* not a usable link */ }
  }
  return out.slice(0, 5);
}
const PAGE_RE = /(?:page(?:\s*(?:number|no\.?))?|pg\.?\s*no\.?|pgno|pg)\s*[:#.-]?\s*(\d{1,4})/i;
/** "… missing page number 47 “https://…pdf”" -> 47 */
const notePage = (note) => { const m = PAGE_RE.exec(String(note || '')); return m ? Number(m[1]) : null; };
const INSTRUCTION = /\b(pls|please|capture|refer|change|add|create|missing|check|remove|decision|valid|flag|recheck|found|given|kindly|query|as per|from|based)\b/i;
/** words from the auditor's note worth looking for on the source: quoted text, or a short plain value such as "10 in" */
export function noteHints(note) {
  const n = String(note || ''); const out = [];
  for (const m of n.matchAll(/[“”"]([^“”"]{2,200})[“”"]/g)) { const t = m[1].trim(); if (t && !/^(https?:|www\.)/i.test(t) && !out.includes(t)) out.push(t); }
  const plain = n.replace(/(?:https?:\/\/|www\.)\S+/gi, '').trim();
  if (!out.length && plain && plain.length <= 30 && !INSTRUCTION.test(plain)) out.push(plain);
  return out.slice(0, 4);
}

/** recs = the records of ONE Product Team member, already filtered. Only audited records with a real error are listed. */
export async function sourceChecks(db, recs) {
  const wrong = recs.filter((r) => r.sampled && r.errs.length);
  const stored = new Map();
  for (let i = 0; i < wrong.length; i += 400) {
    const ids = wrong.slice(i, i + 400).map((r) => r.id);
    const rows = await db.all(`SELECT r.id, r.source_info, r.audit_comments, u.original_name AS file FROM audit_records r JOIN uploads u ON u.id = r.upload_id WHERE r.id IN (${ids.map(() => '?').join(',')})`, ids);
    for (const row of rows) stored.set(row.id, row);
  }
  const missingFiles = new Set();
  const items = wrong.map((r) => {
    const row = stored.get(r.id);
    let info = null; try { info = row?.source_info ? JSON.parse(row.source_info) : null; } catch { info = null; }
    if (!info && r.attrs.length && row) missingFiles.add(row.file); // uploaded before source links were saved, or the file has none
    const comment = String(row?.audit_comments || '').trim();
    const used = new Set();
    const isAttr = new Map((r.attrInfo || []).map((a) => [a.name, a.isAttribute]));
    const attributes = r.attrs.map((name) => {
      const hit = info?.attrs?.[sourceKey(name)];
      const isAttribute = isAttr.get(name) ?? !!hit; // a real attribute of the SKU (counted in "Attributes with errors"), not "Source", "All" …
      const note = noteFor(comment, name);
      // a link inside the auditor's note for this attribute = the source the auditor checked it against (the correct one)
      const auditorLinks = commentLinks(note).map((url) => { used.add(url); return { url, page: notePage(note) }; });
      return { name, isAttribute, matched: !!hit, value: hit?.value || '', links: hit?.links || [], note, auditorLinks, hints: noteHints(note) };
    });
    // links in the comment that are not tied to one attribute, e.g. a Source error: "Found-https://…" = the correct source the auditor found
    const auditorLinks = commentLinks(comment).filter((u) => !used.has(u)).map((url) => ({ url, page: null }));
    return { id: r.id, skuId: r.skuId, auditDate: r.auditDate, codes: r.errs, saved: !!info, attributes, productLinks: info?.product || [], auditorLinks, comment: comment.slice(0, 2000) };
  });
  items.sort((a, b) => b.auditDate.localeCompare(a.auditDate) || a.skuId.localeCompare(b.skuId) || a.id - b.id);
  return { items, missingFiles: [...missingFiles].sort() };
}

/* ---------------------------------------------------------------------------------------------------------------
   PDF for the in-app "find and highlight" view. Browsers cannot mark text inside a PDF from a link, so the app shows the PDF itself.
   Only a link that is saved for that record can be fetched (no other address), only http/https, only public hosts, only real PDFs.
--------------------------------------------------------------------------------------------------------------- */
const MAX_BYTES = 120 * 1024 * 1024;
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:)/i;
const publicUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && !PRIVATE_HOST.test(x.hostname); } catch { return false; } };

export async function fetchSourcePdf(db, recordId, url) {
  const row = await db.get('SELECT source_info, audit_comments FROM audit_records WHERE id = ?', [recordId]);
  let info = null; try { info = row?.source_info ? JSON.parse(row.source_info) : null; } catch { info = null; }
  const saved = new Set([...Object.values(info?.attrs || {}).flatMap((a) => (a.links || []).map((l) => l.url)), ...(info?.product || []).map((l) => l.url), ...commentLinks(row?.audit_comments)]);
  if (!saved.has(url)) throw new HttpError(404, 'This link is not saved for this SKU.');
  if (!publicUrl(url)) throw new HttpError(400, 'This link cannot be opened here.');
  // Some sites cut the connection when a program claims to be Chrome but does not connect like Chrome (e.g. clevelandcontrols.com),
  // others refuse anything that does not look like a browser. So: a plain request first, then a browser-like one.
  const tries = [{}, { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', accept: 'application/pdf,*/*' }, { 'user-agent': 'curl/8.9.1', accept: '*/*' }];
  let last = new HttpError(502, 'The source website did not answer.');
  for (const headers of tries) {
    try { return await getPdf(url, headers); } catch (e) { last = e; if (e.status === 400 || e.status === 413) break; }
  }
  throw last;
}

async function getPdf(url, headers) {
  const stop = new AbortController(); const timer = setTimeout(() => stop.abort(), 75000); // big catalogues take a while
  try {
    let res;
    try { res = await fetch(url, { signal: stop.signal, redirect: 'follow', headers }); } catch { throw new HttpError(502, 'The source website did not answer.'); }
    if (!publicUrl(res.url || url)) throw new HttpError(400, 'This link cannot be opened here.');
    if (!res.ok) throw new HttpError(502, `The source website refused the request (${res.status}).`);
    const chunks = []; let size = 0;
    try {
      for await (const c of res.body) { size += c.length; if (size > MAX_BYTES) throw new HttpError(413, 'This PDF is too large to show here.'); chunks.push(c); }
    } catch (e) { throw e instanceof HttpError ? e : new HttpError(502, 'The source website stopped sending the file.'); }
    const buf = Buffer.concat(chunks);
    if (buf.subarray(0, 1024).indexOf('%PDF-') < 0) throw new HttpError(415, 'This link is not a PDF.');
    return buf;
  } finally { clearTimeout(timer); }
}
