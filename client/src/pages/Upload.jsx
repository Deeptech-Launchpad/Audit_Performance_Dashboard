import { useRef, useState } from 'react';
import { api, download, useApi } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { useMeta } from '../lib/filters.jsx';
import { bytes, date, dateTime, num, plural } from '../lib/format.js';
import { Alert, Async, Card, DataTable, Icon, Info, PageHeader } from '../components/ui.jsx';
import { CodeTags } from '../components/Details.jsx';

const VERDICT = {
  identical: ['Already imported', 'The same record with the same details is already in the system.'],
  changed: ['Updated details', 'The same audit finding exists, but PT / re-audit / comment details are different.'],
  conflict: ['Different result for a known SKU', 'This SKU already has another audit result.'],
  inFileDuplicate: ['Repeated in this file', 'The same record appears more than once in this file.'],
  knownSku: ['Known SKU, no audit result', 'The SKU was imported earlier; this row adds nothing new.'],
};
const DECISION = { skip: 'Skip', update: 'Update the existing record', import: 'Import as a new record' };

function Tile({ label, value, tone, info }) {
  return <div className="card kpi" style={{ padding: '10px 14px' }}><div className="lbl">{label}{info && <Info text={info} />}</div><div className="val" style={{ fontSize: 22, color: tone ? `var(--${tone})` : undefined }}>{num(value)}</div></div>;
}

