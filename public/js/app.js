/* FeelCalm web app. Phone first, one blue, live GPS. Talks to the FeelCalm server over HTTPS and a WebSocket. */
(function () {
'use strict';

/* ---------------------------------------------------------------- constants */
var STAGE = ['Finding a rider', 'Rider assigned', 'Picked up', 'Rider arrived', 'Delivered'];
var HINT = ['Looking for a rider near the pickup', 'Rider heading to the pickup', 'On the way to the delivery address', 'Rider is at the door. Share your PIN', 'Delivered'];
var RSTAGE = ['New request', 'Head to pickup', 'Delivering', 'At drop-off', 'Completed'];
var TIPS = [0, 200, 500, 1000, 2000];
var AVG_KMH = { Standard: 22, Express: 30 };
var IC = {
  home: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4"/><path d="M12 11v10"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A15 15 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  bike: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17l4-8h5l3 8"/><path d="M10 9L8 6H6"/>',
  wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7l2-3h12"/><circle cx="16.5" cy="13.5" r="1.2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  nav: '<path d="M3 11l18-8-8 18-2-8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>'
};
function ico(n, s) { s = s || 22; return '<svg class="i" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" aria-hidden="true">' + IC[n] + '</svg>'; }
function logo(sz) {
  return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 64 64" role="img" aria-label="FeelCalm logo"><rect width="64" height="64" rx="18" style="fill:var(--logo)"/><path d="M32 9c-8.6 0-14.5 6.3-14.5 14 0 10 11 19.5 14.5 22.3 3.5-2.8 14.5-12.3 14.5-22.3C46.5 15.3 40.6 9 32 9z" fill="#2347FF"/><circle cx="32" cy="23" r="5.5" fill="#fff"/><path d="M14 54c4-3.4 8-3.4 12 0s8 3.4 12 0 8-3.4 12 0" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>';
}

/* ---------------------------------------------------------------- helpers */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function money(n) { return '₦' + Number(n || 0).toLocaleString('en-US'); }
function digits(p) { return String(p || '').replace(/[^0-9+]/g, ''); }
function initials(n) { var p = String(n || '').trim().split(/\s+/).filter(Boolean); return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() : '?'; }
function timeOf(ts) { return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function dateOf(ts) { return new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short' }); }
function distText(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 10) * 10 + ' m'; }
function hav(a, b) { return window.FCGeo.haversineKm(a, b); }
function isDark() { var t = document.documentElement.getAttribute('data-theme'); return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches; }
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }

/* ---------------------------------------------------------------- state */
var S = {
  cfg: null, token: lsGet('fc_token'), me: null, boot: 'loading', screen: 'home', cur: null,
  ships: {}, msgs: {}, unread: {}, typing: {}, routes: {}, drafts: {},
  authMode: lsGet('fc_seen') ? 'login' : 'signup', wRole: 'customer', veh: 'Motorbike',
  form: { zone: 'city', size: 'small', service: 'Standard', pay: 'Card', insured: false },
  addr: { from: null, to: null }, sug: { field: '', items: [], busy: false, down: false },
  online: lsGet('fc_online') === '1', wsUp: false, busy: false, err: '', findMsg: '',
  gps: { state: 'idle', ll: null, acc: 0, ts: 0 }, autofit: true, rating: 0, tip: 0,
  safety: false, receipt: null, payFor: null, installEvt: null, lastErr: ''
};
var $app = document.getElementById('app'), $toast = document.getElementById('toast');
var ws = null, wsTimer = null, wsTry = 0, toastT = null, renderQ = false, lastScreen = '', sugT = null, typeT = 0;
var map = null, geoWatch = null, lastSent = 0, lastSentLL = null, wake = null;

function D(id, fb) { return S.drafts[id] != null ? S.drafts[id] : (fb == null ? '' : fb); }
function toast(msg) { $toast.textContent = msg; $toast.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { $toast.hidden = true; }, 4200); }
function notify(msg, important, tag) {
  if (S.me && S.me.calm && !important) return;
  toast(msg);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted' && navigator.serviceWorker) {
    navigator.serviceWorker.ready.then(function (r) { r.showNotification('FeelCalm', { body: msg, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: tag || 'fc', renotify: true }); }).catch(function () {});
  }
  if (important && navigator.vibrate) { try { navigator.vibrate([120, 60, 120]); } catch (e) {} }
}

async function api(method, url, body) {
  var r, j;
  try {
    r = await fetch(url, { method: method, headers: Object.assign({ 'Content-Type': 'application/json' }, S.token ? { Authorization: 'Bearer ' + S.token } : {}), body: body ? JSON.stringify(body) : undefined });
  } catch (e) { var ne = new Error('No connection. Check your internet and try again.'); ne.net = true; throw ne; }
  j = await r.json().catch(function () { return {}; });
  if (r.status === 401 && S.token && url.indexOf('/auth/') < 0) { logout(true); throw new Error('Please sign in again.'); }
  if (!r.ok) { var e = new Error(j.error || 'Something went wrong. Please try again.'); e.status = r.status; throw e; }
  return j;
}

/* ---------------------------------------------------------------- derived data */
function list(kind) { return Object.keys(S.ships).map(function (k) { return S.ships[k]; }).filter(function (s) { return s.mine === kind; }).sort(function (a, b) { return (b.created || 0) - (a.created || 0); }); }
function myRole() { return S.me ? S.me.role : 'customer'; }
function isActive(s) { return s.stage >= 0 && s.stage <= 3; }
function curShip() {
  var rider = myRole() === 'rider', all = Object.keys(S.ships).map(function (k) { return S.ships[k]; }), s;
  if (rider) {
    s = all.filter(function (x) { return x.mine === 'rider' && x.stage >= 1 && x.stage <= 3; })[0];
    if (s) { S.cur = s.id; return s; }
    s = S.cur && S.ships[S.cur]; return (s && s.mine === 'rider' && s.stage === 4) ? s : null;
  }
  if (S.cur && S.ships[S.cur] && S.ships[S.cur].mine !== 'open' && S.ships[S.cur].stage !== -1) return S.ships[S.cur];
  var l = all.filter(function (x) { return (x.mine === 'sender' || x.mine === 'follower') && x.stage >= 0 && (x.stage < 4 || (x.mine === 'sender' && !x.rated)); }).sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
  S.cur = l[0] ? l[0].id : null; return l[0] || null;
}
function target(sh) { return sh.stage <= 1 ? sh.fromLL : sh.toLL; }
function riderLL(sh) {
  if (sh.mine === 'rider' && S.gps.ll && S.gps.ts > Date.now() - 120000) return S.gps.ll;
  return sh.riderPos ? sh.riderPos.ll : null;
}
function recvLL(sh) {
  if (sh.mine !== 'rider' && S.me && S.me.share && S.gps.ll && S.gps.ts > Date.now() - 120000) return S.gps.ll;
  return sh.recvPos ? sh.recvPos.ll : null;
}
function liveInfo(sh) {
  var key = 'R' + sh.id, r = S.routes[key], leg2 = S.routes['L' + sh.id], q = sh.q || { mins: 30, km: 5 };
  var rl = riderLL(sh), tg = target(sh), km, mins;
  if (sh.stage >= 3) return { eta: 0, km: 0, known: true };
  if (rl && tg) {
    if (r && r.ok) { km = r.km; mins = r.mins; }
    else { km = hav(rl, tg) * 1.3; mins = km / AVG_KMH[sh.service || 'Standard'] * 60; }
    if (sh.stage === 1 && leg2) { km += leg2.km; mins += leg2.mins; } else if (sh.stage === 1) { var d = sh.fromLL && sh.toLL ? hav(sh.fromLL, sh.toLL) * 1.3 : q.km; km += d; mins += d / AVG_KMH[sh.service || 'Standard'] * 60; }
    return { eta: Math.max(1, Math.round(mins)), km: km, known: true };
  }
  return { eta: q.mins, km: q.km, known: false };
}
function etaText(sh) { if (sh.stage >= 4) return 'Delivered'; if (sh.stage === 3) return 'Arrived'; if (sh.stage === 0) return 'Finding rider'; return liveInfo(sh).eta + ' min'; }
function chatUnread() { return Object.keys(S.unread).some(function (k) { return S.unread[k]; }); }

/* pricing preview (the server decides the final price) */
function localQuote() {
  var f = S.form, cat = S.cfg.cat, zone = f.zone, km = null, note = '', ok = true;
  if (S.addr.from && S.addr.to) {
    km = hav(S.addr.from.ll, S.addr.to.ll) * cat.roadFactor;
    zone = km <= 5 ? 'near' : km <= 15 ? 'city' : km <= 30 ? 'far' : null;
    if (!zone) { ok = false; note = 'That trip is over 30 km. We do not deliver that far yet.'; zone = 'far'; }
  }
  var z = cat.zones[zone], sz = cat.sizes[f.size], delivery = z[f.service], ins = f.insured ? cat.ins : 0;
  return { ok: ok, note: note, auto: km != null, km: km, zone: zone, delivery: delivery, size: sz.add, fee: cat.fee, ins: ins, total: delivery + sz.add + cat.fee + ins, mins: z.mins[f.service], zoneLabel: z.label, sizeLabel: sz.label };
}
function quoteRows(q, service) {
  var r = [['Delivery · ' + q.zoneLabel + ' · ' + service, money(q.delivery)], ['Package · ' + q.sizeLabel, q.size ? money(q.size) : 'Included'], ['Service fee', money(q.fee)]];
  if (q.ins) r.push(['Parcel protection', money(q.ins)]);
  return r.map(function (x) { return '<div class="row between g12"><span>' + esc(x[0]) + '</span><span class="num">' + esc(x[1]) + '</span></div>'; }).join('') +
    '<div class="row between g12 xb"><span>Total</span><span class="num">' + money(q.total) + '</span></div>';
}

