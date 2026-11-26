// A small animated champion button in the bottom-right corner of the Overview.
// Click it to see the champions of the week: best Product Team person (lowest error rate) and Audit Team person (most error types found).
import { useEffect, useRef, useState } from 'react';
import { useApi } from '../lib/api.js';
import { num, pct, weekLabel } from '../lib/format.js';
import { AnimatedValue } from './ui.jsx';

const Trophy = ({ size = 28 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />
  </svg>
);
const Star = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17l-6.1 3.4 1.5-6.8L2.2 9l6.9-.7z" fill="currentColor" /></svg>;
const initials = (n) => String(n).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const CONFETTI = ['#ffd84d', '#ff7a90', '#5ad1b0', '#7aa2ff', '#c39bff', '#ffa94d'];

function Champ({ tone, team, ribbon, p, stat, statLabel, lines, next, empty }) {
  return (
    <div className={`champ-card champ-${tone}`}>
      <div className="champ-card-top"><span className="champ-chip">{team}</span>{p && <span className="champ-ribbon">{ribbon}</span>}</div>
      {p ? (
        <div className="champ-row">
          <div className="champ-medal"><span className="champ-avatar">{initials(p.name)}</span><span className="champ-star"><Star /></span></div>
          <div className="champ-info">
            <div className="champ-name" title={p.name}>{p.name}</div>
            <div className="champ-stat"><b><AnimatedValue value={stat} /></b> <span>{statLabel}</span></div>
            {lines.filter(Boolean).map((l, i) => <div key={i} className="champ-line">{l}</div>)}
          </div>
        </div>
      ) : <p className="champ-empty">{empty}</p>}
      {next && <div className="champ-next">{next}</div>}
    </div>
  );
}

export default function ChampionFab() {
  const [open, setOpen] = useState(false); const [week, setWeek] = useState(''); const [hint, setHint] = useState(true); const root = useRef();
  const st = useApi('/api/champions', week ? { week } : {}, { skip: !open });
  useEffect(() => { const t = setTimeout(() => setHint(false), 7000); return () => clearTimeout(t); }, []);
  useEffect(() => { if (!open) setWeek(''); }, [open]); // every time it is opened it starts at the newest week again
  useEffect(() => {
    if (!open) return undefined;
    const key = (e) => e.key === 'Escape' && setOpen(false);
    const click = (e) => { if (root.current && !root.current.contains(e.target)) setOpen(false); };
    window.addEventListener('keydown', key); document.addEventListener('mousedown', click);
    return () => { window.removeEventListener('keydown', key); document.removeEventListener('mousedown', click); };
  }, [open]);
  const d = st.data;
  const year = d?.week ? new Date(d.week.start).getUTCFullYear() : '';
  const p = d?.product?.[0]; const a = d?.audit?.[0];
  const better = p && d.teamErrorRate != null && d.teamErrorRate > p.errorRate ? Math.round((d.teamErrorRate - p.errorRate) * 10) / 10 : null;

  return (
    <div className="champ-root" ref={root}>
      {open && (
        <div className="champ-pop" role="dialog" aria-label="Champions of the week">
          <div className="confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ '--x': `${(i * 37) % 100}%`, '--c': CONFETTI[i % CONFETTI.length], '--dl': `${(i % 6) * 70}ms`, '--rot': `${(i * 53) % 360}deg` }} />)}</div>
          <div className="champ-head">
            <div><div className="champ-title"><Trophy size={20} /> Champions of the week</div>
              <div className="champ-sub">{d?.week ? `Week of ${weekLabel(d.week.start)} ${year}${d.latest ? ' · latest week with data' : ''}` : 'Loading…'}</div></div>
            <button className="champ-x" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          {d?.weeks?.length > 1 && (
            <div className="field inline champ-week"><label htmlFor="cw">Show another week</label>
              <select id="cw" value={d.week.start} onChange={(e) => setWeek(e.target.value)}>{d.weeks.map((w, i) => <option key={w} value={w}>{weekLabel(w)} {new Date(w).getUTCFullYear()}{i === 0 ? ' (latest)' : ''}</option>)}</select></div>)}
          {st.loading && !d && <div className="skeleton" style={{ height: 210 }} />}
          {st.error && <div className="alert error"><div>{st.error.message}</div></div>}
          {d && !d.week && <p className="champ-empty dark">No audit data yet. Upload an audit file first.</p>}
          {d?.week && (
            <>
              <Champ tone="product" team="Product Team" ribbon="Lowest error rate" p={p} stat={p ? pct(p.errorRate) : ''} statLabel="error rate"
                lines={p ? [`${p.errorSkus} of ${p.samples} audited SKUs had errors`, better ? `${better} points better than the team (${pct(d.teamErrorRate)})` : null] : []}
                next={d.product.length > 1 ? `Next: ${d.product.slice(1).map((x) => `${x.name} ${pct(x.errorRate)}`).join(' · ')}` : null}
                empty={`Nobody had ${d.minSample} or more audited SKUs this week, so nobody can be ranked fairly.`} />
              <Champ tone="audit" team="Audit Team" ribbon="Most errors found" p={a} stat={a ? num(a.classifications) : ''} statLabel={a?.classifications === 1 ? 'error type found' : 'error types found'}
                lines={a ? [`found on ${num(a.errorSkus)} of ${num(a.skusAudited)} audited SKUs`, a.cases ? `${a.closedCases} of ${a.cases} follow-up cases closed` : null] : []}
                next={d.audit.length > 1 ? `Next: ${d.audit.slice(1).map((x) => `${x.name} ${num(x.classifications)}`).join(' · ')}` : null}
                empty="No auditor recorded an error this week." />
              <p className="champ-note">Whole team, all projects and files. Product Team: lowest error rate. Audit Team: most error types found. It updates by itself when you upload files with a newer audit date.</p>
            </>
          )}
        </div>
      )}
      {!open && hint && <div className="champ-hint" aria-hidden="true">🏆 Champion of the week</div>}
      <button className={`champ-fab ${open ? 'is-open' : ''}`} onClick={() => { setOpen(!open); setHint(false); }} aria-expanded={open} aria-label="Show the champions of the week" title="Champions of the week">
        <span className="champ-ring" /><Trophy /><span className="champ-spark s1"><Star /></span><span className="champ-spark s2"><Star /></span><span className="champ-spark s3"><Star /></span>
      </button>
    </div>
  );
}
