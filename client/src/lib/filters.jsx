import { createContext, useCallback, useContext, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi } from './api.js';

/** Global filters live in the address bar (?week=2026-07-13&builderId=3) so they follow you from page to page and can be shared. */
export const FILTER_KEYS = ['from', 'to', 'week', 'month', 'builderId', 'auditorId', 'uploadId', 'project', 'errorCode', 'ptStatus'];

export function useFilters(allowed = FILTER_KEYS) {
  const [sp, setSp] = useSearchParams();
  const values = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, sp.get(k) || ''])), [sp]);
  const params = useMemo(() => Object.fromEntries(allowed.filter((k) => values[k]).map((k) => [k, values[k]])), [values, allowed.join()]); // eslint-disable-line
  const set = useCallback((patch) => {
    setSp((old) => {
      const n = new URLSearchParams(old);
      const p = { ...patch };
      // only one way of choosing dates at a time
      if (p.week) Object.assign(p, { month: '', from: '', to: '' });
      else if (p.month) Object.assign(p, { week: '', from: '', to: '' });
      else if (p.from !== undefined || p.to !== undefined) Object.assign(p, { week: '', month: '' });
      for (const [k, v] of Object.entries(p)) { if (v === '' || v == null) n.delete(k); else n.set(k, v); }
      return n;
    }, { replace: true });
  }, [setSp]);
  const clear = useCallback(() => setSp((old) => { const n = new URLSearchParams(old); FILTER_KEYS.forEach((k) => n.delete(k)); return n; }, { replace: true }), [setSp]);
  const active = FILTER_KEYS.filter((k) => values[k] && allowed.includes(k));
  return { values, params, set, clear, active };
}

export const MetaContext = createContext(null);
export const useMeta = () => useContext(MetaContext);
export function useMetaLoader() { return useApi('/api/meta'); }