/* ---------------------------------------------------------------- shell */
function navBar() {
  var rider = myRole() === 'rider', sc = S.screen;
  function b(label, icon, to, on, badge) {
    return '<button data-act="go" data-to="' + to + '" aria-label="' + label + '"' + (on ? ' class="on" aria-current="page"' : '') + '>' + ico(icon) + (badge ? '<span class="unread"></span>' : '') + '</button>';
  }
  return '<nav class="navbar" aria-label="Main">' + b('Home', 'home', 'home', sc === 'home', !rider && chatUnread() && sc !== 'home') + b('Live map', 'pin', 'track', sc === 'track') +
    (rider ? b('Earnings', 'wallet', 'earn', sc === 'earn') : b('History', 'wallet', 'history', sc === 'history')) + b('Profile', 'user', 'profile', sc === 'profile') + '</nav>';
}
function sheetOpen(inner) { return '<div class="overlay" data-act="closeOv" data-bg="1"><div class="osheet" role="dialog" aria-modal="true"><div class="grab"></div>' + inner + '</div></div>'; }
function overlays() {
  var h = '', r;
  if (S.safety) {
    h += sheetOpen('<div class="xb" style="font-size:20px">Safety</div><div class="small muted">Your trip is visible only to you, your rider and the receiver. Use these if something feels wrong.</div>' +
      '<div class="card col g4"><span class="small muted">Emergency line (Nigeria)</span><a class="xb" style="font-size:24px" href="tel:112">112</a></div>' +
      '<button class="btn soft" data-act="shareTrip">Share live tracking link</button><button class="btn" style="color:var(--accent)" data-act="closeOv">Close</button>');
  }
  if (S.receipt && (r = S.ships[S.receipt])) {
    h += sheetOpen('<div class="row between"><div class="xb" style="font-size:20px">Receipt</div><span class="badge">' + esc(r.id) + '</span></div>' +
      '<div class="col g12">' + quoteRows(r.q, r.service) + (r.tip ? '<div class="row between"><span>Tip</span><span class="num">' + money(r.tip) + '</span></div>' : '') + '</div>' +
      '<div class="row between small muted"><span>Paid with</span><span>' + esc(r.pay) + '</span></div><div class="small muted">' + esc(r.from) + ' to ' + esc(r.to) + '</div>' +
      '<div class="small muted">' + esc(dateOf(r.created) + ' · ' + timeOf(r.created)) + '</div><button class="btn" style="color:var(--accent)" data-act="closeOv">Close</button>');
  }
  if (S.payFor && (r = S.ships[S.payFor.id])) {
    h += sheetOpen('<div class="xb" style="font-size:20px">Pay for your delivery</div><div class="card col g8">' + quoteRows(r.q, r.service) + '</div>' +
      (S.cfg && S.cfg.testMode ? '<div class="banner">Test mode: no real money moves. Add Paystack keys on the server to take real payments.</div>' : '<div class="small muted">You will be taken to Paystack to pay securely, then brought back here.</div>') +
      (S.err ? '<div class="err">' + esc(S.err) + '</div>' : '') +
      '<button class="btn primary" data-act="payNow"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Please wait' : 'Pay ' + money(r.q.total)) + '</button><button class="btn" style="color:var(--accent)" data-act="closeOv">Pay later</button>');
  }
  if (S.ask) {
    h += sheetOpen('<div class="xb" style="font-size:20px">' + esc(S.ask.title) + '</div><div class="small muted">' + esc(S.ask.text) + '</div>' +
      '<button class="btn dark" data-act="' + S.ask.act + '"' + (S.busy ? ' disabled' : '') + '>' + esc(S.ask.yes) + '</button><button class="btn" style="color:var(--accent)" data-act="closeOv">Keep it</button>');
  }
  return h;
}
function shell(content, nav) { return '<div class="scroll' + (nav ? ' nav' : '') + '">' + content + '</div>' + (nav ? navBar() : '') + overlays() + (S.net === false ? '<div class="offline" role="alert">' + ico('nav', 16) + 'You are offline. Reconnecting</div>' : ''); }
function errLine() { return S.err ? '<div class="err" role="alert">' + esc(S.err) + '</div>' : ''; }
function field(id, label, ph, fb, extra) { return '<div class="col g8"><label class="lab" for="' + id + '">' + label + '</label><input class="inp" id="' + id + '" placeholder="' + esc(ph) + '" value="' + esc(D(id, fb)) + '" ' + (extra || '') + '></div>'; }

/* ---------------------------------------------------------------- boot + sign in */
function vBoot() {
  var bad = S.boot === 'error';
  return '<div class="splash">' + logo(64) + '<div class="brand" style="font-size:26px">Feel<b>Calm</b></div>' +
    (bad ? '<div class="small muted" style="max-width:280px">' + esc(S.lastErr || 'We could not reach the server.') + '</div><button class="btn sm dark" data-act="retryBoot">Try again</button>' : '<div class="spin" role="status" aria-label="Loading"></div>') + '</div>';
}
function vAuth() {
  var signup = S.authMode === 'signup', rider = S.wRole === 'rider';
  var veh = ['Motorbike', 'Bicycle', 'Car'].map(function (v) { return '<button data-act="setVeh" data-v="' + v + '"' + (S.veh === v ? ' class="on"' : '') + '>' + v + '</button>'; }).join('');
  return shell(
    '<div class="ink col g24" style="border-radius:36px;padding:24px;min-height:210px;justify-content:space-between"><div class="row g12">' + logo(48) + '<span class="brand" style="font-size:24px">Feel<b style="color:#6C88FF">Calm</b></span></div>' +
    '<div class="col g8"><div class="xb" style="font-size:28px;line-height:34px">Deliveries that feel calm.</div><div class="small mut">Fixed prices, live GPS and chat for you, your rider and the receiver.</div></div></div>' +
    '<div class="auth-tabs" role="tablist"><button role="tab" aria-selected="' + signup + '" data-act="authMode" data-m="signup"' + (signup ? ' class="on"' : '') + '>Create account</button><button role="tab" aria-selected="' + !signup + '" data-act="authMode" data-m="login"' + (!signup ? ' class="on"' : '') + '>Sign in</button></div>' +
    (signup ? '<div class="grid2"><button class="opt' + (!rider ? ' on' : '') + '" data-act="wRole" data-r="customer" style="height:76px;justify-content:center;border-radius:24px"><span class="t" style="font-size:15px">Send or receive</span><span class="s">I am a customer</span></button>' +
      '<button class="opt' + (rider ? ' on' : '') + '" data-act="wRole" data-r="rider" style="height:76px;justify-content:center;border-radius:24px"><span class="t" style="font-size:15px">Ride and earn</span><span class="s">I am a rider</span></button></div>' : '') +
    '<div class="col g12">' +
    (signup ? '<input class="inp" id="a-name" aria-label="Full name" autocomplete="name" placeholder="Full name" value="' + esc(D('a-name')) + '">' +
      '<input class="inp" id="a-phone" aria-label="Phone number" inputmode="tel" autocomplete="tel" placeholder="' + (rider ? 'Phone number customers will call' : 'Phone number') + '" value="' + esc(D('a-phone')) + '">' +
      (rider ? '<div class="seg2" role="group" aria-label="Vehicle">' + veh + '</div><input class="inp" id="a-plate" aria-label="Plate number" placeholder="Plate number (optional)" value="' + esc(D('a-plate')) + '">' :
        '<input class="inp" id="a-address" aria-label="Home or office address" autocomplete="street-address" placeholder="Home or office address (optional)" value="' + esc(D('a-address')) + '">') : '') +
    '<input class="inp" id="a-email" type="email" aria-label="Email" autocomplete="email" placeholder="Email" value="' + esc(D('a-email')) + '">' +
    '<input class="inp" id="a-pass" type="password" aria-label="Password" autocomplete="' + (signup ? 'new-password' : 'current-password') + '" placeholder="' + (signup ? 'Password (8+ characters)' : 'Password') + '" value="' + esc(D('a-pass')) + '" data-enter="submitAuth">' +
    errLine() + '</div>' +
    '<button class="btn primary" data-act="submitAuth"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Please wait' : signup ? 'Create account' : 'Sign in') + '</button>' +
    '<div class="small muted center" style="text-align:center">By continuing you agree to use FeelCalm for lawful deliveries only.</div>', false);
}

