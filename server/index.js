'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const cfg = require('./lib/config');
const { q, tx } = require('./lib/db');
const auth = require('./lib/auth');
const pricing = require('./lib/pricing');
const geo = require('./lib/geo');
const pay = require('./lib/payments');
const wsLib = require('./lib/ws');
const { CAT, haversineKm } = pricing;

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const PAYS = ['Card', 'Bank transfer', 'Cash to rider'];
const TIPS = [0, 200, 500, 1000, 2000];

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpError(400, m), notFound = (m) => new HttpError(404, m || 'Not found'), conflict = (m) => new HttpError(409, m);
const nul = (v) => (v === undefined ? null : v);
const now = () => Date.now();
const str = (v, max, name, req) => {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  if (req && !s) throw bad((name || 'A field') + ' is required.');
  return s;
};
const phoneKey = (p) => String(p || '').replace(/\D/g, '').slice(-10);
function cleanPhone(p, req) {
  const s = String(p || '').replace(/[^0-9+]/g, '');
  if (!s && !req) return '';
  if (s.replace(/\D/g, '').length < 7 || s.length > 16) throw bad('Enter a valid phone number.');
  return s;
}
const ll = (v) => {
  if (v == null) return null;
  const a = Number(v[0]), b = Number(v[1]);
  if (!isFinite(a) || !isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) throw bad('That location is not valid.');
  return [a, b];
};

/* ------------------------------------------------------------ live connections */
const online = new Map(); // uid -> Set<Conn>
function push(uid, obj) { const s = online.get(uid); if (s) { const m = JSON.stringify(obj); for (const c of s) c.send(m); } }
function riderConns() { const out = []; for (const [uid, set] of online) for (const c of set) if (c.meta.role === 'rider' && c.meta.online) out.push([uid, c]); return out; }

/* ------------------------------------------------------------ views */
const userRow = (id) => q.get('SELECT * FROM users WHERE id=?', id);
const publicUser = (u) => ({ id: u.id, email: u.email, phone: u.phone || '', name: u.name || '', role: u.role, address: u.address || '', vehicle: u.vehicle || '', plate: u.plate || '', share: !!u.share, calm: !!u.calm });
function riderRating(id) { const r = q.get('SELECT AVG(rating) a, COUNT(rating) n FROM shipments WHERE rider_id=? AND rating>0', id); return r && r.n ? { avg: Math.round(r.a * 10) / 10, n: r.n } : null; }
const followers = (id) => q.all('SELECT user_id FROM follows WHERE shipment_id=?', id).map((r) => r.user_id);
const audience = (s) => Array.from(new Set([s.sender_id, s.rider_id, ...followers(s.id)].filter(Boolean)));
const isOpen = (s) => s.stage === 0 && !s.rider_id && (s.pay_status === 'paid' || s.pay_status === 'cash');

