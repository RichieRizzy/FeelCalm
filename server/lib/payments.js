'use strict';
/* Paystack (cards, bank transfer). With no secret key the server runs in test mode. */
const crypto = require('node:crypto');
const cfg = require('./config');
const API = 'https://api.paystack.co';

async function call(method, path, body) {
  const r = await fetch(API + path, {
    method, headers: { Authorization: 'Bearer ' + cfg.paystackSecret, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status === false) throw new Error(j.message || ('Paystack ' + r.status));
  return j.data;
}
async function initialize({ email, amountNaira, reference, callbackUrl, channels, metadata }) {
  return call('POST', '/transaction/initialize', { email, amount: amountNaira * 100, currency: 'NGN', reference, callback_url: callbackUrl, channels, metadata });
}
async function verify(reference) { return call('GET', '/transaction/verify/' + encodeURIComponent(reference)); }
async function refund(reference) { return call('POST', '/refund', { transaction: reference }); }
function validSignature(rawBody, header) {
  if (!cfg.paystackSecret || !header) return false;
  const h = crypto.createHmac('sha512', cfg.paystackSecret).update(rawBody).digest('hex');
  const a = Buffer.from(h), b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports = { initialize, verify, refund, validSignature };
