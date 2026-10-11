'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const procs = [];
async function boot(port, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-'));
  const p = spawn(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'server', 'index.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dir, ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  procs.push(p);
  await new Promise((res, rej) => { p.stdout.on('data', (d) => { if (String(d).includes('running')) res(); }); p.on('exit', () => rej(new Error('server exited'))); setTimeout(() => rej(new Error('boot timeout')), 8000); });
  return 'http://127.0.0.1:' + port;
}
after(() => procs.forEach((p) => p.kill()));

function client(base) {
  const c = { token: null, events: [] };
  c.api = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(c.token ? { Authorization: 'Bearer ' + c.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json(); return { status: r.status, ...j };
  };
  c.signup = async (b) => { const r = await c.api('POST', '/api/auth/signup', b); assert.equal(r.status, 200, JSON.stringify(r)); c.token = r.token; c.user = r.user; return r; };
  c.connect = () => new Promise((res) => { c.ws = new WebSocket(base.replace('http', 'ws') + '/ws?token=' + c.token); c.ws.onmessage = (e) => { const m = JSON.parse(e.data); c.events.push(m); if (m.t === 'hello') res(); }; });
  c.wait = async (fn, ms = 3000) => { const t = Date.now(); for (;;) { const m = c.events.find(fn); if (m) return m; if (Date.now() - t > ms) throw new Error('timeout waiting for event; got ' + JSON.stringify(c.events.map((e) => e.t))); await new Promise((r) => setTimeout(r, 25)); } };
  return c;
}
const PICK = [6.5244, 3.3792], DROP = [6.6018, 3.3515];
const body = (o) => ({ item: 'Documents', from: 'Marina, Lagos', to: 'Ikeja, Lagos', fromLL: PICK, toLL: DROP, rName: 'Chidi', rPhone: '08030001111', size: 'small', service: 'Standard', insured: false, pay: 'Card', ...o });

test('full delivery lifecycle', async () => {
  const base = await boot(3911, { GEOFENCE_M: '0' });
  const A = client(base), B = client(base), D = client(base), C = client(base);
  await A.signup({ role: 'customer', name: 'Ada Sender', email: 'ada@x.com', phone: '08011112222', password: 'password1' });
  await B.signup({ role: 'rider', name: 'Bayo Rider', email: 'bayo@x.com', phone: '08033334444', password: 'password1', vehicle: 'Motorbike' });
  await D.signup({ role: 'rider', name: 'Dayo Rider', email: 'dayo@x.com', phone: '08055556666', password: 'password1' });
  await C.signup({ role: 'customer', name: 'Chidi Receiver', email: 'chidi@x.com', phone: '0803 000 1111', password: 'password1' });
  assert.equal((await A.api('POST', '/api/auth/login', { email: 'ada@x.com', password: 'bad' })).status, 401);
  assert.equal((await A.api('POST', '/api/auth/signup', { role: 'customer', name: 'x', email: 'ada@x.com', phone: '08011112222', password: 'password1' })).status, 409);
  await Promise.all([A.connect(), B.connect(), C.connect()]);
  B.ws.send(JSON.stringify({ t: 'online', on: true }));

  // fixed price, decided by the server
  const quote = await A.api('POST', '/api/quote', { fromLL: PICK, toLL: DROP, size: 'small', service: 'Standard' });
  assert.equal(quote.q.zone, 'city'); assert.equal(quote.q.total, 3000 + 600 + 250);
  assert.equal((await A.api('POST', '/api/quote', { fromLL: PICK, toLL: [7.4, 3.9], size: 'small', service: 'Standard' })).status, 400);

  // card payment stays hidden from riders until paid
  const made = await A.api('POST', '/api/shipments', body({ total: 1, payout: 99999 }));
  assert.equal(made.status, 200); const id = made.ship.id;
  assert.match(id, /^FC-[A-Z2-9]{6}$/); assert.equal(made.ship.q.total, 3850); assert.equal(made.ship.payStatus, 'pending'); assert.match(made.ship.pin, /^\d{4}$/);
  assert.equal((await B.api('GET', '/api/shipments/open')).open.length, 0);
  assert.equal((await B.api('POST', `/api/shipments/${id}/accept`)).status, 409);
  const p = await A.api('POST', `/api/shipments/${id}/pay`); assert.equal(p.demo, true);
  assert.equal((await B.api('POST', `/api/shipments/${id}/pay-demo`)).status, 403);
  assert.equal((await A.api('POST', `/api/shipments/${id}/pay-demo`)).ship.payStatus, 'paid');
  const open = await B.api('GET', '/api/shipments/open'); assert.equal(open.open.length, 1);
  assert.equal(open.open[0].senderPhone, ''); assert.equal(open.open[0].pin, undefined);
  await B.wait((m) => m.t === 'ship' && m.ship.id === id && m.ship.stage === 0);

  // the receiver finds it through their phone number
  const fol = await C.api('GET', '/api/shipments'); assert.equal(fol.follow.length, 1); assert.equal(fol.follow[0].pin, made.ship.pin); assert.equal(fol.follow[0].isReceiver, true);

  // only one rider can win a job
  const acc = await B.api('POST', `/api/shipments/${id}/accept`); assert.equal(acc.status, 200); assert.equal(acc.ship.stage, 1); assert.equal(acc.ship.senderPhone, '08011112222');
  assert.equal((await D.api('POST', `/api/shipments/${id}/accept`)).status, 409);
  await A.wait((m) => m.t === 'ship' && m.ship.stage === 1 && m.ship.riderPhone === '08033334444');

  // live GPS goes to sender and receiver, not to strangers
  B.ws.send(JSON.stringify({ t: 'loc', lat: 6.53, lng: 3.38, hdg: 90 }));
  const loc = await A.wait((m) => m.t === 'loc' && m.id === id); assert.deepEqual(loc.ll, [6.53, 3.38]);
  await C.wait((m) => m.t === 'loc' && m.id === id);
  A.ws.send(JSON.stringify({ t: 'cloc', id, lat: 6.6, lng: 3.35 }));
  await B.wait((m) => m.t === 'loc' && m.role === 'customer');

  // chat
  const m1 = await A.api('POST', `/api/shipments/${id}/messages`, { text: 'Please call at the gate' }); assert.equal(m1.msg.role, 'customer');
  await B.wait((m) => m.t === 'msg' && m.msg.text === 'Please call at the gate');
  await B.api('POST', `/api/shipments/${id}/messages`, { text: 'On my way' });
  await A.wait((m) => m.t === 'msg' && m.msg.role === 'rider');
  assert.equal((await C.api('GET', `/api/shipments/${id}/messages`)).messages.length, 2);
  assert.equal((await D.api('GET', `/api/shipments/${id}/messages`)).status, 404);

  // steps and PIN
  assert.equal((await B.api('POST', `/api/shipments/${id}/arrived`)).status, 409);
  assert.equal((await B.api('POST', `/api/shipments/${id}/picked`)).ship.stage, 2);
  assert.equal((await A.api('POST', `/api/shipments/${id}/picked`)).status, 403);
  assert.equal((await B.api('POST', `/api/shipments/${id}/arrived`)).ship.stage, 3);
  const wrong = await B.api('POST', `/api/shipments/${id}/confirm`, { pin: made.ship.pin === '1234' ? '4321' : '1234' }); assert.equal(wrong.status, 400);
  const done = await B.api('POST', `/api/shipments/${id}/confirm`, { pin: made.ship.pin }); assert.equal(done.ship.stage, 4);
  await A.wait((m) => m.t === 'ship' && m.ship.stage === 4);

  // rating and tip
  assert.equal((await B.api('POST', `/api/shipments/${id}/rate`, { rating: 5, tip: 500 })).status, 403);
  assert.equal((await A.api('POST', `/api/shipments/${id}/rate`, { rating: 5, tip: 777 })).status, 400);
  const rated = await A.api('POST', `/api/shipments/${id}/rate`, { rating: 5, tip: 500, comment: 'Great' }); assert.equal(rated.ship.rating, 5); assert.equal(rated.ship.tip, 500);
  assert.equal((await A.api('POST', `/api/shipments/${id}/rate`, { rating: 4, tip: 0 })).status, 409);
});

test('cash jobs, cancel, tracking by ID', async () => {
  const base = await boot(3912, { GEOFENCE_M: '0' });
  const A = client(base), B = client(base), X = client(base);
  await A.signup({ role: 'customer', name: 'Ada', email: 'a@x.com', phone: '08011112222', password: 'password1' });
  await B.signup({ role: 'rider', name: 'Bayo', email: 'b@x.com', phone: '08033334444', password: 'password1' });
  await X.signup({ role: 'customer', name: 'Xavier', email: 'x@x.com', phone: '08099990000', password: 'password1' });
  await B.connect(); B.ws.send(JSON.stringify({ t: 'online', on: true }));
  const s = (await A.api('POST', '/api/shipments', body({ pay: 'Cash to rider', fromLL: undefined, toLL: undefined, zone: 'near', service: 'Express', size: 'env' }))).ship;
  assert.equal(s.q.total, 2800 + 250); assert.equal(s.payStatus, 'cash');
  await B.wait((m) => m.t === 'ship' && m.ship.id === s.id);
  assert.equal((await X.api('GET', `/api/shipments/${s.id}`)).status, 404);
  const f = await X.api('POST', `/api/shipments/${s.id}/follow`); assert.equal(f.status, 200); assert.equal(f.ship.pin, undefined); assert.equal(f.ship.mine, 'follower');
  assert.equal((await X.api('POST', `/api/shipments/${s.id}/cancel`)).status, 403);
  assert.equal((await A.api('POST', `/api/shipments/${s.id}/cancel`)).ship.stage, -1);
  await B.wait((m) => m.t === 'gone' && m.id === s.id);
  assert.equal((await B.api('POST', `/api/shipments/${s.id}/accept`)).status, 409);
  assert.equal((await A.api('POST', '/api/shipments', body({ pay: 'Wire' }))).status, 400);
  assert.equal((await client(base).api('GET', '/api/me')).status, 401);
});

test('GPS geofence blocks pickup from far away', async () => {
  const base = await boot(3913, { GEOFENCE_M: '400' });
  const A = client(base), B = client(base);
  await A.signup({ role: 'customer', name: 'Ada', email: 'a@x.com', phone: '08011112222', password: 'password1' });
  await B.signup({ role: 'rider', name: 'Bayo', email: 'b@x.com', phone: '08033334444', password: 'password1' });
  await B.connect();
  const id = (await A.api('POST', '/api/shipments', body({ pay: 'Cash to rider' }))).ship.id;
  await B.api('POST', `/api/shipments/${id}/accept`);
  assert.equal((await B.api('POST', `/api/shipments/${id}/picked`)).status, 409);
  B.ws.send(JSON.stringify({ t: 'loc', lat: 6.60, lng: 3.35 })); await new Promise((r) => setTimeout(r, 150));
  const far = await B.api('POST', `/api/shipments/${id}/picked`); assert.equal(far.status, 409); assert.match(far.error, /km from the pickup/);
  B.ws.send(JSON.stringify({ t: 'loc', lat: 6.5245, lng: 3.3793 })); await new Promise((r) => setTimeout(r, 150));
  assert.equal((await B.api('POST', `/api/shipments/${id}/picked`)).ship.stage, 2);
});
