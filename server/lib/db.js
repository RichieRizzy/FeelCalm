'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

fs.mkdirSync(cfg.dataDir, { recursive: true });
const db = new DatabaseSync(process.env.DB_FILE || path.join(cfg.dataDir, 'feelcalm.db'));
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, phone TEXT, phone_key TEXT, name TEXT, pass TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer', address TEXT, vehicle TEXT, plate TEXT,
  share INTEGER NOT NULL DEFAULT 1, calm INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS users_phone ON users(phone_key);
CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, rider_id TEXT, stage INTEGER NOT NULL DEFAULT 0,
  item TEXT, service TEXT, zone TEXT, size TEXT, insured INTEGER DEFAULT 0, pay TEXT, pay_status TEXT, pay_ref TEXT, note TEXT,
  from_addr TEXT, to_addr TEXT, from_lat REAL, from_lng REAL, to_lat REAL, to_lng REAL,
  r_name TEXT, r_phone TEXT, r_key TEXT,
  delivery INTEGER, size_add INTEGER, fee INTEGER, ins INTEGER, total INTEGER, payout INTEGER, km REAL, mins INTEGER,
  pin TEXT, pin_tries INTEGER DEFAULT 0, pin_lock INTEGER DEFAULT 0,
  created INTEGER, accepted_at INTEGER, picked_at INTEGER, arrived_at INTEGER, delivered_at INTEGER,
  rider_lat REAL, rider_lng REAL, rider_ts INTEGER, recv_lat REAL, recv_lng REAL, recv_ts INTEGER,
  rating INTEGER, tip INTEGER DEFAULT 0, comment TEXT, refund TEXT,
  FOREIGN KEY (sender_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ship_sender ON shipments(sender_id);
CREATE INDEX IF NOT EXISTS ship_rider ON shipments(rider_id);
CREATE INDEX IF NOT EXISTS ship_open ON shipments(stage, pay_status);
CREATE INDEX IF NOT EXISTS ship_rkey ON shipments(r_key);
CREATE TABLE IF NOT EXISTS follows (user_id TEXT NOT NULL, shipment_id TEXT NOT NULL, PRIMARY KEY (user_id, shipment_id));
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, shipment_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT, name TEXT, text TEXT NOT NULL, ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS msg_ship ON messages(shipment_id, id);
`);

const q = {
  get: (sql, ...a) => db.prepare(sql).get(...a),
  all: (sql, ...a) => db.prepare(sql).all(...a),
  run: (sql, ...a) => db.prepare(sql).run(...a)
};
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
function meta(k, make) {
  const row = q.get('SELECT v FROM meta WHERE k=?', k);
  if (row) return row.v;
  const v = make(); q.run('INSERT INTO meta(k,v) VALUES(?,?)', k, v); return v;
}
module.exports = { db, q, tx, meta };
