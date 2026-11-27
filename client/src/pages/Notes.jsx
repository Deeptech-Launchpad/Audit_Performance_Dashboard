// Feedback board: Audit Managers note bugs / feature ideas, the developer replies and marks them done.
import { useMemo, useState } from 'react';
import { api, useApi } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { dateTime } from '../lib/format.js';
import { PageHeader, Tabs, Modal, Empty, ErrorBox, Loading, Alert, Icon } from '../components/ui.jsx';
import '../notes.css';

export const KINDS = { bug: ['🐞', 'Bug'], feature: ['✨', 'New feature'], other: ['💬', 'Other'] };
const STATUS = { new: ['info', 'New'], in_progress: ['watch', 'In progress'], done: ['good', 'Done'], wont_do: ['few', 'Won’t do'] };
const PAGES = ['Overview', 'Product Team', 'Category Performance', 'Audit Team', 'Error Analysis', 'PT & Re-Audit', 'Upload Audit Files', 'Weekly Reports', 'Settings', 'Login page', 'Emails', 'Whole website'];
const changed = () => window.dispatchEvent(new Event('notes-changed')); // updates the number on the menu

const Badge = ({ map, k }) => { const [cls, label] = map[k] || ['', k]; return <span className={`badge ${cls || 'plain'}`}>{label}</span>; };

function NoteForm({ note, onClose, onSaved }) {
  const [f, setF] = useState(() => ({ kind: note?.kind || 'bug', details: note?.details || '', page: note?.page || '' }));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { if (note) await api.patch(`/api/notes/${note.id}`, f); else await api.post('/api/notes', f); changed(); onSaved(); }
    catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <Modal title={note ? 'Edit note' : 'New note for the developer'} onClose={onClose}>
      <form onSubmit={save} className="note-form">
        <div className="field"><label>What kind of note?</label>
          <div className="kind-pick" role="radiogroup">{Object.entries(KINDS).map(([k, [ic, label]]) => (
            <button type="button" key={k} role="radio" aria-checked={f.kind === k} className={f.kind === k ? 'on' : ''} onClick={() => setF((x) => ({ ...x, kind: k }))}><span aria-hidden="true">{ic}</span> {label}</button>))}</div></div>
        <div className="field"><label htmlFor="n-page">Which page?</label>
          <select id="n-page" value={f.page} onChange={set('page')} required><option value="" disabled>Choose a page…</option>{PAGES.map((p) => <option key={p}>{p}</option>)}</select></div>
        <div className="field"><label htmlFor="n-details">Notes</label>
          <textarea id="n-details" rows={6} value={f.details} onChange={set('details')} maxLength={5000} required minLength={3} autoFocus
            placeholder={f.kind === 'bug' ? 'What did you do, what happened, and what did you expect? (file name, person, SKU ID… help a lot)' : f.kind === 'feature' ? 'What do you need, and how will it help?' : 'Write your note here.'} /></div>
        {err && <Alert kind="error">{err}</Alert>}
        <div className="row mt"><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : note ? 'Save changes' : 'Add note'}</button><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}

