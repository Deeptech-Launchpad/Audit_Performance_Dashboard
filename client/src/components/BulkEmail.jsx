// Admin: send one personal email to everyone in a group at once.
//   achieved = appreciation to everyone with the lowest error rate;  improve = feedback to everyone with a high error rate.
// Each person gets THEIR OWN message and PDF report (the same as the Feedback window), never one shared text.
import { useEffect, useState } from 'react';
import { api, useApi } from '../lib/api.js';
import { pct } from '../lib/format.js';
import { Alert, Async, Modal } from './ui.jsx';

const GROUP = {
  achieved: { title: '🎉 Appreciation email – lowest error rate', intro: 'Everyone with the lowest error rate gets a personal congratulations email with their own results and their PDF report.' },
  improve: { title: '✉ Feedback email – high error rate', intro: 'Everyone with a high error rate gets their personal feedback email: their numbers, what to work on and the SKUs to check, with their PDF report.' },
};
const okEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

export default function BulkEmail({ group, params, onClose }) {
  const q = Object.fromEntries(['from', 'to', 'week', 'month'].filter((k) => params[k]).map((k) => [k, params[k]]));
  const qs = Object.keys(q).length ? `?${new URLSearchParams(q)}` : '';
  const st = useApi(`/api/feedback/bulk/${group}`, q);
  const [pick, setPick] = useState({}); const [mails, setMails] = useState({}); const [busy, setBusy] = useState(false); const [res, setRes] = useState(null); const [err, setErr] = useState('');
  useEffect(() => { if (st.data) { setPick(Object.fromEntries(st.data.members.map((m) => [m.id, true]))); setMails(Object.fromEntries(st.data.members.map((m) => [m.id, m.email]))); } }, [st.data]);

  async function send() {
    const list = st.data.members.filter((m) => pick[m.id]);
    if (!window.confirm(`Send ${list.length} personal email${list.length === 1 ? '' : 's'} now?`)) return;
    setBusy(true); setErr(''); setRes(null);
    try {
      const emails = Object.fromEntries(list.map((m) => [String(m.id), String(mails[m.id] || '').trim()]).filter(([, v]) => v));
      setRes(await api.post(`/api/feedback/bulk/${group}${qs}`, { ids: list.map((m) => m.id), emails }));
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  return (
    <Modal title={GROUP[group].title} onClose={onClose}>
      <Async state={st}>{(d) => {
        const chosen = d.members.filter((m) => pick[m.id]);
        const missing = chosen.filter((m) => !okEmail(mails[m.id]));
        return (
          <>
            <p className="muted" style={{ marginTop: 0 }}>{GROUP[group].intro} The period is the one chosen in the filters{q.week || q.month || q.from ? '' : ' (all dates)'}.</p>
            {!d.mail && <div className="mb"><Alert kind="warn">Email sending is not set up yet. Add your mail server in <b>Settings → Email</b> first, then come back here.</Alert></div>}
            {!d.members.length ? <div className="empty">Nobody is in this group for the chosen period.</div> : (
              <div className="tbl-wrap" style={{ maxHeight: '48vh', overflowY: 'auto' }}><table className="tbl">
                <thead><tr><th><input type="checkbox" aria-label="Select everyone" checked={chosen.length === d.members.length} onChange={(e) => setPick(Object.fromEntries(d.members.map((m) => [m.id, e.target.checked])))} /></th><th>Name</th><th className="num">Error %</th><th>Email address</th><th>Result</th></tr></thead>
                <tbody>{d.members.map((m) => {
                  const r = res?.results.find((x) => x.id === m.id);
                  return (
                    <tr key={m.id}>
                      <td><input type="checkbox" aria-label={`Send to ${m.name}`} checked={!!pick[m.id]} onChange={(e) => setPick({ ...pick, [m.id]: e.target.checked })} /></td>
                      <td><b>{m.name}</b><div className="small muted">{m.errorSkus} of {m.samples} audited SKUs had errors</div></td>
                      <td className="num">{pct(m.errorRate)}</td>
                      <td><input type="text" inputMode="email" aria-label={`Email of ${m.name}`} value={mails[m.id] || ''} onChange={(e) => setMails({ ...mails, [m.id]: e.target.value })} placeholder="name@company.com"
                        style={{ width: '100%', minWidth: 200, borderColor: pick[m.id] && !okEmail(mails[m.id]) ? 'var(--improve)' : undefined }} /></td>
                      <td className="small">{r ? (r.ok ? <span className="badge good">✔ Sent</span> : <span className="badge improve" title={r.error}>Not sent – {r.error}</span>) : <span className="muted">—</span>}</td>
                    </tr>);
                })}</tbody>
              </table></div>
            )}
            {missing.length > 0 && <p className="small" style={{ color: 'var(--improve)' }}>{missing.length} selected {missing.length === 1 ? 'person has' : 'people have'} no valid email address – type it in (it is saved for next time) or untick them.</p>}
            {err && <div className="mt-s"><Alert kind="error">{err}</Alert></div>}
            {res && <div className="mt-s"><Alert kind={res.failed ? 'warn' : 'ok'}>{res.sent} email{res.sent === 1 ? '' : 's'} sent{res.failed ? `, ${res.failed} not sent (see the Result column)` : ''}.</Alert></div>}
            <div className="row mt">
              <button className="btn primary" onClick={send} disabled={busy || !d.mail || !chosen.length || missing.length > 0}>{busy ? 'Sending…' : `Send ${chosen.length} email${chosen.length === 1 ? '' : 's'}`}</button>
              <button className="btn" onClick={onClose}>{res ? 'Close' : 'Cancel'}</button>
              <span className="muted small">Each email has the person's own numbers and their PDF report attached. To check one message first, use the person's Feedback button.</span>
            </div>
          </>
        );
      }}</Async>
    </Modal>
  );
}
