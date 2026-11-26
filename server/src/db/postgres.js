// PostgreSQL adapter (same interface as sqlite.js).
// NOTE: written for production use but NOT tested in the development PC (no PostgreSQL available there).
// Requires:  npm install pg   and   DB_CLIENT=postgres  DATABASE_URL=postgres://user:pass@host/db
export async function openPostgres(url, schemaSql) {
  const pg = (await import('pg')).default;
  pg.types.setTypeParser(20, (v) => parseInt(v, 10)); // BIGINT -> number
  // allowExitOnIdle: idle connections never keep a finished script/test alive (the web server keeps the app itself running)
  const pool = new pg.Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX) || 10, allowExitOnIdle: true, idleTimeoutMillis: 10000 });
  await pool.query(schemaSql);
  const conv = (sql) => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };
  const make = (q) => ({
    kind: 'postgres',
    all: async (sql, p = []) => (await q.query(conv(sql), p)).rows,
    get: async (sql, p = []) => (await q.query(conv(sql), p)).rows[0],
    run: async (sql, p = []) => { const r = await q.query(conv(sql), p); return { lastId: null, changes: r.rowCount }; },
    insert: async (sql, p = []) => (await q.query(conv(sql) + ' RETURNING id', p)).rows[0].id,
    exec: async (sql) => { await q.query(sql); },
  });
  const api = make(pool);
  api.close = () => pool.end();
  api.tx = async (fn) => {
    const c = await pool.connect();
    try { await c.query('BEGIN'); const out = await fn(make(c)); await c.query('COMMIT'); return out; }
    catch (e) { await c.query('ROLLBACK'); throw e; }
    finally { c.release(); }
  };
  return api;
}