/** The developer's part: reply + change status. */
function Respond({ note, onDone }) {
  const [reply, setReply] = useState(note.reply || ''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const go = async (status) => {
    setBusy(true); setErr(null);
    try { await api.patch(`/api/notes/${note.id}`, { reply, ...(status ? { status } : {}) }); changed(); onDone(); }
    catch (x) { setErr(x.message); setBusy(false); }
  };
  return (
    <div className="respond">
      <label className="small muted" htmlFor={`r-${note.id}`}>Reply to {note.author} (optional)</label>
      <textarea id={`r-${note.id}`} rows={3} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={5000} placeholder="e.g. Fixed – please check the Reports page again." />
      {err && <Alert kind="error">{err}</Alert>}
      <div className="row gap-s mt-s">
        {note.status !== 'in_progress' && <button className="btn small" disabled={busy} onClick={() => go('in_progress')}>▶ Start working</button>}
        {note.status !== 'done' && <button className="btn small primary" disabled={busy} onClick={() => go('done')}>✔ Mark done</button>}
        {note.status !== 'wont_do' && <button className="btn small" disabled={busy} onClick={() => go('wont_do')}>Won’t do</button>}
        {(note.status === 'done' || note.status === 'wont_do') && <button className="btn small" disabled={busy} onClick={() => go('new')}>Re-open</button>}
        <button className="btn small" disabled={busy || reply === (note.reply || '')} onClick={() => go(null)}>Save reply only</button>
        <button className="btn small link" onClick={onDone}>Close</button>
      </div>
    </div>
  );
}

function NoteCard({ note, canManage, onEdit, reload }) {
  const [open, setOpen] = useState(false);
  const [ic, kindLabel] = KINDS[note.kind] || KINDS.other;
  const mayEdit = note.mine && note.status === 'new';
  const del = async () => {
    if (!window.confirm(`Delete note #${note.id}?`)) return;
    try { await api.del(`/api/notes/${note.id}`); changed(); reload(); } catch (x) { window.alert(x.message); }
  };
  return (
    <article className={`note-card card st-${note.status}`}>
      <div className="note-top">
        <span className="note-kind" title={kindLabel} aria-label={kindLabel}>{ic}</span>
        <div className="grow">
          {note.title && <h3 className="note-title">{note.title}</h3>}
          <div className="small muted">#{note.id} · {kindLabel} · by <b>{note.author}</b>{note.mine && ' (you)'} · {dateTime(note.createdAt)}{note.page && <> · Page: <b>{note.page}</b></>}</div>
        </div>
        <div className="note-badges"><Badge map={STATUS} k={note.status} /></div>
      </div>
      {note.details && <p className={`note-details ${note.title ? '' : 'main'}`}>{note.details}</p>}
      {(note.reply || note.doneAt) && (
        <div className="note-reply">
          <b>Developer:</b> {note.reply || <span className="muted">(no reply text)</span>}
          {note.doneAt && <div className="small muted">{note.status === 'done' ? 'Marked done' : 'Closed'} by {note.doneBy || '—'} · {dateTime(note.doneAt)}</div>}
        </div>
      )}
      {open && canManage && <Respond note={note} onDone={() => { setOpen(false); reload(); }} />}
      {!open && (canManage || mayEdit) && (
        <div className="row gap-s note-actions">
          {canManage && <button className="btn small primary" onClick={() => setOpen(true)}>Reply / change status</button>}
          {mayEdit && <button className="btn small" onClick={() => onEdit(note)}>Edit</button>}
          {(canManage || mayEdit) && <button className="btn small danger" onClick={del}>Delete</button>}
        </div>
      )}
    </article>
  );
}

export default function Notes() {
  const { user } = useAuth();
  const st = useApi('/api/notes');
  const [tab, setTab] = useState('open'); const [kind, setKind] = useState(''); const [onlyMine, setOnlyMine] = useState(false);
  const [form, setForm] = useState(null); // null | {} (new) | note (edit)
  const data = st.data;
  const list = useMemo(() => (data?.notes || []).filter((n) =>
    (tab === 'all' || (tab === 'open' ? ['new', 'in_progress'].includes(n.status) : n.status === tab))
    && (!kind || n.kind === kind) && (!onlyMine || n.mine)), [data, tab, kind, onlyMine]);
  const c = data?.counts || {};
  const canManage = !!data?.canManage;
  return (
    <>
      <PageHeader title="Feedback board" subtitle={canManage ? 'Notes from the Audit Managers. Reply, then mark each one done when it is fixed or added.' : 'Found a bug or want something new? Write it here – the developer will reply and mark it done.'}>
        <button className="btn primary" onClick={() => setForm({})}><span aria-hidden="true">＋</span> New note</button>
      </PageHeader>
      <div className="toolbar row mb">
        <Tabs value={tab} onChange={setTab} items={[['open', `Open (${c.open ?? 0})`], ['done', `Done (${c.done ?? 0})`], ['wont_do', `Won’t do (${c.wont_do ?? 0})`], ['all', `All (${c.all ?? 0})`]]} />
        <span className="grow" />
        <select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All types</option>{Object.entries(KINDS).map(([k, [ic, l]]) => <option key={k} value={k}>{ic} {l}</option>)}</select>
        <label className="row gap-s small"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> Only my notes</label>
      </div>
      {st.error ? <ErrorBox error={st.error} retry={st.reload} /> : !data ? <Loading /> : !list.length ? (
        <Empty title={tab === 'open' ? 'No open notes 🎉' : 'Nothing here'}>
          {tab === 'open' ? <>Everything is handled. Found a problem or have an idea? <button className="btn link" onClick={() => setForm({})}>Add a note</button></> : 'Try another tab or filter.'}
        </Empty>
      ) : (
        <div className="note-list">{list.map((n) => <NoteCard key={n.id} note={n} canManage={canManage} onEdit={setForm} reload={st.reload} />)}</div>
      )}
      {!canManage && data && <p className="small muted mt"><Icon name="info" size={13} /> You can edit or delete your own note until the developer starts on it. Signed in as {user.name}.</p>}
      {form && <NoteForm note={form.id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); st.reload(); }} />}
    </>
  );
}
