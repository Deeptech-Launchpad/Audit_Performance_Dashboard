import { useMemo, useState } from 'react';
import { useApi } from '../lib/api.js';
import { useFilters } from '../lib/filters.jsx';
import { num, pct } from '../lib/format.js';
import FilterBar from '../components/FilterBar.jsx';
import { Async, Card, DataTable, Drawer, Icon, Info, Kpi, PageHeader, Tabs } from '../components/ui.jsx';

const ALLOWED = ['from', 'to', 'week', 'month', 'uploadId', 'project', 'auditorId'];

// Plain words for audit team and managers. (Internal keys strong/ok/weak/early/untested come from the server.)
const RATING = {
  strong: { label: 'Great', cls: 'good', dot: '●' },
  ok: { label: 'Okay', cls: 'watch', dot: '●' },
  weak: { label: 'Needs coaching', cls: 'improve', dot: '●' },
  early: { label: 'Not enough checks', cls: 'few', dot: '○' },
  untested: { label: 'Not checked yet', cls: 'few', dot: '○' },
};
const CHOICE = {
  proven: { label: 'Clear best choice', cls: 'good', hint: 'These people have enough checked SKUs and very few mistakes.' },
  'best available': { label: 'Best guess – few checks', cls: 'watch', hint: 'Nobody is rated Great yet. This is the best person so far, but only a few of their SKUs were checked, so it is a guess.' },
  'none suitable': { label: 'No one ready yet', cls: 'improve', hint: 'Everyone here either needs coaching or has no checked SKUs. Decide yourself, or coach someone first.' },
  'no history': { label: 'New category', cls: 'few', hint: 'Nobody has built SKUs in this category before.' },
};
const ORDER_ATTENTION = { 'none suitable': 0, 'best available': 1, proven: 2, 'no history': 3 };
const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c7)', 'var(--c5)', 'var(--c6)', 'var(--c8)', 'var(--c4)'];
const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const initials = (n) => String(n).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

const Avatar = ({ name, size = 34 }) => <span className="avatar" style={{ width: size, height: size, background: COLORS[hash(name) % COLORS.length], fontSize: size * 0.38 }} aria-hidden="true">{initials(name)}</span>;
const Rating = ({ t }) => <span className={`badge ${RATING[t].cls}`}>{RATING[t].dot} {RATING[t].label}</span>;
const Rate = ({ m }) => (m.samples ? <b>{pct(m.errorRate)}</b> : <span className="muted">–</span>);

export default function Categories() {
  const { params } = useFilters(ALLOWED);
  const st = useApi('/api/categories', params);
  return (
    <>
      <PageHeader title="Category Performance" subtitle="Who does best in each product category? Use this page to decide who should get new SKUs." />
      <FilterBar show={['period', 'project', 'file', 'auditor']} />
      <Async state={st} emptyWhen={(d) => d.empty}>{(d) => <Body d={d} />}</Async>
    </>
  );
}

function HowToRead({ s }) {
  return (
    <details className="howto mb" open>
      <summary><Icon name="info" size={16} /> How to read this page</summary>
      <div className="howto-body">
        <p>We group SKUs by <b>product category</b> (the first part of the PIM Taxonomy, for example “Abrasives”). For each person and category we look at the SKUs the Audit Team <b>checked</b> and count how many had a mistake. That share is the <b>mistake rate</b>. The number in brackets is how many of their SKUs were checked.</p>
        <div className="legend-row">
          <span><Rating t="strong" /> {s.minCat}+ SKUs checked and {s.target}% mistakes or fewer</span>
          <span><Rating t="ok" /> up to {s.target + s.margin}%</span>
          <span><Rating t="weak" /> more than {s.target + s.margin}%</span>
          <span><Rating t="early" /> fewer than {s.minCat} SKUs checked, so we cannot judge yet</span>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>The limits can be changed by the Admin in Settings.</p>
      </div>
    </details>
  );
}

