// Sign-in / first-time setup. Two panels: an animated audit illustration (drawn in code, no outside images) and the form.
// The illustration is decoration only: it never blocks the form, hides on small screens, and stops moving for people who turn motion off.
import { useState } from 'react';
import { api } from '../lib/api.js';
import Logo from '../components/Logo.jsx';

const Svg = ({ d, size = 18 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const USER = <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>;
const LOCK = <><rect x="4" y="10.5" width="16" height="10.5" rx="2.5" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></>;
const EYE = <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>;
const EYE_OFF = <><path d="M3 3l18 18" /><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>;
const PERSON = <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>;

/** The audit scene: a product checklist scanned by a magnifying glass, ticks and one flagged mistake appear, charts draw themselves. */
function LoginArt() {
  return (
    <svg className="la" viewBox="0 0 520 420" role="img" aria-label="Illustration: an audit checklist being checked, with charts">
      <defs>
        <linearGradient id="laCard" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity=".98" /><stop offset="1" stopColor="#eef6fb" stopOpacity=".96" /></linearGradient>
        <linearGradient id="laBar" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#2a2170" /><stop offset="1" stopColor="#32c3eb" /></linearGradient>
        <linearGradient id="laLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#b2cd3d" /><stop offset="1" stopColor="#239d38" /></linearGradient>
        <filter id="laShadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="14" stdDeviation="16" floodColor="#150f38" floodOpacity=".28" /></filter>
      </defs>

      {/* back card: charts */}
      <g className="la-float2" filter="url(#laShadow)">
        <rect x="250" y="40" width="240" height="170" rx="18" fill="url(#laCard)" />
        <rect x="270" y="60" width="90" height="10" rx="5" fill="#d3d1e8" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect key={i} className="la-bar" style={{ animationDelay: `${0.25 + i * 0.12}s` }} x={276 + i * 34} y={192 - [70, 48, 86, 58, 96, 74][i]} width="20" height={[70, 48, 86, 58, 96, 74][i]} rx="5" fill="url(#laBar)" />
        ))}
        <path className="la-line" d="M272 170 C 310 150, 330 160, 360 132 S 420 120, 470 92" fill="none" stroke="url(#laLine)" strokeWidth="4" strokeLinecap="round" />
        <circle className="la-dot" cx="470" cy="92" r="6" fill="#239d38" />
      </g>

      {/* front card: the product checklist being audited */}
      <g className="la-float" filter="url(#laShadow)">
        <rect x="40" y="110" width="270" height="260" rx="20" fill="url(#laCard)" />
        <rect x="64" y="134" width="44" height="44" rx="12" fill="#e4f5fc" />
        <path d="M76 166l8-16 8 10 6-6 6 12" stroke="#2a2170" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="120" y="140" width="120" height="10" rx="5" fill="#d3d1e8" />
        <rect x="120" y="158" width="80" height="8" rx="4" fill="#e7e6f4" />
        {[0, 1, 2, 3].map((i) => {
          const y = 204 + i * 40; const bad = i === 2;
          return (
            <g key={i}>
              <rect x="64" y={y - 13} width="222" height="30" rx="9" fill={bad ? '#f8e0e0' : '#f5f6fb'} className={bad ? 'la-bad' : ''} style={{ animationDelay: '2.4s' }} />
              <rect x="80" y={y - 3} width={[110, 84, 124, 96][i]} height="8" rx="4" fill={bad ? '#e59a9a' : '#d3d1e8'} />
              <circle cx="266" cy={y + 2} r="10" fill={bad ? '#cc3a3a' : '#239d38'} className="la-pop" style={{ animationDelay: `${0.9 + i * 0.45}s` }} />
              {bad
                ? <path className="la-pop" style={{ animationDelay: `${0.9 + i * 0.45}s` }} d={`M262 ${y - 2}l8 8M270 ${y - 2}l-8 8`} stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
                : <path className="la-tick" style={{ animationDelay: `${1 + i * 0.45}s` }} d={`M261 ${y + 2}l3.5 3.5 6.5-7`} stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
            </g>
          );
        })}
        {/* magnifying glass sweeping down the list */}
        <g className="la-lens">
          <circle cx="0" cy="0" r="26" fill="#ffffff" fillOpacity=".35" stroke="#2a2170" strokeWidth="6" />
          <path d="M19 19l22 22" stroke="#2a2170" strokeWidth="9" strokeLinecap="round" />
        </g>
      </g>

      {/* floating labels */}
      <g className="la-chip" style={{ animationDelay: '1.2s' }}>
        <rect x="330" y="248" width="150" height="40" rx="20" fill="#ffffff" filter="url(#laShadow)" />
        <circle cx="352" cy="268" r="9" fill="#239d38" /><path d="M347.5 268l3 3 5-5.5" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        <text x="369" y="273" fontSize="14" fontWeight="700" fill="#150f38">Source checked</text>
      </g>
      <g className="la-chip" style={{ animationDelay: '2.8s' }}>
        <rect x="338" y="304" width="142" height="40" rx="20" fill="#ffffff" filter="url(#laShadow)" />
        <circle cx="360" cy="324" r="9" fill="#cc3a3a" /><path d="M356.5 320.5l7 7M363.5 320.5l-7 7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        <text x="377" y="329" fontSize="14" fontWeight="700" fill="#150f38">Mistake found</text>
      </g>
      <circle className="la-spark" cx="225" cy="70" r="5" fill="#b2cd3d" />
      <circle className="la-spark" style={{ animationDelay: '-2s' }} cx="500" cy="250" r="4" fill="#32c3eb" />
      <circle className="la-spark" style={{ animationDelay: '-4s' }} cx="30" cy="390" r="6" fill="#cc3a3a" />
    </svg>
  );
}

