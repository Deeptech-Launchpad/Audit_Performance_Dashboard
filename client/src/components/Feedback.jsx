// Personal feedback for one product team member: their numbers, suggestions based on THEIR errors, the SKUs to re-check,
// and a message ready to send (email, copy, PDF).
import { useEffect, useState } from 'react';
import { api, download, useApi } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { date, pct } from '../lib/format.js';
import { Alert, Async, Card, Drawer, Icon, Kpi, LevelBadge } from './ui.jsx';
import { CodeTags, useDetails } from './Details.jsx';

const DOT = { high: '!', medium: '•', low: 'i', good: '✔' };

export default function FeedbackDrawer({ member, params, onClose }) {
  const { can } = useAuth(); const { openSku } = useDetails();
  const q = Object.fromEntries(['from', 'to', 'week', 'month'].filter((k) => params[k]).map((k) => [k, params[k]]));
  const st = useApi(`/api/feedback/${member.id}`, q);
  const mailSt = useApi('/api/feedback/mail/status'); const mailReady = !!mailSt.data?.ready;
  const [msg, setMsg] = useState(''); const [email, setEmail] = useState(''); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [sending, setSending] = useState(false);
  const send = async () => {
    if (!email.trim()) return flash('error', `Type ${member.name}'s email address first.`);
    setSending(true);
    try { const r = await api.post(`/api/feedback/${member.id}/send${Object.keys(q).length ? '?' + new URLSearchParams(q) : ''}`, { email: email.trim(), message: msg }); flash('ok', `Email sent to ${r.to}, with the PDF report attached.`); }
    catch (e) { flash('error', e.message); }
    setSending(false);
  };
  useEffect(() => { if (st.data) { setMsg(st.data.message); setEmail(st.data.email || ''); } }, [st.data]);
  const flash = (kind, text) => { setNote({ kind, text }); setTimeout(() => setNote(null), 6000); };

  const saveEmail = async () => {
    try { await api.put(`/api/feedback/${member.id}/email`, { email }); flash('ok', email ? 'Email address saved for next time.' : 'Email address removed.'); } catch (e) { flash('error', e.message); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(msg); flash('ok', 'Message copied. Paste it into an email or chat.'); } catch { flash('error', 'Could not copy. Select the text and copy it with Ctrl+C.'); } };
  const pdf = async () => { setBusy(true); try { await download(`/api/feedback/${member.id}/pdf`, q, 'audit-feedback.pdf'); } catch (e) { flash('error', e.message); } finally { setBusy(false); } };
  return (
    <Drawer title={member.level === 'good' ? `🎉 Appreciation for ${member.name}` : `Feedback for ${member.name}`} onClose={onClose} wide>
      <Async state={st}>{(d) => (
        <>
          <p className="muted" style={{ marginTop: 0 }}>Period: <b>{d.period.label}</b>. Everything below is calculated from {member.name}'s own audit records.</p>
          <div className="row gap-s mb"><LevelBadge level={d.member.level} />{d.member.rank && <span className="muted">Rank {d.member.rank}</span>}</div>
          <div className="grid g-kpi mb">
            <Kpi label="SKUs audited" value={d.member.samples} />
            <Kpi label="SKUs with errors" value={d.member.errorSkus} sub={`Error % ${pct(d.member.errorRate)}`} tone={d.member.level === 'improve' ? 'improve' : d.member.level === 'good' ? 'good' : undefined} info={`Target: ${d.target}% or lower`} />
            <Kpi label="Error classifications" value={d.member.classifications} info="Each mistake recorded on a SKU is one classification. One SKU can have several, so this can be higher than the number of SKUs with errors." />
          </div>
          <div className="grid g-kpi mb">
            <Kpi label="Attributes enriched" value={d.member.attrsAvailable ? d.member.attrsEnriched : 'Not available'} info="Attributes with a value on this person's SKUs. Not available when the uploaded file has no attribute columns." />
            <Kpi label="Attributes audited" value={d.member.attrsAvailable ? d.member.attrsAudited : 'Not available'} info="Enriched attributes of the audited SKUs plus attributes the auditor said were left empty." />
            <Kpi label="Attributes with errors" value={d.member.attrErrors} sub={d.member.attrsAvailable ? `Attribute error % ${pct(d.member.attrErrorRate)}` : undefined} info="Attributes the auditor marked wrong. One attribute on one SKU counts once." />
          </div>

          <Card title="Suggestions" className="mb" info="Rules applied to this person's real numbers. Each one shows the figures behind it; nothing is guessed.">
            {d.suggestions.length ? d.suggestions.map((x) => (
              <div key={x.id} className={`sugg ${x.severity}`}><span className="dot">{DOT[x.severity]}</span>
                <div><div className="t">{x.title}</div><div className="d">{x.detail}</div>{x.action && <div className="a"><b>Suggested:</b> {x.action}</div>}</div></div>
            )) : <div className="empty">No suggestions – nothing crossed a rule in this period.</div>}
          </Card>

          <Card title={`SKUs to check (${d.skusToCheck.length})`} className="mb" info="Audited SKUs of this person that have at least one error. Click a SKU for its full audit history.">
            {d.skusToCheck.length ? (
              <div className="tbl-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}><table className="tbl">
                <thead><tr><th>SKU</th><th>Error</th><th>Field</th><th>Audit comment</th></tr></thead>
                <tbody>{d.skusToCheck.map((s, i) => (
                  <tr key={i} className="clickable" onClick={() => openSku(s.skuId)}><td><b>{s.skuId}</b><div className="small muted">{date(s.auditDate)}</div></td><td><CodeTags codes={s.codes} /></td><td><div className="clip">{s.attribute}</div></td><td><div className="clip">{s.comment}</div></td></tr>))}</tbody>
              </table></div>
            ) : <div className="empty">No SKUs with errors.</div>}
          </Card>

          {d.kind === 'appreciation' && <div className="mb"><Alert kind="ok"><b>{member.name} achieved the target.</b> The message below is a thank-you and congratulations note with their own results.</Alert></div>}
          <Card title={d.kind === 'appreciation' ? 'Appreciation message' : 'Message'} info="Edit it if you like. The same text is used when you send it or copy it.">
            {note && <div className={`alert ${note.kind === 'ok' ? 'ok' : note.kind === 'warn' ? 'warn' : 'error'} mb`} role="status"><div>{note.text}</div></div>}
            <textarea rows={14} value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Feedback message" style={{ fontFamily: 'inherit' }} />
            {can('report') ? (
              <div className="row mt-s">
                <div className="field grow" style={{ minWidth: 220 }}><label htmlFor="fb-email">Email address of {member.name} (optional)</label>
                  <input id="fb-email" type="text" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" /></div>
                <button className="btn" onClick={saveEmail} disabled={email === (d.email || '')}>Save address</button>
              </div>
            ) : <p className="muted small">Only an Audit Team Leader, Audit Manager or Admin can send feedback.</p>}
            <div className="row mt-s">
              {can('report') && <button className="btn primary" onClick={mailReady ? send : () => flash('error', 'Email sending is not finished yet: an Admin needs to save the email password in Settings → Email (then send a test email).')} disabled={sending}>{sending ? 'Sending…' : '✉ Send email'}</button>}
              <button className="btn" onClick={copy}>Copy message</button>
              <button className="btn" onClick={pdf} disabled={busy}><Icon name="download" /> {busy ? 'Preparing…' : 'Download PDF report'}</button>
            </div>
            <Alert kind={mailReady ? 'info' : 'warn'}><span className="small">{mailReady
              ? <>“Send email” sends this message from the dashboard to the address above, with the PDF report attached. Subject: “{d.subject}”.</>
              : <>Email sending is almost ready – the email password still has to be saved in <b>Settings → Email</b>. After that, “Send email” sends this message with the PDF report attached.</>}</span></Alert>
          </Card>
        </>)}</Async>
    </Drawer>
  );
}