function view(s, uid) {
  const sender = userRow(s.sender_id), rider = s.rider_id ? userRow(s.rider_id) : null;
  const isSender = s.sender_id === uid, isRider = s.rider_id === uid;
  const isFollower = !isSender && !isRider && !!q.get('SELECT 1 x FROM follows WHERE user_id=? AND shipment_id=?', uid, s.id);
  const mine = isSender ? 'sender' : isRider ? 'rider' : isFollower ? 'follower' : 'open';
  const priv = isSender || isRider || isFollower;
  const v = {
    id: s.id, mine, stage: s.stage, item: s.item, service: s.service, zone: s.zone, size: s.size, insured: !!s.insured,
    pay: s.pay, payStatus: s.pay_status, note: priv ? s.note || '' : '', from: s.from_addr, to: s.to_addr,
    fromLL: s.from_lat != null ? [s.from_lat, s.from_lng] : null, toLL: s.to_lat != null ? [s.to_lat, s.to_lng] : null,
    rName: s.r_name, rPhone: priv ? s.r_phone : '',
    q: { delivery: s.delivery, size: s.size_add, fee: s.fee, ins: s.ins, total: s.total, payout: s.payout, km: s.km, mins: s.mins, zoneLabel: CAT.zones[s.zone] ? CAT.zones[s.zone].label : '', sizeLabel: CAT.sizes[s.size] ? CAT.sizes[s.size].label : '' },
    senderId: s.sender_id, senderName: sender ? sender.name : '', senderPhone: priv && (isSender || isFollower || isRider) && sender ? sender.phone : '',
    riderId: s.rider_id || null, riderName: rider ? rider.name : '', riderPhone: rider && priv ? rider.phone : '', riderVehicle: rider ? rider.vehicle : '', riderPlate: rider ? rider.plate : '',
    riderRating: rider ? riderRating(rider.id) : null,
    riderPos: s.rider_ts ? { ll: [s.rider_lat, s.rider_lng], ts: s.rider_ts } : null,
    recvPos: s.recv_ts ? { ll: [s.recv_lat, s.recv_lng], ts: s.recv_ts } : null,
    created: s.created, acceptedAt: s.accepted_at, pickedAt: s.picked_at, deliveredAt: s.delivered_at,
    rated: s.rating != null, rating: s.rating || 0, tip: s.tip || 0, comment: priv ? s.comment || '' : ''
  };
  const viewer = isFollower ? userRow(uid) : null;
  const isReceiver = !!(viewer && viewer.phone_key && viewer.phone_key === s.r_key);
  v.isReceiver = isReceiver;
  if ((isSender || isReceiver) && s.stage >= 0 && s.stage < 4) v.pin = s.pin;
  return v;
}
function fanout(s, wasOpen) {
  const aud = audience(s), seen = new Set(aud);
  aud.forEach((uid) => { if (online.has(uid)) push(uid, { t: 'ship', ship: view(s, uid) }); });
  const open = isOpen(s);
  for (const [uid, c] of riderConns()) {
    if (seen.has(uid)) continue;
    if (open) c.send({ t: 'ship', ship: view(s, uid) });
    else if (wasOpen) c.send({ t: 'gone', id: s.id });
  }
}
const live = new Map(); // newest GPS fix per shipment, ahead of the throttled database write
const ship = (id) => {
  const s = q.get('SELECT * FROM shipments WHERE id=?', id);
  if (s) {
    const r = live.get('r' + id); if (r && r.ts > (s.rider_ts || 0)) { s.rider_lat = r.lat; s.rider_lng = r.lng; s.rider_ts = r.ts; }
    const c = live.get('c' + id); if (c && c.ts > (s.recv_ts || 0)) { s.recv_lat = c.lat; s.recv_lng = c.lng; s.recv_ts = c.ts; }
    if (s.stage === 4 || s.stage < 0) { live.delete('r' + id); live.delete('c' + id); }
  }
  return s;
};
function mustShip(id) { const s = ship(String(id || '').toUpperCase()); if (!s) throw notFound('No shipment with that ID.'); return s; }
function participant(s, uid) { return s.sender_id === uid || s.rider_id === uid || !!q.get('SELECT 1 x FROM follows WHERE user_id=? AND shipment_id=?', uid, s.id); }

function linkFollows(uid, key) {
  if (!key) return;
  q.run('INSERT OR IGNORE INTO follows(user_id, shipment_id) SELECT ?, id FROM shipments WHERE r_key=? AND sender_id<>? AND stage>=0 AND (stage<4 OR delivered_at>?)', uid, key, uid, now() - 7 * 86400000);
}
function newId() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) { let s = 'FC-'; for (let i = 0; i < 6; i++) s += A[crypto.randomInt(A.length)]; if (!ship(s)) return s; }
}

/* ------------------------------------------------------------ router */
const routes = [];
const add = (method, pattern, fn, opts) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, opts: opts || {} });
const me = (c) => { if (!c.user) throw new HttpError(401, 'Please sign in.'); return c.user; };

add('GET', '/api/config', () => ({
  cat: CAT, tiles: { light: cfg.tileLight, dark: cfg.tileDark, attribution: cfg.tileAttribution }, testMode: cfg.testMode,
  geofenceM: cfg.geofenceM, country: cfg.country
}));

