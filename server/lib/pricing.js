'use strict';
/* Fixed price list. Prices are decided here on the server, never by the app. */
const CAT = {
  zones: {
    near: { label: 'Nearby', range: 'Up to 5 km', maxKm: 5, km: 4, Standard: 1800, Express: 2800, mins: { Standard: 35, Express: 20 } },
    city: { label: 'Across town', range: '5 to 15 km', maxKm: 15, km: 10, Standard: 3000, Express: 4600, mins: { Standard: 60, Express: 35 } },
    far: { label: 'Far', range: '15 to 30 km', maxKm: 30, km: 22, Standard: 4800, Express: 7200, mins: { Standard: 100, Express: 60 } }
  },
  sizes: {
    env: { label: 'Envelope', range: 'Up to 1 kg', add: 0 },
    small: { label: 'Small box', range: 'Up to 5 kg', add: 600 },
    large: { label: 'Large box', range: 'Up to 15 kg', add: 1600 }
  },
  services: ['Standard', 'Express'],
  fee: 250, ins: 500, insCover: 50000, share: 0.8, roadFactor: 1.3
};

function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function zoneForKm(km) {
  for (const k of ['near', 'city', 'far']) if (km <= CAT.zones[k].maxKm) return k;
  return null;
}
/* in: { zone?, from?:[lat,lng], to?:[lat,lng], size, service, insured } */
function quote(inp) {
  const size = CAT.sizes[inp.size], service = CAT.services.includes(inp.service) ? inp.service : null;
  if (!size) throw new Error('Choose a package size.');
  if (!service) throw new Error('Choose Standard or Express.');
  let zone = inp.zone, roadKm = null;
  if (inp.from && inp.to) {
    roadKm = haversineKm(inp.from, inp.to) * CAT.roadFactor;
    zone = zoneForKm(roadKm);
    if (!zone) throw new Error('That trip is over 30 km. We do not deliver that far yet.');
  }
  const z = CAT.zones[zone];
  if (!z) throw new Error('Choose a distance.');
  const delivery = z[service], ins = inp.insured ? CAT.ins : 0;
  return {
    zone, delivery, size: size.add, fee: CAT.fee, ins, total: delivery + size.add + CAT.fee + ins,
    payout: Math.round((delivery + size.add) * CAT.share),
    km: roadKm != null ? Math.round(roadKm * 10) / 10 : z.km, mins: z.mins[service],
    zoneLabel: z.label, sizeLabel: size.label
  };
}
module.exports = { CAT, quote, haversineKm, zoneForKm };