/* ---------------------------------------------------------------- home */
function badgeText(sh) {
  if (sh.stage === 0 && sh.payStatus === 'pending') return 'Payment needed';
  if (sh.mine === 'rider') return RSTAGE[sh.stage];
  return STAGE[sh.stage];
}
function shipCard(sh) {
  var rider = sh.mine === 'rider', recv = sh.mine === 'follower';
  var left = sh.stage === 4 ? 'Delivered to ' + esc(sh.rName) : sh.stage === 0 ? (sh.payStatus === 'pending' ? 'Pay to start looking' : 'Finding a rider') : sh.stage === 3 ? 'Rider has arrived' : 'Arrives in ' + etaText(sh);
  var cta = sh.stage === 0 && sh.payStatus === 'pending' && sh.mine === 'sender' ? 'Pay now' : sh.stage === 4 && sh.mine === 'sender' && !sh.rated ? 'Rate and tip' : 'Live tracking';
  return '<button class="outline col g16" style="width:100%" data-act="openShip" data-id="' + esc(sh.id) + '"><div class="row g12"><div class="circ dk" style="border-radius:14px">' + ico('box') + '</div>' +
    '<div class="col f1 g4"><span class="h3 trunc">' + esc(sh.id) + (recv ? ' · for you' : '') + '</span><span class="small muted trunc">' + esc(sh.item) + ' · ' + esc(sh.service) + '</span></div><span class="badge">' + badgeText(sh) + '</span></div>' +
    '<div class="col g8"><div class="bar"><i style="width:' + ['10%', '30%', '60%', '90%', '100%'][Math.max(0, sh.stage)] + '"></i></div><div class="row between small b"><span class="muted">' + left + '</span><span style="color:var(--accent)">' + cta + '</span></div></div></button>';
}
function vHomeC() {
  var me = S.me, cur = curShip(), unread = chatUnread();
  var act = Object.keys(S.ships).map(function (k) { return S.ships[k]; }).filter(function (s) { return (s.mine === 'sender' || s.mine === 'follower') && ((s.stage >= 0 && s.stage < 4) || (s.stage === 4 && s.mine === 'sender' && !s.rated)); }).sort(function (a, b) { return (b.created || 0) - (a.created || 0); });
  return shell('<div class="row g12">' + logo(40) + '<span class="brand f1" style="font-size:20px">Feel<b>Calm</b></span><button class="circ dk" aria-label="Open profile" data-act="go" data-to="profile" style="font-weight:700">' + esc(initials(me.name)) + '</button></div>' +
    '<div class="col g4"><span class="h1">Hello, ' + esc((me.name || '').trim().split(' ')[0]) + '</span><span class="small muted trunc">' + esc(me.address || 'Add your address in Profile') + '</span></div>' +
    '<div class="ink col g16"><div class="col g6"><span class="xb" style="font-size:20px">Track a package</span><span class="small mut">' + esc(S.findMsg || 'Enter a tracking ID to follow a parcel sent to you or by you.') + '</span></div>' +
    '<div class="row g8" style="background:var(--bg);color:var(--fg);border-radius:30px;height:56px;padding:0 8px 0 18px"><span class="muted">' + ico('search', 20) + '</span>' +
    '<input id="t-id" aria-label="Tracking ID" placeholder="e.g. FC-48K2PQ" autocapitalize="characters" value="' + esc(D('t-id')) + '" data-enter="findShip" style="flex:1;min-width:0;border:0;background:transparent;outline:0;font-weight:500;color:var(--fg)">' +
    '<button class="circ acc" aria-label="Find shipment" data-act="findShip" style="width:42px;height:42px;border-radius:21px">' + ico('arrow', 20) + '</button></div></div>' +
    '<div class="grid3"><button class="qa" data-act="go" data-to="new">' + ico('box', 24) + '<span>Send parcel</span></button><button class="qa" data-act="go" data-to="chat">' + ico('chat', 24) + '<span>Messages</span>' + (unread ? '<span class="unread"></span>' : '') + '</button><button class="qa" data-act="go" data-to="track">' + ico('pin', 24) + '<span>Live map</span></button></div>' +
    '<div class="col g12"><span class="h2">' + (act.length > 1 ? 'Active deliveries' : 'Current shipment') + '</span>' +
    (act.length ? act.slice(0, 6).map(shipCard).join('') : '<div class="dashed col g12" style="align-items:center"><div class="circ" style="border-radius:16px;width:48px;height:48px">' + ico('box', 24) + '</div><div class="col g4"><span class="h3">No shipments yet</span><span class="small muted">Send a parcel at a fixed price and watch your rider arrive live.</span></div><button class="btn sm primary" data-act="go" data-to="new">Send a parcel</button></div>') + '</div>', true);
}
function vHomeR() {
  var me = S.me, active = curShip();
  var jobs = list('rider'), done = jobs.filter(function (j) { return j.stage === 4; });
  var earn = done.reduce(function (a, j) { return a + (j.q ? j.q.payout : 0) + (j.tip || 0); }, 0);
  var rated = done.filter(function (j) { return j.rating > 0; });
  var avg = rated.length ? (rated.reduce(function (a, j) { return a + j.rating; }, 0) / rated.length).toFixed(1) : 'New';
  var reqs = list('open'), body = '';
  if (active && active.stage >= 1 && active.stage <= 3) body = shipCard(active);
  else if (!S.online) body = '<div class="card center col g8" style="padding:24px"><span class="h3">You are offline</span><span class="small muted">Go online to receive delivery requests.</span></div>';
  else if (!reqs.length) body = '<div class="dashed col g8" style="align-items:center"><span class="row g8 b" style="color:var(--accent);font-size:13px"><span class="dot"></span>Looking for requests</span><span class="small muted">New deliveries appear here with your payout shown first.</span></div>';
  else body = reqs.map(function (r) {
    var away = S.gps.ll && r.fromLL ? distText(hav(S.gps.ll, r.fromLL) * 1000) + ' from you' : '';
    return '<div class="outline col g16" style="border:2px solid var(--accent)"><div class="row between"><span class="b" style="color:var(--accent);font-size:13px">New request' + (away ? ' · ' + away : '') + '</span><span class="xb" style="font-size:22px">' + money(r.q.payout) + '</span></div>' +
      '<div class="col g8"><div class="col"><span class="small muted">Pickup</span><span class="b">' + esc(r.from) + '</span></div><div class="col"><span class="small muted">Drop-off</span><span class="b">' + esc(r.to) + '</span></div></div>' +
      '<div class="small b muted">' + esc(r.item) + ' · ' + esc(r.q.sizeLabel) + ' · ' + esc(r.service) + ' · ' + r.q.km + ' km</div><button class="btn primary" data-act="accept" data-id="' + esc(r.id) + '"' + (S.busy ? ' disabled' : '') + '>Accept delivery</button></div>';
  }).join('');
  if (active && active.stage === 4) body = '<div class="ink col g6"><span class="small mut b">Delivery complete</span><span class="xb" style="font-size:26px">' + money(active.q.payout) + ' earned</span><button class="btn sm white" data-act="riderDone" style="align-self:flex-start;margin-top:8px">Back to requests</button></div>';
  return shell('<div class="row g12">' + logo(40) + '<span class="brand f1" style="font-size:20px">Feel<b>Calm</b> <span class="small muted b">Rider</span></span><button class="circ dk" aria-label="Open profile" data-act="go" data-to="profile" style="font-weight:700">' + esc(initials(me.name)) + '</button></div>' +
    '<div class="ink col g16"><div class="row between"><div class="col g4"><span class="small mut">Earned so far</span><span class="xb num" style="font-size:32px">' + money(earn) + '</span></div>' +
    '<button class="btn sm onink" role="switch" aria-checked="' + S.online + '" data-act="toggleOnline" style="' + (S.online ? 'background:var(--accent);color:var(--on-accent)' : '') + '"><span class="dot" style="background:' + (S.online ? 'currentColor' : 'var(--ink-muted)') + '"></span>' + (S.online ? 'Online' : 'Offline') + '</button></div>' +
    '<div class="grid3"><div class="card col g4" style="background:var(--ink-card);padding:12px 14px"><span class="xb num" style="font-size:18px">' + done.length + '</span><span class="tiny mut b">Trips</span></div><div class="card col g4" style="background:var(--ink-card);padding:12px 14px"><span class="xb num" style="font-size:18px">' + avg + '</span><span class="tiny mut b">Rating</span></div><div class="card col g4" style="background:var(--ink-card);padding:12px 14px"><span class="xb trunc" style="font-size:15px;line-height:26px">' + esc(me.vehicle || 'Motorbike') + '</span><span class="tiny mut b">Vehicle</span></div></div>' +
    (S.online ? gpsBar() : '') + '</div>' +
    (!me.phone ? '<button class="banner row g12" data-act="go" data-to="profile" style="width:100%"><span class="f1">Add the number customers can call you on.</span><span style="color:var(--accent)">Add</span></button>' : '') +
    '<div class="col g12"><span class="h2">Deliveries</span>' + body + '</div>', true);
}
function gpsBar() {
  var g = S.gps, txt, off = true;
  if (g.state === 'on') { off = false; txt = 'GPS on' + (g.acc ? ' · accurate to ' + Math.round(g.acc) + ' m' : ''); }
  else if (g.state === 'denied') txt = myRole() === 'rider' ? 'Location is blocked. Allow it in your browser settings so customers can follow you.' : 'Location is blocked. Allow it in your browser settings so your rider can find you.';
  else if (g.state === 'unavailable') txt = 'This device cannot share its location.';
  else if (g.state === 'asking') txt = 'Waiting for your location';
  else txt = myRole() === 'rider' ? 'Turn on location so customers can follow you.' : 'Turn on location so your rider can find you.';
  return '<div class="gpsbar"><span class="dot' + (off ? ' off' : '') + '"></span><span class="f1">' + esc(txt) + '</span>' + (g.state === 'idle' || g.state === 'denied' ? '<button class="b" style="color:#fff" data-act="enableGps">Turn on</button>' : '') + '</div>';
}

/* ---------------------------------------------------------------- send a parcel */
function vNew() {
  var f = S.form, q = localQuote(), z = S.cfg.cat.zones, cat = S.cfg.cat, auto = q.auto;
  function opts(map, key, getP, locked) {
    return '<div class="grid3">' + Object.keys(map).map(function (k) { return '<button class="opt' + ((locked ? q.zone : f[key]) === k ? ' on' : '') + '" data-act="setForm" data-k="' + key + '" data-v="' + k + '"' + (locked ? ' disabled' : '') + '><span class="t">' + map[k].label + '</span><span class="s">' + map[k].range + '</span><span class="p">' + getP(map[k]) + '</span></button>'; }).join('') + '</div>';
  }
  function sug(fieldKey) {
    if (S.sug.field !== fieldKey) return '';
    if (S.sug.busy) return '<div class="small muted" style="padding-left:8px">Searching</div>';
    if (S.sug.down) return '<div class="small muted" style="padding-left:8px">Address search is unavailable. Type the full address and choose the distance below.</div>';
    if (!S.sug.items.length) return '';
    return '<div class="sug" role="listbox"><div class="hd">Suggestions</div>' + S.sug.items.map(function (it, i) { return '<button role="option" data-act="pickSug" data-i="' + i + '">' + esc(it.label) + '</button>'; }).join('') + '</div>';
  }
  function addrField(id, key, label, ph, withGps) {
    var set = !!S.addr[key];
    return '<div class="col g8"><label class="lab" for="' + id + '">' + label + (set ? ' · pinned on map' : '') + '</label><div class="inpwrap"><input class="inp" id="' + id + '" autocomplete="off" placeholder="' + esc(ph) + '" value="' + esc(D(id)) + '">' +
      (withGps ? '<button aria-label="Use my current location" data-act="useGps" data-field="' + key + '">' + ico('target', 20) + '</button>' : '') + '</div>' + sug(key) + '</div>';
  }
  var pay = ['Card', 'Bank transfer', 'Cash to rider'].map(function (p) { return '<button class="pill' + (f.pay === p ? ' on' : '') + '" data-act="setForm" data-k="pay" data-v="' + p + '">' + p + '</button>'; }).join('');
  return '<div class="scroll" style="padding-bottom:16px"><div class="row between"><button class="circ" aria-label="Back" data-act="go" data-to="home">' + ico('back') + '</button><span class="b" style="font-size:15px">Send a parcel</span><span style="width:44px"></span></div>' +
    field('n-item', 'What are you sending?', 'e.g. Documents, shoes, laptop') +
    addrField('n-from', 'from', 'Pickup address', 'Where should the rider collect it?', true) + addrField('n-to', 'to', 'Delivery address', 'Where is it going?', false) +
    '<div class="grid2">' + field('n-rn', 'Receiver name', 'Name', '', 'autocomplete="off"') + field('n-rp', 'Receiver phone', 'Phone', '', 'inputmode="tel" autocomplete="off"') + '</div>' +
    '<div class="col g8"><span class="lab">Distance' + (auto ? ' · worked out from your addresses (about ' + q.km.toFixed(1) + ' km)' : '') + '</span>' + opts(z, 'zone', function (o) { return money(o[f.service]); }, auto) + '</div>' +
    '<div class="col g8"><span class="lab">Package size</span>' + opts(cat.sizes, 'size', function (o) { return o.add ? '+' + money(o.add) : 'Included'; }) + '</div>' +
    '<div class="col g8"><span class="lab">Speed</span><div class="seg2" role="group" aria-label="Speed"><button data-act="setForm" data-k="service" data-v="Standard"' + (f.service === 'Standard' ? ' class="on"' : '') + '>Standard · ' + z[q.zone].mins.Standard + ' min</button><button data-act="setForm" data-k="service" data-v="Express"' + (f.service === 'Express' ? ' class="on"' : '') + '>Express · ' + z[q.zone].mins.Express + ' min</button></div></div>' +
    '<div class="col g8"><span class="lab">Pay with</span><div class="row g8 wrap">' + pay + '</div></div>' +
    '<button class="outline row between g12" style="width:100%" role="switch" aria-checked="' + f.insured + '" data-act="toggleIns"><div class="col g4"><span class="b" style="font-size:14px">Protect this parcel</span><span class="small muted">Covers loss or damage up to ' + money(cat.insCover) + ' · +' + money(cat.ins) + '</span></div><span class="tog' + (f.insured ? ' on' : '') + '"></span></button>' +
    field('n-note', 'Note for the rider (optional)', 'Gate code, landmark, call on arrival') +
    '<div class="card col g12" style="border-radius:24px;padding:18px"><span class="h3">Price breakdown</span>' + quoteRows(q, f.service) + '<span class="tiny muted">Fixed price. No surge, no hidden fees.</span></div>' +
    (q.note ? '<div class="err">' + esc(q.note) + '</div>' : '') + errLine() +
    '<div class="row g16"><div class="col g4 nos"><span class="small muted b">Total</span><span class="xb num" style="font-size:24px">' + money(q.total) + '</span></div><button class="btn dark" data-act="createShip"' + (S.busy || !q.ok ? ' disabled' : '') + '>' + (S.busy ? 'Please wait' : 'Confirm and find a rider') + '</button></div></div>' + overlays();
}

