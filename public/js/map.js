/* FeelCalm map: small slippy-map (tiles, markers, route lines, pan, pinch and wheel zoom). No dependencies. */
(function (root) {
  'use strict';
  var TS = 256, MINZ = 3, MAXZ = 18;
  function px(ll, z) { var s = TS * Math.pow(2, z), sin = Math.sin(ll[0] * Math.PI / 180); sin = Math.max(-0.9999, Math.min(0.9999, sin)); return [(ll[1] + 180) / 360 * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s]; }
  function unpx(p, z) { var s = TS * Math.pow(2, z), n = Math.PI - 2 * Math.PI * p[1] / s; return [180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), p[0] / s * 360 - 180]; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function el(tag, cls) { var e = document.createElement(tag); if (cls) e.className = cls; return e; }

  function FCMap(opts) {
    this.o = opts || {};
    this.el = el('div', 'fcmap');
    this.tiles = el('div', 'tiles');
    this.svgNS = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(this.svgNS, 'svg'); this.svg.setAttribute('class', 'routes');
    this.mkLayer = el('div');
    this.el.appendChild(this.tiles); this.el.appendChild(this.svg); this.el.appendChild(this.mkLayer);
    this.center = this.o.center || [6.5244, 3.3792]; this.zoom = this.o.zoom || 12;
    this.w = 300; this.h = 400; this.imgs = {}; this.markers = {}; this.routes = {}; this.dark = false; this.pointers = {};
    this.onMove = this.o.onMove || null; this.onTap = this.o.onTap || null; this.raf = 0;
    var self = this;
    this.ro = typeof ResizeObserver === 'function' ? new ResizeObserver(function () { self.resize(); }) : null;
    if (this.ro) this.ro.observe(this.el);
    this._bind();
  }
  var P = FCMap.prototype;
  P.resize = function () { var r = this.el.getBoundingClientRect(); if (r.width && (r.width !== this.w || r.height !== this.h)) { this.w = r.width; this.h = r.height; this.draw(); } };
  P.setTheme = function (dark) { if (this.dark === dark) return; this.dark = dark; for (var k in this.imgs) { this.imgs[k].remove(); } this.imgs = {}; this.draw(); };
  P.project = function (ll) { var c = px(this.center, this.zoom), p = px(ll, this.zoom); return [p[0] - c[0] + this.w / 2, p[1] - c[1] + this.h / 2]; };
  P.unproject = function (xy) { var c = px(this.center, this.zoom); return unpx([xy[0] - this.w / 2 + c[0], xy[1] - this.h / 2 + c[1]], this.zoom); };
  P.setView = function (center, zoom) { this.center = center; if (zoom != null) this.zoom = clamp(zoom, MINZ, MAXZ); this.draw(); };
  P.zoomBy = function (d, at) {
    var nz = clamp(this.zoom + d, MINZ, MAXZ); if (nz === this.zoom) return;
    if (at) { var before = this.unproject(at); this.zoom = nz; var after = this.project(before); var c = px(this.center, nz); this.center = unpx([c[0] + after[0] - at[0], c[1] + after[1] - at[1]], nz); } else this.zoom = nz;
    this.draw(); if (this.onMove) this.onMove();
  };
  P.fit = function (pts, pad) {
    pts = pts.filter(Boolean); if (!pts.length) return;
    pad = pad || {}; var t = pad.top == null ? 70 : pad.top, b = pad.bottom == null ? 70 : pad.bottom, l = pad.left == null ? 50 : pad.left, r = pad.right == null ? 50 : pad.right;
    if (this.w < 10) this.resize();
    var availW = Math.max(60, this.w - l - r), availH = Math.max(60, this.h - t - b);
    if (pts.length === 1) { this.center = pts[0]; this.zoom = 16; this.draw(); return; }
    var z, minx, maxx, miny, maxy;
    for (z = MAXZ - 2; z >= MINZ; z -= 0.25) {
      minx = miny = Infinity; maxx = maxy = -Infinity;
      for (var i = 0; i < pts.length; i++) { var p = px(pts[i], z); minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); miny = Math.min(miny, p[1]); maxy = Math.max(maxy, p[1]); }
      if (maxx - minx <= availW && maxy - miny <= availH) break;
    }
    var cx = (minx + maxx) / 2 - (l - r) / 2, cy = (miny + maxy) / 2 - (t - b) / 2;
    this.zoom = z; this.center = unpx([cx, cy], z); this.draw();
  };
  P.tileUrl = function (z, x, y) {
    var tpl = (this.dark ? this.o.tileDark : this.o.tileLight) || this.o.tileLight || '';
    return tpl.replace('{s}', 'abc'[(x + y) % 3]).replace('{z}', z).replace('{x}', x).replace('{y}', y).replace('{r}', '');
  };
  P.draw = function () {
    if (this.raf) return; var self = this;
    this.raf = requestAnimationFrame(function () { self.raf = 0; self._draw(); });
  };
  P._draw = function () {
    var tz = clamp(Math.round(this.zoom), MINZ, 18), sc = Math.pow(2, this.zoom - tz), size = TS * sc;
    var c = px(this.center, tz), cx = c[0] * sc, cy = c[1] * sc; // center in scaled px
    var x0 = Math.floor((cx - this.w / 2) / size), x1 = Math.floor((cx + this.w / 2) / size), y0 = Math.floor((cy - this.h / 2) / size), y1 = Math.floor((cy + this.h / 2) / size);
    var max = Math.pow(2, tz), keep = {}, x, y, key, img;
    if (this.o.tileLight) for (x = x0; x <= x1; x++) for (y = y0; y <= y1; y++) {
      if (y < 0 || y >= max) continue;
      var wx = ((x % max) + max) % max; key = tz + '/' + x + '/' + y + (this.dark ? 'd' : 'l'); keep[key] = 1; img = this.imgs[key];
      if (!img) {
        img = new Image(); img.decoding = 'async'; img.alt = ''; img.draggable = false; img.width = TS; img.height = TS;
        img.onerror = function () { this.style.visibility = 'hidden'; }; img.src = this.tileUrl(tz, wx, y); this.tiles.appendChild(img); this.imgs[key] = img;
      }
      img.style.transform = 'translate(' + Math.round(x * size - cx + this.w / 2) + 'px,' + Math.round(y * size - cy + this.h / 2) + 'px) scale(' + (sc + 0.004) + ')';
    }
    for (key in this.imgs) if (!keep[key]) { this.imgs[key].remove(); delete this.imgs[key]; }
    var id, m, p;
    for (id in this.markers) { m = this.markers[id]; p = this.project(m.ll); m.node.style.transform = 'translate(' + p[0].toFixed(1) + 'px,' + p[1].toFixed(1) + 'px)'; }
    this._drawRoutes();
  };
  P._drawRoutes = function () {
    for (var id in this.routes) {
      var r = this.routes[id], d = '';
      for (var i = 0; i < r.coords.length; i++) { var p = this.project(r.coords[i]); d += (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }
      for (var j = 0; j < r.paths.length; j++) r.paths[j].setAttribute('d', d);
    }
  };
  P.setMarker = function (id, ll, html) {
    var m = this.markers[id];
    if (!ll) { if (m) { m.node.remove(); delete this.markers[id]; } return; }
    if (!m) { m = this.markers[id] = { node: el('div', 'mk'), ll: ll, html: null }; this.mkLayer.appendChild(m.node); }
    m.ll = ll; if (html != null && m.html !== html) { m.html = html; m.node.innerHTML = html; }
    var p = this.project(ll); m.node.style.transform = 'translate(' + p[0].toFixed(1) + 'px,' + p[1].toFixed(1) + 'px)';
  };
  P.setRoute = function (id, coords, style) {
    var r = this.routes[id];
    if (!coords || coords.length < 2) { if (r) { r.paths.forEach(function (p) { p.remove(); }); delete this.routes[id]; } return; }
    if (!r) {
      r = this.routes[id] = { coords: coords, paths: [] };
      var spec = style && style.dashed ? [['#fff', 9, null], [style.color || 'var(--accent)', 4, '2 9']] : [['#fff', 10, null], [(style && style.color) || 'var(--accent)', 5, null]];
      for (var i = 0; i < spec.length; i++) {
        var p = document.createElementNS(this.svgNS, 'path'); p.setAttribute('fill', 'none'); p.setAttribute('stroke', spec[i][0]); p.setAttribute('stroke-width', spec[i][1]); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
        if (i === 0) p.setAttribute('opacity', '.9'); if (spec[i][2]) p.setAttribute('stroke-dasharray', spec[i][2]);
        this.svg.appendChild(p); r.paths.push(p);
      }
    }
    r.coords = coords; this._drawRoutes();
  };
  P.clear = function () { for (var k in this.markers) this.markers[k].node.remove(); this.markers = {}; for (var j in this.routes) this.routes[j].paths.forEach(function (p) { p.remove(); }); this.routes = {}; };

  P._bind = function () {
    var self = this, e = this.el, start = null, pinch = null;
    function rel(ev) { var r = e.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
    e.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest && ev.target.closest('button')) return;
      e.setPointerCapture(ev.pointerId); self.pointers[ev.pointerId] = rel(ev);
      var ids = Object.keys(self.pointers);
      if (ids.length === 1) start = { at: rel(ev), t: Date.now(), moved: false };
      else if (ids.length === 2) { var a = self.pointers[ids[0]], b = self.pointers[ids[1]]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: self.zoom }; if (start) start.moved = true; }
    });
    e.addEventListener('pointermove', function (ev) {
      if (!self.pointers[ev.pointerId]) return;
      var prev = self.pointers[ev.pointerId], cur = rel(ev); self.pointers[ev.pointerId] = cur;
      var ids = Object.keys(self.pointers);
      if (ids.length === 1) {
        if (start && !start.moved && Math.hypot(cur[0] - start.at[0], cur[1] - start.at[1]) > 6) start.moved = true;
        if (start && start.moved) { var c = px(self.center, self.zoom); self.center = unpx([c[0] - (cur[0] - prev[0]), c[1] - (cur[1] - prev[1])], self.zoom); self.draw(); if (self.onMove) self.onMove(); }
      } else if (ids.length === 2 && pinch) {
        var a = self.pointers[ids[0]], b = self.pointers[ids[1]], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        var mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], nz = clamp(pinch.z + Math.log(d / Math.max(1, pinch.d)) / Math.LN2, MINZ, MAXZ);
        var before = self.unproject(mid); self.zoom = nz; var after = self.project(before), c2 = px(self.center, nz);
        self.center = unpx([c2[0] + after[0] - mid[0], c2[1] + after[1] - mid[1]], nz); self.draw(); if (self.onMove) self.onMove();
      }
    });
    function up(ev) {
      if (!self.pointers[ev.pointerId]) return;
      delete self.pointers[ev.pointerId];
      if (Object.keys(self.pointers).length < 2) pinch = null;
      if (!Object.keys(self.pointers).length && start) { if (!start.moved && Date.now() - start.t < 500 && self.onTap && ev.type === 'pointerup') self.onTap(self.unproject(start.at)); start = null; }
    }
    e.addEventListener('pointerup', up); e.addEventListener('pointercancel', up);
    e.addEventListener('wheel', function (ev) { ev.preventDefault(); self.zoomBy(ev.deltaY < 0 ? 0.5 : -0.5, rel(ev)); }, { passive: false });
    e.addEventListener('dblclick', function (ev) { self.zoomBy(1, rel(ev)); });
  };
  root.FCMap = FCMap; root.FCGeo = { haversineKm: function (a, b) { var R = 6371, r = Math.PI / 180, dl = (b[0] - a[0]) * r, dg = (b[1] - a[1]) * r, x = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dg / 2) * Math.sin(dg / 2); return 2 * R * Math.asin(Math.sqrt(x)); } };
})(window);
