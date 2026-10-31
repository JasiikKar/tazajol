// Integration tests against a real PostgreSQL + PostGIS database (see README).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path');
const { createApp } = require('../server/app');
const { seed } = require('../server/db/seed');

let ctx, server, base, adminToken;
const U1 = 'test-user-0001', U2 = 'test-user-0002';
const post = (p, body, uid = U1, extra = {}) => fetch(base + p, { method: 'POST', headers: { 'X-User-Id': uid, ...extra }, body });
const form = (o) => { const f = new FormData(); Object.entries(o).forEach(([k, v]) => f.append(k, v)); return f; };
const get = (p, uid = U1) => fetch(base + p, { headers: { 'X-User-Id': uid } });

before(async () => {
  ctx = createApp({ adminPassword: 'test-admin-pw' });
  await ctx.repo.init(fs.readFileSync(path.join(__dirname, '..', 'server', 'db', 'schema.sql'), 'utf8'));
  await seed(ctx.pool);
  await ctx.pool.query("DELETE FROM reports WHERE author_id LIKE 'test-%'");
  server = ctx.app.listen(0); base = 'http://localhost:' + server.address().port + '/api';
  const r = await fetch(base + '/auth/admin-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-admin-pw' }) });
  adminToken = (await r.json()).token;
});
after(async () => {
  await ctx.pool.query("DELETE FROM reports WHERE author_id LIKE 'test-%'");
  await ctx.pool.query("DELETE FROM users WHERE id LIKE 'test-%'");
  server.close(); await ctx.pool.end();
});