/* ---------------------------------------------------------------- live map screen */
function mapBox(sh, back) {
  return '<div class="mapbox" id="mapbox"><div class="mapbtn"><button class="circ" aria-label="Back" data-act="go" data-to="' + back + '">' + ico('back') + '</button></div>' +
    (sh ? '<div class="mappill"><span class="dot"></span><span id="eta-pill" class="num">' + etaText(sh) + '</span></div>' : '') +
    '<div class="mapctl"><button aria-label="Zoom in" data-act="zoom" data-d="1">' + ico('plus', 20) + '</button><button aria-label="Zoom out" data-act="zoom" data-d="-1">' + ico('minus', 20) + '</button><button aria-label="Centre the map" data-act="recenter">' + ico('target', 20) + '</button></div>' +
    '<div class="attrib">' + esc(S.cfg ? S.cfg.tiles.attribution : '') + '</div></div>';
}
function contactRow(name, sub, phone, chat) {
  var has = digits(phone);
  return '<div class="row g12" style="background:var(--ink-card);border-radius:24px;padding:10px 10px 10px 12px"><div class="circ" style="background:var(--seg-off);color:var(--ink-fg)">' + ico('user', 20) + '</div>' +
    '<div class="col f1 g4"><span class="b trunc" style="font-size:14px">' + esc(name) + '</span><span class="small muted trunc">' + esc(sub) + '</span></div>' +
    (chat ? '<button class="circ wh" aria-label="Open chat" data-act="go" data-to="chat">' + ico('chat', 20) + '</button>' : '') +
    '<a class="circ ' + (has ? 'acc' : 'off') + '" aria-label="Call ' + esc(name) + '" href="' + (has ? 'tel:' + has : '#') + '">' + ico('phone', 20) + '</a></div>';
}
function vTrack() {
  var sh = curShip(), rider = myRole() === 'rider';
  if (!sh) {
    return '<div class="trackwrap">' + mapBox(null, 'home') + '<div class="sheet center" style="gap:20px;padding-bottom:104px"><div class="grab"></div><div class="col g8"><span class="xb" style="font-size:20px">Nothing on the map yet</span><span class="small muted">' + (rider ? 'Accept a delivery and your route appears here.' : 'Send a parcel and your rider appears here, live.') + '</span></div>' +
      '<button class="btn primary" data-act="go" data-to="' + (rider ? 'home' : 'new') + '">' + (rider ? 'Back to requests' : 'Send a parcel') + '</button></div></div>' + navBar() + overlays();
  }
  var st = sh.stage, segs = [0, 1, 2, 3, 4].map(function (i) { return '<i' + (i <= st ? ' class="on"' : '') + '></i>'; }).join(''), li = liveInfo(sh), body = '';
  if (!rider) {
    var isSender = sh.mine === 'sender', pay = isSender && st === 0 && sh.payStatus === 'pending';
    body = '<div class="row between"><div class="col g4"><span class="small muted">Tracking ID</span><span class="xb" style="font-size:24px">' + esc(sh.id) + '</span></div><span class="badge solid">' + badgeText(sh) + '</span></div>' +
      '<div class="col g8"><div class="segs">' + segs + '</div><span class="small b muted">' + (pay ? 'Pay to start looking for a rider' : st === 0 && S.findMsg ? S.findMsg : HINT[Math.max(0, st)]) + '</span></div>' +
      (st >= 1 && st < 3 ? '<div class="grid3"><div class="col g4"><span class="small muted">Arrives in</span><span class="b num" id="m-eta" style="font-size:15px">' + etaText(sh) + '</span></div><div class="col g4"><span class="small muted">Distance left</span><span class="b num" id="m-dist" style="font-size:15px">' + li.km.toFixed(1) + ' km</span></div><div class="col g4"><span class="small muted">Total</span><span class="b num" style="font-size:15px">' + money(sh.q.total) + '</span></div></div>' : '') +
      (pay ? '<button class="btn primary" data-act="openPay" data-id="' + esc(sh.id) + '">Pay ' + money(sh.q.total) + '</button>' : '') +
      (sh.pin && st >= 1 && st < 4 ? '<div class="row between" style="background:var(--ink-card);border-radius:20px;padding:12px 16px"><div class="col g4"><span class="small muted">Delivery PIN</span><span class="tiny muted">' + (isSender ? 'Give it to the receiver' : 'Tell it to the rider at the door') + '</span></div><span class="pin num">' + esc(sh.pin) + '</span></div>' : '') +
      (st === 4 && isSender && !sh.rated ? '<button class="btn primary" data-act="go" data-to="rate">Rate your rider and add a tip</button>' : '') +
      (sh.riderId ? contactRow(sh.riderName || 'Your rider', (sh.riderVehicle || '') + (sh.riderPlate ? ' · ' + sh.riderPlate : '') + (sh.riderPhone ? ' · ' + sh.riderPhone : '') + (sh.riderRating ? ' · ' + sh.riderRating.avg + ' stars' : ''), sh.riderPhone, true) :
        (st === 0 && !pay ? '<div class="row g12 small b muted" style="background:var(--ink-card);border-radius:24px;padding:16px"><span class="dot"></span>Looking for a rider near the pickup</div>' : '')) +
      (st < 4 && st >= 0 ? '<div class="row g8"><button class="btn sm onink f1" data-act="toggleShare" style="padding:0 8px"><span class="dot" style="background:' + (S.me.share ? 'var(--accent)' : 'var(--ink-muted)') + '"></span>' + (S.me.share ? 'Location on' : 'Location off') + '</button><button class="btn sm onink f1" data-act="shareTrip" style="padding:0 8px">Share trip</button><button class="btn sm onink f1" data-act="openSafety" style="padding:0 8px">Safety</button></div>' : '') +
      (S.me.share && st >= 1 && st < 4 ? gpsBar() : '') +
      (isSender && st >= 0 && st < 2 ? '<button class="small b muted" data-act="askCancel" style="text-align:center;height:24px">Cancel shipment' + (sh.payStatus === 'paid' ? ' (refund to your card)' : ' (free before pickup)') + '</button>' : '');
  } else {
    var addr = st >= 2 ? sh.to : sh.from, action = '', tgt = target(sh), d = S.gps.ll && tgt ? hav(S.gps.ll, tgt) * 1000 : null, gf = S.cfg.geofenceM, far = gf && (d == null || d > gf);
    var nextTxt = ['Accept to start', 'Head to the pickup', 'Deliver to the receiver', 'Collect the PIN from the receiver', 'Delivery complete'][st];
    var nearTxt = st === 1 || st === 2 ? (d == null ? 'Waiting for your location' : distText(d) + ' away' + (far ? ' · get within ' + gf + ' m to continue' : ' · you are there')) : '';
    if (st === 1) action = '<button class="btn primary" data-act="picked"' + (far || S.busy ? ' disabled' : '') + '>' + (far ? 'Riding to pickup' : 'Confirm pickup') + '</button>';
    if (st === 2) action = '<button class="btn primary" data-act="arrived"' + (far || S.busy ? ' disabled' : '') + '>' + (far ? 'Riding to drop-off' : "I've arrived") + '</button>';
    if (st === 3) action = '<div class="row g8"><input class="inp f1" id="r-pin" inputmode="numeric" maxlength="4" autocomplete="one-time-code" aria-label="Delivery PIN" placeholder="Receiver 4-digit PIN" value="' + esc(D('r-pin')) + '" data-enter="confirmPin"><button class="btn primary" style="width:auto" data-act="confirmPin"' + (S.busy ? ' disabled' : '') + '>Confirm</button></div>';
    if (st === 4) action = '<button class="btn primary" data-act="riderDone">Done · back to requests</button>';
    body = '<div class="row between"><div class="col g4"><span class="small muted">' + RSTAGE[st] + '</span><span class="xb" style="font-size:24px">' + esc(sh.id) + '</span></div><div class="col g4" style="align-items:flex-end"><span class="small muted">Your payout</span><span class="xb num" style="font-size:20px">' + money(sh.q.payout) + '</span></div></div>' +
      '<div class="segs">' + segs + '</div><div class="col g4"><span class="b" style="font-size:14px">' + nextTxt + '</span><span class="small muted">' + esc(addr) + '</span>' + (sh.note ? '<span class="small muted">Note: ' + esc(sh.note) + '</span>' : '') + (nearTxt ? '<span class="small b" id="near-txt" style="color:var(--accent)">' + esc(nearTxt) + '</span>' : '') + '</div>' +
      (st < 4 ? gpsBar() : '') + contactRow('Sender · ' + (sh.senderName || ''), sh.senderPhone || 'no number', sh.senderPhone, false) + contactRow('Receiver · ' + (sh.rName || ''), sh.rPhone || 'no number', sh.rPhone, true) +
      (sh.payStatus === 'cash' && st < 4 ? '<div class="banner">Cash job: collect ' + money(sh.q.total) + ' from the sender or receiver.</div>' : '') + errLine() + action;
  }
  return '<div class="trackwrap">' + mapBox(sh, 'home') + '<div class="sheet"><div class="grab"></div>' + body + '</div></div>' + overlays();
}

/* ---------------------------------------------------------------- chat */
function msgHtml(m) { return '<div class="msg ' + (m.uid === S.me.id ? 'me' : 'them') + '"><span class="t">' + esc(m.text) + '</span><span class="tiny muted">' + (m.uid === S.me.id ? '' : esc(m.name || '') + ' · ') + esc(timeOf(m.ts)) + '</span></div>'; }
function chatListHtml(id) { var l = S.msgs[id]; if (!l) return '<div class="small muted center" style="margin:auto">Loading messages</div>'; if (!l.length) return '<div class="small muted center" style="margin:auto;text-align:center;max-width:240px">No messages yet. Say hello to start the chat.</div>'; return l.map(msgHtml).join(''); }
function chatUnread() { return Object.keys(S.unread).some(function (k) { return S.unread[k]; }); }
function vChat() {
  var sh = curShip(), rider = myRole() === 'rider', on = sh && sh.stage >= 1 && sh.stage <= 4;
  var name = !sh ? 'No active delivery' : rider ? (sh.rName || 'Receiver') : (sh.riderName || 'Your rider');
  var phone = !sh ? '' : rider ? sh.rPhone : sh.riderPhone, has = digits(phone);
  var chips = (rider ? ['I have arrived', 'Which gate?', 'Running 5 min late'] : ['Please call at the gate', 'Leave it at the door', 'How far are you?']).map(function (c) { return '<button class="chip" data-act="sendChip" data-t="' + esc(c) + '">' + esc(c) + '</button>'; }).join('');
  return '<div class="scroll" style="padding-bottom:24px;gap:16px"><div class="row g12"><button class="circ" aria-label="Back" data-act="go" data-to="' + (sh ? 'track' : 'home') + '">' + ico('back') + '</button><div class="circ dk">' + ico('user', 20) + '</div>' +
    '<div class="col f1 g4"><span class="xb trunc" style="font-size:16px">' + esc(name) + '</span><span class="small muted row g6"><span class="dot" style="background:' + (on ? 'var(--accent)' : 'var(--off)') + '"></span>' + (on ? 'Connected' : 'Not assigned yet') + '</span></div>' +
    '<a class="circ ' + (has ? 'acc' : 'off') + '" aria-label="Call" href="' + (has ? 'tel:' + has : '#') + '">' + ico('phone', 20) + '</a></div>' +
    (!on ? '<div class="col center g16" style="flex:1"><div class="circ" style="width:64px;height:64px;border-radius:20px">' + ico('chat', 28) + '</div><div class="col g8"><span class="h2">Chat opens with a delivery</span><span class="small muted">' + (sh ? 'A rider is being assigned. This chat opens as soon as one accepts.' : 'Send a parcel and you can message your rider here.') + '</span></div></div>' :
      '<div class="chatlist" id="chat-list">' + chatListHtml(sh.id) + '</div><div id="typing" class="small muted"' + (S.typing[sh.id] ? '' : ' hidden') + '>typing…</div><div class="row g8 wrap">' + chips + '</div>' +
      '<div class="composer"><input id="c-msg" aria-label="Message" autocomplete="off" placeholder="Write a message" value="' + esc(D('c-msg')) + '" data-enter="sendChat"><button class="circ dk" aria-label="Send message" data-act="sendChat" style="width:46px;height:46px;border-radius:23px">' + ico('send', 20) + '</button></div>') + '</div>' + overlays();
}

