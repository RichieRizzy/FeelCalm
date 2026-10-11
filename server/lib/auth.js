'use strict';
const crypto = require('node:crypto');
const cfg = require('./config');
const { meta } = require('./db');

const SECRET = cfg.jwtSecret || meta('jwt_secret', () => crypto.randomBytes(32).toString('hex'));
const b64 = (b) => Buffer.from(b).toString('base64url');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return 's1$' + salt.toString('hex') + '$' + key.toString('hex');
}
function checkPassword(pw, stored) {
  const [v, s, k] = String(stored || '').split('$');
  if (v !== 's1' || !s || !k) return false;
  const key = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(k, 'hex');
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}
function sign(uid, days = 30) {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + days * 86400 }));
  const sig = crypto.createHmac('sha256', SECRET).update(head + '.' + body).digest('base64url');
  return head + '.' + body + '.' + sig;
}
function verify(token) {
  const p = String(token || '').split('.');
  if (p.length !== 3) return null;
  const sig = crypto.createHmac('sha256', SECRET).update(p[0] + '.' + p[1]).digest();
  const got = Buffer.from(p[2], 'base64url');
  if (got.length !== sig.length || !crypto.timingSafeEqual(got, sig)) return null;
  try {
    const body = JSON.parse(Buffer.from(p[1], 'base64url').toString());
    return body.exp > Date.now() / 1000 ? body.sub : null;
  } catch (e) { return null; }
}
module.exports = { hashPassword, checkPassword, sign, verify };