add('POST', '/api/auth/signup', (c) => {
  const b = c.body, email = str(b.email, 120, 'Email', true).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email address.');
  const pw = String(b.password || '');
  if (pw.length < 8) throw bad('Use a password of at least 8 characters.');
  const role = b.role === 'rider' ? 'rider' : 'customer';
  const phone = cleanPhone(b.phone, true), name = str(b.name, 60, 'Your name', true);
  if (q.get('SELECT 1 x FROM users WHERE email=?', email)) throw conflict('An account with this email already exists. Sign in instead.');
  const id = crypto.randomUUID();
  q.run('INSERT INTO users(id,email,phone,phone_key,name,pass,role,address,vehicle,plate,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    id, email, phone, phoneKey(phone), name, auth.hashPassword(pw), role, str(b.address, 200), str(b.vehicle || (role === 'rider' ? 'Motorbike' : ''), 20), str(b.plate, 20).toUpperCase(), now());
  linkFollows(id, phoneKey(phone));
  return { token: auth.sign(id), user: publicUser(userRow(id)) };
}, { public: true, strict: true });

add('POST', '/api/auth/login', (c) => {
  const email = str(c.body.email, 120).toLowerCase(), u = q.get('SELECT * FROM users WHERE email=?', email);
  const ok = auth.checkPassword(String(c.body.password || ''), u ? u.pass : 's1$00$00');
  if (!u || !ok) throw new HttpError(401, 'Wrong email or password.');
  return { token: auth.sign(u.id), user: publicUser(u) };
}, { public: true, strict: true });

add('GET', '/api/me', (c) => ({ user: publicUser(me(c)) }));
add('PATCH', '/api/me', (c) => {
  const u = me(c), b = c.body, f = {};
  if (b.name !== undefined) f.name = str(b.name, 60, 'Your name', true);
  if (b.phone !== undefined) { f.phone = cleanPhone(b.phone, true); f.phone_key = phoneKey(f.phone); }
  if (b.address !== undefined) f.address = str(b.address, 200);
  if (b.vehicle !== undefined) f.vehicle = ['Motorbike', 'Bicycle', 'Car'].includes(b.vehicle) ? b.vehicle : 'Motorbike';
  if (b.plate !== undefined) f.plate = str(b.plate, 20).toUpperCase();
  if (b.share !== undefined) f.share = b.share ? 1 : 0;
  if (b.calm !== undefined) f.calm = b.calm ? 1 : 0;
  if (b.role !== undefined && ['customer', 'rider'].includes(b.role)) {
    if (b.role === 'rider') {
      const active = q.get('SELECT 1 x FROM shipments WHERE sender_id=? AND stage BETWEEN 0 AND 3', u.id);
      if (active && u.role === 'customer') { /* switching is allowed; shipments stay with the account */ }
    }
    f.role = b.role;
  }
  const keys = Object.keys(f);
  if (keys.length) q.run('UPDATE users SET ' + keys.map((k) => k + '=?').join(',') + ' WHERE id=?', ...keys.map((k) => f[k]), u.id);
  if (f.phone_key) linkFollows(u.id, f.phone_key);
  const nu = userRow(u.id);
  for (const set of [online.get(u.id)]) if (set) for (const cn of set) cn.meta.role = nu.role;
  return { user: publicUser(nu) };
});

add('POST', '/api/quote', (c) => {
  me(c); const b = c.body;
  try { return { q: pricing.quote({ zone: b.zone, from: ll(b.fromLL), to: ll(b.toLL), size: b.size, service: b.service, insured: !!b.insured }) }; } catch (e) { throw e instanceof HttpError ? e : bad(e.message); }
});
add('GET', '/api/geocode', async (c) => { me(c); const t = str(c.query.q, 120); if (t.length < 3) return { results: [] }; try { return { results: await geo.search(t) }; } catch (e) { return { results: [], unavailable: true }; } });
add('GET', '/api/reverse', async (c) => { me(c); const a = ll([c.query.lat, c.query.lng]); try { return { place: await geo.reverse(a[0], a[1]) }; } catch (e) { return { place: { label: a[0].toFixed(5) + ', ' + a[1].toFixed(5), lat: a[0], lng: a[1] } }; } });
add('GET', '/api/route', async (c) => { me(c); const a = String(c.query.a || '').split(',').map(Number), b = String(c.query.b || '').split(',').map(Number); return { route: await geo.route(ll(a), ll(b)) }; });

add('POST', '/api/shipments', (c) => {
  const u = me(c), b = c.body;
  const fromLL = ll(b.fromLL), toLL = ll(b.toLL);
  const payMethod = PAYS.includes(b.pay) ? b.pay : null;
  if (!payMethod) throw bad('Choose how you will pay.');
  let qt;
  try { qt = pricing.quote({ zone: b.zone, from: fromLL, to: toLL, size: b.size, service: b.service, insured: !!b.insured }); } catch (e) { throw bad(e.message); }
  const rPhone = cleanPhone(b.rPhone, true), id = newId(), pin = String(crypto.randomInt(1000, 10000));
  const active = q.get('SELECT COUNT(*) n FROM shipments WHERE sender_id=? AND stage BETWEEN 0 AND 3', u.id).n;
  if (active >= 5) throw conflict('You have 5 deliveries in progress. Please wait for one to finish.');
  q.run(`INSERT INTO shipments(id,sender_id,stage,item,service,zone,size,insured,pay,pay_status,note,from_addr,to_addr,from_lat,from_lng,to_lat,to_lng,r_name,r_phone,r_key,
    delivery,size_add,fee,ins,total,payout,km,mins,pin,created) VALUES(?,?,0,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, u.id, str(b.item, 80, 'What you are sending', true), b.service, qt.zone, b.size, b.insured ? 1 : 0, payMethod, payMethod === 'Cash to rider' ? 'cash' : 'pending', str(b.note, 200),
    str(b.from, 200, 'Pickup address', true), str(b.to, 200, 'Delivery address', true), nul(fromLL && fromLL[0]), nul(fromLL && fromLL[1]), nul(toLL && toLL[0]), nul(toLL && toLL[1]),
    str(b.rName, 60, 'Receiver name', true), rPhone, phoneKey(rPhone),
    qt.delivery, qt.size, qt.fee, qt.ins, qt.total, qt.payout, qt.km, qt.mins, pin, now());
  q.run('INSERT OR IGNORE INTO follows(user_id, shipment_id) SELECT id, ? FROM users WHERE phone_key=? AND id<>?', id, phoneKey(rPhone), u.id);
  const s = ship(id); fanout(s, false);
  return { ship: view(s, u.id) };
});

add('GET', '/api/shipments', (c) => {
  const u = me(c);
  const mineRows = q.all('SELECT * FROM shipments WHERE sender_id=? ORDER BY created DESC LIMIT 100', u.id);
  const jobRows = q.all('SELECT * FROM shipments WHERE rider_id=? ORDER BY created DESC LIMIT 100', u.id);
  const folRows = q.all('SELECT s.* FROM shipments s JOIN follows f ON f.shipment_id=s.id WHERE f.user_id=? AND s.sender_id<>? ORDER BY s.created DESC LIMIT 50', u.id, u.id);
  return { mine: mineRows.map((s) => view(s, u.id)), job: jobRows.map((s) => view(s, u.id)), follow: folRows.map((s) => view(s, u.id)) };
});
add('GET', '/api/shipments/open', (c) => {
  const u = me(c); if (u.role !== 'rider') throw new HttpError(403, 'Switch to the rider app to see requests.');
  const rows = q.all("SELECT * FROM shipments WHERE stage=0 AND rider_id IS NULL AND pay_status IN ('paid','cash') AND sender_id<>? ORDER BY created DESC LIMIT 30", u.id);
  return { open: rows.map((s) => view(s, u.id)) };
});
add('GET', '/api/shipments/:id', (c) => { const u = me(c), s = mustShip(c.params.id); if (!participant(s, u.id) && !(u.role === 'rider' && isOpen(s))) throw notFound('No shipment with that ID.'); return { ship: view(s, u.id) }; });
add('POST', '/api/shipments/:id/follow', (c) => {
  const u = me(c), s = mustShip(c.params.id);
  if (s.stage === -1) throw notFound('That delivery was cancelled.');
  if (s.sender_id !== u.id && s.rider_id !== u.id) {
    const n = q.get('SELECT COUNT(*) n FROM follows WHERE user_id=?', u.id).n;
    if (n >= 50) throw conflict('You are following too many deliveries.');
    q.run('INSERT OR IGNORE INTO follows(user_id, shipment_id) VALUES(?,?)', u.id, s.id);
  }
  return { ship: view(s, u.id) };
});
add('POST', '/api/shipments/:id/unfollow', (c) => { const u = me(c); q.run('DELETE FROM follows WHERE user_id=? AND shipment_id=?', u.id, String(c.params.id).toUpperCase()); return { ok: true }; });

/* payments */
function markPaid(ref, expectNaira) {
  const s = q.get('SELECT * FROM shipments WHERE pay_ref=?', ref);
  if (!s) return null;
  if (s.pay_status === 'pending') {
    if (expectNaira != null && expectNaira !== s.total) return null;
    q.run("UPDATE shipments SET pay_status='paid' WHERE id=? AND pay_status='pending'", s.id);
    const ns = ship(s.id); fanout(ns, false); return ns;
  }
  return s;
}
add('POST', '/api/shipments/:id/pay', async (c) => {
  const u = me(c), s = mustShip(c.params.id);
  if (s.sender_id !== u.id) throw new HttpError(403, 'Only the sender can pay.');
  if (s.pay_status !== 'pending') return { ship: view(s, u.id) };
  const ref = 'FC_' + s.id + '_' + crypto.randomBytes(4).toString('hex');
  q.run('UPDATE shipments SET pay_ref=? WHERE id=?', ref, s.id);
  if (cfg.testMode) return { demo: true, ref, amount: s.total };
  const base = cfg.publicUrl || ('http://' + c.req.headers.host);
  try {
    const d = await pay.initialize({ email: u.email, amountNaira: s.total, reference: ref, callbackUrl: base + '/api/paystack/callback', channels: s.pay === 'Bank transfer' ? ['bank_transfer', 'bank'] : ['card'], metadata: { shipment: s.id } });
    return { url: d.authorization_url, ref };
  } catch (e) { throw new HttpError(502, 'Payment is unavailable right now. Try again or pay cash to the rider.'); }
});
add('POST', '/api/shipments/:id/pay-demo', (c) => {
  const u = me(c), s = mustShip(c.params.id);
  if (!cfg.testMode) throw new HttpError(403, 'Test payments are off.');
  if (s.sender_id !== u.id) throw new HttpError(403, 'Only the sender can pay.');
  if (!s.pay_ref) throw conflict('Start the payment first.');
  return { ship: view(markPaid(s.pay_ref, null), u.id) };
});
add('GET', '/api/paystack/callback', async (c) => {
  const ref = String(c.query.reference || c.query.trxref || '');
  let id = '';
  try {
    const d = await pay.verify(ref);
    if (d.status === 'success') { const s = markPaid(ref, d.amount / 100); id = s ? s.id : ''; }
    else { const s = q.get('SELECT id FROM shipments WHERE pay_ref=?', ref); id = s ? s.id : ''; }
  } catch (e) { /* fall through to the app, which shows the real status */ }
  return { redirect: '/?pay=' + encodeURIComponent(id) };
}, { public: true });
add('POST', '/api/paystack/webhook', (c) => {
  if (!pay.validSignature(c.raw, c.req.headers['x-paystack-signature'])) throw new HttpError(401, 'Bad signature.');
  let ev; try { ev = JSON.parse(c.raw.toString()); } catch (e) { throw bad('Bad body.'); }
  if (ev.event === 'charge.success' && ev.data) markPaid(ev.data.reference, ev.data.amount / 100);
  return { ok: true };
}, { public: true });

/* rider actions */
function near(s, target, label) {
  if (!cfg.geofenceM || !target || target[0] == null) return;
  if (!s.rider_ts) throw conflict('Turn on location so we can confirm where you are.');
  if (now() - s.rider_ts > 120000) throw conflict('We lost your location. Check that GPS is on.');
  const m = Math.round(haversineKm([s.rider_lat, s.rider_lng], target) * 1000);
  if (m > cfg.geofenceM) throw conflict('You are ' + (m >= 1000 ? (m / 1000).toFixed(1) + ' km' : m + ' m') + ' from the ' + label + '. Move closer to continue.');
}
add('POST', '/api/shipments/:id/accept', (c) => {
  const u = me(c), s = mustShip(c.params.id);
  if (u.role !== 'rider') throw new HttpError(403, 'Switch to the rider app first.');
  if (!u.phone) throw bad('Add your call number first.');
  if (q.get('SELECT 1 x FROM shipments WHERE rider_id=? AND stage BETWEEN 1 AND 3', u.id)) throw conflict('Finish your current delivery first.');
  if (s.sender_id === u.id) throw bad('You cannot deliver your own parcel.');
  const r = q.run("UPDATE shipments SET rider_id=?, stage=1, accepted_at=? WHERE id=? AND stage=0 AND rider_id IS NULL AND pay_status IN ('paid','cash')", u.id, now(), s.id);
  if (!r.changes) throw conflict('Another rider just took this delivery.');
  const ns = ship(s.id); fanout(ns, true);
  return { ship: view(ns, u.id) };
});
function step(name, from, to, extra) {
  add('POST', '/api/shipments/:id/' + name, (c) => {
    const u = me(c), s = mustShip(c.params.id);
    if (s.rider_id !== u.id) throw new HttpError(403, 'This is not your delivery.');
    if (s.stage !== from) throw conflict('That step is not available right now.');
    if (extra) extra(s, c);
    const col = { 2: 'picked_at', 3: 'arrived_at' }[to];
    q.run('UPDATE shipments SET stage=?, ' + col + '=? WHERE id=? AND stage=?', to, now(), s.id, from);
    const ns = ship(s.id); fanout(ns, false); return { ship: view(ns, u.id) };
  });
}
step('picked', 1, 2, (s) => near(s, s.from_lat != null ? [s.from_lat, s.from_lng] : null, 'pickup point'));
step('arrived', 2, 3, (s) => near(s, s.to_lat != null ? [s.to_lat, s.to_lng] : null, 'drop-off point'));
add('POST', '/api/shipments/:id/confirm', (c) => {
  const u = me(c), s = mustShip(c.params.id);
  if (s.rider_id !== u.id) throw new HttpError(403, 'This is not your delivery.');
  if (s.stage !== 3) throw conflict('Arrive at the drop-off first.');
  if (s.pin_lock > now()) throw conflict('Too many wrong PINs. Try again in ' + Math.ceil((s.pin_lock - now()) / 1000) + ' seconds.');
  const given = Buffer.from(String(c.body.pin || '').padEnd(8)), want = Buffer.from(s.pin.padEnd(8));
  if (!crypto.timingSafeEqual(given, want) || String(c.body.pin).length !== 4) {
    const tries = (s.pin_tries || 0) + 1;
    q.run('UPDATE shipments SET pin_tries=?, pin_lock=? WHERE id=?', tries >= 5 ? 0 : tries, tries >= 5 ? now() + 60000 : 0, s.id);
    throw bad(tries >= 5 ? 'Too many wrong PINs. Wait a minute and ask the receiver again.' : 'That PIN does not match. Ask the receiver to check it.');
  }
  q.run('UPDATE shipments SET stage=4, delivered_at=?, pin_tries=0 WHERE id=?', now(), s.id);
  const ns = ship(s.id); fanout(ns, false); return { ship: view(ns, u.id) };
});
add('POST', '/api/shipments/:id/cancel', async (c) => {
  const u = me(c), s = mustShip(c.params.id);
  if (s.sender_id !== u.id) throw new HttpError(403, 'Only the sender can cancel.');
  if (s.stage < 0 || s.stage > 1) throw conflict('This delivery can no longer be cancelled.');
  const wasOpen = isOpen(s);
  q.run("UPDATE shipments SET stage=-1, refund=? WHERE id=? AND stage IN (0,1)", s.pay_status === 'paid' && !cfg.testMode ? 'requested' : null, s.id);
  if (s.pay_status === 'paid' && !cfg.testMode && s.pay_ref) { try { await pay.refund(s.pay_ref); q.run("UPDATE shipments SET refund='sent' WHERE id=?", s.id); } catch (e) { /* stays "requested" for manual follow-up */ } }
  const ns = ship(s.id); fanout(ns, wasOpen); return { ship: view(ns, u.id) };
});
add('POST', '/api/shipments/:id/rate', (c) => {
  const u = me(c), s = mustShip(c.params.id);
  if (s.sender_id !== u.id) throw new HttpError(403, 'Only the sender can rate.');
  if (s.stage !== 4 || s.rating != null) throw conflict('This delivery cannot be rated.');
  const rating = Math.round(Number(c.body.rating)), tip = Number(c.body.tip) || 0;
  if (!(rating >= 1 && rating <= 5)) throw bad('Choose 1 to 5 stars.');
  if (!TIPS.includes(tip)) throw bad('Pick one of the tip amounts.');
  q.run('UPDATE shipments SET rating=?, tip=?, comment=? WHERE id=?', rating, tip, str(c.body.comment, 300), s.id);
  const ns = ship(s.id); fanout(ns, false); return { ship: view(ns, u.id) };
});

/* chat */
add('GET', '/api/shipments/:id/messages', (c) => {
  const u = me(c), s = mustShip(c.params.id);
  if (!participant(s, u.id)) throw notFound();
  return { messages: q.all('SELECT id,user_id uid,role,name,text,ts FROM messages WHERE shipment_id=? ORDER BY id DESC LIMIT 200', s.id).reverse() };
});
add('POST', '/api/shipments/:id/messages', (c) => {
  const u = me(c), s = mustShip(c.params.id);
  if (!participant(s, u.id)) throw notFound();
  if (s.stage < 1) throw conflict('Chat opens when a rider accepts.');
  const text = str(c.body.text, 500, 'Message', true), role = s.rider_id === u.id ? 'rider' : 'customer';
  const r = q.run('INSERT INTO messages(shipment_id,user_id,role,name,text,ts) VALUES(?,?,?,?,?,?)', s.id, u.id, role, u.name, text, now());
  const msg = { id: Number(r.lastInsertRowid), uid: u.id, role, name: u.name, text, ts: now() };
  audience(s).forEach((uid) => push(uid, { t: 'msg', id: s.id, msg }));
  return { msg };
});

/* ------------------------------------------------------------ http plumbing */
const hits = new Map();
function limited(ip, strict) {
  const key = ip + (strict ? ':a' : ''), lim = strict ? 20 : 600, win = strict ? 600000 : 60000, t = now();
  let h = hits.get(key); if (!h || h.reset < t) { h = { n: 0, reset: t + win }; hits.set(key, h); }
  return ++h.n > lim;
}
setInterval(() => { const t = now(); for (const [k, h] of hits) if (h.reset < t) hits.delete(k); }, 60000).unref();

const SEC = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://tile.openstreetmap.org https://*.tile.openstreetmap.org; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
};
function send(res, status, body, headers) {
  const h = Object.assign({}, SEC, headers);
  if (typeof body !== 'string' && !Buffer.isBuffer(body)) { body = JSON.stringify(body); h['Content-Type'] = 'application/json; charset=utf-8'; h['Cache-Control'] = 'no-store'; }
  res.writeHead(status, h); res.end(body);
}
function readBody(req, max = 100000) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (d) => { n += d.length; if (n > max) { reject(new HttpError(413, 'Request too large.')); req.destroy(); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const gz = new Map();
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname); if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const ext = path.extname(file), type = MIME[ext] || 'application/octet-stream';
    const noCache = ['.html', '.webmanifest'].includes(ext) || file.endsWith('sw.js');
    const etag = '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    const h = { 'Content-Type': type, 'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600', ETag: etag };
    if (req.headers['if-none-match'] === etag) return send(res, 304, '', h);
    const canGz = /gzip/.test(req.headers['accept-encoding'] || '') && /^(text|application\/(json|manifest)|image\/svg)/.test(type);
    fs.readFile(file, (e, buf) => {
      if (e) return send(res, 500, 'Error');
      if (canGz) { let z = gz.get(etag + file); if (!z) { z = zlib.gzipSync(buf); gz.set(etag + file, z); } h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding'; buf = z; }
      send(res, 200, buf, h);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), pathname = url.pathname;
  if (pathname === '/healthz') return send(res, 200, { ok: true });
  if (!pathname.startsWith('/api/')) return req.method === 'GET' || req.method === 'HEAD' ? serveStatic(req, res, pathname) : send(res, 405, 'Method not allowed');
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  try {
    let route = null, params = {};
    for (const r of routes) { if (r.method !== req.method) continue; const m = r.re.exec(pathname); if (m) { route = r; params = m.groups || {}; break; } }
    if (!route) throw notFound('Unknown endpoint.');
    if (limited(ip, route.opts.strict)) throw new HttpError(429, 'Too many requests. Please slow down.');
    const raw = req.method === 'POST' || req.method === 'PATCH' ? await readBody(req) : Buffer.alloc(0);
    let body = {};
    if (raw.length && !pathname.endsWith('/webhook')) { try { body = JSON.parse(raw.toString()); } catch (e) { throw bad('Send valid JSON.'); } }
    const ctx = { req, res, params, query: Object.fromEntries(url.searchParams), body: body && typeof body === 'object' ? body : {}, raw, user: null };
    const tok = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (tok) { const uid = auth.verify(tok[1]); if (uid) ctx.user = userRow(uid); }
    const out = await route.fn(ctx);
    if (out && out.redirect) return send(res, 302, '', { Location: out.redirect });
    send(res, 200, out || { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message });
    console.error('[error]', req.method, pathname, e);
    send(res, 500, { error: 'Something went wrong on our side. Please try again.' });
  }
});

/* ------------------------------------------------------------ websocket */
function activeRiderShips(uid) { return q.all('SELECT * FROM shipments WHERE rider_id=? AND stage BETWEEN 1 AND 3', uid); }
const lastWrite = new Map();
wsLib.attach(server,
  (req, url) => { const uid = auth.verify(url.searchParams.get('token')); const u = uid && userRow(uid); return u ? { uid, role: u.role, online: false } : null; },
  (conn, m) => {
    const uid = conn.meta.uid;
    if (m.t === 'online') { conn.meta.online = !!m.on; if (conn.meta.online && conn.meta.role === 'rider') { /* client fetches the open list itself */ } }
    else if (m.t === 'ping') conn.send({ t: 'pong' });
    else if (m.t === 'loc') {
      const lat = Number(m.lat), lng = Number(m.lng);
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      const ts = now();
      for (const s of activeRiderShips(uid)) {
        const lw = lastWrite.get(s.id) || 0;
        live.set('r' + s.id, { lat, lng, ts });
        if (ts - lw > 4000) { lastWrite.set(s.id, ts); q.run('UPDATE shipments SET rider_lat=?, rider_lng=?, rider_ts=? WHERE id=?', lat, lng, ts, s.id); }
        const msg = { t: 'loc', id: s.id, role: 'rider', ll: [lat, lng], hdg: Number(m.hdg) || null, ts };
        audience(s).forEach((a) => { if (a !== uid) push(a, msg); });
      }
    } else if (m.t === 'cloc' || m.t === 'cloff') {
      const s = ship(String(m.id || '')); if (!s || s.rider_id === uid || !participant(s, uid) || s.stage < 1 || s.stage > 3) return;
      if (m.t === 'cloff') { q.run('UPDATE shipments SET recv_lat=NULL, recv_lng=NULL, recv_ts=NULL WHERE id=?', s.id); if (s.rider_id) push(s.rider_id, { t: 'loc', id: s.id, role: 'customer', ll: null }); return; }
      const lat = Number(m.lat), lng = Number(m.lng);
      if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      const ts = now(), lw = lastWrite.get('c' + s.id) || 0;
      live.set('c' + s.id, { lat, lng, ts });
      if (ts - lw > 4000) { lastWrite.set('c' + s.id, ts); q.run('UPDATE shipments SET recv_lat=?, recv_lng=?, recv_ts=? WHERE id=?', lat, lng, ts, s.id); }
      if (s.rider_id) push(s.rider_id, { t: 'loc', id: s.id, role: 'customer', ll: [lat, lng], ts });
    } else if (m.t === 'typing') {
      const s = ship(String(m.id || '')); if (!s || !participant(s, uid)) return;
      const role = s.rider_id === uid ? 'rider' : 'customer';
      audience(s).forEach((a) => { if (a !== uid) push(a, { t: 'typing', id: s.id, role, on: !!m.on }); });
    }
  },
  (conn) => { const set = online.get(conn.meta.uid); if (set) { set.delete(conn); if (!set.size) online.delete(conn.meta.uid); } },
  (conn) => { let set = online.get(conn.meta.uid); if (!set) online.set(conn.meta.uid, set = new Set()); set.add(conn); }
);
module.exports = { server };

if (require.main === module) {
  server.listen(cfg.port, () => console.log('FeelCalm running on port ' + cfg.port + (cfg.testMode ? ' (payments in TEST mode)' : ' (Paystack live)')));
  setInterval(() => {
    const cut = now() - 3600000;
    const stale = q.all("SELECT * FROM shipments WHERE stage=0 AND pay_status='pending' AND created<?", cut);
    for (const s of stale) { q.run('UPDATE shipments SET stage=-1 WHERE id=?', s.id); fanout(ship(s.id), false); }
  }, 600000).unref();
}