/* ---------------------------------------------------------------- history, earnings, rating, profile */
function vHistory() {
  var l = list('sender').filter(function (s) { return s.stage === 4 || s.stage === -1; });
  var rows = l.map(function (s) {
    return '<button class="card row g12" data-act="receipt" data-id="' + esc(s.id) + '" style="width:100%"><div class="circ" style="background:var(--bg);border-radius:12px;width:40px;height:40px">' + ico(s.stage === 4 ? 'check' : 'box', 20) + '</div>' +
      '<div class="col f1 g4"><span class="b trunc" style="font-size:14px">' + esc(s.id) + ' · ' + esc(s.item) + '</span><span class="small muted trunc">' + (s.stage === -1 ? 'Cancelled' : 'To ' + esc(s.to) + (s.rating ? ' · ' + s.rating + ' stars' : '')) + '</span></div><span class="b num" style="font-size:13px">' + (s.stage === -1 ? '' : money(s.q.total + (s.tip || 0))) + '</span></button>';
  }).join('');
  return shell('<span class="h1">History</span>' + (rows ? '<div class="col g12">' + rows + '</div>' : '<div class="dashed col g8"><span class="h3">No completed deliveries</span><span class="small muted">Finished deliveries and receipts appear here.</span></div>'), true);
}
function vEarn() {
  var jobs = list('rider').filter(function (j) { return j.stage === 4; }).sort(function (a, b) { return (b.deliveredAt || 0) - (a.deliveredAt || 0); });
  var earn = jobs.reduce(function (a, j) { return a + j.q.payout + (j.tip || 0); }, 0), tips = jobs.reduce(function (a, j) { return a + (j.tip || 0); }, 0);
  var rows = jobs.map(function (j) { return '<div class="card row g12"><div class="col f1 g4"><span class="b" style="font-size:14px">' + esc(j.id) + (j.payStatus === 'cash' ? ' · cash' : '') + '</span><span class="small muted trunc">' + esc(j.to) + ' · ' + esc(dateOf(j.deliveredAt || j.created)) + '</span></div><span class="b num" style="font-size:13px">+' + money(j.q.payout + (j.tip || 0)) + '</span></div>'; }).join('');
  return shell('<span class="h1">Earnings</span><div class="ink col g6" style="padding:22px"><span class="small mut">Total earned</span><span class="xb num" style="font-size:36px">' + money(earn) + '</span><span class="small mut">' + jobs.length + ' trips · ' + money(tips) + ' in tips · you keep 80% of each delivery</span></div>' +
    '<div class="col g12"><span class="h2">Trips</span>' + (rows || '<div class="dashed col g8"><span class="h3">No trips yet</span><span class="small muted">Complete a delivery and it shows up here.</span></div>') + '</div>', true);
}
function vRate() {
  var sh = curShip();
  if (!sh || sh.mine !== 'sender' || sh.stage !== 4) return shell('<div class="dashed"><span class="h3">Nothing to rate</span></div><button class="btn dark" data-act="go" data-to="home">Back home</button>', false);
  var stars = [1, 2, 3, 4, 5].map(function (n) { return '<button class="star' + (n <= S.rating ? ' on' : '') + '" aria-label="' + n + ' star' + (n > 1 ? 's' : '') + '" data-act="setRating" data-n="' + n + '"><svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">' + IC.star + '</svg></button>'; }).join('');
  var tips = TIPS.slice(0, 4).map(function (v) { return '<button class="pill' + (S.tip === v ? ' on' : '') + '" data-act="setTip" data-v="' + v + '">' + (v ? '+' + money(v) : 'No tip') + '</button>'; }).join('');
  return shell('<div class="col g12 center" style="padding-top:12px"><div class="circ dk" style="width:72px;height:72px;border-radius:36px">' + ico('check', 30) + '</div><span class="h1">Delivered</span><span class="small muted">' + esc(sh.id) + ' reached ' + esc(sh.rName) + '. How was ' + esc(sh.riderName || 'your rider') + '?</span></div>' +
    '<div class="stars">' + stars + '</div><div class="col g8"><span class="lab">Add a tip for your rider</span><div class="row g8 wrap">' + tips + '</div></div>' + field('rt-c', 'Comment (optional)', 'Anything we should know?') +
    '<div class="card row between b"><span>Total paid</span><span class="num">' + money(sh.q.total + S.tip) + '</span></div>' + errLine() + '<button class="btn dark" data-act="submitRating"' + (S.busy ? ' disabled' : '') + '>Submit</button><button class="small b muted" data-act="go" data-to="home" style="text-align:center;height:24px">Skip for now</button>', false);
}
function vProfile() {
  var p = S.me, rider = p.role === 'rider', sent = list('sender'), jobs = list('rider').filter(function (j) { return j.stage === 4; });
  var s1 = rider ? jobs.length : sent.filter(function (s) { return s.stage >= 0; }).length;
  var s2 = rider ? money(jobs.reduce(function (a, j) { return a + j.q.payout + (j.tip || 0); }, 0)) : money(sent.filter(function (s) { return s.stage === 4; }).reduce(function (a, s) { return a + s.q.total + (s.tip || 0); }, 0));
  var vehNow = D('p-veh', p.vehicle || 'Motorbike'), veh = ['Motorbike', 'Bicycle', 'Car'].map(function (v) { return '<button data-act="setVeh" data-v="' + v + '" data-prof="1"' + (vehNow === v ? ' class="on"' : '') + '>' + v + '</button>'; }).join('');
  var th = lsGet('fc_theme') || 'system', themes = ['system', 'light', 'dark'].map(function (t) { return '<button data-act="theme" data-v="' + t + '"' + (th === t ? ' class="on"' : '') + '>' + t[0].toUpperCase() + t.slice(1) + '</button>'; }).join('');
  var notif = 'Notification' in window ? Notification.permission : 'unsupported';
  return shell('<div class="row between"><span class="h1">Profile</span><span class="badge">' + (rider ? 'Rider app' : 'Customer app') + '</span></div>' +
    '<div class="row g16"><div class="circ dk" style="width:76px;height:76px;border-radius:38px;font-size:26px;font-weight:800">' + esc(initials(p.name)) + '</div><div class="col f1 g6"><span class="xb trunc" style="font-size:20px">' + esc(p.name) + '</span><span class="small muted trunc">' + esc(rider ? (p.vehicle || 'Motorbike') + (p.plate ? ' · ' + p.plate : '') : p.address || p.email) + '</span></div></div>' +
    '<div class="grid2"><div class="card col g4"><span class="xb num" style="font-size:24px">' + s1 + '</span><span class="small muted b">' + (rider ? 'Trips' : 'Shipments') + '</span></div><div class="ink col g4" style="border-radius:22px;padding:16px 18px"><span class="xb num" style="font-size:24px">' + s2 + '</span><span class="small mut b">' + (rider ? 'Earned' : 'Spent') + '</span></div></div>' +
    '<div class="col g12"><span class="h2">Your details</span>' + field('p-name', 'Full name', 'Your name', p.name) + field('p-phone', rider ? 'Call number (customers call you here)' : 'Phone number', 'Phone number', p.phone, 'inputmode="tel"') +
    (rider ? '<div class="col g8"><span class="lab">Vehicle</span><div class="seg2" role="group" aria-label="Vehicle">' + veh + '</div></div>' + field('p-plate', 'Plate number', 'e.g. LAG 123 AB', p.plate) : field('p-address', 'Home or office address', 'Add your address', p.address)) +
    errLine() + '<button class="btn dark" data-act="saveProfile"' + (S.busy ? ' disabled' : '') + '>Save details</button></div>' +
    '<div class="col g12"><button class="outline row between g12" style="width:100%" role="switch" aria-checked="' + !!p.calm + '" data-act="toggleCalm"><div class="col g4"><span class="h3">Calm mode</span><span class="small muted">Only pickup, arrival and delivery alerts</span></div><span class="tog' + (p.calm ? ' on' : '') + '"></span></button>' +
    '<button class="outline row between g12" style="width:100%" role="switch" aria-checked="' + !!p.share + '" data-act="toggleShare"><div class="col g4"><span class="h3">Share live location</span><span class="small muted">' + (rider ? 'Customers see you on the map during a delivery' : 'Your rider sees where to meet you') + '</span></div><span class="tog' + (p.share ? ' on' : '') + '"></span></button>' +
    '<div class="col g8"><span class="lab">Appearance</span><div class="seg2" role="group" aria-label="Theme">' + themes + '</div></div>' +
    (notif === 'default' ? '<button class="btn soft" data-act="enableNotif">Turn on delivery alerts</button>' : '') +
    (S.installEvt ? '<button class="btn soft" data-act="install">Install FeelCalm on this phone</button>' : /iphone|ipad/i.test(navigator.userAgent) && !window.navigator.standalone ? '<div class="small muted" style="padding-left:8px">To install on iPhone: tap Share, then Add to Home Screen.</div>' : '') +
    '<button class="btn soft" data-act="switchRole">' + (rider ? 'Switch to customer app' : 'Switch to rider app') + '</button><button class="btn" style="color:var(--accent)" data-act="logout">Sign out</button>' +
    '<div class="tiny muted center" style="text-align:center">' + esc(p.email) + ' · ' + (S.cfg.testMode ? 'Payments in test mode · ' : '') + 'FeelCalm</div></div>', true);
}

function view() {
  if (S.boot !== 'ready') return vBoot();
  if (!S.me) return vAuth();
  var sc = S.screen, rider = myRole() === 'rider';
  if (sc === 'new' && !rider) return vNew();
  if (sc === 'track') return vTrack();
  if (sc === 'chat') return vChat();
  if (sc === 'rate' && !rider) return vRate();
  if (sc === 'history' && !rider) return vHistory();
  if (sc === 'earn' && rider) return vEarn();
  if (sc === 'profile') return vProfile();
  S.screen = 'home';
  return rider ? vHomeR() : vHomeC();
}

/* ---------------------------------------------------------------- render */
function render() {
  var ae = document.activeElement, keep = (ae && ae.id && $app.contains(ae)) ? { id: ae.id, s: ae.selectionStart, e: ae.selectionEnd } : null;
  var sc = $app.querySelector('.scroll,.sheet,.osheet'), top = sc ? sc.scrollTop : 0, same = lastScreen === S.screen;
  var cl0 = document.getElementById('chat-list'), stick = !cl0 || cl0.scrollHeight - cl0.scrollTop - cl0.clientHeight < 80;
  if (S.me) { curShip(); markRead(); }
  $app.innerHTML = view();
  lastScreen = S.screen;
  if (same) { var n = $app.querySelector('.scroll,.sheet'); if (n) n.scrollTop = top; }
  var cl = document.getElementById('chat-list'); if (cl && stick) cl.scrollTop = cl.scrollHeight;
  if (keep) { var el = document.getElementById(keep.id); if (el) { el.focus(); try { if (keep.s != null) el.setSelectionRange(keep.s, keep.e); } catch (e) {} } }
  attachMap();
}
function scheduleRender() { if (renderQ) return; renderQ = true; requestAnimationFrame(function () { renderQ = false; render(); }); }
function go(to) { S.screen = to; S.err = ''; S.safety = false; S.receipt = null; S.ask = null; S.payFor = null; scheduleRender(); if (to === 'chat') loadMsgs(); window.scrollTo(0, 0); }
function markRead() { var sh = S.cur && S.ships[S.cur]; if (sh && S.screen === 'chat' && S.unread[sh.id]) S.unread[sh.id] = false; }