function FileCard({ item, onChange, onDone }) {
  const { reload, projects = [] } = useMeta(); const [a, setA] = useState(item.analysis);
  const [project, setProject] = useState(item.analysis?.upload?.project || '');
  const [decisions, setDecisions] = useState(() => Object.fromEntries((item.analysis?.review || []).map((r) => [r.rowNo, r.defaultDecision])));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [result, setResult] = useState(null); const [showAll, setShowAll] = useState(false);
  if (item.failed) return (
    <Card title={item.fileName}><div className="alert error" role="alert"><div><b>This file was not imported.</b><br />{item.error}</div></div>
      <p className="muted small">Nothing was added to the audit data. The failure is recorded in the upload history below.</p></Card>);

  const reanalyse = async (patch) => {
    setBusy(true); setErr('');
    try {
      const r = await api.post(`/api/uploads/${item.id}/analyze`, patch);
      setA(r.analysis); setDecisions(Object.fromEntries(r.analysis.review.map((x) => [x.rowNo, x.defaultDecision])));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true); setErr('');
    try {
      const body = { auditDate: a.upload.auditDate || undefined, tableIndex: a.sheet.index, project: project.trim() || undefined, decisions: Object.fromEntries(Object.entries(decisions).filter(([k, v]) => a.review.find((r) => r.rowNo === Number(k))?.defaultDecision !== v)) };
      const r = await api.post(`/api/uploads/${item.id}/commit`, body);
      setResult(r); reload(); onDone?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const discard = async () => { try { await api.post(`/api/uploads/${item.id}/discard`); } catch { /* ignore */ } onChange('remove'); };

  if (result) return (
    <Card title={a.upload.fileName}>
      <div className="alert ok" role="status"><div><b>✔ Import finished.</b> {plural(result.imported, 'record')} added, {plural(result.updated, 'record')} updated, {plural(result.skipped, 'record')} skipped.</div></div>
      <div className="row mt-s"><button className="btn" onClick={() => download(`/api/uploads/${item.id}/report`, {}, 'upload-report.xlsx')}><Icon name="download" /> Download processing report</button>
        <button className="btn link" onClick={() => onChange('remove')}>Dismiss</button></div>
    </Card>);

  const c = a.counts; const d = a.dataChecks; const review = a.review; const unresolved = a.blockers.length > 0;
  const setAll = (verdict, value) => setDecisions((d) => { const n = { ...d }; review.filter((r) => r.verdict === verdict).forEach((r) => { n[r.rowNo] = value; }); return n; });
  const willImport = c.new + review.filter((r) => decisions[r.rowNo] === 'import').length;
  const willUpdate = review.filter((r) => decisions[r.rowNo] === 'update').length;
  const willSkip = review.filter((r) => decisions[r.rowNo] === 'skip').length + c.invalid;
  const warnEntries = Object.entries(a.validation.warnings || {}); const missEntries = Object.entries(a.validation.missingValues || {});

  return (
    <Card title={<>{a.upload.fileName} <span className="muted small">· {bytes(a.upload.fileSize)}</span></>}>
      {err && <div className="alert error mb" role="alert"><div>{err}</div></div>}
      {a.sameFileBefore && <div className="alert warn mb"><div><b>This exact file was already imported</b> on {dateTime(a.sameFileBefore.importedAt)}. Records that are already in the system are marked as duplicates below and will be skipped unless you choose otherwise.</div></div>}
      <div className="row mb">
        <div className="field"><label htmlFor={`d${item.id}`}>Audit date for this file <Info text="The audit files do not contain a date column. Enter the day this audit was done. It is taken from the file name when possible." /></label>
          <input id={`d${item.id}`} type="date" value={a.upload.auditDate || ''} onChange={(e) => reanalyse({ auditDate: e.target.value || null })} disabled={busy} required />
          <span className="muted small">{a.upload.dateFromName && a.upload.dateFromName === a.upload.auditDate ? 'Found in the file name – please check it.' : !a.upload.auditDate ? 'Not found in the file name – please choose.' : ''}</span></div>
        <div className="field"><label htmlFor={`p${item.id}`}>Project <Info text="The audit table has no project column, so name the project this file belongs to. It is suggested from the file name – change it if needed. Files with the same project name are grouped, and you can filter every page by project." /></label>
          <input id={`p${item.id}`} type="text" list={`pl${item.id}`} value={project} maxLength={120} onChange={(e) => setProject(e.target.value)} style={{ minWidth: 260 }} />
          <datalist id={`pl${item.id}`}>{projects.map((p) => <option key={p.name} value={p.name} />)}</datalist>
          <span className="muted small">Suggested from the file name.</span></div>
        {a.sheet.options.length > 1 && (
          <div className="field"><label htmlFor={`s${item.id}`}>Sheet to read <Info text="This workbook has more than one sheet that looks like an audit table. The best match is chosen automatically; change it only if the wrong one was picked." /></label>
            <select id={`s${item.id}`} value={a.sheet.index} onChange={(e) => reanalyse({ tableIndex: Number(e.target.value) })} disabled={busy}>{a.sheet.options.map((o) => <option key={o.index} value={o.index}>{o.name} ({num(o.rows)} rows)</option>)}</select></div>)}
        <span className="muted small">Reading sheet “{a.sheet.used}”, headings on row {a.sheet.headerRow}.</span>
      </div>

      {a.blockers.map((b) => <div key={b} className="alert error mb" role="alert"><div>{b}</div></div>)}
      {a.columns.missingOptional.length > 0 && <Alert kind="warn">These audit columns were not found: <b>{a.columns.missingOptional.join(', ')}</b>. The file can still be imported, but numbers that need them will be incomplete.</Alert>}

      <div className="grid g-kpi mt-s" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))' }}>
        <Tile label="Rows read" value={c.rowsRead} /><Tile label="New records" value={c.new} tone="good" info="Records not seen before." />
        <Tile label="Already imported" value={c.identical} info="Identical to a record already in the system." /><Tile label="Updated details" value={c.changed} tone={c.changed ? 'watch' : undefined} info="Same audit finding, different PT / re-audit / comment details." />
        <Tile label="Needs a look" value={c.conflict + c.inFileDuplicate + c.knownSku} tone={c.conflict + c.inFileDuplicate ? 'watch' : undefined} info="Repeated rows, or SKUs that already have a different audit result." /><Tile label="Invalid rows" value={c.invalid} tone={c.invalid ? 'improve' : undefined} info="Rows without a SKU ID. They cannot be imported." />
      </div>
      <p className="mt-s"><b>On import:</b> {plural(willImport, 'record')} will be added, {plural(willUpdate, 'record')} updated, {plural(willSkip, 'record')} skipped.{c.blankRows > 0 && <span className="muted small"> ({c.blankRows} blank rows ignored.)</span>}</p>
      <div className="alert info mt-s"><div>
        <b>What this file contains</b> <span className="muted small">(calculated only from columns A–N of the sheet “{a.sheet.used}”)</span><br />
        {num(d.skus)} SKUs · {num(d.samples)} audited samples · {num(d.errorSkus)} SKUs with errors · {num(d.classifications)} error classifications{d.attributes.columnsFound && <> · {num(d.attributes.enrichedTotal)} attributes enriched <span className="muted small">({d.attributes.slots} attribute columns found)</span></>}
        {d.extraClassifications > 0 && <> <span className="muted small">({d.extraClassifications} more classifications than SKUs because {plural(d.multiErrorSkus.length, 'SKU')} {d.multiErrorSkus.length === 1 ? 'has' : 'have'} more than one error code)</span></>}
        {!d.totalSkusAvailable && <div className="mt-s"><b>Total SKUs: Not available.</b> {d.totalSkusNote}</div>}
        {!d.attributes.columnsFound && <div className="mt-s"><b>Attributes: Not available.</b> {d.attributes.note}</div>}
        {d.categories && (d.categories.columnFound
          ? <div className="mt-s muted small">Categories: “PIM Taxonomy” found in column {d.categories.column} · {num(d.categories.count)} categor{d.categories.count === 1 ? 'y' : 'ies'}{d.categories.skusWithoutCategory ? ` · ${num(d.categories.skusWithoutCategory)} SKU(s) without a category` : ''}</div>
          : <div className="mt-s"><b>Categories: Not available.</b> {d.categories.note}</div>)}
      </div></div>

      {(warnEntries.length > 0 || missEntries.length > 0 || a.validation.unrecognisedCodes.length > 0) && (
        <details className="mt-s" open={a.validation.unrecognisedCodes.length > 0}><summary><b>Checks and warnings</b> ({warnEntries.length + missEntries.length + a.validation.unrecognisedCodes.length})</summary>
          <ul>
            {a.validation.unrecognisedCodes.length > 0 && <li>Error codes that are not in the error list: <b>{a.validation.unrecognisedCodes.map((u) => `${u.code} (${u.rows})`).join(', ')}</b>. They are <b>not counted as errors</b> until an Admin adds them in Settings → Error types.</li>}
            {warnEntries.map(([w, n]) => <li key={w}>{w} – {plural(n, 'row')}</li>)}
            {missEntries.map(([w, n]) => <li key={w}>Missing <b>{w}</b> on {plural(n, 'row')}</li>)}
          </ul>
          {a.validation.skipped.length > 0 && <><b>Rows that cannot be imported</b><ul>{a.validation.skipped.slice(0, 10).map((s) => <li key={s.rowNo}>Row {s.rowNo}: {s.reason}</li>)}{a.validation.skipped.length > 10 && <li>…and {a.validation.skipped.length - 10} more</li>}</ul></>}
        </details>)}

      <details className="mt-s"><summary><b>Columns read</b> <Info text="The audit columns A to N are read. Of everything to the right of column N, only these are looked at: the attribute columns (Att 1, Raw Val 1, Build Val 1 …) to count attributes, PIM Taxonomy for categories, and – for rows that name an attribute – the source links, source page numbers and captured values. Other sheets and summary tables are ignored." /></summary>
        <p className="small" style={{ marginTop: 6 }}>{Object.entries(a.columns.found).map(([k, v]) => <span key={k} className="tag">{v}</span>)}</p>
        {a.columns.missingOptional.length > 0 && <p className="small muted">Not found in A–N: {a.columns.missingOptional.join(', ')}</p>}
      </details>

      {a.reviewTotal > 0 && (
        <div className="mt">
          <div className="row"><h3 style={{ fontSize: 15 }}>Review duplicates ({num(a.reviewTotal)})</h3>
            <Info text="Choose what happens to each row that is already known. Nothing is added twice unless you choose ‘Import as a new record’." /><span className="grow" />
            {review.some((r) => r.verdict === 'identical') && <><button className="btn small" onClick={() => setAll('identical', 'skip')}>Skip all already-imported</button></>}
            {review.some((r) => r.verdict === 'changed') && <><button className="btn small" onClick={() => setAll('changed', 'update')}>Update all changed</button><button className="btn small" onClick={() => setAll('changed', 'skip')}>Skip all changed</button></>}
          </div>
          <div className="tbl-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}><table className="tbl">
            <thead><tr><th>Row</th><th>SKU</th><th>Product team member</th><th>What was found</th><th>What to do</th></tr></thead>
            <tbody>{review.slice(0, showAll ? 2000 : 25).map((r) => (
              <tr key={r.rowNo}><td>{r.rowNo}</td><td><b>{r.skuId}</b><div><CodeTags codes={r.codes} /></div></td><td>{r.builder}</td>
                <td><span className={`badge ${r.verdict === 'identical' ? 'few' : 'watch'}`}>{VERDICT[r.verdict][0]}</span><div className="small muted">{r.reason}</div>
                  {r.diff.length > 0 && <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 16 }}>{r.diff.slice(0, 6).map((d) => <li key={d.field}><b>{d.field}:</b> “{d.old || '—'}” → “{d.new || '—'}”</li>)}</ul>}</td>
                <td><select aria-label={`Decision for row ${r.rowNo}`} value={decisions[r.rowNo]} onChange={(e) => setDecisions({ ...decisions, [r.rowNo]: e.target.value })}>{r.options.map((o) => <option key={o} value={o}>{DECISION[o]}</option>)}</select></td></tr>))}</tbody></table></div>
          {review.length > 25 && <button className="btn link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${review.length} rows`}</button>}
        </div>)}

      <details className="mt-s"><summary><b>Preview of the first {a.preview.length} rows</b></summary>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Row</th><th>SKU ID</th><th>SKU Build By</th><th>Sample</th><th>Audit By</th><th>Error type</th><th>Attribute / field</th><th>PT status</th></tr></thead>
          <tbody>{a.preview.map((r) => <tr key={r.rowNo}><td>{r.rowNo}</td><td>{r.skuId}</td><td>{r.builder || <span className="badge watch">missing</span>}</td><td>{r.sample}</td><td>{r.auditor}</td><td>{r.errorType}</td><td><div className="clip">{r.attribute}</div></td><td>{r.ptStatus}</td></tr>)}</tbody></table></div></details>

      <div className="row mt">
        <button className="btn primary" onClick={commit} disabled={busy || unresolved}>{busy ? 'Working…' : `Import ${plural(willImport + willUpdate, 'record')}`}</button>
        <button className="btn" onClick={discard} disabled={busy}>Cancel – do not import</button>
        {unresolved && <span className="muted small">Fix the red message above first.</span>}
      </div>
    </Card>
  );
}

