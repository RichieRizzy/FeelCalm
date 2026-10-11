'use strict';
/* Minimal RFC 6455 WebSocket server (text frames only), no dependencies. */
const crypto = require('node:crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX = 1 << 20;

function frame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, payload]);
}

class Conn {
  constructor(socket, onMessage, onClose) {
    this.socket = socket; this.buf = Buffer.alloc(0); this.frag = null; this.alive = true; this.closed = false;
    this.meta = {}; this.onMessage = onMessage; this.onClose = onClose;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._end());
    socket.on('error', () => this._end());
  }
  send(obj) { if (!this.closed) try { this.socket.write(frame(1, Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)))); } catch (e) { this._end(); } }
  ping() { if (!this.closed) try { this.socket.write(frame(9, Buffer.alloc(0))); } catch (e) { this._end(); } }
  close(code = 1000) { if (this.closed) return; const b = Buffer.alloc(2); b.writeUInt16BE(code); try { this.socket.end(frame(8, b)); } catch (e) {} this._end(); }
  _end() { if (this.closed) return; this.closed = true; try { this.socket.destroy(); } catch (e) {} this.onClose(this); }
  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (this.buf.length > MAX * 2) return this.close(1009);
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 0x0f, masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (!masked) return this.close(1002);
      if (len > MAX) return this.close(1009);
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4), data = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op === 8) return this.close();
      if (op === 9) { this.socket.write(frame(10, data)); continue; }
      if (op === 10) { this.alive = true; continue; }
      if (op === 1 || op === 2) { this.frag = fin ? null : [data]; if (fin) this._msg(data); }
      else if (op === 0 && this.frag) { this.frag.push(data); if (fin) { const all = Buffer.concat(this.frag); this.frag = null; this._msg(all); } }
    }
  }
  _msg(data) { this.alive = true; let m; try { m = JSON.parse(data.toString('utf8')); } catch (e) { return; } this.onMessage(this, m); }
}

function attach(server, authorize, onMessage, onClose, onOpen) {
  const conns = new Set();
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    const ctx = url.pathname === '/ws' && key && String(req.headers.upgrade || '').toLowerCase() === 'websocket' ? authorize(req, url) : null;
    if (!ctx) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return; }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    const c = new Conn(socket, onMessage, (cc) => { conns.delete(cc); onClose(cc); });
    c.meta = ctx; conns.add(c);
    if (onOpen) onOpen(c);
    c.send({ t: 'hello' });
  });
  const timer = setInterval(() => { for (const c of conns) { if (!c.alive) { c.close(1001); continue; } c.alive = false; c.ping(); } }, 30000);
  timer.unref();
  return { conns };
}
module.exports = { attach };