/* ---------------------------------------------------------------- map */
function ensureMap() {
  if (map || !window.FCMap || !S.cfg) return map;
  map = new FCMap({ tileLight: S.cfg.tiles.light, tileDark: S.cfg.tiles.dark, zoom: 13, onMove: function () { S.autofit = false; } });
  map.setTheme(isDark()); return map;
}
function attachMap() {
  var box = document.getElementById('mapbox');
  if (!box) return;
  if (!ensureMap()) return;
  if (map.el.parentNode !== box) box.insertBefore(map.el, box.firstChild);
  map.setTheme(isDark()); map.resize(); lastFitKey = ''; updateMap();
}
var lastFitKey = '';
function mk(cls, icon, size, label) { return '<div class="' + cls + '">' + ico(icon, size) + '</div>' + (label ? '<div class="lab2">' + esc(label) + '</div>' : ''); }
function updateMap() {
  var sh = S.cur && S.ships[S.cur];
  if (!map || !document.getElementById('mapbox') || !sh || S.screen !== 'track') return;
  var rl = riderLL(sh), cl = recvLL(sh), rider = myRole() === 'rider', tg = target(sh);
  map.setMarker('from', sh.fromLL, mk('pinb', 'box', 18));
  map.setMarker('to', sh.toLL, mk('pinc', 'pin', 22));
  map.setMarker('rider', sh.stage >= 1 && sh.stage <= 3 ? rl : null, mk('rid', 'bike', 22, rider ? 'You' : (sh.riderName || 'Rider').split(' ')[0]));
  map.setMarker('recv', sh.stage >= 1 && sh.stage <= 3 ? cl : null, mk('me', 'user', 16, rider ? 'Customer' : 'You'));
  var trip = S.routes['L' + sh.id], run = S.routes['R' + sh.id];
  map.setRoute('trip', sh.fromLL && sh.toLL ? (trip && trip.coords ? trip.coords : [sh.fromLL, sh.toLL]) : null, { dashed: true, color: 'var(--ink)' });
  map.setRoute('run', sh.stage >= 1 && sh.stage <= 3 && rl && tg ? (run && run.ok && run.coords ? run.coords : [rl, tg]) : null);
  if (sh.stage >= 1 && sh.stage <= 3) { routeFor(sh, rl, tg); }
  if (sh.fromLL && sh.toLL && !trip) fetchRoute('L' + sh.id, sh.fromLL, sh.toLL);
  var pts = (sh.stage >= 1 && sh.stage <= 3) ? [rl, tg, sh.stage <= 1 ? sh.toLL : null, cl] : [sh.fromLL, sh.toLL];
  var key = sh.id + '|' + sh.stage + '|' + (rl ? 1 : 0) + (cl ? 1 : 0);
  if (S.autofit && (key !== lastFitKey || rl)) { lastFitKey = key; var p = pts.filter(Boolean); if (p.length) map.fit(p, { top: 90, bottom: 190, left: 50, right: 70 }); }
  liveText(sh);
}
function liveText(sh) {
  var li = liveInfo(sh), a = document.getElementById('eta-pill'), b = document.getElementById('m-eta'), c = document.getElementById('m-dist'), d = document.getElementById('near-txt');
  if (a) a.textContent = etaText(sh); if (b) b.textContent = etaText(sh); if (c) c.textContent = li.km.toFixed(1) + ' km';
  if (S.me && S.me.role === 'rider' && (sh.stage === 1 || sh.stage === 2)) {
    var t = target(sh), gf = S.cfg.geofenceM, m = S.gps.ll && t ? hav(S.gps.ll, t) * 1000 : null, far = !!gf && (m == null || m > gf);
    if (d) d.textContent = m == null ? 'Waiting for your location' : distText(m) + ' away' + (far ? ' · get within ' + gf + ' m to continue' : ' · you are there');
    var btn = document.querySelector('[data-act=picked],[data-act=arrived]');
    if (btn) { btn.disabled = far || !!S.busy; btn.textContent = sh.stage === 1 ? (far ? 'Riding to pickup' : 'Confirm pickup') : (far ? 'Riding to drop-off' : "I've arrived"); }
  }
}
async function fetchRoute(key, a, b) {
  var cur = S.routes[key]; if (cur && cur.busy) return;
  S.routes[key] = Object.assign({}, cur || {}, { busy: true, tgt: b.join() });
  try {
    var r = await api('GET', '/api/route?a=' + a.join(',') + '&b=' + b.join(','));
    S.routes[key] = { ok: !r.route.approx, coords: r.route.coords, km: r.route.km, mins: r.route.mins, at: Date.now(), from: a, tgt: b.join() };
  } catch (e) { S.routes[key] = Object.assign({}, cur || {}, { busy: false, at: Date.now(), from: a, tgt: b.join() }); }
  updateMap();
}
function routeFor(sh, rl, tg) {
  if (!rl || !tg) return;
  var key = 'R' + sh.id, r = S.routes[key];
  if (r && r.busy) return;
  if (r && r.at && r.tgt === tg.join() && (Date.now() - r.at < 20000 || (r.from && hav(r.from, rl) < 0.15))) return;
  fetchRoute(key, rl, tg);
}

/* ---------------------------------------------------------------- data */
function upsert(sh, announce) {
  var old = S.ships[sh.id];
  if (S.ships[sh.id] && S.ships[sh.id].riderPos && sh.riderPos && S.ships[sh.id].riderPos.ts > sh.riderPos.ts) sh.riderPos = S.ships[sh.id].riderPos;
  if (S.ships[sh.id] && S.ships[sh.id].recvPos && sh.recvPos && S.ships[sh.id].recvPos.ts > sh.recvPos.ts) sh.recvPos = S.ships[sh.id].recvPos;
  S.ships[sh.id] = sh;
  if (announce !== false) announceChange(old, sh);
  return sh;
}
function announceChange(old, sh) {
  if (!old) { if (sh.mine === 'open' && myRole() === 'rider' && S.online) notify('New request · ' + money(sh.q.payout) + ' payout', true, 'req'); return; }
  if (old.stage === sh.stage) return;
  var s = sh.stage, who = sh.riderName || 'Your rider';
  if (sh.mine === 'rider') { if (s === -1) notify('The sender cancelled this delivery.', true, 'st'); return; }
  if (s === 1) notify(who + ' accepted your delivery.', true, 'st'); else if (s === 2) notify('Picked up. On the way to ' + (sh.rName || 'the receiver') + '.', false, 'st');
  else if (s === 3) notify(who + ' has arrived. Share your PIN ' + (sh.pin || '') + '.', true, 'st'); else if (s === 4) notify('Delivered. Thanks for choosing FeelCalm.', true, 'st'); else if (s === -1) notify('This delivery was cancelled.', true, 'st');
}
async function loadShips() {
  try {
    var r = await api('GET', '/api/shipments'), keep = {};
    ['mine', 'job', 'follow'].forEach(function (k) { (r[k] || []).forEach(function (s) { upsert(s, false); keep[s.id] = 1; }); });
    Object.keys(S.ships).forEach(function (id) { if (!keep[id] && S.ships[id].mine !== 'open') delete S.ships[id]; });
    if (myRole() === 'rider' && S.online) await loadOpen();
  } catch (e) { if (e.net) S.lastErr = e.message; }
  scheduleRender();
}
async function loadOpen() {
  try { var r = await api('GET', '/api/shipments/open'), seen = {}; r.open.forEach(function (s) { upsert(s, false); seen[s.id] = 1; }); Object.keys(S.ships).forEach(function (id) { if (S.ships[id].mine === 'open' && !seen[id]) delete S.ships[id]; }); } catch (e) {}
}
async function loadMsgs() {
  var sh = curShip(); if (!sh || sh.stage < 1 || S.msgs[sh.id]) return;
  try { var r = await api('GET', '/api/shipments/' + sh.id + '/messages'); S.msgs[sh.id] = r.messages; } catch (e) { S.msgs[sh.id] = []; }
  scheduleRender();
}

/* ---------------------------------------------------------------- websocket */
function wsSend(o) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(o)); return true; } catch (e) {} } return false; }
function connectWs() {
  if (!S.token || (ws && (ws.readyState === 0 || ws.readyState === 1))) return;
  clearTimeout(wsTimer);
  var url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?token=' + encodeURIComponent(S.token);
  try { ws = new WebSocket(url); } catch (e) { return retryWs(); }
  var mine = ws;
  ws.onopen = function () { wsTry = 0; };
  ws.onmessage = function (ev) { var m; try { m = JSON.parse(ev.data); } catch (e) { return; } onWs(m); };
  ws.onclose = function () { if (ws === mine) { S.wsUp = false; ws = null; retryWs(); } };
  ws.onerror = function () { try { mine.close(); } catch (e) {} };
}
function retryWs() { if (!S.token) return; clearTimeout(wsTimer); wsTry++; wsTimer = setTimeout(connectWs, Math.min(15000, 600 * Math.pow(2, wsTry))); }
function onWs(m) {
  if (m.t === 'hello') { S.wsUp = true; wsSend({ t: 'online', on: myRole() === 'rider' && S.online }); loadShips(); sendFix(true); }
  else if (m.t === 'ship') { var ex = S.ships[m.ship.id]; if (m.ship.mine === 'open' && ex && ex.mine !== 'open') return; upsert(m.ship); if (m.ship.mine === 'open' && m.ship.stage !== 0) delete S.ships[m.ship.id]; scheduleRender(); }
  else if (m.t === 'gone') { var g = S.ships[m.id]; if (g && g.mine === 'open') { delete S.ships[m.id]; scheduleRender(); } }
  else if (m.t === 'msg') {
    var l = S.msgs[m.id]; if (l) { if (!l.some(function (x) { return x.id === m.msg.id; })) l.push(m.msg); } 
    if (m.msg.uid !== S.me.id) { S.typing[m.id] = false; if (!(S.screen === 'chat' && S.cur === m.id)) { S.unread[m.id] = true; notify(m.msg.name + ': ' + m.msg.text, true, 'msg'); } }
    if (S.screen === 'chat') { if (!S.msgs[m.id]) loadMsgs(); scheduleRender(); } else scheduleRender();
  } else if (m.t === 'loc') {
    var sh = S.ships[m.id]; if (!sh) return;
    if (m.role === 'rider') sh.riderPos = { ll: m.ll, ts: m.ts }; else sh.recvPos = m.ll ? { ll: m.ll, ts: m.ts || Date.now() } : null;
    if (S.screen === 'track' && S.cur === m.id) updateMap();
  } else if (m.t === 'typing') {
    S.typing[m.id] = !!m.on; clearTimeout(typeTimers[m.id]);
    if (m.on) typeTimers[m.id] = setTimeout(function () { S.typing[m.id] = false; var t = document.getElementById('typing'); if (t) t.hidden = true; }, 4500);
    var t = document.getElementById('typing'); if (t && S.cur === m.id) t.hidden = !m.on;
  }
}
var typeTimers = {};

