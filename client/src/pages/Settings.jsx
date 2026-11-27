import { useEffect, useState } from 'react';
import { api, useApi } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { useMeta } from '../lib/filters.jsx';
import { ROLE_LABEL } from '../lib/format.js';
import { Alert, Async, Card, Info, PageHeader, PasswordInput, Tabs } from '../components/ui.jsx';

const NUM_FIELDS = [
  ['errorTargetPct', 'Error rate (%)', 'A product team member has the “Lowest error rate” when their error percentage is at or below this number.'],
  ['watchMarginPct', 'Warning margin (points)', 'Up to “error rate + this margin” is shown as “Moderate error rate”. Above it is “High error rate”.'],
  ['minSample', 'Minimum audited SKUs', 'With fewer audited SKUs than this, a person’s percentage is shown as “Too few samples” because it is not reliable yet.'],
  ['ageingWarnDays', 'Call out pending cases older than (days)', 'Pending PT or re-audit cases older than this many days are highlighted.'],
  ['weeklyReportHour', 'Create Monday report at hour (0–23)', 'Hour of the day from which Monday’s weekly report (for the Monday–Saturday week just finished) is created.'],
];

function Msg({ m }) { return m ? <div className="mt-s"><Alert kind={m.kind}>{m.text}</Alert></div> : null; }