let first;
test('creates a report and counts the author as first vote', async () => {
  const r = await post('/reports', form({ category: 'road', description: 'test pothole', lat: 43.6, lng: 77.8, ref: 'test-ref-1' }));
  assert.equal(r.status, 201); first = await r.json();
  assert.equal(first.votes, 1); assert.equal(first.status, 'new'); assert.deepEqual(first.allowedNext, ['in_progress', 'fixed']);
});
test('retrying the same client ref is idempotent (outbox safety)', async () => {
  const r = await post('/reports', form({ category: 'road', lat: 43.6, lng: 77.8, ref: 'test-ref-1', force: '1' }));
  assert.equal(r.status, 200); assert.equal((await r.json()).id, first.id);
});
test('same category within 50 m returns 409 DUPLICATE', async () => {
  const r = await post('/reports', form({ category: 'road', lat: 43.60030, lng: 77.80020 }), U2);
  assert.equal(r.status, 409); const b = await r.json(); assert.equal(b.code, 'DUPLICATE'); assert.equal(b.duplicate.id, first.id);
});
test('different category or farther than 50 m is not a duplicate', async () => {
  assert.equal((await post('/reports', form({ category: 'light', lat: 43.6, lng: 77.8 }), U2)).status, 201);
  assert.equal((await post('/reports', form({ category: 'road', lat: 43.6010, lng: 77.8 }), U2)).status, 201); // ~110 m
});
test('force=1 creates a new report next to a duplicate', async () => {
  assert.equal((await post('/reports', form({ category: 'road', lat: 43.60030, lng: 77.80020, force: '1' }), U2)).status, 201);
});
test('upvote is idempotent: one vote per user', async () => {
  const a = await (await post(`/reports/${first.id}/votes`, null, U2)).json();
  const b = await (await post(`/reports/${first.id}/votes`, null, U2)).json();
  assert.equal(a.added, true); assert.equal(b.added, false); assert.equal(b.report.votes, 2);
});
test('rejects bad location, out-of-region point and unknown category', async () => {
  assert.equal((await post('/reports', form({ category: 'road', lat: 'x', lng: 1 }))).status, 400);
  assert.equal((await post('/reports', form({ category: 'road', lat: 10, lng: 10 }))).status, 400);
  assert.equal((await post('/reports', form({ category: 'nope', lat: 43.7, lng: 77.9 }))).status, 400);
});
test('bbox filter returns only reports inside the box', async () => {
  const inside = await (await get('/reports?bbox=77.7,43.5,77.9,43.7')).json();
  assert.ok(inside.some((r) => r.id === first.id));
  const outside = await (await get('/reports?bbox=76.0,43.0,76.1,43.1')).json();
  assert.ok(!outside.some((r) => r.id === first.id));
});
test('only admins can change status; invalid transitions are refused (State)', async () => {
  const auth = { Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' };
  const patch = (s, h) => fetch(`${base}/reports/${first.id}/status`, { method: 'PATCH', headers: { 'X-User-Id': 'test-admin-0001', ...h }, body: JSON.stringify({ status: s }) });
  assert.equal((await patch('fixed', { 'Content-Type': 'application/json' })).status, 403);
  assert.equal((await patch('in_progress', auth)).status, 200);
  assert.equal((await patch('new', auth)).status, 422);   // in_progress -> new not allowed
  assert.equal((await patch('fixed', auth)).status, 200);
  assert.equal((await patch('bogus', auth)).status, 400);
  const d = await (await get(`/reports/${first.id}`)).json();
  assert.deepEqual(d.history.map((h) => h.to), ['new', 'in_progress', 'fixed']);
});
test('voters are notified of status changes (Observer)', async () => {
  await new Promise((r) => setTimeout(r, 200));
  const n = await (await get('/notifications', U2)).json();
  assert.ok(n.some((x) => x.reportId === first.id && x.newStatus === 'fixed'));
  assert.equal((await post('/notifications/read', null, U2)).status, 204);
  assert.ok((await (await get('/notifications', U2)).json()).every((x) => x.read));
});
test('fixed reports no longer count as duplicates', async () => {
  const r = await (await post('/reports', form({ category: 'road', lat: 43.7, lng: 77.9 }))).json();
  const hdr = { 'X-User-Id': 'test-admin-0001', Authorization: 'Bearer ' + adminToken, 'Content-Type': 'application/json' };
  const fix = (s) => fetch(`${base}/reports/${r.id}/status`, { method: 'PATCH', headers: hdr, body: JSON.stringify({ status: s }) });
  assert.equal((await post('/reports', form({ category: 'road', lat: 43.7, lng: 77.9 }), U2)).status, 409); // still open
  assert.equal((await fix('fixed')).status, 200);
  assert.equal((await post('/reports', form({ category: 'road', lat: 43.7, lng: 77.9 }), U2)).status, 201); // now allowed
});
test('photo is stored in the database and served back; other types are refused', async () => {
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const f = new FormData(); f.append('category', 'trash'); f.append('lat', '43.65'); f.append('lng', '77.85');
  f.append('photo', new Blob([jpg], { type: 'image/jpeg' }), 'a.jpg');
  const ok = await post('/reports', f); assert.equal(ok.status, 201);
  const rep = await ok.json(); assert.match(rep.photoUrl, /^\/api\/photos\/\d+$/);
  const img = await fetch(base.replace('/api', '') + rep.photoUrl); // public, no user header
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), jpg);
  const g = new FormData(); g.append('category', 'trash'); g.append('lat', '43.66'); g.append('lng', '77.86');
  g.append('photo', new Blob(['<script>'], { type: 'text/html' }), 'a.html');
  assert.equal((await post('/reports', g)).status, 400);
  const h = new FormData(); h.append('category', 'trash'); h.append('lat', '43.67'); h.append('lng', '77.87'); // fake jpeg: wrong signature
  h.append('photo', new Blob(['not an image'], { type: 'image/jpeg' }), 'b.jpg');
  assert.equal((await post('/reports', h)).status, 400);
  assert.equal((await fetch(base + '/photos/999999999')).status, 404);
});
test('hidden reports: invisible to residents, visible to admin, can be restored', async () => {
  const r = await (await post('/reports', form({ category: 'other', lat: 43.8, lng: 77.95 }))).json();
  const A = { 'X-User-Id': 'test-admin-0001', Authorization: 'Bearer ' + adminToken };
  assert.equal((await fetch(`${base}/reports/${r.id}/hide`, { method: 'POST', headers: { 'X-User-Id': U1 } })).status, 403);
  assert.equal((await fetch(`${base}/reports/${r.id}/hide`, { method: 'POST', headers: A })).status, 204);
  assert.equal((await get(`/reports/${r.id}`)).status, 404);
  assert.ok(!(await (await get('/reports')).json()).some((x) => x.id === r.id));
  const adm = await (await fetch(`${base}/reports`, { headers: A })).json();
  assert.ok(adm.some((x) => x.id === r.id && x.hidden === true));
  assert.equal((await fetch(`${base}/reports/${r.id}/unhide`, { method: 'POST', headers: A })).status, 204);
  assert.equal((await get(`/reports/${r.id}`)).status, 200);
});
test('health endpoint works without a user id', async () => {
  const r = await fetch(base + '/health'); assert.equal(r.status, 200); assert.equal((await r.json()).status, 'ok');
});
test('wrong admin password is refused; requests without user id are refused', async () => {
  const r = await fetch(base + '/auth/admin-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) });
  assert.equal(r.status, 401);
  assert.equal((await fetch(base + '/reports')).status, 400);
});
test('Open311 adapter output has the standard fields', async () => {
  const rows = await (await get('/open311/requests.json')).json();
  assert.ok(rows.length > 0); const x = rows[0];
  for (const k of ['service_request_id', 'status', 'service_code', 'lat', 'long', 'requested_datetime']) assert.ok(k in x, k);
});