function History({ onReview }) {
  const { can } = useAuth(); const { reload: reloadMeta } = useMeta(); const st = useApi('/api/uploads'); const [msg, setMsg] = useState('');
  const review = async (u) => {
    try { const r = await api.get(`/api/uploads/${u.id}`); onReview({ id: u.id, key: u.id, fileName: u.original_name, failed: false, analysis: r.analysis }); setMsg(''); }
    catch (e) { setMsg(e.message); st.reload(); }
  };
  const openInExcel = async (u) => {
    try {
      // on the same PC as the server: open straight in Excel; from another computer: download the file instead
      const r = await api.post(`/api/uploads/${u.id}/open-local`);
      if (r.opened) { setMsg(`Opening ${r.original ? 'the full original file' : 'columns A to N of'} “${u.original_name}” in Excel…${r.original ? '' : ' (the original file was uploaded before full copies were kept – upload it again to open the full file).'} If Excel does not appear in a few seconds, open this file yourself: ${r.file}`); return; }
      await download(`/api/uploads/${u.id}/export`, {}, 'audit-data.xlsx');
      setMsg(`“${u.original_name.replace(/\.ods$/i, '.xlsx')}” is downloaded – the full file, every sheet and column, as an Excel file. Click it in the browser’s download list (the ↓ arrow at the top right) or open it from your Downloads folder. A website cannot open Excel by itself.`);
    } catch (e) { setMsg(e.message); }
  };
  const rename = async (u) => {
    const name = window.prompt('Project name for this file:', u.project || ''); if (name == null || !name.trim()) return;
    try { await api.patch(`/api/uploads/${u.id}/project`, { project: name.trim() }); setMsg(`Project changed to “${name.trim()}”.`); st.reload(); reloadMeta(); } catch (e) { setMsg(e.message); }
  };
  const discard = async (u) => { try { await api.post(`/api/uploads/${u.id}/discard`); } catch (e) { setMsg(e.message); } st.reload(); };
  const undo = async (u) => {
    if (!window.confirm(`Remove the ${u.imported_rows} records added by “${u.original_name}”? Records this file only updated are not reverted.`)) return;
    try { await api.post(`/api/uploads/${u.id}/undo`); setMsg(`Removed the import of “${u.original_name}”.`); st.reload(); reloadMeta(); } catch (e) { setMsg(e.message); }
  };
  const label = { imported: ['Imported', 'good'], failed: ['Failed', 'improve'], undone: ['Undone', 'few'], preview: ['Waiting for review', 'watch'] };
  return (
    <Card title="Upload history" className="mt">
      {msg && <Alert kind="info">{msg}</Alert>}
      <Async state={st} emptyWhen={(d) => !d.length} empty={<div className="empty">No files uploaded yet.</div>}>{(rows) => (
        <DataTable rows={rows} pageSize={10} initialSort={{ key: 'id', dir: 'desc' }} columns={[
          { key: 'original_name', label: 'File', render: (u) => <><b>{u.original_name}</b>{u.error && <div className="small" style={{ color: 'var(--improve)' }}>{u.error}</div>}</> },
          { key: 'project', label: 'Project', render: (u) => (u.project ? <>{u.project}{u.status === 'imported' && can('upload') && <button className="btn link" onClick={() => rename(u)} title="Change the project name">edit</button>}</> : <span className="muted">—</span>) },
          { key: 'audit_date', label: 'Audit date', render: (u) => date(u.audit_date) },
          { key: 'uploaded_at', label: 'Uploaded', render: (u) => <>{dateTime(u.uploaded_at)}<div className="small muted">{u.uploaded_by}</div></> },
          { key: 'status', label: 'Result', render: (u) => <><span className={`badge ${label[u.status]?.[1] || 'few'}`}>{label[u.status]?.[0] || u.status}</span>
            {u.status === 'imported' && u.no_attr > 0 && <div className="small" style={{ color: 'var(--watch)', marginTop: 4 }} title="The attribute counts of this file were not saved when it was first uploaded (before attribute counting existed). The file itself has them: upload it once more and the rows show as ‘Updated details’, adding the counts without duplicating anything.">⚠ Attribute counts not saved yet – upload this file once more to add them</div>}</> },
          { key: 'total_rows', label: 'Rows', num: true }, { key: 'imported_rows', label: 'Imported', num: true }, { key: 'updated_rows', label: 'Updated', num: true }, { key: 'skipped_rows', label: 'Skipped', num: true },
          { key: 'act', label: '', sort: false, render: (u) => (
            <div className="row gap-s nowrap">
              {u.status === 'imported' && u.imported_rows === 0 && u.updated_rows > 0 && <span className="small muted" style={{ alignSelf: 'center' }} title="This upload only updated records that an earlier upload of the same file had added. Use “Open in Excel” on that earlier upload.">updated existing rows only</span>}
              {u.status === 'imported' && u.imported_rows > 0 && <button className="btn small primary" title="Opens the full original file in Excel, exactly as it was uploaded (all sheets and columns)." onClick={() => openInExcel(u)}><Icon name="download" /> Open in Excel</button>}
              {(u.status === 'imported' || u.status === 'failed') && <button className="btn small" title="Import report (Excel): what happened to every row of this upload. Which rows were imported, which were skipped and why, which existing records were updated (old value to new value), warnings found, and the totals." onClick={() => download(`/api/uploads/${u.id}/report`, {}, 'import-report.xlsx')}><Icon name="download" /> Import report</button>}
              {u.status === 'preview' && can('upload') && <><button className="btn small primary" onClick={() => review(u)}>Review &amp; import</button><button className="btn small" onClick={() => discard(u)}>Discard</button></>}
              {u.status === 'imported' && can('undoUpload') && <button className="btn small danger" onClick={() => undo(u)}>Undo</button>}
            </div>) },
        ]} />)}</Async>
    </Card>
  );
}

