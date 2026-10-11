'use strict';
/* Server-side proxies for address search and routing, with caching and polite rate limits. */
const cfg = require('./config');
const { haversineKm, CAT } = require('./pricing');
const UA = 'FeelCalm/1.0 (' + cfg.contact + ')';
const cache = new Map();
function cget(k) { const e = cache.get(k); if (e && e.exp > Date.now()) return e.v; cache.delete(k); return null; }
function cset(k, v, ttl) { if (cache.size > 2000) cache.delete(cache.keys().next().value); cache.set(k, { v, exp: Date.now() + ttl }); }

let chain = Promise.resolve(), lastNom = 0;
function nominatim(path) {
  const run = async () => {
    const wait = Math.max(0, lastNom + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastNom = Date.now();
    const r = await fetch('https://nominatim.openstreetmap.org' + path, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) throw new Error('geocoder ' + r.status);
    return r.json();
  };
  const p = chain.then(run, run); chain = p.catch(() => {}); return p;
}
async function search(text) {
  const key = 's:' + text.toLowerCase(); let v = cget(key); if (v) return v;
  const rows = await nominatim('/search?format=jsonv2&limit=5&countrycodes=' + cfg.country + '&q=' + encodeURIComponent(text));
  v = rows.map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
  cset(key, v, 86400000); return v;
}
async function reverse(lat, lng) {
  const key = 'r:' + lat.toFixed(4) + ',' + lng.toFixed(4); let v = cget(key); if (v) return v;
  const r = await nominatim('/reverse?format=jsonv2&zoom=18&lat=' + lat + '&lon=' + lng);
  v = { label: r.display_name || (lat.toFixed(5) + ', ' + lng.toFixed(5)), lat, lng };
  cset(key, v, 86400000); return v;
}
async function route(a, b) {
  const key = 'x:' + [a[0].toFixed(3), a[1].toFixed(3), b[0].toFixed(3), b[1].toFixed(3)].join(); let v = cget(key); if (v) return v;
  try {
    const u = 'https://router.project-osrm.org/route/v1/driving/' + a[1] + ',' + a[0] + ';' + b[1] + ',' + b[0] + '?overview=simplified&geometries=geojson';
    const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(4500) });
    const j = await r.json();
    const rt = j.routes && j.routes[0];
    if (!rt) throw new Error('no route');
    v = { coords: rt.geometry.coordinates.map((c) => [c[1], c[0]]), km: Math.round(rt.distance / 100) / 10, mins: Math.max(1, Math.round(rt.duration / 60)), approx: false };
  } catch (e) {
    const km = Math.round(haversineKm(a, b) * CAT.roadFactor * 10) / 10;
    v = { coords: [a, b], km, mins: Math.max(1, Math.round(km / 22 * 60)), approx: true };
    cset(key, v, 15000); return v;
  }
  cset(key, v, 60000); return v;
}
module.exports = { search, reverse, route };
