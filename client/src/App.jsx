import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { AuthCtx } from './lib/auth.js';
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api, useApi } from './lib/api.js';
import { MetaContext } from './lib/filters.jsx';
import { ROLE_LABEL } from './lib/format.js';
import { Icon, Loading, ErrorBox } from './components/ui.jsx';
import { DetailsProvider } from './components/Details.jsx';
import SearchBox from './components/SearchBox.jsx';
import Logo from './components/Logo.jsx';
import AuthScreen from './pages/AuthScreen.jsx';
import Overview from './pages/Overview.jsx';
import Categories from './pages/Categories.jsx';
import ContentTeam from './pages/ContentTeam.jsx';
import AuditTeam from './pages/AuditTeam.jsx';
import ErrorAnalysis from './pages/ErrorAnalysis.jsx';
import FollowUps from './pages/FollowUps.jsx';
import Upload from './pages/Upload.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
const SourceView = lazy(() => import('./pages/SourceView.jsx')); // the source PDF with the value marked (opened in a new tab)

const PERMS = { upload: ['admin', 'manager', 'leader'], undoUpload: ['admin', 'manager'], report: ['admin', 'manager', 'leader'], settings: ['admin'], users: ['admin'] };

const NAV = [
  ['/', 'Overview', 'overview'], ['/content', 'Product Team', 'users'], ['/categories', 'Category Performance', 'table'], ['/audit', 'Audit Team', 'audit'], ['/errors', 'Error Analysis', 'error'],
  ['/follow-ups', 'PT & Re-Audit', 'clock'], ['/upload', 'Upload Audit Files', 'upload'], ['/reports', 'Weekly Reports', 'report'], ['/settings', 'Settings', 'settings'],
];

/** Light / Dark / Auto (follows the computer). Remembered in this browser. */
function applyTheme(t) { const el = document.documentElement; if (t === 'light' || t === 'dark') el.dataset.theme = t; else delete el.dataset.theme; }
try { applyTheme(localStorage.getItem('theme')); } catch { /* storage blocked: stay on Auto */ }
function ThemeSwitch() {
  const [t, setT] = useState(() => { try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; } });
  const pick = (v) => { setT(v); applyTheme(v); try { localStorage.setItem('theme', v); } catch { /* ignore */ } };
  return (
    <div className="theme" role="group" aria-label="Colour theme">
      {[['light', '☀ Light'], ['dark', '☾ Dark'], ['auto', 'Auto']].map(([v, label]) => <button key={v} className={t === v ? 'on' : ''} aria-pressed={t === v} onClick={() => pick(v)} title={v === 'auto' ? 'Follow the computer setting' : undefined}>{label}</button>)}
    </div>
  );
}

function Shell({ user, onLogout }) {
  const meta = useApi('/api/meta'); const [open, setOpen] = useState(false); const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  if (meta.loading && !meta.data) return <div className="auth"><Loading /></div>;
  if (meta.error) return <div className="auth"><div style={{ maxWidth: 480 }}><ErrorBox error={meta.error} retry={meta.reload} /></div></div>;
  const m = { ...meta.data, reload: meta.reload };
  return (
    <MetaContext.Provider value={m}>
      <DetailsProvider>
        <div className="app">
          <div className="topbar"><button className="btn small" aria-label="Open menu" onClick={() => setOpen(true)}><Icon name="menu" /></button><Logo /><b>Audit Performance</b></div>
          <nav className={`side ${open ? 'open' : ''}`} aria-label="Main">
            <div className="brand"><Logo /><span className="brand-app">Audit Performance</span></div>
            <div className="nav">{NAV.map(([to, label, icon]) => (
              <NavLink key={to} to={{ pathname: to, search: loc.search }} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}><Icon name={icon} />{label}</NavLink>))}</div>
            <div className="side-foot">
              <ThemeSwitch />
              <div><b>{user.name}</b></div><div className="muted">{ROLE_LABEL[user.role]}</div>
              <button className="btn small mt-s" onClick={onLogout}><Icon name="logout" /> Sign out</button>
            </div>
          </nav>
          <main className="main" id="main">
            <div className="searchbar"><SearchBox /></div>
            <div className="page" key={loc.pathname}><Routes>
              <Route path="/" element={<Overview />} /><Route path="/content" element={<ContentTeam />} /><Route path="/categories" element={<Categories />} /><Route path="/audit" element={<AuditTeam />} />
              <Route path="/errors" element={<ErrorAnalysis />} /><Route path="/follow-ups" element={<FollowUps />} /><Route path="/records" element={<Navigate to="/" replace />} />
              <Route path="/upload" element={<Upload />} /><Route path="/reports" element={<Reports />} /><Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes></div>
          </main>
        </div>
      </DetailsProvider>
    </MetaContext.Provider>
  );
}

function Root() {
  const [state, setState] = useState({ loading: true, user: null, needsSetup: false, error: null });
  const refresh = useCallback(() => api.get('/api/auth/status').then((s) => setState({ loading: false, user: s.user, needsSetup: s.needsSetup, error: null })).catch((error) => setState({ loading: false, user: null, needsSetup: false, error })), []);
  useEffect(() => { refresh(); const h = () => setState((s) => ({ ...s, user: null })); window.addEventListener('auth-expired', h); return () => window.removeEventListener('auth-expired', h); }, [refresh]);
  const logout = async () => { try { await api.post('/api/auth/logout'); } catch { /* ignore */ } setState((s) => ({ ...s, user: null })); };
  if (state.loading) return <div className="auth"><Loading /></div>;
  if (state.error) return <div className="auth"><div style={{ maxWidth: 480 }}><ErrorBox error={state.error} retry={refresh} /></div></div>;
  if (!state.user) return <AuthScreen needsSetup={state.needsSetup} onDone={refresh} />;
  if (window.location.pathname === '/source-view') return <Suspense fallback={<div className="auth"><Loading /></div>}><SourceView /></Suspense>;
  const auth = { user: state.user, can: (p) => (PERMS[p] || []).includes(state.user.role), refresh };
  return <AuthCtx.Provider value={auth}><Shell user={state.user} onLogout={logout} /></AuthCtx.Provider>;
}

export default function App() { return <BrowserRouter><Root /></BrowserRouter>; }
