import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error { constructor(message, status, details) { super(message); this.status = status; this.details = details; } }

export const qs = (params = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
};

async function request(method, url, body) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res;
  try {
    res = await fetch(url, { method, credentials: 'same-origin', headers: { 'x-requested-with': 'audit-app', ...(body && !isForm ? { 'content-type': 'application/json' } : {}) }, body: body ? (isForm ? body : JSON.stringify(body)) : undefined });
  } catch { throw new ApiError('Cannot reach the server. Check that it is running and try again.', 0); }
  if (!res.ok) {
    let msg = `Something went wrong (${res.status}).`; let details;
    try { const j = await res.json(); msg = j.error || msg; details = j.details; } catch { /* not json */ }
    if (res.status === 401) window.dispatchEvent(new Event('auth-expired'));
    throw new ApiError(msg, res.status, details);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res;
}
export const api = {
  get: (url, params) => request('GET', url + qs(params)),
  post: (url, body) => request('POST', url, body ?? {}),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
};

/** Download a file from the API (Excel / PDF). Uses the same session cookie. */
export async function download(url, params, fallbackName) {
  const res = await request('GET', url + qs(params));
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') || '';
  const name = (cd.match(/filename="([^"]+)"/) || [])[1] || fallbackName;
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Loads data from the API whenever the url/params change. */
export function useApi(url, params, { skip = false } = {}) {
  const [state, setState] = useState({ data: null, loading: !skip, error: null });
  const key = url + qs(params); const tick = useRef(0);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (skip) { setState({ data: null, loading: false, error: null }); return undefined; }
    let live = true; const my = ++tick.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(url, params).then((data) => { if (live && my === tick.current) setState({ data, loading: false, error: null }); })
      .catch((error) => { if (live && my === tick.current) setState({ data: null, loading: false, error }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, skip]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