/* ------------------------------ Rules ------------------------------ */
function Rules({ data, editable, onSaved }) {
  const s = data.settings;
  const [f, setF] = useState(() => ({ ...s, ...Object.fromEntries(NUM_FIELDS.map(([k]) => [k, String(s[k])])), okWords: (s.reauditOkWords || []).join(', ') }));
  const [map, setMap] = useState(() => Object.entries(s.ptStatusMap || {}));
  const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e.preventDefault(); setMsg(null);
    // (the time zone and the per-category minimum are no longer on this page: the server keeps the values it already has)
    const body = {
      blankPtIsPending: !!f.blankPtIsPending, countErrorsAfterReaudit: !!f.countErrorsAfterReaudit, dedupeIncludeDate: !!f.dedupeIncludeDate, weeklyReportAuto: !!f.weeklyReportAuto,
      reauditOkWords: f.okWords.split(',').map((x) => x.trim()).filter(Boolean),
      ptStatusMap: Object.fromEntries(map.filter(([k]) => k.trim()).map(([k, v]) => [k.trim().toLowerCase(), v])),
    };
    for (const [k, label] of NUM_FIELDS) { const n = Number(f[k]); if (f[k].trim() === '' || Number.isNaN(n)) return setMsg({ kind: 'error', text: `“${label}” must be a number.` }); body[k] = n; }
    setBusy(true);
    try { await api.put('/api/settings', body); setMsg({ kind: 'ok', text: 'Saved. All numbers were recalculated.' }); onSaved(); }
    catch (x) { setMsg({ kind: 'error', text: x.message }); }
    setBusy(false);
  }
  const ro = !editable;
  return (
    <form onSubmit={save}>
      {ro && <div className="mb"><Alert kind="info">Only an Admin can change these settings. You can see the current values below.</Alert></div>}
      <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <Card title="Error rate and limits">
          <div className="grid g3">
            {NUM_FIELDS.map(([k, label, help]) => (
              <div className="field" key={k}><label htmlFor={`s-${k}`}>{label} <Info text={help} /></label><input id={`s-${k}`} type="number" step="any" value={f[k]} onChange={set(k)} required /></div>))}
          </div>
        </Card>

        <Card title="When does an error count?" className="mt">
          <label className="row gap-s" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><input type="checkbox" checked={!!f.countErrorsAfterReaudit} onChange={set('countErrorsAfterReaudit')} style={{ marginTop: 3 }} />
            <span><b>Count an error only after the re-audit has checked it</b><br /><span className="muted small">The audit finds the error → the Product Team fixes it → the re-audit checks it. The error counts when the re-audit comment is written (“ok / okay / done”, or the re-auditor’s notes) <b>and</b> the PT status is not “Not Updated”. Until then it is “not confirmed” and is left out of every number (error %, rankings, champions, reports), because the audit itself may have been wrong.</span></span></label>
        </Card>

        <Card title="PT status meanings" className="mt" info="The PT Status column holds free text. Tell the system which texts mean the fix is done and which mean it is still pending. Texts that are not listed here are shown as “Unrecognised” and are never guessed.">
          <Alert kind="warn">These meanings were set up from the sample file. <b>Please confirm they are right for your team.</b> Changing them recalculates every pending/done number.</Alert>
          <p className="muted small mt-s">A combined status such as “Checked/Updated” or “Updated | Not Updated” (one word per attribute) is read word by word: all words done = <b>Done</b>; any word pending = <b>Pending</b>. Only a combination with a word that is not listed stays “Unrecognised”.</p>
          <table className="tbl mt-s"><thead><tr><th>Text in the PT Status column</th><th>Means</th><th /></tr></thead>
            <tbody>{map.map(([k, v], i) => (
              <tr key={i}>
                <td><input type="text" aria-label="PT status text" value={k} onChange={(e) => setMap(map.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} placeholder="e.g. Updated" /></td>
                <td><select aria-label="Meaning" value={v} onChange={(e) => setMap(map.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}><option value="completed">Done (fixed)</option><option value="pending">Pending (not fixed yet)</option></select></td>
                <td>{!ro && <button type="button" className="btn small danger" onClick={() => setMap(map.filter((_, j) => j !== i))}>Remove</button>}</td>
              </tr>))}</tbody></table>
          {!ro && <button type="button" className="btn small mt-s" onClick={() => setMap([...map, ['', 'pending']])}>+ Add a status text</button>}
          <div className="field mt"><label htmlFor="s-ok">Re-audit comments that mean “OK” (separate with commas) <Info text="A Re-Audit Comment with one of these words means the re-check passed. Any other comment is treated as “issues found”." /></label>
            <input id="s-ok" type="text" value={f.okWords} onChange={set('okWords')} /></div>
          <label className="row gap-s mt"><input type="checkbox" checked={f.blankPtIsPending} onChange={set('blankPtIsPending')} />
            <span>Count an empty PT Status as “pending” <Info text="Off (recommended): a finding with an empty PT Status is shown as “No PT status recorded” and is not counted as pending, because we cannot know. Turn on if an empty status really means PT has not acted yet." /></span></label>
        </Card>

        <Card title="Uploads and reports" className="mt">
          <label className="row gap-s"><input type="checkbox" checked={f.dedupeIncludeDate} onChange={set('dedupeIncludeDate')} />
            <span>Treat the same finding on a different date as a new record <Info text="Off (recommended): a later version of the same file (for example with PT progress added) updates the existing record instead of adding it twice. On: the audit date is part of what makes a record unique." /></span></label>
          <label className="row gap-s mt-s"><input type="checkbox" checked={f.weeklyReportAuto} onChange={set('weeklyReportAuto')} />
            <span>Create the weekly report automatically every Monday</span></label>
        </Card>
      </fieldset>
      {editable && <div className="row mt"><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>}
      <Msg m={msg} />
    </form>
  );
}

/* ---------------------------- Error types -------------------------- */
function ErrorTypes({ data, editable, onSaved }) {
  const [rows, setRows] = useState(() => data.errorTypes.map((t) => ({ ...t, isNew: false })));
  const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const upd = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  async function save() {
    setMsg(null);
    const codes = rows.map((r) => r.code.trim().toUpperCase());
    if (codes.some((c) => !/^[A-Z][A-Z0-9_-]{0,9}$/.test(c))) return setMsg({ kind: 'error', text: 'Each code must start with a letter and use only letters, numbers, - or _ (up to 10 characters).' });
    if (new Set(codes).size !== codes.length) return setMsg({ kind: 'error', text: 'Two rows have the same code.' });
    setBusy(true);
    try {
      await api.put('/api/error-types', rows.map((r) => ({ code: r.code.trim().toUpperCase(), name: r.name.trim() || r.code, isError: !!r.isError, tip: r.tip || '', verified: !!r.verified })));
      setMsg({ kind: 'ok', text: 'Saved. All numbers were recalculated.' }); onSaved();
    } catch (x) { setMsg({ kind: 'error', text: x.message }); }
    setBusy(false);
  }
  return (
    <>
      <div className="mb"><Alert kind="warn">The meaning of each code was <b>worked out from the audit comments and is not yet confirmed</b>. Tick “Confirmed” once your team agrees a meaning is right. Codes marked “not an error” (for example SG suggestions) are not counted in error numbers.</Alert></div>
      {!editable && <div className="mb"><Alert kind="info">Only an Admin can change error types.</Alert></div>}
      <Card flush>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Code</th><th>Name</th><th title="If ticked, this code is counted as a mistake">Counts as error</th><th>Advice to give the team</th><th>Confirmed</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              <td>{r.isNew ? <input type="text" aria-label="Code" style={{ width: 80 }} value={r.code} onChange={(e) => upd(i, { code: e.target.value.toUpperCase() })} /> : <b>{r.code}</b>}</td>
              <td><input type="text" aria-label={`Name of ${r.code}`} value={r.name} disabled={!editable} onChange={(e) => upd(i, { name: e.target.value })} /></td>
              <td className="center"><input type="checkbox" aria-label={`${r.code} counts as an error`} checked={r.isError} disabled={!editable} onChange={(e) => upd(i, { isError: e.target.checked })} /></td>
              <td><input type="text" aria-label={`Advice for ${r.code}`} style={{ width: '100%', minWidth: 220 }} value={r.tip} disabled={!editable} onChange={(e) => upd(i, { tip: e.target.value })} /></td>
              <td className="center"><input type="checkbox" aria-label={`${r.code} meaning confirmed`} checked={r.verified} disabled={!editable} onChange={(e) => upd(i, { verified: e.target.checked })} /></td>
            </tr>))}</tbody>
        </table></div>
      </Card>
      {editable && <div className="row mt">
        <button className="btn" onClick={() => setRows([...rows, { code: '', name: '', isError: true, tip: '', verified: false, isNew: true }])}>+ Add an error type</button>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save error types'}</button></div>}
      <Msg m={msg} />
    </>
  );
}

