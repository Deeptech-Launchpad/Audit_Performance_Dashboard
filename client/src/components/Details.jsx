// Shared pop-ups: a SKU's full audit history, and a list of records behind a number/chart bar ("click to see the SKUs").
import { createContext, useCallback, useContext, useState } from 'react';
import { api, useApi } from '../lib/api.js';
import { date, PT_CLASS, REAUDIT } from '../lib/format.js';
import { Async, Drawer, Modal, Pager } from './ui.jsx';
import { codeColor } from './charts.jsx';
import { useMeta } from '../lib/filters.jsx';

const Ctx = createContext(null);
export const useDetails = () => useContext(Ctx);

export function DetailsProvider({ children }) {
  const [sku, setSku] = useState(null); const [list, setList] = useState(null);
  const openSku = useCallback((id) => setSku(id), []);
  const openRecords = useCallback((spec) => setList(spec), []); // { title, params }
  return (
    <Ctx.Provider value={{ openSku, openRecords }}>
      {children}
      {list && <RecordsModal spec={list} onClose={() => setList(null)} />}
      {sku && <SkuDrawer skuId={sku} onClose={() => setSku(null)} />}
    </Ctx.Provider>
  );
}

export function CodeTags({ codes }) {
  return <>{(codes || []).map((c) => <span key={c} className="tag" style={{ borderColor: codeColor(c) }}>{c}</span>)}</>;
}

function SkuDrawer({ skuId, onClose }) {
  const st = useApi(`/api/skus/${encodeURIComponent(skuId)}`);
  const meta = useMeta(); const names = Object.fromEntries(meta.errorTypes.map((t) => [t.code, t.name]));
  return (
    <Drawer title={`SKU ${skuId}`} onClose={onClose} wide>
      <Async state={st}>{(d) => (
        <>
          <dl className="kv mb">
            <dt>Audit records</dt><dd>{d.history.length} (newest first)</dd>
          </dl>
          {d.history.slice().reverse().map((h) => (
            <section key={h.id} className="card mb"><div className="card-b">
              <div className="row gap-s mb"><b>{date(h.auditDate)}</b><span className="muted small">from {h.file}</span><span className="grow" />{h.sampled ? <span className="badge info">Audited</span> : <span className="badge few">Not audited</span>}</div>
              <dl className="kv">
                <dt>Product team member</dt><dd>{h.builder}</dd>
                {h.auditor && <><dt>Audited by</dt><dd>{h.auditor}</dd></>}
                {h.codes.length > 0 && <><dt>Error type</dt><dd><CodeTags codes={h.codes} /> <span className="muted small">{h.codes.map((c) => names[c] || c).join(', ')}</span></dd></>}
                {h.attribute && <><dt>Attribute / field</dt><dd>{h.attribute}</dd></>}
                {h.attributes?.some((a) => a.fromComment) && <><dt>Attributes with errors</dt><dd className="attr-list">{h.attributes.map((a) => <span key={a.name} className={`badge ${a.fromComment ? 'info' : 'plain'}`} title={a.fromComment ? 'Named in the audit comment (not in Attribute/Field) – counted as an attribute error' : 'From Attribute/Field'}>{a.name}{a.fromComment ? ' · comment' : ''}</span>)}</dd></>}
                {h.auditComments && <><dt>Audit comments</dt><dd>{h.auditComments}</dd></>}
                {h.ptStatus && <><dt>PT status</dt><dd>{h.ptStatus} <span className="muted small">({PT_CLASS[h.ptClass]})</span></dd></>}
                {h.ptComments && <><dt>PT comments</dt><dd>{h.ptComments}</dd></>}
                {h.reauditComments && <><dt>Re-audit comments</dt><dd>{h.reauditComments}</dd></>}
                {h.ptClass !== 'not_applicable' && <><dt>Re-audit status</dt><dd>{REAUDIT[h.reaudit]}</dd></>}
                {h.gapSimilar && <><dt>Gap / similar</dt><dd>{h.gapSimilar}</dd></>}
                {h.ptResponse && <><dt>PT response</dt><dd>{h.ptResponse}</dd></>}
                {(h.cfbAttribute || h.cfbComments) && <><dt>CFB</dt><dd>{h.cfbAttribute} {h.cfbComments}</dd></>}
              </dl></div></section>
          ))}
        </>)}</Async>
    </Drawer>
  );
}

function RecordsModal({ spec, onClose }) {
  const [page, setPage] = useState(1); const { openSku } = useDetails();
  const st = useApi('/api/records', { ...spec.params, page, pageSize: 10, sort: 'skuId', dir: 'asc' });
  return (
    <Modal title={spec.title} onClose={onClose}>
      <Async state={st} emptyWhen={(d) => d.total === 0} empty={<div className="empty">No records match.</div>}>{(d) => (
        <>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>SKU ID</th><th>Date</th><th>Product team member</th><th>Auditor</th><th>Error</th><th>Attribute</th><th>Audit comments</th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => openSku(r.skuId)}>
                <td><b>{r.skuId}</b></td><td className="nowrap">{date(r.auditDate)}</td><td>{r.builder}</td><td>{r.auditor}</td><td><CodeTags codes={r.codes} /></td>
                <td><div className="clip">{r.attribute}</div></td><td><div className="clip">{r.auditComments}</div></td></tr>))}</tbody>
          </table></div>
          <Pager page={page} pageSize={10} total={d.total} onPage={setPage} />
          <p className="muted small">Click a row to see the full history of that SKU.</p>
        </>)}</Async>
    </Modal>
  );
}
