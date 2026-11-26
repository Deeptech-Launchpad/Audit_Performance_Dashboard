// One search box for the whole app: people (product team and auditors), projects, files and SKU IDs.
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { date } from '../lib/format.js';
import { Icon } from './ui.jsx';
import { useDetails } from './Details.jsx';

const FILTERABLE = ['/', '/content', '/audit', '/errors', '/follow-ups']; // pages that have the filter bar

export default function SearchBox() {
  const [q, setQ] = useState(''); const [res, setRes] = useState(null); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const box = useRef(); const nav = useNavigate(); const loc = useLocation(); const { openSku } = useDetails();

  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return undefined; }
    let live = true; setBusy(true);
    const t = setTimeout(() => api.get('/api/search', { q: q.trim() }).then((r) => { if (live) { setRes(r); setBusy(false); } }).catch(() => { if (live) { setRes(null); setBusy(false); } }), 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  useEffect(() => {
    const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
  }, []);

  // keep the current filters, change only what was picked
  const go = (path, patch) => {
    const p = new URLSearchParams(loc.search);
    for (const [k, v] of Object.entries(patch)) { if (v === '') p.delete(k); else p.set(k, v); }
    nav({ pathname: path, search: p.toString() ? `?${p}` : '' });
  };
  const done = () => { setOpen(false); setQ(''); setRes(null); };
  const page = FILTERABLE.includes(loc.pathname) ? loc.pathname : '/';
  const pick = {
    person: (p) => (p.role === 'auditor' ? go('/audit', { auditorId: String(p.id), builderId: '' }) : go('/content', { builderId: String(p.id), auditorId: '' })),
    project: (p) => go(page, { project: p.name }),
    file: (f) => go(page, { uploadId: String(f.id) }),
    sku: (s) => openSku(s.skuId),
  };
  const choose = (kind, item) => { pick[kind](item); done(); };

  const groups = res ? [
    ['People', res.people.map((p) => ({ key: `p${p.id}${p.role}`, kind: 'person', item: p, label: p.name, hint: p.role === 'auditor' ? 'Auditor' : 'Product team member' }))],
    ['Projects', res.projects.map((p) => ({ key: `pr${p.name}`, kind: 'project', item: p, label: p.name, hint: `${p.files} file${p.files === 1 ? '' : 's'}` }))],
    ['Files', res.files.map((f) => ({ key: `f${f.id}`, kind: 'file', item: f, label: f.name, hint: date(f.auditDate) }))],
    ['SKUs', res.skus.map((s) => ({ key: `s${s.skuId}${s.builder}`, kind: 'sku', item: s, label: s.skuId, hint: s.builder || '' }))],
  ].filter(([, items]) => items.length) : [];

  return (
    <div className="search" ref={box} role="search">
      <Icon name="search" size={16} />
      <input type="search" value={q} placeholder="Search a person, project, file or SKU ID…" aria-label="Search"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} />
      {open && q.trim().length >= 2 && (
        <div className="search-pop" role="listbox">
          {busy && !res && <div className="search-empty">Searching…</div>}
          {res && !groups.length && <div className="search-empty">Nothing found for “{q.trim()}”.</div>}
          {groups.map(([title, items]) => (
            <div key={title}><div className="search-h">{title}</div>
              {items.map((x) => <button key={x.key} role="option" className="search-item" onClick={() => choose(x.kind, x.item)}><span className="clip1">{x.label}</span><span className="muted small">{x.hint}</span></button>)}
            </div>))}
        </div>)}
    </div>
  );
}