function Body({ d }) {
  const [tab, setTab] = useState('category'); const [q, setQ] = useState(''); const [sort, setSort] = useState('size'); const [sel, setSel] = useState(null); const [showAll, setShowAll] = useState(false);
  const s = d.settings; const cov = d.coverage;
  const match = (t) => String(t).toLowerCase().includes(q.trim().toLowerCase());
  const cats = useMemo(() => {
    const l = d.categories.filter((c) => !q.trim() || match(c.name));
    return l.slice().sort(sort === 'az' ? (a, b) => a.name.localeCompare(b.name) : sort === 'attention' ? (a, b) => ORDER_ATTENTION[a.basis] - ORDER_ATTENTION[b.basis] || b.skus - a.skus : (a, b) => b.skus - a.skus);
  }, [d.categories, q, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  const people = useMemo(() => d.people.filter((p) => !q.trim() || match(p.name)), [d.people, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const projects = useMemo(() => {
    const l = (d.projects || []).filter((c) => !q.trim() || match(c.name));
    return l.slice().sort(sort === 'az' ? (a, b) => a.name.localeCompare(b.name) : sort === 'attention' ? (a, b) => ORDER_ATTENTION[a.basis] - ORDER_ATTENTION[b.basis] || b.skus - a.skus : (a, b) => b.skus - a.skus);
  }, [d.projects, q, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!d.categories.length) {
    return (
      <Card><div className="empty"><h3>No category information yet</h3>
        None of the uploaded files in this selection has a “PIM Taxonomy” column. Upload the file(s) again on Upload Audit Files: the rows show as “Updated details” and the categories are added.
        {d.missingFiles.length > 0 && <div className="small mt-s">Files without it: {d.missingFiles.map((f) => f.name).join(', ')}</div>}</div></Card>
    );
  }
  const gridCats = showAll ? d.categories : d.categories.slice(0, 12);
  const cell = (c, p) => c.members.find((m) => (m.id ?? m.name) === (p.id ?? p.name));

  return (
    <>
      {d.missingFiles.length > 0 && (
        <div className="alert warn mb" role="status"><div><b>{d.missingFiles.length} file{d.missingFiles.length === 1 ? '' : 's'} not included:</b> {d.missingFiles.map((f) => f.name).join(', ')}. {d.missingFiles.length === 1 ? 'It has' : 'They have'} no category saved yet. Upload {d.missingFiles.length === 1 ? 'it' : 'them'} once more on Upload Audit Files and the categories are added (nothing is duplicated).</div></div>
      )}
      <div className="grid g3 mb">
        <Kpi label="Product categories" value={num(d.summary.categories)} sub={`${num(cov.skusWithCategory)} of ${num(cov.skusTotal)} SKUs have a category`} info="The category is the first part of the PIM Taxonomy, for example “Abrasives”." />
        <Kpi label="With a clear best choice" value={num(d.summary.withProven)} tone="good" sub="someone is rated Great" info="At least one person is rated Great there: enough checked SKUs and very few mistakes." />
        <Kpi label="Need your attention" value={num(d.summary.noProven)} tone={d.summary.noProven ? 'watch' : 'good'} sub="no clear best choice yet" info="Nobody is rated Great yet. Use the best guess shown, coach someone, or get more of their SKUs checked." />
      </div>

      <HowToRead s={s} />

      <div className="toolbar mb">
        <Tabs value={tab} onChange={(v) => { setTab(v); setQ(''); }} items={[['category', 'By category'], ['project', 'By project'], ['person', 'By person'], ['grid', 'Overview grid']]} />
        {tab !== 'grid' && (
          <div className="toolbar-tools">
            <div className="search-mini"><Icon name="search" size={15} /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'category' ? 'Find a category…' : tab === 'project' ? 'Find a project…' : 'Find a person…'} aria-label={tab === 'category' ? 'Find a category' : tab === 'project' ? 'Find a project' : 'Find a person'} /></div>
            {(tab === 'category' || tab === 'project') && <div className="field inline"><label htmlFor="cs">Show</label><select id="cs" value={sort} onChange={(e) => setSort(e.target.value)}><option value="size">{tab === 'project' ? 'Biggest projects first' : 'Biggest categories first'}</option><option value="attention">Needs attention first</option><option value="az">A to Z</option></select></div>}
          </div>)}
      </div>

      {tab === 'category' && (
        cats.length ? (
          <div className="cat-grid">{cats.map((c, i) => <CategoryCard key={c.name} c={c} i={i} onOpen={() => setSel(c)} />)}</div>
        ) : <div className="empty">No category matches “{q}”.</div>
      )}

      {tab === 'project' && (
        <>
          <p className="muted small mb">Who does best in each project (the first word of the project name, as in the Project filter). Same ratings as the categories; every audited SKU of the project counts, also SKUs without a category.</p>
          {projects.length ? (
            <div className="cat-grid">{projects.map((c, i) => <CategoryCard key={c.name} c={c} i={i} onOpen={() => setSel({ ...c, isProject: true })} more="See everyone in this project →" />)}</div>
          ) : <div className="empty">No project matches “{q}”.</div>}
        </>
      )}

      {tab === 'person' && (
        people.length ? <div className="cat-grid">{people.map((p, i) => <PersonCard key={p.id ?? p.name} p={p} i={i} />)}</div> : <div className="empty">Nobody matches “{q}”.</div>
      )}

      {tab === 'grid' && (
        <Card title="Everyone, in every category" info="Each box shows the mistake rate of one person in one category, with the number of checked SKUs in brackets. A dash means they built SKUs there but none were checked.">
          <div className="tbl-wrap"><table className="tbl grid-tbl">
            <thead><tr><th style={{ position: 'sticky', left: 0, zIndex: 2 }}>Team member</th>{gridCats.map((c) => <th key={c.name} className="num" title={c.name} style={{ minWidth: 96 }}><div className="clip" style={{ maxWidth: 110 }}>{c.name}</div></th>)}</tr></thead>
            <tbody>{d.people.map((p) => (
              <tr key={p.id ?? p.name}><td style={{ position: 'sticky', left: 0, background: 'var(--surface)', fontWeight: 600 }}><span className="row gap-s" style={{ flexWrap: 'nowrap' }}><Avatar name={p.name} size={24} />{p.name}</span></td>
                {gridCats.map((c) => {
                  const m = cell(c, p);
                  if (!m) return <td key={c.name} className="num muted">·</td>;
                  return <td key={c.name} className={`num cell-${RATING[m.tier].cls}`} title={`${p.name} in ${c.name}: ${RATING[m.tier].label}. ${m.skus} SKUs built, ${m.samples} checked, ${m.errorSkus} with mistakes.`}>
                    {m.samples ? <><b>{pct(m.errorRate)}</b> <span className="small">({m.samples})</span></> : '–'}</td>;
                })}</tr>))}</tbody>
          </table></div>
          {d.categories.length > 12 && <button className="btn link" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show only the 12 biggest categories' : `Show all ${d.categories.length} categories`}</button>}
          <div className="legend-row mt-s">{['strong', 'ok', 'weak', 'early'].map((k) => <span key={k}><Rating t={k} /></span>)}</div>
        </Card>
      )}

      {sel && <CategoryDrawer c={sel} s={s} onClose={() => setSel(null)} />}
    </>
  );
}

function CategoryCard({ c, i, onOpen, more = 'See everyone in this category →' }) {
  const ch = CHOICE[c.basis]; const best = c.recommended[0]; const others = c.recommended.slice(1);
  return (
    <article className={`cat-card tone-${ch.cls}`} style={{ '--i': Math.min(i, 12) }}>
      <header>
        <h3 title={c.name}>{c.name}</h3>
        <span className="muted small">{num(c.skus)} SKUs · {num(c.samples)} checked</span>
      </header>
      <div className="cat-choice"><span className={`badge ${ch.cls}`} title={ch.hint}>{ch.label}</span></div>
      {best ? (
        <div className="cat-best">
          <Avatar name={best.name} size={40} />
          <div className="grow">
            <div className="cat-name">{best.name}</div>
            <div className="small muted">{best.samples ? `${best.samples} of their SKUs checked` : 'none of their SKUs checked yet'}</div>
            <div className="meter" title={`${pct(best.errorRate)} of their checked SKUs had a mistake`}><i className={`fill-${RATING[best.tier].cls}`} style={{ '--w': `${Math.min(100, best.errorRate ?? 0)}%` }} /></div>
          </div>
          <div className="cat-rate"><b>{best.samples ? pct(best.errorRate) : '–'}</b><span>mistakes</span></div>
        </div>
      ) : <div className="cat-best muted">No one to suggest yet.</div>}
      {others.length > 0 && <div className="cat-line"><span className="muted small">Also great:</span> {others.map((m) => <span key={m.name} className="tag"><b>{m.name}</b> {pct(m.errorRate)}</span>)}</div>}
      {c.needsSupport.length > 0 && <div className="cat-line"><span className="muted small">Needs coaching:</span> {c.needsSupport.map((m) => <span key={m.name} className="tag tag-bad">{m.name} {pct(m.errorRate)}</span>)}</div>}
      <button className="btn link cat-more" onClick={onOpen}>{more}</button>
    </article>
  );
}

function PersonCard({ p, i }) {
  const few = p.early.length + p.untested.length;
  return (
    <article className="cat-card person" style={{ '--i': Math.min(i, 12) }}>
      <header className="row gap-s" style={{ flexWrap: 'nowrap' }}>
        <Avatar name={p.name} size={42} />
        <div className="grow"><h3>{p.name}</h3><span className="muted small">works in {p.categoriesWorked} categor{p.categoriesWorked === 1 ? 'y' : 'ies'}</span></div>
      </header>
      <div className="cat-line stack"><span className="small"><b>Great in</b> <span className="muted">(give them more of these)</span></span>
        <div>{p.strong.length ? p.strong.map((x) => <span key={x.category} className="tag tag-good">{x.category} {pct(x.errorRate)} <span className="muted">({x.samples})</span></span>) : <span className="muted small">No category yet</span>}</div></div>
      {p.weak.length > 0 && <div className="cat-line stack"><span className="small"><b>Needs coaching in</b></span>
        <div>{p.weak.map((x) => <span key={x.category} className="tag tag-bad">{x.category} {pct(x.errorRate)} <span className="muted">({x.samples})</span></span>)}</div></div>}
      {few > 0 && <div className="small muted">Not enough checked SKUs to judge in {few} categor{few === 1 ? 'y' : 'ies'}.</div>}
    </article>
  );
}

function CategoryDrawer({ c, s, onClose }) {
  const cols = [
    { key: 'name', label: 'Team member', render: (m) => <span className="row gap-s" style={{ flexWrap: 'nowrap' }}><Avatar name={m.name} size={26} /><b>{m.name}</b></span> },
    { key: 'tier', label: 'Rating', sort: (m) => Object.keys(RATING).indexOf(m.tier), render: (m) => <Rating t={m.tier} /> },
    { key: 'skus', label: 'SKUs built', num: true }, { key: 'samples', label: 'Checked', num: true }, { key: 'errorSkus', label: 'With mistakes', num: true },
    { key: 'errorRate', label: 'Mistake rate', num: true, sort: (m) => m.errorRate, render: (m) => <Rate m={m} /> },
    { key: 'attr', label: <>Attribute mistake rate <Info text="Attributes with mistakes ÷ attributes checked, for this person in this category." /></>, num: true, sort: (m) => m.attrErrorRate, render: (m) => (m.attrsAvailable && m.attrErrorRate != null ? pct(m.attrErrorRate) : '–') },
  ];
  return (
    <Drawer title={c.name} onClose={onClose} wide>
      <div className="grid g3 mb">
        <Kpi label="SKUs" value={num(c.skus)} /><Kpi label="Checked" value={num(c.samples)} /><Kpi label="Mistake rate" value={pct(c.errorRate)} sub={`${num(c.errorSkus)} SKUs with mistakes`} />
      </div>
      <Card title={c.isProject ? 'Everyone in this project' : 'Everyone in this category'} info={`Great = ${s.minCat} or more SKUs checked and ${s.target}% mistakes or fewer. Best first.`} flush>
        <div className="card-b"><DataTable columns={cols} rows={c.members} pageSize={20} rowKey={(m) => m.name} /></div>
      </Card>
    </Drawer>
  );
}