export default function Upload() {
  const { can } = useAuth(); const input = useRef(); const [items, setItems] = useState([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [over, setOver] = useState(false); const [histKey, setHistKey] = useState(0);
  if (!can('upload')) return <><PageHeader title="Upload Audit Files" /><Alert kind="warn">Your role can view the dashboard but cannot upload files. Ask an Audit Team Leader, Audit Manager or Admin.</Alert><History key={histKey} onReview={() => {}} /></>;
  async function send(fileList) {
    const files = [...fileList]; if (!files.length) return;
    const bad = files.find((f) => !/\.(ods|xlsx|xls)$/i.test(f.name));
    if (bad) return setErr(`“${bad.name}” is not an .ods, .xlsx or .xls file.`);
    if (files.length > 10) return setErr('Please upload up to 10 files at a time.');
    setBusy(true); setErr('');
    try {
      const fd = new FormData(); files.forEach((f) => fd.append('files', f));
      const r = await api.post('/api/uploads', fd);
      setItems((old) => [...r.files.map((f) => ({ ...f, key: f.id })), ...old]); setHistKey((k) => k + 1);
    } catch (e) { setErr(e.message); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  return (
    <>
      <PageHeader title="Upload Audit Files" subtitle="Upload the daily audit files (.ods, .xlsx or .xls). You can choose 2–3 files at once. Only columns A to N are read. Nothing is saved until you check the preview and press Import – the dashboards stay empty until then." />
      <div className={`drop ${over ? 'over' : ''}`} role="button" tabIndex={0} onClick={() => input.current.click()} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}>
        <Icon name="upload" size={30} /><div style={{ fontWeight: 650, marginTop: 6 }}>{busy ? 'Reading your files…' : 'Drop audit files here, or click to choose'}</div>
        <div className="muted small">.ods, .xlsx, .xls · up to 60 MB each · files are read in memory and checked first</div>
        <input ref={input} type="file" multiple accept=".ods,.xlsx,.xls" hidden onChange={(e) => send(e.target.files)} />
      </div>
      {err && <div className="alert error mt-s" role="alert"><div>{err}</div></div>}
      <div className="grid mt">{items.map((it) => <FileCard key={it.key} item={it} onChange={(a) => a === 'remove' && setItems((l) => l.filter((x) => x.key !== it.key))} onDone={() => setHistKey((k) => k + 1)} />)}</div>
      <History key={histKey} onReview={(it) => setItems((old) => (old.some((x) => x.key === it.key) ? old : [it, ...old]))} />
    </>
  );
}
