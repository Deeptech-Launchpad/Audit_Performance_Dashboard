// Feedback board: only Developer accounts and Audit Managers see it; managers add notes, only the developer replies / changes status;
// owners may edit or delete only while "new".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { seedReferenceData } from '../src/services/settings.js';

process.env.AUDIT_NO_LAUNCH = '1';
let db, server, base;
const H = { 'x-requested-with': 'audit-app', 'content-type': 'application/json' };
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { ...H, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const t = await res.text(); let json; try { json = JSON.parse(t); } catch { json = t; }
    return { status: res.status, body: json };
  };
}
const admin = client(), viewer = client(), other = client(), plain = client();

before(async () => {
  db = await openDb({ client: 'sqlite', path: ':memory:' });
  await seedReferenceData(db);
  server = createApp(db).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await admin('POST', '/api/auth/setup', { username: 'admin', displayName: 'Dev', password: 'correct-horse-9' })).status, 201);
  for (const [u, n, role] of [['vino', 'Vino', 'manager'], ['ravi', 'Ravi', 'manager'], ['lee', 'Lee', 'leader']]) assert.equal((await admin('POST', '/api/users', { username: u, name: n, role, password: 'viewer-pass-123' })).status, 201);
  assert.equal((await plain('POST', '/api/auth/login', { username: 'lee', password: 'viewer-pass-123' })).status, 200);
  assert.equal((await viewer('POST', '/api/auth/login', { username: 'vino', password: 'viewer-pass-123' })).status, 200);
  assert.equal((await other('POST', '/api/auth/login', { username: 'ravi', password: 'viewer-pass-123' })).status, 200);
});
after(() => { server?.close(); });

test('feedback board: who can see it, add, edit rules, developer reply + done, counts, delete', async () => {
  // not a developer yet: even the Admin cannot see the board; a Team Leader never can
  assert.equal((await admin('GET', '/api/notes')).status, 403);
  assert.equal((await plain('GET', '/api/notes/count')).status, 403);
  assert.equal((await plain('POST', '/api/notes', { kind: 'bug', details: 'hello there', page: 'Overview' })).status, 403);
  const me = (await admin('GET', '/api/auth/status')).body.user;
  assert.equal(me.developer, false);
  assert.equal((await viewer('PATCH', `/api/users/${me.id}`, { developer: true })).status, 403, 'only Admin manages users');
  assert.equal((await admin('PATCH', `/api/users/${me.id}`, { developer: true })).status, 200);
  assert.equal((await admin('GET', '/api/auth/status')).body.user.developer, true);
  assert.equal((await admin('GET', '/api/users')).body.find((u) => u.id === me.id).developer, true);

  const add = await viewer('POST', '/api/notes', { kind: 'bug', details: 'Excel date shows 1900-01-01', page: 'Weekly Reports' });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  const id = add.body.note.id;
  assert.equal(add.body.note.status, 'new'); assert.equal(add.body.note.author, 'Vino'); assert.equal(add.body.note.mine, true);
  assert.equal((await viewer('POST', '/api/notes', { kind: 'bug', details: 'x', page: 'Overview' })).status, 400, 'note too short');
  assert.equal((await viewer('POST', '/api/notes', { kind: 'bug', details: 'No page given' })).status, 400, 'page is required');

  // someone else cannot change it; a viewer cannot change status
  assert.equal((await other('PATCH', `/api/notes/${id}`, { details: 'hacked text' })).status, 403);
  assert.equal((await viewer('PATCH', `/api/notes/${id}`, { status: 'done' })).status, 403);
  assert.equal((await viewer('PATCH', `/api/notes/${id}`, { details: 'Shows 1900-01-01 on the Excel file' })).status, 200);

  let list = await other('GET', '/api/notes');
  assert.equal(list.body.counts.open, 1); assert.equal(list.body.canManage, false); assert.equal(list.body.notes[0].mine, false);
  assert.equal((await admin('GET', '/api/notes/count')).body.open, 1);

  // developer starts -> owner can no longer edit or delete
  assert.equal((await admin('PATCH', `/api/notes/${id}`, { status: 'in_progress' })).status, 200);
  assert.equal((await viewer('PATCH', `/api/notes/${id}`, { details: 'Changed after start' })).status, 400);
  assert.equal((await viewer('DELETE', `/api/notes/${id}`)).status, 403);

  // developer marks done with a reply
  const done = await admin('PATCH', `/api/notes/${id}`, { status: 'done', reply: 'Fixed, please check.' });
  assert.equal(done.body.note.status, 'done'); assert.equal(done.body.note.reply, 'Fixed, please check.'); assert.equal(done.body.note.doneBy, 'Dev'); assert.ok(done.body.note.doneAt);
  list = await admin('GET', '/api/notes');
  assert.deepEqual([list.body.counts.open, list.body.counts.done, list.body.canManage], [0, 1, true]);
  // re-open clears the done stamp
  const re = await admin('PATCH', `/api/notes/${id}`, { status: 'new' });
  assert.equal(re.body.note.doneAt, null);

  // owner may delete own "new" note; admin may delete anything
  const n2 = (await other('POST', '/api/notes', { kind: 'feature', details: 'Month filter please', page: 'Audit Team' })).body.note.id;
  assert.equal((await viewer('DELETE', `/api/notes/${n2}`)).status, 403);
  assert.equal((await other('DELETE', `/api/notes/${n2}`)).status, 200);
  assert.equal((await admin('DELETE', `/api/notes/${id}`)).status, 200);
  assert.equal((await admin('GET', '/api/notes')).body.counts.all, 0);
  assert.equal((await admin('GET', '/api/notes/999')).status, 404);
});