/* ---------------------------------------------------------------- GPS */
function activeForGps() {
  if (!S.me) return [];
  return Object.keys(S.ships).map(function (k) { return S.ships[k]; }).filter(function (s) { return s.stage >= 1 && s.stage <= 3 && (myRole() === 'rider' ? s.mine === 'rider' : (s.mine === 'sender' || s.mine === 'follower') && S.me.share); });
}
function wantGps() { if (!S.me) return false; if (myRole() === 'rider') return S.online || activeForGps().length > 0; return activeForGps().length > 0; }
function syncGps(fromTap) {
  if (!wantGps()) { stopGps(); return; }
  if (!('geolocation' in navigator)) { S.gps.state = 'unavailable'; return; }
  if (geoWatch != null) return;
  if (S.gps.state === 'denied' && !fromTap) return;
  S.gps.state = S.gps.ll ? 'on' : 'asking';
  geoWatch = navigator.geolocation.watchPosition(onFix, function (err) {
    if (err && err.code === 1) { stopWatch(); S.gps.state = 'denied'; scheduleRender(); }
    else if (S.gps.state !== 'on') { S.gps.state = 'asking'; scheduleRender(); } /* timeouts and brief outages: keep watching */
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 60000 });
  if (myRole() === 'rider' && activeForGps().length && 'wakeLock' in navigator && !wake) { navigator.wakeLock.request('screen').then(function (w) { wake = w; w.addEventListener('release', function () { wake = null; }); }).catch(function () {}); }
}
function stopWatch() { if (geoWatch != null) { try { navigator.geolocation.clearWatch(geoWatch); } catch (e) {} geoWatch = null; } }
function stopGps() { stopWatch(); if (wake) { try { wake.release(); } catch (e) {} wake = null; } if (S.gps.state === 'on' || S.gps.state === 'asking') S.gps.state = 'idle'; }
function onFix(pos) {
  var first = S.gps.state !== 'on';
  S.gps = { state: 'on', ll: [pos.coords.latitude, pos.coords.longitude], acc: pos.coords.accuracy, ts: Date.now(), hdg: pos.coords.heading };
  sendFix(false);
  if (first) scheduleRender(); else if (S.screen === 'track') updateMap();
}
function sendFix(force) {
  var g = S.gps; if (g.state !== 'on' || !g.ll || !S.wsUp) return;
  var t = Date.now(); if (!force && t - lastSent < 2500) return;
  var moved = lastSentLL ? hav(lastSentLL, g.ll) * 1000 : 1e9; if (!force && moved < 4 && t - lastSent < 15000) return;
  if (myRole() === 'rider') { if (activeForGps().length) wsSend({ t: 'loc', lat: g.ll[0], lng: g.ll[1], hdg: g.hdg || null }); }
  else activeForGps().forEach(function (s) { wsSend({ t: 'cloc', id: s.id, lat: g.ll[0], lng: g.ll[1] }); });
  lastSent = t; lastSentLL = g.ll;
}
setInterval(function () { if (S.me && geoWatch != null && S.gps.state === 'on' && Date.now() - lastSent > 18000) { S.gps.ts = Date.now(); sendFix(true); } }, 6000);
document.addEventListener('visibilitychange', function () { if (!document.hidden && S.me) { connectWs(); syncGps(); if (S.gps.state === 'on' && !wake && myRole() === 'rider' && activeForGps().length) syncGps(); } });

/* ---------------------------------------------------------------- actions */
function at(el, k) { return el && el.getAttribute ? el.getAttribute('data-' + k) : null; }
function val(id) { var e = document.getElementById(id); return e ? e.value : (S.drafts[id] || ''); }
async function busy(fn) {
  if (S.busy) return; S.busy = true; S.err = ''; scheduleRender();
  try { await fn(); } catch (e) { S.err = e.message || 'Something went wrong.'; if (e.net) toast(e.message); }
  S.busy = false; scheduleRender();
}
function clearDrafts(prefix) { Object.keys(S.drafts).forEach(function (k) { if (k.indexOf(prefix) === 0) delete S.drafts[k]; }); }
function applyTheme() { var t = lsGet('fc_theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', isDark() ? '#0B0B0C' : '#0B0B0C'); }
function normId(t) { t = String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (t.indexOf('FC') === 0) t = t.slice(2); return t ? 'FC-' + t : ''; }
function setSession(r) { S.token = r.token; lsSet('fc_token', r.token); lsSet('fc_seen', '1'); S.me = r.user; }
function logout(silent) {
  lsSet('fc_token', null); S.token = null; S.me = null; S.ships = {}; S.msgs = {}; S.unread = {}; S.typing = {}; S.routes = {}; S.cur = null; S.screen = 'home'; S.online = false; lsSet('fc_online', null);
  S.authMode = 'login'; S.err = silent ? 'Please sign in again.' : ''; clearTimeout(wsTimer); if (ws) { var w = ws; ws = null; try { w.close(); } catch (e) {} } S.wsUp = false; stopGps(); S.gps = { state: 'idle', ll: null, acc: 0, ts: 0 };
  if (map) map.clear(); scheduleRender();
}
async function afterLogin() {
  S.screen = 'home'; S.err = '';
  connectWs(); await loadShips(); syncGps(); await deepLinks();
}
async function deepLinks() {
  var tr = null, pay = null, go = null;
  try { tr = sessionStorage.getItem('fc_track'); pay = sessionStorage.getItem('fc_pay'); go = sessionStorage.getItem('fc_go'); ['fc_track', 'fc_pay', 'fc_go'].forEach(function (k) { sessionStorage.removeItem(k); }); } catch (e) {}
  if (pay) {
    try { var r = await api('GET', '/api/shipments/' + encodeURIComponent(pay)); upsert(r.ship, false); S.cur = pay; S.screen = 'track';
      toast(r.ship.payStatus === 'paid' ? 'Payment received. Finding your rider.' : 'Payment not completed yet. You can pay again from the map.'); } catch (e) {}
  } else if (tr) {
    try { var f = await api('POST', '/api/shipments/' + encodeURIComponent(tr) + '/follow'); upsert(f.ship, false); S.cur = f.ship.id; S.screen = 'track'; } catch (e) { toast(e.message); }
  } else if (go === 'new' && myRole() === 'customer') S.screen = 'new'; else if (go === 'track') S.screen = 'track';
}
function shareText(sh) { return 'Follow my FeelCalm delivery ' + sh.id + ' live: ' + location.origin + '/?track=' + sh.id; }