export default function AuthScreen({ needsSetup, onDone }) {
  const [f, setF] = useState({ username: '', displayName: '', password: '', confirm: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const [show, setShow] = useState(false); const [caps, setCaps] = useState(false); const [shake, setShake] = useState(0);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const onKey = (e) => setCaps(!!e.getModifierState?.('CapsLock'));
  const fail = (m) => { setErr(m); setBusy(false); setShake((n) => n + 1); };
  async function submit(e) {
    e.preventDefault(); setErr('');
    if (needsSetup && f.password !== f.confirm) return fail('The two passwords do not match.');
    setBusy(true);
    try {
      if (needsSetup) await api.post('/api/auth/setup', { username: f.username, displayName: f.displayName, password: f.password });
      else await api.post('/api/auth/login', { username: f.username, password: f.password });
      setDone(true); setTimeout(onDone, 450); // a short "signed in" tick, then the dashboard
    } catch (x) { fail(x.message); }
  }
  return (
    <div className="login">
      <aside className="login-art" aria-hidden="false">
        <div className="login-blob b1" /><div className="login-blob b2" /><div className="login-grid" />
        <div className="login-brand"><Logo /><span>Audit Performance</span></div>
        <div className="login-copy">
          <h2>Every audit, every attribute –<br /><span>clear at a glance.</span></h2>
          <p>See how accurate each team member is, spot the mistakes that keep coming back, and check them against the original source.</p>
        </div>
        <LoginArt />
        <ul className="login-points">
          <li><span>✓</span>Team accuracy, week by week</li>
          <li><span>✓</span>Mistakes checked at the source</li>
          <li><span>✓</span>Weekly reports, ready to share</li>
        </ul>
      </aside>

      <main className="login-side">
        <form key={shake} className={`login-card${shake ? ' shake' : ''}`} onSubmit={submit} noValidate={false}>
          <h1>{needsSetup ? 'Welcome – create the Admin account' : 'Welcome back'}</h1>
          <p className="login-sub">{needsSetup ? 'This is the first time the system is used. This account can add other users and change settings.' : 'Sign in with the username and password given by your administrator.'}</p>
          {err && <div className="alert error mb" role="alert">{err}</div>}

          <label className="login-field" htmlFor="u"><span className="lf-label">Username</span>
            <span className="lf-box"><Svg d={USER} /><input id="u" value={f.username} onChange={set('username')} autoComplete="username" required autoFocus placeholder="Your username" /></span></label>
          {needsSetup && (
            <label className="login-field" htmlFor="n"><span className="lf-label">Your name</span>
              <span className="lf-box"><Svg d={PERSON} /><input id="n" value={f.displayName} onChange={set('displayName')} required placeholder="Name shown in the app" /></span></label>
          )}
          <label className="login-field" htmlFor="p"><span className="lf-label">Password{needsSetup && ' (at least 10 characters)'}</span>
            <span className="lf-box"><Svg d={LOCK} />
              <input id="p" type={show ? 'text' : 'password'} value={f.password} onChange={set('password')} onKeyUp={onKey} onKeyDown={onKey} autoComplete={needsSetup ? 'new-password' : 'current-password'} required minLength={needsSetup ? 10 : 1} placeholder="Your password" />
              <button type="button" className="lf-eye" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} title={show ? 'Hide password' : 'Show password'}><Svg d={show ? EYE_OFF : EYE} /></button>
            </span></label>
          {caps && <div className="login-caps" role="status">⇪ Caps Lock is on</div>}
          {needsSetup && (
            <label className="login-field" htmlFor="c"><span className="lf-label">Type the password again</span>
              <span className="lf-box"><Svg d={LOCK} /><input id="c" type={show ? 'text' : 'password'} value={f.confirm} onChange={set('confirm')} autoComplete="new-password" required /></span></label>
          )}

          <button className={`btn primary login-btn${done ? ' ok' : ''}`} disabled={busy}>
            {done ? <>✓ Signed in</> : busy ? <><span className="login-spin" aria-hidden="true" />Please wait…</> : <>{needsSetup ? 'Create account' : 'Sign in'}<span className="login-arrow" aria-hidden="true">→</span></>}
          </button>
          <p className="login-foot">Forgot your password or need access? Ask your administrator.</p>
        </form>
      </main>
    </div>
  );
}