/* -------------------------------- Users ----------------------------- */
function UserRow({ u, me, reload }) {
  const [pw, setPw] = useState(null); const [err, setErr] = useState('');
  const { refresh } = useAuth();
  async function patch(body) { setErr(''); try { await api.patch(`/api/users/${u.id}`, body); setPw(null); reload(); if (u.id === me && 'developer' in body) refresh(); } catch (e) { setErr(e.message); } } // own Developer tick: show / hide the Feedback board at once
  return (
    <tr>
      <td><b>{u.name}</b><div className="muted small">{u.username}{u.id === me ? ' (you)' : ''}</div></td>
      <td><select aria-label={`Role of ${u.username}`} value={u.role} onChange={(e) => patch({ role: e.target.value })}>{Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
      <td><label className="row gap-s"><input type="checkbox" checked={u.active} onChange={(e) => patch({ active: e.target.checked })} /> {u.active ? 'Can sign in' : 'Blocked'}</label></td>
      <td><label className="row gap-s"><input type="checkbox" checked={!!u.developer} onChange={(e) => patch({ developer: e.target.checked })} /> {u.developer ? 'Developer' : 'No'}</label></td>
      <td>
        {pw === null ? <button className="btn small" onClick={() => setPw('')}>Reset password</button> : (
          <div className="row gap-s"><PasswordInput aria-label="New password" placeholder="New password (10+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            <button className="btn small primary" disabled={pw.length < 10} onClick={() => patch({ password: pw })}>Save</button><button className="btn small" onClick={() => setPw(null)}>Cancel</button></div>)}
        {err && <div className="small" style={{ color: 'var(--improve)' }} role="alert">{err}</div>}
      </td>
    </tr>
  );
}
function Users() {
  const { user } = useAuth(); const st = useApi('/api/users');
  const empty = { username: '', name: '', role: 'viewer', password: '' };
  const [f, setF] = useState(empty); const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function add(e) {
    e.preventDefault(); setMsg(null); setBusy(true);
    try { await api.post('/api/users', f); setMsg({ kind: 'ok', text: `User “${f.username}” was added.` }); setF(empty); st.reload(); } catch (x) { setMsg({ kind: 'error', text: x.message }); }
    setBusy(false);
  }
  return (
    <>
      <Card title="What each role can do" className="mb">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><b>Admin</b> – everything, including users and settings.</li>
          <li><b>Audit Manager</b> – see all pages, upload files, undo an upload, create reports.</li>
          <li><b>Audit Team Leader</b> – upload files, review records, create reports.</li>
          <li><b>Viewer</b> – read-only: can look at dashboards and download reports.</li>
          <li><b>Developer</b> (tick in the list below, on top of the role) – sees the Feedback board, replies to notes and marks them done. Audit Managers can also open the board and add notes.</li>
        </ul>
      </Card>
      <Card title="People who can sign in" flush>
        <Async state={st}>{(rows) => (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>User</th><th>Role</th><th>Access</th><th>Developer <Info text="A developer sees the Feedback board, replies to notes and marks them done. Audit Managers can see the board and add notes. Nobody else sees it." /></th><th>Password</th></tr></thead>
            <tbody>{rows.map((u) => <UserRow key={`${u.id}-${u.role}-${u.active}-${u.developer}`} u={u} me={user.id} reload={st.reload} />)}</tbody></table></div>)}</Async>
      </Card>
      <form onSubmit={add}><Card title="Add a user" className="mt">
        <div className="grid g4">
          <div className="field"><label htmlFor="nu">Username</label><input id="nu" type="text" value={f.username} onChange={set('username')} required minLength={3} autoComplete="off" /></div>
          <div className="field"><label htmlFor="nn">Full name</label><input id="nn" type="text" value={f.name} onChange={set('name')} required /></div>
          <div className="field"><label htmlFor="nr">Role</label><select id="nr" value={f.role} onChange={set('role')}>{Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field"><label htmlFor="np">Password (10+ characters)</label><PasswordInput id="np" value={f.password} onChange={set('password')} required minLength={10} autoComplete="new-password" /></div>
        </div>
        <div className="row mt-s"><button className="btn primary" disabled={busy}>{busy ? 'Adding…' : 'Add user'}</button></div>
        <Msg m={msg} />
      </Card></form>
    </>
  );
}

/* ------------------------------- Account ---------------------------- */
function Account() {
  const { user } = useAuth();
  const [f, setF] = useState({ current: '', next: '', again: '' }); const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save(e) {
    e.preventDefault(); setMsg(null);
    if (f.next !== f.again) return setMsg({ kind: 'error', text: 'The two new passwords do not match.' });
    setBusy(true);
    try { await api.post('/api/auth/password', { current: f.current, next: f.next }); setMsg({ kind: 'ok', text: 'Password changed. Other devices were signed out.' }); setF({ current: '', next: '', again: '' }); }
    catch (x) { setMsg({ kind: 'error', text: x.message }); }
    setBusy(false);
  }
  return (
    <form onSubmit={save}><Card title="Change my password">
      <p className="muted" style={{ marginTop: 0 }}>Signed in as <b>{user.name}</b> ({ROLE_LABEL[user.role]}).</p>
      <div className="grid g3">
        <div className="field"><label htmlFor="pc">Current password</label><PasswordInput id="pc" value={f.current} onChange={set('current')} autoComplete="current-password" required /></div>
        <div className="field"><label htmlFor="pn">New password (10+ characters)</label><PasswordInput id="pn" value={f.next} onChange={set('next')} autoComplete="new-password" required minLength={10} /></div>
        <div className="field"><label htmlFor="pa">New password again</label><PasswordInput id="pa" value={f.again} onChange={set('again')} autoComplete="new-password" required /></div>
      </div>
      <div className="row mt-s"><button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button></div>
      <Msg m={msg} />
    </Card></form>
  );
}

/* ------------------------------ Email (Admin) ------------------------------ */
function EmailSetup() {
  const st = useApi('/api/feedback/mail/settings');
  const [f, setF] = useState(null); const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(''); const [testTo, setTestTo] = useState('');
  useEffect(() => { if (st.data) setF({ ...st.data, port: String(st.data.port), pass: '' }); }, [st.data]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  async function save(e) {
    e.preventDefault(); setMsg(null); setBusy('save');
    try {
      const body = { host: f.host, port: Number(f.port) || 587, secure: !!f.secure, user: f.user, fromAddress: f.fromAddress, fromName: f.fromName, ...(f.pass ? { pass: f.pass } : {}) };
      await api.put('/api/feedback/mail/settings', body); setMsg({ kind: 'ok', text: 'Saved. Send a test email to check it works.' }); st.reload();
    } catch (x) { setMsg({ kind: 'error', text: x.message }); }
    setBusy('');
  }
  async function test() {
    setMsg(null); setBusy('test');
    try { await api.post('/api/feedback/mail/test', { to: testTo }); setMsg({ kind: 'ok', text: `Test email sent to ${testTo}. Check that inbox (and the spam folder).` }); }
    catch (x) { setMsg({ kind: 'error', text: x.message }); }
    setBusy('');
  }
  if (!f) return <Async state={st}>{() => null}</Async>;
  return (
    <form onSubmit={save}>
      <Card title="Email sending" info="The dashboard sends feedback and appreciation emails through your company's mail server (SMTP). Your IT team or email provider can give these details. The password is stored on the server only and is never shown again.">
        <p className="muted small" style={{ marginTop: 0 }}>Status: {f.ready ? <b style={{ color: 'var(--good)' }}>ready – emails can be sent from the dashboard</b> : <b style={{ color: 'var(--watch)' }}>{f.host && f.user && !f.hasPassword ? 'password missing – type it below and save' : 'not set up – emails cannot be sent yet'}</b>}.
          Common values: Office 365 – smtp.office365.com, port 587; Gmail / Google Workspace – smtp.gmail.com, port 587 (needs an app password).</p>
        <div className="grid g3">
          <div className="field"><label htmlFor="m-host">Mail server (SMTP host)</label><input id="m-host" type="text" value={f.host} onChange={set('host')} placeholder="smtp.office365.com" /></div>
          <div className="field"><label htmlFor="m-port">Port</label><input id="m-port" type="number" value={f.port} onChange={set('port')} /></div>
          <label className="row gap-s" style={{ alignSelf: 'end', paddingBottom: 6 }}><input type="checkbox" checked={!!f.secure} onChange={set('secure')} /><span>Secure connection from the start (port 465) <Info text="Leave off for port 587 (the connection is secured after it starts). Turn on only for port 465." /></span></label>
          <div className="field"><label htmlFor="m-user">Username</label><input id="m-user" type="text" value={f.user} onChange={set('user')} autoComplete="off" placeholder="audit@company.com" /></div>
          <div className="field"><label htmlFor="m-pass">Password</label><PasswordInput id="m-pass" value={f.pass} onChange={set('pass')} autoComplete="new-password" placeholder={f.hasPassword ? 'saved – leave empty to keep it' : ''} /></div>
          <div />
          <div className="field"><label htmlFor="m-from">Send from (address)</label><input id="m-from" type="text" value={f.fromAddress} onChange={set('fromAddress')} placeholder="audit@company.com" /></div>
          <div className="field"><label htmlFor="m-name">Sender name</label><input id="m-name" type="text" value={f.fromName} onChange={set('fromName')} placeholder="Audit Team" /></div>
        </div>
        <div className="row mt"><button className="btn primary" disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save email settings'}</button></div>
        <div className="row mt" style={{ alignItems: 'flex-end' }}>
          <div className="field"><label htmlFor="m-test">Send a test email to</label><input id="m-test" type="text" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@company.com" /></div>
          <button type="button" className="btn" disabled={!!busy || !testTo || !f.ready} onClick={test}>{busy === 'test' ? 'Sending…' : 'Send test email'}</button>
        </div>
        <Msg m={msg} />
      </Card>
    </form>
  );
}

export default function Settings() {
  const { can } = useAuth(); const meta = useMeta();
  const st = useApi('/api/settings');
  const [tab, setTab] = useState('rules');
  useEffect(() => { if ((tab === 'users' || tab === 'email') && !can('users')) setTab('rules'); }, [tab, can]);
  const items = [['rules', 'Rules'], ['errors', 'Error types'], ...(can('users') ? [['users', 'Users'], ['email', 'Email']] : []), ['account', 'My account']];
  const saved = () => { st.reload(); meta.reload(); };
  return (
    <>
      <PageHeader title="Settings" subtitle="The rules behind the numbers. Nothing is fixed in the program: change a rule and every page is recalculated." />
      <Tabs value={tab} onChange={setTab} items={items} />
      {(tab === 'rules' || tab === 'errors') && (
        <Async state={st}>{(d) => (tab === 'rules'
          ? <Rules key="rules" data={d} editable={can('settings')} onSaved={saved} />
          : <ErrorTypes key="errors" data={d} editable={can('settings')} onSaved={saved} />)}</Async>
      )}
      {tab === 'users' && can('users') && <Users />}
      {tab === 'email' && can('users') && <EmailSetup />}
      {tab === 'account' && <Account />}
    </>
  );
}