var A = {
  go: function (el) { go(at(el, 'to')); },
  retryBoot: function () { S.boot = 'loading'; render(); boot(); },
  authMode: function (el) { S.authMode = at(el, 'm'); S.err = ''; scheduleRender(); },
  wRole: function (el) { S.wRole = at(el, 'r'); scheduleRender(); },
  setVeh: function (el) { if (at(el, 'prof')) S.drafts['p-veh'] = at(el, 'v'); else S.veh = at(el, 'v'); scheduleRender(); },
  submitAuth: function () {
    busy(async function () {
      var signup = S.authMode === 'signup', email = val('a-email'), pass = val('a-pass'), r;
      S.drafts['a-email'] = email; S.drafts['a-name'] = val('a-name'); S.drafts['a-phone'] = val('a-phone');
      if (signup) r = await api('POST', '/api/auth/signup', { email: email, password: pass, role: S.wRole, name: val('a-name'), phone: val('a-phone'), address: val('a-address'), vehicle: S.veh, plate: val('a-plate') });
      else r = await api('POST', '/api/auth/login', { email: email, password: pass });
      setSession(r); clearDrafts('a-'); S.wRole = r.user.role; S.online = false; lsSet('fc_online', null); await afterLogin();
    });
  },
  logout: function () { logout(false); },

  openShip: function (el) {
    var id = at(el, 'id'), sh = S.ships[id]; if (!sh) return; S.cur = id; S.autofit = true;
    if (sh.mine === 'sender' && sh.stage === 4 && !sh.rated) { S.screen = 'rate'; S.rating = 0; S.tip = 0; scheduleRender(); return; }
    go('track');
  },
  findShip: function () {
    var id = normId(val('t-id')); if (id.length < 5) { S.findMsg = 'Enter the tracking ID, like FC-48K2PQ.'; scheduleRender(); return; }
    S.drafts['t-id'] = val('t-id');
    api('POST', '/api/shipments/' + id + '/follow').then(function (r) { upsert(r.ship, false); S.cur = r.ship.id; S.findMsg = ''; S.drafts['t-id'] = ''; S.autofit = true; go('track'); })
      .catch(function (e) { S.findMsg = e.message; scheduleRender(); });
  },

  setForm: function (el) { var k = at(el, 'k'); S.form[k] = at(el, 'v'); scheduleRender(); },
  toggleIns: function () { S.form.insured = !S.form.insured; scheduleRender(); },
  useGps: function (el) {
    var key = at(el, 'field'); if (!('geolocation' in navigator)) { toast('This device cannot share its location.'); return; }
    toast('Finding your location');
    navigator.geolocation.getCurrentPosition(function (p) {
      var ll = [p.coords.latitude, p.coords.longitude];
      api('GET', '/api/reverse?lat=' + ll[0] + '&lng=' + ll[1]).then(function (r) { S.addr[key] = { label: r.place.label, ll: ll }; S.drafts['n-' + key] = r.place.label; S.sug = { field: '', items: [], busy: false, down: false }; scheduleRender(); })
        .catch(function () { S.addr[key] = { label: 'My location', ll: ll }; S.drafts['n-' + key] = 'My current location'; scheduleRender(); });
    }, function (e) { toast(e && e.code === 1 ? 'Allow location access in your browser to use this.' : 'We could not find your location.'); }, { enableHighAccuracy: true, timeout: 15000 });
  },
  pickSug: function (el) {
    var it = S.sug.items[Number(at(el, 'i'))], key = S.sug.field; if (!it) return;
    S.addr[key] = { label: it.label, ll: [it.lat, it.lng] }; S.drafts['n-' + key] = it.label; S.sug = { field: '', items: [], busy: false, down: false }; scheduleRender();
  },
  createShip: function () {
    ['n-item', 'n-from', 'n-to', 'n-rn', 'n-rp', 'n-note'].forEach(function (k) { S.drafts[k] = val(k); });
    busy(async function () {
      var f = S.form, q = localQuote(); if (!q.ok) throw new Error(q.note);
      var r = await api('POST', '/api/shipments', { item: val('n-item'), from: val('n-from'), to: val('n-to'), fromLL: S.addr.from ? S.addr.from.ll : null, toLL: S.addr.to ? S.addr.to.ll : null,
        rName: val('n-rn'), rPhone: val('n-rp'), zone: q.zone, size: f.size, service: f.service, insured: f.insured, pay: f.pay, note: val('n-note') });
      upsert(r.ship, false); clearDrafts('n-'); S.addr = { from: null, to: null }; S.sug = { field: '', items: [], busy: false, down: false }; S.form.insured = false;
      S.cur = r.ship.id; S.autofit = true; S.screen = 'track'; if (r.ship.payStatus === 'pending') S.payFor = { id: r.ship.id };
    });
  },
  openPay: function (el) { S.payFor = { id: at(el, 'id') }; S.err = ''; scheduleRender(); },
  payNow: function () {
    var id = S.payFor && S.payFor.id; if (!id) return;
    busy(async function () {
      var r = await api('POST', '/api/shipments/' + id + '/pay');
      if (r.ship) { upsert(r.ship, false); S.payFor = null; return; }
      if (r.demo) { var o = await api('POST', '/api/shipments/' + id + '/pay-demo'); upsert(o.ship, false); S.payFor = null; toast('Payment received. Finding your rider.'); return; }
      if (r.url) { location.href = r.url; await new Promise(function () {}); }
    });
  },
  closeOv: function (el, ev) { if (at(el, 'bg') && ev && ev.target !== el) return; S.safety = false; S.receipt = null; S.ask = null; S.payFor = null; S.err = ''; scheduleRender(); },

  toggleOnline: function () {
    if (!S.me.phone) { toast('Add your call number first.'); go('profile'); return; }
    S.online = !S.online; lsSet('fc_online', S.online ? '1' : '0'); wsSend({ t: 'online', on: S.online });
    if (S.online) { loadOpen().then(scheduleRender); syncGps(true); if ('Notification' in window && Notification.permission === 'default') { try { Notification.requestPermission(); } catch (e) {} } }
    else { Object.keys(S.ships).forEach(function (id) { if (S.ships[id].mine === 'open') delete S.ships[id]; }); syncGps(); }
    scheduleRender();
  },
  accept: function (el) {
    var id = at(el, 'id');
    busy(async function () { try { var r = await api('POST', '/api/shipments/' + id + '/accept'); upsert(r.ship, false); S.cur = id; S.autofit = true; S.screen = 'track'; syncGps(true); } catch (e) { await loadOpen(); throw e; } });
  },
  picked: function () { stepCall('picked'); },
  arrived: function () { stepCall('arrived'); },
  confirmPin: function () {
    var sh = curShip(), pin = val('r-pin').replace(/\D/g, ''); S.drafts['r-pin'] = pin; if (!sh) return;
    if (pin.length !== 4) { S.err = 'Enter the 4-digit PIN from the receiver.'; scheduleRender(); return; }
    busy(async function () { var r = await api('POST', '/api/shipments/' + sh.id + '/confirm', { pin: pin }); upsert(r.ship, false); S.drafts['r-pin'] = ''; toast('Delivered. ' + money(r.ship.q.payout) + ' earned.'); });
  },
  riderDone: function () { S.cur = null; go('home'); },

  sendChat: function () { sendMsg(val('c-msg')); },
  sendChip: function (el) { sendMsg(at(el, 't')); },
  setRating: function (el) { S.rating = Number(at(el, 'n')); scheduleRender(); },
  setTip: function (el) { S.tip = Number(at(el, 'v')); scheduleRender(); },
  submitRating: function () {
    var sh = curShip(); if (!sh) return; if (S.rating < 1) { S.err = 'Choose 1 to 5 stars.'; scheduleRender(); return; }
    busy(async function () { var r = await api('POST', '/api/shipments/' + sh.id + '/rate', { rating: S.rating, tip: S.tip, comment: val('rt-c') }); upsert(r.ship, false); S.rating = 0; S.tip = 0; clearDrafts('rt-'); S.cur = null; S.screen = 'home'; toast('Thanks for rating your rider.'); });
  },
  askCancel: function () { S.ask = { title: 'Cancel this delivery?', text: 'You can cancel for free until the parcel is picked up. If you already paid by card, you will be refunded.', yes: 'Cancel delivery', act: 'cancelYes' }; scheduleRender(); },
  cancelYes: function () {
    var sh = curShip(); if (!sh) return;
    busy(async function () { var r = await api('POST', '/api/shipments/' + sh.id + '/cancel'); upsert(r.ship, false); S.ask = null; S.cur = null; S.screen = 'home'; toast('Delivery cancelled.'); });
  },
  receipt: function (el) { S.receipt = at(el, 'id'); scheduleRender(); },
  openSafety: function () { S.safety = true; scheduleRender(); },
  shareTrip: function () {
    var sh = curShip(); if (!sh) return; var text = shareText(sh);
    if (navigator.share) navigator.share({ title: 'FeelCalm delivery', text: text }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast('Tracking link copied.'); }, function () { toast(text); }); else toast(text);
  },

  toggleShare: function () {
    var on = !S.me.share;
    api('PATCH', '/api/me', { share: on }).then(function (r) {
      S.me = r.user;
      if (!on) Object.keys(S.ships).forEach(function (id) { var s = S.ships[id]; if (s.mine !== 'rider' && s.stage >= 1 && s.stage <= 3) wsSend({ t: 'cloff', id: id }); }); else syncGps(true);
      if (!on) syncGps(); scheduleRender();
    }).catch(function (e) { toast(e.message); });
  },
  toggleCalm: function () { api('PATCH', '/api/me', { calm: !S.me.calm }).then(function (r) { S.me = r.user; toast(r.user.calm ? 'Calm mode on' : 'Calm mode off'); scheduleRender(); }).catch(function (e) { toast(e.message); }); },
  saveProfile: function () {
    var rider = myRole() === 'rider', b = { name: val('p-name'), phone: val('p-phone') };
    if (rider) { b.vehicle = D('p-veh', S.me.vehicle || 'Motorbike'); b.plate = val('p-plate'); } else b.address = val('p-address');
    busy(async function () { var r = await api('PATCH', '/api/me', b); S.me = r.user; clearDrafts('p-'); toast('Saved.'); });
  },
  switchRole: function () {
    var to = myRole() === 'rider' ? 'customer' : 'rider';
    busy(async function () {
      var r = await api('PATCH', '/api/me', { role: to }); S.me = r.user; S.online = false; lsSet('fc_online', null); S.cur = null; S.screen = 'home'; S.wRole = to; clearDrafts('p-');
      Object.keys(S.ships).forEach(function (id) { if (S.ships[id].mine === 'open') delete S.ships[id]; }); wsSend({ t: 'online', on: false }); syncGps(); toast(to === 'rider' ? 'Rider app. Add your call number, then go online.' : 'Customer app.');
    });
  },
  theme: function (el) { var v = at(el, 'v'); lsSet('fc_theme', v === 'system' ? null : v); applyTheme(); if (map) map.setTheme(isDark()); scheduleRender(); },
  enableNotif: function () { try { Notification.requestPermission().then(scheduleRender); } catch (e) {} },
  install: function () { var e = S.installEvt; if (!e) return; e.prompt(); e.userChoice.then(function () { S.installEvt = null; scheduleRender(); }); },
  enableGps: function () { S.gps.state = 'idle'; syncGps(true); scheduleRender(); },
  zoom: function (el) { if (map) map.zoomBy(Number(at(el, 'd'))); },
  recenter: function () { S.autofit = true; lastFitKey = ''; updateMap(); }
};
function stepCall(name) {
  var sh = curShip(); if (!sh) return;
  busy(async function () {
    if (S.gps.ll) { wsSend({ t: 'loc', lat: S.gps.ll[0], lng: S.gps.ll[1] }); await new Promise(function (r) { setTimeout(r, 250); }); }
    var r = await api('POST', '/api/shipments/' + sh.id + '/' + name); upsert(r.ship, false); lastFitKey = '';
    toast(name === 'picked' ? 'Picked up. Head to the drop-off.' : 'Arrived. Ask the receiver for their PIN.');
  });
}
async function sendMsg(text) {
  text = String(text || '').trim(); var sh = curShip(); if (!text || !sh) return;
  S.drafts['c-msg'] = ''; var inp = document.getElementById('c-msg'); if (inp) inp.value = ''; wsSend({ t: 'typing', id: sh.id, on: false });
  try { var r = await api('POST', '/api/shipments/' + sh.id + '/messages', { text: text }); var l = S.msgs[sh.id] || (S.msgs[sh.id] = []); if (!l.some(function (x) { return x.id === r.msg.id; })) l.push(r.msg); scheduleRender(); }
  catch (e) { S.drafts['c-msg'] = text; toast(e.message); scheduleRender(); }
}

/* ---------------------------------------------------------------- events */
$app.addEventListener('click', function (e) {
  var el = e.target.closest && e.target.closest('[data-act]'); if (!el || !$app.contains(el)) return;
  var fn = A[el.getAttribute('data-act')]; if (!fn) return;
  if (el.tagName === 'A') return;
  fn(el, e);
});
$app.addEventListener('input', function (e) {
  var t = e.target; if (!t.id) return; S.drafts[t.id] = t.value;
  if (t.id === 'n-from' || t.id === 'n-to') {
    var key = t.id === 'n-from' ? 'from' : 'to'; if (S.addr[key]) { S.addr[key] = null; scheduleRender(); }
    suggest(key, t.value);
  } else if (t.id === 'c-msg') {
    var sh = curShip(); if (sh && Date.now() - typeT > 2000) { typeT = Date.now(); wsSend({ t: 'typing', id: sh.id, on: true }); }
  }
});
$app.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter') return; var a = e.target.getAttribute && e.target.getAttribute('data-enter'); if (a && A[a]) { e.preventDefault(); A[a](e.target); }
});
function suggest(key, text) {
  clearTimeout(sugT); text = String(text || '').trim();
  if (text.length < 3) { S.sug = { field: '', items: [], busy: false, down: false }; scheduleRender(); return; }
  sugT = setTimeout(async function () {
    S.sug = { field: key, items: [], busy: true, down: false }; scheduleRender();
    try { var r = await api('GET', '/api/geocode?q=' + encodeURIComponent(text)); if (S.sug.field === key) S.sug = { field: key, items: r.results || [], busy: false, down: !!r.unavailable }; }
    catch (e) { S.sug = { field: key, items: [], busy: false, down: true }; }
    scheduleRender();
  }, 500);
}
window.addEventListener('online', function () { S.net = true; connectWs(); loadShips(); scheduleRender(); });
window.addEventListener('offline', function () { S.net = false; scheduleRender(); });
window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); S.installEvt = e; if (S.screen === 'profile') scheduleRender(); });
if (window.matchMedia) { try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (map) map.setTheme(isDark()); }); } catch (e) {} }

/* ---------------------------------------------------------------- start */
async function boot() {
  applyTheme();
  try {
    var qs = new URLSearchParams(location.search);
    ['track', 'pay', 'go'].forEach(function (k) { var v = qs.get(k); if (v) { try { sessionStorage.setItem('fc_' + k, k === 'go' ? v : normId(v)); } catch (e) {} } });
    if (qs.toString()) history.replaceState(null, '', '/');
  } catch (e) {}
  try { S.cfg = await api('GET', '/api/config'); } catch (e) { S.boot = 'error'; S.lastErr = e.message; render(); return; }
  if (S.token) {
    try { var r = await api('GET', '/api/me'); S.me = r.user; }
    catch (e) { if (e.net) { S.boot = 'error'; S.lastErr = e.message; render(); return; } S.token = null; lsSet('fc_token', null); S.me = null; }
  }
  if (S.me && S.me.role !== 'rider') S.online = false;
  S.boot = 'ready'; S.net = navigator.onLine !== false;
  if (S.me) { S.wRole = S.me.role; await afterLogin(); } else {
    var tr = null; try { tr = sessionStorage.getItem('fc_track'); } catch (e) {}
    if (tr) { S.authMode = 'signup'; }
  }
  render();
}
if ('serviceWorker' in navigator) window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
render();
boot();
})();
