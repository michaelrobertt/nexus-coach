import { assetUrl, clamp, hexToRgba, luminance, uid } from './ui.js';

const TAU = Math.PI * 2;
const HANDLE = 7;
const ROT_OFFSET = 30;
const MIN_SIZE = 6;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function smoothPath(ctx, pts) {
  if (!pts.length) return;
  if (pts.length === 1) {
    ctx.lineTo(pts[0].x, pts[0].y);
    return;
  }
  if (pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
    return;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y);
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  ctx.quadraticCurveTo(prev.x, prev.y, last.x, last.y);
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function rotatePoint(p, center, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
}

function pathBounds(points, pad = 0) {
  if (!points?.length) return { x: 0, y: 0, w: 0, h: 0 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const maxX = Math.max(...xs) + pad;
  const maxY = Math.max(...ys) + pad;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, rr);
}

function makeId() { return uid('d'); }

export class SceneEngine {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts;
    this.mode = opts.mode || 'overlay';
    this.catalog = opts.catalog || { stamps: [], aoePresets: [] };
    this.textLayer = opts.textLayer || document.body;
    this.zoomable = !!opts.zoomable;
    this.panEnabled = !!opts.panEnabled;
    this.showSelection = opts.showSelection !== false;
    this.items = [];
    this.selection = new Set();
    this.history = [];
    this.hIndex = -1;
    this.hidden = false;
    this.interactive = true;
    this.spaceDown = false;
    this.view = { x: 0, y: 0, scale: 1 };
    this.mapW = opts.mapW || 2600;
    this.mapH = opts.mapH || 2212;
    this.background = { src: null, mode: 'none', brightness: 1, grid: false, image: null };
    this.style = {
      tool: 'pen', color: '#C8AA6E', width: 4, opacity: 1, arrowStyle: 'attack',
      aoeId: 'range', stampId: null, stampTeam: 'ally', stampSize: 64, textSize: 38,
      fade: false, fadeSeconds: 4, lineStyle: 'solid', globalOpacity: 1, showCursor: true, showLabels: true
    };
    this.active = null;
    this.route = null;
    this.marquee = null;
    this.hover = null;
    this._dirty = false;
    this._raf = null;
    this._fadeTimer = null;
    this._images = new Map();
    this._editing = null;
    this._saveTimer = null;
    this._bind();
    this.resize();
    this._initHistory();
    if (opts.imageRenderer) this.imageRenderer = opts.imageRenderer;
    window.addEventListener('resize', () => this.resize());
  }

  /* ------------------------------- setup ------------------------------- */

  _bind() {
    this._onDown = this.onPointerDown.bind(this);
    this._onMove = this.onPointerMove.bind(this);
    this._onUp = this.onPointerUp.bind(this);
    this._onWheel = this.onWheel.bind(this);
    this._onDouble = (e) => { if (this.route) { this.finishRoute(true); e.preventDefault(); } else if (this.style.tool === 'select') this.editSelectedText(); };
    this._onContext = (e) => { e.preventDefault(); };
    this._onKeyDown = (e) => {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.code === 'Space' && this.zoomable && !typing) { this.spaceDown = true; this.updateCursor(); }
    };
    this._onKeyUp = (e) => { if (e.code === 'Space') { this.spaceDown = false; this.updateCursor(); } };
    this.canvas.addEventListener('pointerdown', this._onDown);
    this.canvas.addEventListener('pointermove', this._onMove);
    this.canvas.addEventListener('pointerup', this._onUp);
    this.canvas.addEventListener('pointercancel', this._onUp);
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    this.canvas.addEventListener('dblclick', this._onDouble);
    this.canvas.addEventListener('contextmenu', this._onContext);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this.updateCursor();
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this._onDown);
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerup', this._onUp);
    this.canvas.removeEventListener('pointercancel', this._onUp);
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('dblclick', this._onDouble);
    this.canvas.removeEventListener('contextmenu', this._onContext);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('resize', this.resize);
    clearTimeout(this._fadeTimer);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.render();
  }

  setStyle(patch = {}) {
    const prevTool = this.style.tool;
    Object.assign(this.style, patch);
    if (prevTool === 'route' && this.style.tool !== 'route' && this.route) this.finishRoute(true);
    if (this._editing && prevTool !== this.style.tool) this.commitTextEdit();
    if (prevTool !== this.style.tool && this.style.tool !== 'select' && this.selection.size) {
      this.selection.clear();
      this.emitSelection();
    }
    this.updateCursor();
    this.renderSoon();
  }

  dashFor(styleValue) {
    if (styleValue === 'dashed') return [12, 9];
    if (styleValue === 'dotted') return [2, 8];
    return [];
  }

  applyStyleToSelection(patch = {}) {
    if (!this.selection.size) return false;
    const dash = patch.lineStyle ? this.dashFor(patch.lineStyle) : null;
    for (const it of this.selectedItems()) {
      if (patch.color && ['stroke', 'line', 'arrow', 'route', 'shape', 'zone', 'cone', 'text'].includes(it.type)) it.color = patch.color;
      if (patch.opacity != null) it.opacity = patch.opacity;
      if (patch.width != null && it.type !== 'text' && it.type !== 'stamp' && it.type !== 'wave') it.width = patch.width;
      if (patch.arrowStyle && (it.type === 'arrow' || it.type === 'route')) it.arrowStyle = patch.arrowStyle;
      if (patch.lineStyle) {
        it.lineStyle = patch.lineStyle;
        if (['stroke', 'line', 'shape', 'cone'].includes(it.type)) it.dash = dash;
      }
    }
    clearTimeout(this._styleCommit);
    this._styleCommit = setTimeout(() => this.commit(), 260);
    this.renderSoon();
    return true;
  }

  setCatalog(catalog) {
    this.catalog = catalog || this.catalog;
  }

  setInteractive(v) {
    this.interactive = !!v;
    this.updateCursor();
    if (!v) {
      if (this.route) this.finishRoute(true);
      this.active = null;
      this.renderSoon();
    }
  }

  setSpaceDown(v) { this.spaceDown = !!v; this.updateCursor(); }

  updateCursor() {
    if (!this.canvas) return;
    let cursor = 'default';
    const t = this.style.tool;
    if (this.spaceDown && this.zoomable) cursor = 'grab';
    else if (t === 'select') cursor = 'default';
    else if (t === 'text') cursor = 'text';
    else if (t === 'eraser') cursor = 'none';
    else if (t === 'stamp' || t === 'aoe') cursor = 'copy';
    else if (['pen', 'pencil', 'marker', 'line', 'arrow', 'curve', 'route', 'circle', 'rect', 'triangle', 'hexagon', 'cone'].includes(t)) cursor = 'crosshair';
    this.canvas.style.cursor = this.interactive ? cursor : 'default';
  }

  /* ------------------------------- view ------------------------------- */

  setView(view) {
    if (!this.zoomable) return;
    this.view = {
      x: isNum(view?.x) ? view.x : this.view.x,
      y: isNum(view?.y) ? view.y : this.view.y,
      scale: isNum(view?.scale) ? clamp(view.scale, 0.12, 8) : this.view.scale
    };
    this._viewInitialized = true;
    this.opts.onViewChange?.(this.view);
    this.renderSoon();
  }

  getView() { return { ...this.view }; }

  fitView(padding = 0.94) {
    if (!this.zoomable) return;
    const scale = Math.min(this.w / this.mapW, this.h / this.mapH) * padding;
    this.view = {
      scale,
      x: (this.w - this.mapW * scale) / 2,
      y: (this.h - this.mapH * scale) / 2
    };
    this._viewInitialized = true;
    this.opts.onViewChange?.(this.view);
    this.renderSoon();
  }

  zoomToRect(rect, padding = 1.5) {
    if (!this.zoomable || !rect) return;
    const w = Math.max(rect.w, 50) * padding;
    const h = Math.max(rect.h, 50) * padding;
    const scale = clamp(Math.min(this.w / w, this.h / h), 0.12, 8);
    this.view = {
      scale,
      x: this.w / 2 - (rect.x + rect.w / 2) * scale,
      y: this.h / 2 - (rect.y + rect.h / 2) * scale
    };
    this._viewInitialized = true;
    this.opts.onViewChange?.(this.view);
    this.renderSoon();
  }

  panBy(dx, dy) {
    this.view.x += dx;
    this.view.y += dy;
    this.opts.onViewChange?.(this.view);
    this.renderSoon();
  }

  zoomAt(sx, sy, factor) {
    if (!this.zoomable) return;
    const next = clamp(this.view.scale * factor, 0.12, 8);
    const k = next / this.view.scale;
    this.view.x = sx - (sx - this.view.x) * k;
    this.view.y = sy - (sy - this.view.y) * k;
    this.view.scale = next;
    this.opts.onViewChange?.(this.view);
    this.renderSoon();
  }

  screenToWorld(p) {
    return {
      x: (p.x - this.view.x) / this.view.scale,
      y: (p.y - this.view.y) / this.view.scale
    };
  }

  worldToScreen(p) {
    return { x: p.x * this.view.scale + this.view.x, y: p.y * this.view.scale + this.view.y };
  }

  eventPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /* ----------------------------- background ---------------------------- */

  setBackground({ src, mode = 'hd', brightness = 1, grid = false, mapW, mapH } = {}) {
    if (mapW) this.mapW = mapW;
    if (mapH) this.mapH = mapH;
    this.background.mode = mode;
    this.background.brightness = brightness;
    this.background.grid = grid;
    if (src && src !== this.background.src) {
      this.background.src = src;
      this._loadImage(src, (img) => {
        this.background.image = img;
        if (this.zoomable && !this._viewInitialized) {
          this.fitView();
          this._viewInitialized = true;
        }
        this.renderSoon();
      });
    }
    this.renderSoon();
  }

  _loadImage(src, cb) {
    if (!src) return;
    const key = src;
    if (this._images.has(key)) {
      const img = this._images.get(key);
      if (img.complete) cb?.(img);
      else img.addEventListener('load', () => cb?.(img), { once: true });
      return img;
    }
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    this._images.set(key, img);
    img.addEventListener('load', () => { this.renderSoon(); cb?.(img); }, { once: true });
    img.addEventListener('error', () => { this._images.delete(key); }, { once: true });
    return img;
  }

  getImage(src, cb) {
    if (!src) return null;
    const computed = /^(file:|data:|https?:|\/)/.test(src) ? src : assetUrl(src);
    return this._loadImage(computed, cb);
  }

  /* ------------------------------ history ----------------------------- */

  _snapshot() {
    return JSON.stringify(this.items.map((it) => ({ ...it, _sel: undefined })));
  }

  _initHistory() {
    this.history = [this._snapshot()];
    this.hIndex = 0;
    this.emitHistory();
  }

  commit(options = {}) {
    const snap = this._snapshot();
    if (this.history[this.hIndex] !== snap) {
      this.history = this.history.slice(0, this.hIndex + 1);
      this.history.push(snap);
      if (this.history.length > 70) this.history.shift();
      this.hIndex = this.history.length - 1;
    }
    this.emitHistory();
    this.renderSoon();
    this.scheduleSave();
  }

  undo() {
    if (this._editing) this.cancelTextEdit();
    if (this.hIndex <= 0) return false;
    this.hIndex--;
    this.items = JSON.parse(this.history[this.hIndex]);
    this.selection.clear();
    this.emitHistory();
    this.emitSelection();
    this.renderSoon();
    this.scheduleSave();
    return true;
  }

  redo() {
    if (this.hIndex >= this.history.length - 1) return false;
    this.hIndex++;
    this.items = JSON.parse(this.history[this.hIndex]);
    this.selection.clear();
    this.emitHistory();
    this.emitSelection();
    this.renderSoon();
    this.scheduleSave();
    return true;
  }

  emitHistory() {
    this.opts.onHistory?.({
      canUndo: this.hIndex > 0,
      canRedo: this.hIndex < this.history.length - 1,
      selectedCount: this.selection.size,
      itemCount: this.items.length
    });
  }

  emitSelection() {
    this.opts.onSelection?.(this.selectedItems().map((it) => it.type));
    this.emitHistory();
  }

  scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this.opts.onChange?.(this.serialize());
    }, 450);
  }

  /* ----------------------------- scene data ---------------------------- */

  serialize() {
    return {
      version: 1,
      items: JSON.parse(JSON.stringify(this.items.filter((it) => !it.ttl))),
      view: this.zoomable ? this.getView() : null,
      background: this.background.mode,
      mapW: this.mapW,
      mapH: this.mapH
    };
  }

  loadScene(scene, opts = {}) {
    if (this._editing) this.cancelTextEdit();
    const data = scene?.scene && scene.scene.items ? scene.scene : scene;
    if (!data) return false;
    const items = Array.isArray(data.items) ? data.items : [];
    this.items = items.filter((it) => it && typeof it === 'object' && typeof it.type === 'string' && !it.ttl);
    this.selection.clear();
    if (this.zoomable && data.view) { this._viewInitialized = true; this.setView(data.view); }
    else if (this.zoomable && opts.fit) this.fitView();
    this._initHistory();
    this.renderSoon();
    this.scheduleSave();
    return true;
  }

  clear(options = {}) {
    if (this._editing) this.cancelTextEdit();
    if (!this.items.length) return;
    this.items = [];
    this.selection.clear();
    this.active = null;
    this.route = null;
    this.marquee = null;
    this.emitSelection();
    this.commit();
  }

  clearTemporary() {
    const before = this.items.length;
    this.items = this.items.filter((it) => !it.ttl);
    if (this.items.length !== before) {
      this.selection.clear();
      this.emitSelection();
      this.commit();
    }
  }

  setHidden(v) {
    this.hidden = !!v;
    this.renderSoon();
  }

  /* ----------------------------- selection ---------------------------- */

  selectedItems() {
    return this.items.filter((it) => this.selection.has(it.id));
  }

  setSelection(ids) {
    this.selection = new Set(ids);
    this.emitSelection();
    this.renderSoon();
  }

  selectAll() {
    this.selection = new Set(this.items.map((it) => it.id));
    this.emitSelection();
    this.renderSoon();
  }

  deleteSelected() {
    if (this._editing) return;
    if (!this.selection.size) return;
    this.items = this.items.filter((it) => !this.selection.has(it.id));
    this.selection.clear();
    this.emitSelection();
    this.commit();
  }

  copySelection() {
    const items = this.selectedItems();
    if (!items.length) return false;
    this._clipboard = JSON.parse(JSON.stringify(items));
    try { window.nexus?.writeClipboard(JSON.stringify({ app: 'nexus-coach-items', version: 1, items: this._clipboard })); } catch { /* ignore */ }
    return true;
  }

  paste() {
    let items = this._clipboard;
    if (!items) return false;
    const offset = 28 / (this.view.scale || 1);
    const map = new Map();
    const pasted = items.map((it) => {
      const copy = JSON.parse(JSON.stringify(it));
      copy.id = makeId();
      map.set(it.id, copy.id);
      this._offsetItem(copy, offset, offset);
      return copy;
    });
    this.items.push(...pasted);
    this.selection = new Set(pasted.map((it) => it.id));
    this.emitSelection();
    this.commit();
    return true;
  }

  duplicateSelected() {
    if (!this.selection.size) return;
    const items = this.selectedItems().map((it) => {
      const copy = JSON.parse(JSON.stringify(it));
      copy.id = makeId();
      this._offsetItem(copy, 24 / (this.view.scale || 1), 24 / (this.view.scale || 1));
      return copy;
    });
    this.items.push(...items);
    this.selection = new Set(items.map((it) => it.id));
    this.emitSelection();
    this.commit();
  }

  _offsetItem(it, dx, dy) {
    if (it.points) it.points = it.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    if (isNum(it.x)) it.x += dx;
    if (isNum(it.y)) it.y += dy;
  }

  /* ------------------------------ bounds ------------------------------ */

  itemBounds(it) {
    if (it.type === 'stroke' || it.type === 'line' || it.type === 'arrow' || it.type === 'route') {
      return pathBounds(it.points, (it.width || 4) / 2 + 4);
    }
    if (it.type === 'shape') return { x: it.x, y: it.y, w: it.w, h: it.h };
    if (it.type === 'zone' || it.type === 'cone') {
      if (it.kind === 'cone' || it.type === 'cone') {
        const r = (it.w || 200) / 2;
        return { x: it.x - r, y: it.y - r, w: r * 2, h: r * 2 };
      }
      return { x: it.x - it.w / 2, y: it.y - it.h / 2, w: it.w, h: it.h };
    }
    if (it.type === 'stamp') {
      const s = it.size || 64;
      return { x: it.x - s / 2, y: it.y - s / 2, w: s, h: s };
    }
    if (it.type === 'text') {
      const m = this.measureText(it);
      return { x: it.x - 4, y: it.y - 2, w: m.w + 8, h: m.h + 4 };
    }
    if (it.type === 'wave') {
      const s = (it.size || 54);
      return { x: it.x - s * 1.5, y: it.y - s * 1.1, w: s * 3, h: s * 2.2 + 22 };
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  }

  selectionBounds() {
    const items = this.selectedItems();
    if (!items.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const it of items) {
      const b = this.itemBounds(it);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  measureText(it) {
    const size = it.size || 32;
    const weight = it.weight || 650;
    this.ctx.save();
    this.ctx.font = `${weight} ${size}px Inter, Segoe UI, sans-serif`;
    const lines = String(it.text || '').split('\n');
    const widths = lines.map((l) => this.ctx.measureText(l).width);
    this.ctx.restore();
    const lineH = size * 1.22;
    return { w: Math.max(8, ...widths), h: lineH * lines.length, lineH, lines };
  }

  /* ------------------------------- hit -------------------------------- */

  hitTest(pt, tolerance = 6) {
    const tol = tolerance / (this.view.scale || 1);
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this._hitItem(this.items[i], pt, tol)) return this.items[i];
    }
    return null;
  }

  _hitItem(it, pt, tol) {
    if (it.ttl && it.bornAt && (performance.now() - it.bornAt) / 1000 > it.ttl) return false;
    if (it.type === 'stroke' || it.type === 'line' || it.type === 'arrow' || it.type === 'route') {
      const pts = it.points || [];
      if (!pts.length) return false;
      const threshold = (it.width || 4) / 2 + tol;
      if (pts.length === 1) return Math.hypot(pt.x - pts[0].x, pt.y - pts[0].y) <= threshold + 3;
      for (let i = 1; i < pts.length; i++) {
        if (distToSegment(pt, pts[i - 1], pts[i]) <= threshold) return true;
      }
      return false;
    }
    if (it.type === 'shape') {
      const c = { x: it.x + it.w / 2, y: it.y + it.h / 2 };
      const lp = rotatePoint(pt, c, -(it.rotation || 0));
      const lx = lp.x - it.x;
      const ly = lp.y - it.y;
      if (it.shape === 'ellipse') {
        const rx = Math.max(it.w / 2, 1);
        const ry = Math.max(it.h / 2, 1);
        const nx = (lx - it.w / 2) / rx;
        const ny = (ly - it.h / 2) / ry;
        return nx * nx + ny * ny <= 1 + tol / Math.min(rx, ry);
      }
      if (it.shape === 'triangle') {
        return pointInPolygon(lp, [
          { x: it.x + it.w / 2, y: it.y }, { x: it.x + it.w, y: it.y + it.h }, { x: it.x, y: it.y + it.h }
        ]);
      }
      return lx >= -tol && ly >= -tol && lx <= it.w + tol && ly <= it.h + tol;
    }
    if (it.type === 'zone' || it.type === 'cone') {
      if (it.kind === 'cone' || it.type === 'cone') {
        const r = (it.w || 200) / 2;
        const d = Math.hypot(pt.x - it.x, pt.y - it.y);
        if (d > r + tol) return false;
        const a = Math.atan2(pt.y - it.y, pt.x - it.x);
        const delta = Math.abs(((a - ((it.dir || 0) + (it.rotation || 0)) + Math.PI * 3) % TAU) - Math.PI);
        return delta <= ((it.angle || 70) * Math.PI / 180) / 2 + 0.05;
      }
      return Math.hypot(pt.x - it.x, pt.y - it.y) <= Math.max(it.w, it.h) / 2 + tol;
    }
    if (it.type === 'stamp') {
      const s = (it.size || 64) / 2;
      return Math.abs(pt.x - it.x) <= s + tol && Math.abs(pt.y - it.y) <= s + tol;
    }
    if (it.type === 'text') {
      const b = this.itemBounds(it);
      return pt.x >= b.x - tol && pt.y >= b.y - tol && pt.x <= b.x + b.w + tol && pt.y <= b.y + b.h + tol;
    }
    if (it.type === 'wave') {
      const b = this.itemBounds(it);
      return pt.x >= b.x && pt.y >= b.y && pt.x <= b.x + b.w && pt.y <= b.y + b.h;
    }
    return false;
  }

  /* --------------------------- interaction ----------------------------- */

  onPointerDown(e) {
    if (!this.interactive) return;
    if (e.button === 1) {
      if (this.panEnabled) {
        this.canvas.setPointerCapture(e.pointerId);
        this.active = { type: 'pan', start: this.eventPoint(e), view: { ...this.view } };
        this.canvas.style.cursor = 'grabbing';
      }
      e.preventDefault();
      return;
    }
    if (e.button === 2) {
      if (this.route) { this.finishRoute(false); e.preventDefault(); return; }
      return;
    }
    if (e.button !== 0) return;
    if (this._editing) this.commitTextEdit();
    const screen = this.eventPoint(e);
    const world = this.screenToWorld(screen);
    this.lastPointer = screen;

    if (this.spaceDown && this.zoomable) {
      this.canvas.setPointerCapture(e.pointerId);
      this.active = { type: 'pan', start: screen, view: { ...this.view } };
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    const tool = this.style.tool;
    if (tool !== 'select' && this.selection.size) {
      this.selection.clear();
      this.emitSelection();
    }

    if (this.route && tool === 'route') {
      this.addRoutePoint(world);
      return;
    }

    if (tool === 'select') {
      this.beginSelect(screen, world, e.shiftKey, e);
      return;
    }

    if (tool === 'text') {
      this.startTextEdit(world);
      return;
    }

    if (tool === 'eraser') {
      this.canvas.setPointerCapture(e.pointerId);
      this.active = { type: 'erase', changed: false, last: world };
      this._eraseAt(world);
      return;
    }

    if (tool === 'stamp') {
      this.placeStamp(world);
      return;
    }

    if (tool === 'aoe') {
      const preset = (this.catalog.aoePresets || []).find((p) => p.id === this.style.aoeId) || this.catalog.aoePresets?.[0];
      if (!preset) return;
      const item = this.makeZone(world, preset);
      this.items.push(item);
      this.selection = new Set([item.id]);
      this.canvas.setPointerCapture(e.pointerId);
      this.active = { type: 'zoneDrag', item, start: world, changed: false };
      this.emitSelection();
      this.renderSoon();
      return;
    }

    if (tool === 'route') {
      this.startRoute(world);
      return;
    }

    if (['pen', 'pencil', 'marker', 'line', 'arrow', 'curve', 'circle', 'rect', 'triangle', 'hexagon', 'cone'].includes(tool)) {
      const item = this.makeDraft(tool, world);
      this.items.push(item);
      this.canvas.setPointerCapture(e.pointerId);
      this.active = { type: 'draw', tool, item, start: world, last: world, changed: false };
      this.renderSoon();
      return;
    }
  }

  beginSelect(screen, world, shift, e) {
    const sel = this.selectionBounds();
    if (sel && this.selection.size) {
      const handle = this.handleAt(screen, sel);
      if (handle) {
        this.canvas.setPointerCapture(e.pointerId);
        this.active = {
          type: handle === 'rotate' ? 'rotate' : 'scale',
          handle,
          start: world,
          startScreen: screen,
          bounds: { ...sel },
          startItems: this.selectedItems().map((it) => JSON.parse(JSON.stringify(it))),
          startAngle: this.angleToCenter(screen, sel),
          changed: false
        };
        return;
      }
    }
    const hit = this.hitTest(world, 8);
    if (hit) {
      if (shift) {
        if (this.selection.has(hit.id)) this.selection.delete(hit.id);
        else this.selection.add(hit.id);
      } else if (!this.selection.has(hit.id)) {
        this.selection = new Set([hit.id]);
      }
      this.emitSelection();
      this.renderSoon();
      this.canvas.setPointerCapture(e.pointerId);
      this.active = {
        type: 'move',
        start: world,
        startItems: this.selectedItems().map((it) => JSON.parse(JSON.stringify(it))),
        changed: false
      };
      return;
    }
    if (!shift) {
      this.selection.clear();
      this.emitSelection();
    }
    this.marquee = { start: world, current: world };
    this.canvas.setPointerCapture(e.pointerId);
    this.active = { type: 'marquee', additive: shift };
    this.renderSoon();
  }

  angleToCenter(screen, bounds) {
    const c = this.worldToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 });
    return Math.atan2(screen.y - c.y, screen.x - c.x);
  }

  handleAt(screen, bounds) {
    const c = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
    const corners = {
      nw: this.worldToScreen({ x: bounds.x, y: bounds.y }),
      ne: this.worldToScreen({ x: bounds.x + bounds.w, y: bounds.y }),
      sw: this.worldToScreen({ x: bounds.x, y: bounds.y + bounds.h }),
      se: this.worldToScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h })
    };
    for (const [k, p] of Object.entries(corners)) {
      if (Math.hypot(screen.x - p.x, screen.y - p.y) <= HANDLE + 5) return k;
    }
    const top = this.worldToScreen({ x: c.x, y: bounds.y });
    const rot = { x: top.x, y: top.y - ROT_OFFSET };
    if (Math.hypot(screen.x - rot.x, screen.y - rot.y) <= HANDLE + 6) return 'rotate';
    return null;
  }

  onPointerMove(e) {
    const screen = this.eventPoint(e);
    this.lastPointer = screen;
    this.hover = this.screenToWorld(screen);
    if (!this.active) {
      if (this.route) {
        this.route.preview = this.screenToWorld(screen);
        this.renderSoon();
      } else if (this.style.tool === 'eraser') {
        this.renderSoon();
      }
      return;
    }
    const world = this.screenToWorld(screen);
    const a = this.active;

    if (a.type === 'pan') {
      const dx = screen.x - a.start.x;
      const dy = screen.y - a.start.y;
      this.view.x = a.view.x + dx;
      this.view.y = a.view.y + dy;
      this.renderSoon();
      return;
    }

    if (a.type === 'draw') {
      if (a.tool === 'line' || a.tool === 'arrow' || a.tool === 'curve') {
        let end = world;
        if (e.shiftKey) {
          const dx = end.x - a.start.x;
          const dy = end.y - a.start.y;
          const ang = Math.atan2(dy, dx);
          const snap = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
          const d = Math.hypot(dx, dy);
          end = { x: a.start.x + Math.cos(snap) * d, y: a.start.y + Math.sin(snap) * d };
        }
        a.item.points[1] = end;
      } else if (a.tool === 'circle' || a.tool === 'rect' || a.tool === 'triangle' || a.tool === 'hexagon') {
        let dx = world.x - a.start.x;
        let dy = world.y - a.start.y;
        if (e.shiftKey) {
          const s = Math.max(Math.abs(dx), Math.abs(dy));
          dx = Math.sign(dx || 1) * s;
          dy = Math.sign(dy || 1) * s;
        }
        a.item.x = Math.min(a.start.x, a.start.x + dx);
        a.item.y = Math.min(a.start.y, a.start.y + dy);
        a.item.w = Math.abs(dx);
        a.item.h = Math.abs(dy);
      } else if (a.tool === 'cone') {
        const dx = world.x - a.start.x;
        const dy = world.y - a.start.y;
        a.item.dir = Math.atan2(dy, dx);
        a.item.w = Math.hypot(dx, dy) * 2;
        a.item.h = a.item.w;
      } else {
        const last = a.item.points[a.item.points.length - 1];
        if (Math.hypot(world.x - last.x, world.y - last.y) > 2 / this.view.scale) {
          a.item.points.push(world);
        }
      }
      a.changed = true;
      this.renderSoon();
      return;
    }

    if (a.type === 'zoneDrag') {
      const dx = world.x - a.start.x;
      const dy = world.y - a.start.y;
      const r = Math.max(12, Math.hypot(dx, dy));
      if (a.item.kind === 'cone') {
        a.item.w = r * 2;
        a.item.h = r * 2;
        a.item.dir = Math.atan2(dy, dx);
      } else {
        a.item.w = r * 2;
        a.item.h = r * 2;
      }
      a.changed = true;
      this.renderSoon();
      return;
    }

    if (a.type === 'erase') {
      this._eraseAt(world);
      return;
    }

    if (a.type === 'move') {
      let dx = world.x - a.start.x;
      let dy = world.y - a.start.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      this._applyStartItems(a.startItems, (it) => this._offsetItem(it, dx, dy));
      a.changed = Math.abs(dx) > 1 || Math.abs(dy) > 1;
      this.renderSoon();
      return;
    }

    if (a.type === 'marquee') {
      this.marquee.current = world;
      const b = {
        x: Math.min(this.marquee.start.x, world.x),
        y: Math.min(this.marquee.start.y, world.y),
        w: Math.abs(world.x - this.marquee.start.x),
        h: Math.abs(world.y - this.marquee.start.y)
      };
      const ids = [];
      for (const it of this.items) {
        const ib = this.itemBounds(it);
        if (ib.x < b.x + b.w && ib.x + ib.w > b.x && ib.y < b.y + b.h && ib.y + ib.h > b.y) ids.push(it.id);
      }
      if (a.additive) {
        this.selection = new Set([...this.selection, ...ids]);
      } else {
        this.selection = new Set(ids);
      }
      this.emitSelection();
      this.renderSoon();
      return;
    }

    if (a.type === 'scale') {
      const b = a.bounds;
      const anchor = {
        x: a.handle.includes('w') ? b.x + b.w : b.x,
        y: a.handle.includes('n') ? b.y + b.h : b.y
      };
      const sx = a.startScreen.x === 0 ? 1 : (screen.x - this.worldToScreen(anchor).x) / ((a.startScreen.x - this.worldToScreen(anchor).x) || 1);
      const sy = a.startScreen.y === 0 ? 1 : (screen.y - this.worldToScreen(anchor).y) / ((a.startScreen.y - this.worldToScreen(anchor).y) || 1);
      const fx = a.handle.includes('e') || a.handle.includes('w') ? clamp(sx, 0.05, 20) : 1;
      const fy = a.handle.includes('n') || a.handle.includes('s') ? clamp(sy, 0.05, 20) : 1;
      this._applyStartItems(a.startItems, (it) => this._scaleItem(it, anchor, fx, fy));
      a.changed = Math.abs(fx - 1) > 0.002 || Math.abs(fy - 1) > 0.002;
      this.renderSoon();
      return;
    }

    if (a.type === 'rotate') {
      const center = { x: a.bounds.x + a.bounds.w / 2, y: a.bounds.y + a.bounds.h / 2 };
      const angle = this.angleToCenter(screen, a.bounds);
      let delta = angle - a.startAngle;
      if (e.shiftKey) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
      this._applyStartItems(a.startItems, (it) => this._rotateItem(it, center, delta));
      a.changed = Math.abs(delta) > 0.005;
      this.renderSoon();
    }
  }

  onPointerUp(e) {
    if (!this.active) return;
    const a = this.active;
    if (a.type === 'pan') {
      this.active = null;
      this.updateCursor();
      return;
    }
    if (a.type === 'draw') {
      if (a.item.type === 'stroke' && a.item.points.length < 2) {
        // Um clique vira um ponto visível.
        const p = a.item.points[0];
        a.item.points.push({ x: p.x + 0.1, y: p.y + 0.1 });
      }
      if (!a.changed && a.item.type !== 'stroke') {
        this.items = this.items.filter((it) => it.id !== a.item.id);
      } else {
        this.commit();
      }
    } else if (a.type === 'zoneDrag') {
      this.commit();
    } else if (a.type === 'erase') {
      if (a.changed) this.commit();
    } else if (a.type === 'move' || a.type === 'scale' || a.type === 'rotate') {
      if (a.changed) this.commit();
    } else if (a.type === 'marquee') {
      this.marquee = null;
      this.renderSoon();
    }
    this.active = null;
    this.updateCursor();
    this.renderSoon();
  }

  _applyStartItems(startItems, fn) {
    const map = new Map(startItems.map((it) => [it.id, it]));
    for (const it of this.items) {
      const src = map.get(it.id);
      if (!src) continue;
      const copy = JSON.parse(JSON.stringify(src));
      fn(copy);
      Object.assign(it, copy);
    }
  }

  _scaleItem(it, anchor, fx, fy) {
    const scalePoint = (p) => ({ x: anchor.x + (p.x - anchor.x) * fx, y: anchor.y + (p.y - anchor.y) * fy });
    if (it.points) it.points = it.points.map(scalePoint);
    if (it.type === 'shape') {
      const x2 = anchor.x + (it.x + it.w - anchor.x) * fx;
      const y2 = anchor.y + (it.y + it.h - anchor.y) * fy;
      it.x = anchor.x + (it.x - anchor.x) * fx;
      it.y = anchor.y + (it.y - anchor.y) * fy;
      it.w = Math.max(MIN_SIZE, Math.abs(x2 - it.x));
      it.h = Math.max(MIN_SIZE, Math.abs(y2 - it.y));
    } else if (it.type === 'zone' || it.type === 'wave' || it.type === 'cone') {
      it.x = anchor.x + (it.x - anchor.x) * fx;
      it.y = anchor.y + (it.y - anchor.y) * fy;
      if (it.type === 'wave') it.size = Math.max(18, (it.size || 54) * Math.sqrt(Math.abs(fx * fy)));
      else { it.w = Math.max(16, (it.w || 100) * Math.abs(fx)); it.h = Math.max(16, (it.h || 100) * Math.abs(fy)); }
    } else if (it.type === 'stamp') {
      it.x = anchor.x + (it.x - anchor.x) * fx;
      it.y = anchor.y + (it.y - anchor.y) * fy;
      it.size = Math.max(20, (it.size || 64) * Math.sqrt(Math.abs(fx * fy)));
    } else if (it.type === 'text') {
      it.x = anchor.x + (it.x - anchor.x) * fx;
      it.y = anchor.y + (it.y - anchor.y) * fy;
      it.size = Math.max(10, (it.size || 32) * Math.abs(fy));
    }
  }

  _rotateItem(it, center, delta) {
    if (it.points) it.points = it.points.map((p) => rotatePoint(p, center, delta));
    if (it.type === 'stamp' || it.type === 'shape' || it.type === 'text' || it.type === 'zone' || it.type === 'cone') {
      it.rotation = (it.rotation || 0) + delta;
      if (it.type === 'stamp' || it.type === 'text') {
        const p = rotatePoint({ x: it.x, y: it.y }, center, delta);
        it.x = p.x; it.y = p.y;
      } else if (it.type === 'zone' || it.type === 'shape' || it.type === 'cone') {
        const c = it.type === 'shape' ? { x: it.x + it.w / 2, y: it.y + it.h / 2 } : { x: it.x, y: it.y };
        const p = rotatePoint(c, center, delta);
        if (it.type === 'shape') { it.x = p.x - it.w / 2; it.y = p.y - it.h / 2; }
        else { it.x = p.x; it.y = p.y; }
      }
    }
  }

  _eraseAt(pt) {
    const radius = (this.style.width || 4) * 1.6 + 6;
    let removed = false;
    const kept = [];
    for (const it of this.items) {
      const b = this.itemBounds(it);
      const cx = clamp(pt.x, b.x, b.x + b.w);
      const cy = clamp(pt.y, b.y, b.y + b.h);
      const near = Math.hypot(pt.x - cx, pt.y - cy) <= radius;
      if (near && (this._hitItem(it, pt, radius) || this._hitItem(it, { x: cx, y: cy }, 2))) removed = true;
      else kept.push(it);
    }
    if (removed) {
      this.items = kept;
      this.selection.clear();
      this.emitSelection();
      this.active.changed = true;
      this.renderSoon();
    }
  }

  /* ------------------------------ creation ---------------------------- */

  baseStyle() {
    return {
      color: this.style.color,
      width: this.style.width,
      opacity: this.style.opacity,
      arrowStyle: this.style.arrowStyle,
      lineStyle: this.style.lineStyle || 'solid',
      dash: this.dashFor(this.style.lineStyle || 'solid')
    };
  }

  makeDraft(tool, p) {
    const base = this.baseStyle();
    const it = { id: makeId(), ...base, ttl: null, bornAt: null };
    if (this.style.fade) {
      it.ttl = Math.max(0.5, Number(this.style.fadeSeconds) || 4);
      it.bornAt = performance.now();
    }
    if (tool === 'pen' || tool === 'pencil' || tool === 'marker') {
      it.type = 'stroke';
      it.tool = tool;
      it.points = [{ x: p.x, y: p.y }];
      if (tool === 'marker') { it.width = Math.max(14, base.width * 3.2); it.opacity = Math.min(base.opacity, 0.5); it.lineCap = 'round'; }
      if (tool === 'pencil') { it.width = Math.max(1.5, base.width * 0.7); it.opacity = Math.min(base.opacity, 0.85); }
      return it;
    }
    if (tool === 'line') {
      it.type = 'line';
      it.points = [{ ...p }, { ...p }];
      return it;
    }
    if (tool === 'arrow' || tool === 'curve') {
      it.type = 'arrow';
      it.curve = tool === 'curve';
      it.points = [{ ...p }, { ...p }];
      return it;
    }
    if (tool === 'circle' || tool === 'rect' || tool === 'triangle' || tool === 'hexagon') {
      it.type = 'shape';
      it.shape = tool;
      it.x = p.x; it.y = p.y; it.w = 0; it.h = 0;
      it.rotation = 0;
      it.fill = tool === 'circle' ? 0.05 : 0;
      it.dash = base.dash;
      return it;
    }
    if (tool === 'cone') {
      it.type = 'cone';
      it.x = p.x; it.y = p.y; it.w = 0; it.h = 0;
      it.dir = 0; it.angle = 70; it.rotation = 0;
      it.fill = 0.12;
      it.dash = base.dash;
      return it;
    }
    return it;
  }

  makeZone(p, preset) {
    const it = {
      id: makeId(), type: 'zone',
      kind: preset.kind === 'cone' ? 'cone' : 'circle',
      x: p.x, y: p.y,
      w: preset.kind === 'cone' ? (preset.size || 300) * 2 : preset.size || 260,
      h: preset.size || 260,
      angle: preset.angle || 70,
      dir: -Math.PI / 2,
      rotation: 0,
      color: preset.color || this.style.color,
      width: Math.max(2, this.style.width * 0.75),
      opacity: Math.min(0.95, this.style.opacity),
      fill: preset.fill ?? 0.12,
      dash: preset.dash || [],
      label: null,
      ttl: null, bornAt: null
    };
    if (it.kind === 'cone') it.h = it.w;
    if (this.style.fade) { it.ttl = Math.max(0.5, Number(this.style.fadeSeconds) || 4); it.bornAt = performance.now(); }
    return it;
  }

  placeStamp(p) {
    const stamp = this.resolveStamp();
    if (!stamp) return;
    const it = {
      id: makeId(),
      type: stamp.type === 'wave' ? 'wave' : 'stamp',
      x: p.x, y: p.y,
      size: stamp.type === 'wave' ? Math.round((this.style.stampSize || 64) * 1.15) : (this.style.stampSize || 64),
      rotation: 0,
      team: stamp.team || this.style.stampTeam || 'ally',
      preset: stamp.preset || 'freeze',
      stamp,
      label: stamp.label || null,
      color: this.style.color,
      opacity: this.style.opacity,
      width: 2,
      ttl: null, bornAt: null
    };
    if (this.style.fade) { it.ttl = Math.max(0.5, Number(this.style.fadeSeconds) || 4); it.bornAt = performance.now(); }
    this.items.push(it);
    this.selection = new Set([it.id]);
    this.emitSelection();
    this.commit();
  }

  resolveStamp() {
    const id = this.style.stampId;
    if (!id) return null;
    if (id.startsWith('champ:')) {
      const file = id.slice(6);
      return { type: 'champion', img: `champions/${file}.png`, label: this.style.stampLabel || file };
    }
    const s = (this.catalog.stamps || []).find((x) => x.id === id);
    if (!s) return null;
    return {
      type: s.vector || (s.img ? 'image' : 'icon'),
      img: s.img || null,
      vector: s.vector || null,
      ping: s.ping || null,
      role: s.role || null,
      glyph: s.glyph || null,
      team: s.team || null,
      label: s.name,
      cat: s.cat,
      preset: s.id?.startsWith('wave') ? 'freeze' : null
    };
  }

  /* ------------------------------- routes ----------------------------- */

  startRoute(p) {
    const base = this.baseStyle();
    this.route = {
      points: [{ ...p }],
      preview: { ...p },
      color: base.color,
      width: base.width,
      opacity: base.opacity,
      arrowStyle: base.arrowStyle,
      ttl: this.style.fade ? Math.max(0.5, Number(this.style.fadeSeconds) || 4) : null,
      bornAt: this.style.fade ? performance.now() : null
    };
    this.renderSoon();
  }

  addRoutePoint(p) {
    if (!this.route) return;
    this.route.points.push({ ...p });
    this.route.preview = { ...p };
    this.renderSoon();
  }

  finishRoute(commit = true) {
    if (!this.route) return;
    const r = this.route;
    this.route = null;
    if (commit && r.points.length >= 2) {
      const it = {
        id: makeId(),
        type: 'route',
        points: r.points,
        color: r.color,
        width: r.width,
        opacity: r.opacity,
        arrowStyle: r.arrowStyle,
        ttl: r.ttl,
        bornAt: r.bornAt
      };
      this.items.push(it);
      this.selection = new Set([it.id]);
      this.emitSelection();
      this.commit();
    }
    this.renderSoon();
  }

  /* ------------------------------ text -------------------------------- */

  startTextEdit(world, existing = null) {
    if (this._editing) this.commitTextEdit();
    const size = existing?.size || this.style.textSize || 38;
    const canvasRect = this.canvas.getBoundingClientRect();
    const screen = this.worldToScreen({ x: world.x, y: world.y });
    screen.x += canvasRect.left;
    screen.y += canvasRect.top;
    const ta = document.createElement('textarea');
    ta.className = 'nx-text-editor';
    ta.value = existing?.text || '';
    ta.placeholder = 'Digite o texto…';
    ta.spellcheck = false;
    const color = existing?.color || this.style.color;
    const scale = this.view.scale || 1;
    Object.assign(ta.style, {
      position: 'fixed',
      left: `${Math.max(4, screen.x)}px`,
      top: `${Math.max(4, screen.y)}px`,
      minWidth: '160px',
      width: `${Math.max(220, (existing ? this.measureText(existing).w * scale + 40 : 280))}px`,
      minHeight: `${Math.max(36, size * scale * 1.3)}px`,
      height: 'auto',
      padding: '6px 9px',
      border: `1px solid ${color}88`,
      borderRadius: '6px',
      background: 'rgba(5,8,13,0.92)',
      color,
      font: `650 ${Math.max(13, size * scale)}px Inter, Segoe UI, sans-serif`,
      lineHeight: '1.22',
      resize: 'none',
      outline: 'none',
      zIndex: '9999',
      boxShadow: '0 8px 28px rgba(0,0,0,.55)',
      overflow: 'hidden',
      caretColor: color
    });
    this.textLayer.appendChild(ta);

    const auto = () => {
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    };
    ta.addEventListener('input', auto);

    const state = { ta, world: { ...world }, existing, cancelled: false };
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        state.cancelled = true;
        this.commitTextEdit();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.commitTextEdit();
      }
    });
    ta.addEventListener('blur', () => {
      // Pequeno atraso evita commitar ao clicar em controles do overlay.
      setTimeout(() => { if (this._editing === state) this.commitTextEdit(); }, 120);
    });
    this._editing = state;
    requestAnimationFrame(() => { ta.focus(); auto(); ta.select(); });
    this.renderSoon();
  }

  commitTextEdit() {
    const state = this._editing;
    if (!state) return;
    this._editing = null;
    const { ta, world, existing, cancelled } = state;
    const text = ta.value.trim();
    ta.remove();
    if (cancelled) { this.renderSoon(); return; }
    if (!text) {
      if (existing) {
        this.items = this.items.filter((it) => it.id !== existing.id);
        this.selection.clear();
        this.emitSelection();
        this.commit();
      } else this.renderSoon();
      return;
    }
    if (existing) {
      existing.text = text;
      // Se o texto cresceu, mantém a âncora.
      this.commit();
    } else {
      const it = {
        id: makeId(), type: 'text', x: world.x, y: world.y, text,
        size: this.style.textSize || 38,
        color: this.style.color,
        opacity: this.style.opacity,
        weight: 650,
        rotation: 0,
        ttl: this.style.fade ? Math.max(0.5, Number(this.style.fadeSeconds) || 4) : null,
        bornAt: this.style.fade ? performance.now() : null
      };
      this.items.push(it);
      this.selection = new Set([it.id]);
      this.emitSelection();
      this.commit();
    }
    this.renderSoon();
  }

  cancelTextEdit() {
    if (!this._editing) return;
    this._editing.cancelled = true;
    this.commitTextEdit();
  }

  editSelectedText() {
    const it = this.selectedItems().find((x) => x.type === 'text');
    if (it) {
      this.selection.delete(it.id);
      this.startTextEdit({ x: it.x, y: it.y }, it);
      return true;
    }
    return false;
  }

  /* ------------------------------ wheel ------------------------------- */

  onWheel(e) {
    e.preventDefault();
    if (this.zoomable) {
      const factor = Math.pow(1.0018, -e.deltaY);
      this.zoomAt(this.eventPoint(e).x, this.eventPoint(e).y, factor);
      return;
    }
    if (!this.interactive) return;
    const dir = Math.sign(e.deltaY);
    const next = clamp((this.style.width || 4) - dir, 1, 60);
    this.style.width = next;
    this.opts.onBrushSize?.(next);
    this.renderSoon();
  }

  /* ------------------------------ render ------------------------------ */

  renderSoon() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this.render();
    });
  }

  pruneExpired() {
    if (!this.items.some((it) => it.ttl)) return false;
    const now = performance.now();
    const before = this.items.length;
    this.items = this.items.filter((it) => !it.ttl || !it.bornAt || (now - it.bornAt) / 1000 < it.ttl);
    const changed = this.items.length !== before;
    if (changed) {
      for (const id of [...this.selection]) {
        if (!this.items.some((it) => it.id === id)) this.selection.delete(id);
      }
      this.emitSelection();
    }
    return changed;
  }

  itemAlpha(it) {
    if (!it.ttl || !it.bornAt) return 1;
    const elapsed = (performance.now() - it.bornAt) / 1000;
    const remaining = it.ttl - elapsed;
    if (remaining <= 0) return 0;
    const fadeDur = Math.min(0.9, it.ttl * 0.35);
    return remaining < fadeDur ? remaining / fadeDur : 1;
  }

  render() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.hidden) {
      this.pruneExpired();
      const bg = this.background;
      if (this.mode === 'board') {
        ctx.fillStyle = '#070b11';
        ctx.fillRect(0, 0, this.w, this.h);
      }
      ctx.save();
      ctx.translate(this.view.x, this.view.y);
      ctx.scale(this.view.scale, this.view.scale);
      if (this.mode === 'board') this.renderBackground(ctx);
      const globalAlpha = clamp(this.style.globalOpacity ?? 1, 0.05, 1);
      for (const it of this.items) {
        const alpha = this.itemAlpha(it) * globalAlpha;
        if (alpha <= 0.01) continue;
        this.drawItem(ctx, it, alpha);
      }
      if (this.route) this.drawRoutePreview(ctx);
      if (this.marquee) this.drawMarquee(ctx);
      ctx.restore();
      if (!this.hidden && this.showSelection) this.drawSelection(ctx);
      if (this.style.tool === 'eraser' && this.interactive && this.hover) this.drawEraserCursor(ctx);
    }
    if (this.items.some((it) => it.ttl && it.bornAt)) {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = setTimeout(() => this.renderSoon(), 140);
    }
  }

  renderBackground(ctx) {
    const bg = this.background;
    if (bg.mode !== 'dark') {
      if (bg.image && bg.image.complete && bg.image.naturalWidth) {
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.filter = `brightness(${bg.brightness || 1})`;
        ctx.drawImage(bg.image, 0, 0, this.mapW, this.mapH);
        ctx.filter = 'none';
        ctx.restore();
      } else {
        ctx.fillStyle = '#0b111a';
        ctx.fillRect(0, 0, this.mapW, this.mapH);
      }
    } else {
      ctx.fillStyle = '#0a1018';
      ctx.fillRect(0, 0, this.mapW, this.mapH);
      if (bg.image && bg.image.complete) {
        ctx.save();
        ctx.globalAlpha = 0.14;
        ctx.filter = 'saturate(0.3) brightness(1.6)';
        ctx.drawImage(bg.image, 0, 0, this.mapW, this.mapH);
        ctx.filter = 'none';
        ctx.restore();
      }
    }
    if (bg.grid) {
      ctx.save();
      ctx.strokeStyle = 'rgba(120,160,200,0.13)';
      ctx.lineWidth = 1.5 / this.view.scale;
      const step = 220;
      for (let x = 0; x <= this.mapW; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.mapH); ctx.stroke();
      }
      for (let y = 0; y <= this.mapH; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.mapW, y); ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawItem(ctx, it, alpha) {
    ctx.save();
    ctx.globalAlpha = clamp(alpha * (it.opacity ?? 1), 0, 1);
    switch (it.type) {
      case 'stroke': this.drawStroke(ctx, it); break;
      case 'line': this.drawLine(ctx, it); break;
      case 'arrow': this.drawArrow(ctx, it); break;
      case 'route': this.drawRoute(ctx, it); break;
      case 'shape': this.drawShape(ctx, it); break;
      case 'cone': this.drawConeItem(ctx, it); break;
      case 'zone': this.drawZone(ctx, it); break;
      case 'stamp': this.drawStamp(ctx, it); break;
      case 'text': this.drawText(ctx, it); break;
      case 'wave': this.drawWave(ctx, it); break;
      default: break;
    }
    ctx.restore();
  }

  drawStroke(ctx, it) {
    const pts = it.points || [];
    if (!pts.length) return;
    ctx.strokeStyle = it.color;
    ctx.fillStyle = it.color;
    ctx.lineWidth = it.width || 4;
    ctx.lineCap = it.lineCap || 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(it.dash || []);
    if (it.tool === 'pencil') ctx.globalAlpha *= 0.92;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, Math.max(1, (it.width || 4) / 2), 0, TAU);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    smoothPath(ctx, pts);
    ctx.stroke();
  }

  drawLine(ctx, it) {
    const [a, b] = it.points || [];
    if (!a || !b) return;
    ctx.strokeStyle = it.color;
    ctx.lineWidth = it.width || 4;
    ctx.lineCap = 'round';
    ctx.setLineDash(it.dash || []);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  arrowStyle(it) {
    return (this.catalog.arrowStyles || []).find((s) => s.id === (it.arrowStyle || this.style.arrowStyle)) || {
      dash: [], head: 'solid', glow: false
    };
  }

  drawArrow(ctx, it) {
    const pts = it.points || [];
    if (!pts.length) return;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const style = this.arrowStyle(it);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const nx = -dy / len;
    const ny = dx / len;
    const curve = it.curve ? Math.min(len * 0.24, 180) : 0;
    const cp = { x: mid.x + nx * curve, y: mid.y + ny * curve };
    const headLen = Math.max(14, (it.width || 4) * 3.1);
    const angle = Math.atan2(b.y - cp.y, b.x - cp.x);

    ctx.strokeStyle = it.color;
    ctx.fillStyle = it.color;
    ctx.lineWidth = it.width || 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(style.dash || []);
    if (style.glow) {
      ctx.shadowColor = it.color;
      ctx.shadowBlur = 10;
    }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if (curve) ctx.quadraticCurveTo(cp.x, cp.y, b.x, b.y);
    else ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    this.drawArrowHead(ctx, b, angle, headLen, it.width || 4, style.head, it.color);
    if (style.head === 'double') {
      const back = headLen * 1.65;
      this.drawArrowHead(ctx, { x: b.x - Math.cos(angle) * back, y: b.y - Math.sin(angle) * back }, angle, headLen * 0.72, it.width || 4, 'open', it.color);
    }
    if (style.head === 'dot') {
      ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(3, (it.width || 4) * 0.6), 0, TAU); ctx.fill();
    }
  }

  drawArrowHead(ctx, tip, angle, len, width, kind = 'solid', color) {
    const w = Math.max(6, width * 1.9);
    const p1 = { x: tip.x - Math.cos(angle - 0.55) * len, y: tip.y - Math.sin(angle - 0.55) * len };
    const p2 = { x: tip.x - Math.cos(angle + 0.55) * len, y: tip.y - Math.sin(angle + 0.55) * len };
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(2, width * 0.75);
    ctx.lineCap = 'round';
    if (kind === 'open') {
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(tip.x, tip.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    } else {
      const base = { x: tip.x - Math.cos(angle) * len * 0.35, y: tip.y - Math.sin(angle) * len * 0.35 };
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(base.x + Math.cos(angle + Math.PI / 2) * w, base.y + Math.sin(angle + Math.PI / 2) * w);
      ctx.lineTo(base.x - Math.cos(angle + Math.PI / 2) * w, base.y - Math.sin(angle + Math.PI / 2) * w);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawRoute(ctx, it) {
    const pts = it.points || [];
    if (pts.length < 2) return;
    const style = this.arrowStyle(it);
    ctx.strokeStyle = it.color;
    ctx.fillStyle = it.color;
    ctx.lineWidth = it.width || 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(style.dash || []);
    if (style.glow) { ctx.shadowColor = it.color; ctx.shadowBlur = 11; }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    smoothPath(ctx, pts);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    const b = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const angle = Math.atan2(b.y - prev.y, b.x - prev.x);
    this.drawArrowHead(ctx, b, angle, Math.max(15, (it.width || 4) * 3.2), it.width || 4, style.head, it.color);
    // marcadores de waypoint
    if (pts.length <= 14) {
      for (let i = 0; i < pts.length - 1; i++) {
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, Math.max(2.5, (it.width || 4) * 0.45), 0, TAU);
        ctx.fill();
      }
    }
  }

  drawRoutePreview(ctx) {
    const r = this.route;
    if (!r) return;
    const pts = [...r.points, r.preview];
    if (pts.length < 2) return;
    const style = this.arrowStyle({ arrowStyle: r.arrowStyle });
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.width || 4;
    ctx.lineCap = 'round';
    ctx.setLineDash(style.dash || []);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    smoothPath(ctx, pts);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < pts.length - 1; i++) {
      ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, Math.max(2.5, (r.width || 4) * 0.45), 0, TAU); ctx.fillStyle = r.color; ctx.fill();
    }
    ctx.restore();
  }

  drawShape(ctx, it) {
    const cx = it.x + it.w / 2;
    const cy = it.y + it.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(it.rotation || 0);
    ctx.translate(-cx, -cy);
    ctx.strokeStyle = it.color;
    ctx.fillStyle = hexToRgba(it.color, it.fill ?? 0.05);
    ctx.lineWidth = it.width || 4;
    ctx.setLineDash(it.dash || []);
    ctx.lineJoin = 'round';
    if (it.shape === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(Math.abs(it.w) / 2, 0.5), Math.max(Math.abs(it.h) / 2, 0.5), 0, 0, TAU);
      if (it.fill) ctx.fill();
      ctx.stroke();
    } else if (it.shape === 'triangle') {
      ctx.beginPath();
      ctx.moveTo(cx, it.y);
      ctx.lineTo(it.x + it.w, it.y + it.h);
      ctx.lineTo(it.x, it.y + it.h);
      ctx.closePath();
      if (it.fill) ctx.fill();
      ctx.stroke();
    } else if (it.shape === 'hexagon') {
      const r = Math.min(Math.abs(it.w), Math.abs(it.h)) / 2;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 6;
        const x = cx + Math.cos(a) * (it.w / 2);
        const y = cy + Math.sin(a) * (it.h / 2);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      if (it.fill) ctx.fill();
      ctx.stroke();
    } else {
      roundRect(ctx, it.x, it.y, Math.max(1, it.w), Math.max(1, it.h), Math.min(6, it.w / 8));
      if (it.fill) ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  drawConeShape(ctx, cx, cy, r, dir, angleDeg, color, fill, width, dash, label) {
    const spread = (angleDeg * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, dir - spread / 2, dir + spread / 2);
    ctx.closePath();
    ctx.fillStyle = hexToRgba(color, fill ?? 0.12);
    ctx.fill();
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 3;
    ctx.stroke();
    ctx.setLineDash([]);
    if (label) {
      ctx.fillStyle = hexToRgba(color, 0.9);
      ctx.font = `700 ${Math.max(12, r * 0.09)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      const lx = cx + Math.cos(dir) * r * 0.55;
      const ly = cy + Math.sin(dir) * r * 0.55;
      ctx.fillText(label, lx, ly);
      ctx.textAlign = 'left';
    }
  }

  drawConeItem(ctx, it) {
    const r = Math.max(Math.abs(it.w) / 2, 1);
    const angleDeg = it.angle || 70;
    const dir = (it.dir || 0) + (it.rotation || 0);
    ctx.save();
    ctx.setLineDash(it.dash || []);
    this.drawConeShape(ctx, it.x, it.y, r, dir, angleDeg, it.color, it.fill ?? 0.12, it.width || 4, it.dash || []);
    ctx.restore();
  }

  drawZone(ctx, it) {
    ctx.save();
    if (it.kind === 'cone') {
      this.drawConeShape(ctx, it.x, it.y, it.w / 2, (it.dir || 0) + (it.rotation || 0), it.angle || 70, it.color, it.fill, it.width, it.dash, it.label);
    } else {
      ctx.translate(it.x, it.y);
      ctx.rotate(it.rotation || 0);
      ctx.beginPath();
      ctx.ellipse(0, 0, Math.max(it.w / 2, 0.5), Math.max(it.h / 2, 0.5), 0, 0, TAU);
      ctx.fillStyle = hexToRgba(it.color, it.fill ?? 0.12);
      ctx.fill();
      ctx.strokeStyle = it.color;
      ctx.lineWidth = it.width || 3;
      ctx.setLineDash(it.dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
      // Marca central sutil
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, TAU);
      ctx.fillStyle = hexToRgba(it.color, 0.85);
      ctx.fill();
      if (it.label) {
        ctx.font = `700 ${Math.max(12, it.w * 0.06)}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = hexToRgba(it.color, 0.9);
        ctx.fillText(it.label, 0, it.h / 2 + Math.max(16, it.w * 0.07));
        ctx.textAlign = 'left';
      }
    }
    ctx.restore();
  }

  teamColor(team) {
    if (team === 'enemy' || team === 'red') return '#FF4D5E';
    if (team === 'ally' || team === 'blue') return '#3FC7FF';
    return '#C8AA6E';
  }

  drawStamp(ctx, it) {
    const s = it.size || 64;
    const stamp = it.stamp || {};
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(it.rotation || 0);
    const teamColor = this.teamColor(it.team);
    const showLabel = it.label && this.style.showLabels !== false;

    if (stamp.type === 'champion') {
      const img = this.getImage(stamp.img);
      // halo de time
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.54, 0, TAU);
      ctx.fillStyle = 'rgba(4,8,14,0.72)';
      ctx.fill();
      ctx.lineWidth = Math.max(2.5, s * 0.055);
      ctx.strokeStyle = teamColor;
      ctx.shadowColor = teamColor;
      ctx.shadowBlur = s * 0.12;
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (img && img.complete && img.naturalWidth) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, s * 0.47, 0, TAU);
        ctx.clip();
        ctx.drawImage(img, -s / 2, -s / 2, s, s);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(0, 0, s * 0.45, 0, TAU);
        ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fill();
      }
      if (showLabel) this.drawStampLabel(ctx, stamp.label, s, teamColor, s * 0.62);
    } else if (stamp.type === 'wave') {
      this.drawWaveShape(ctx, 0, 0, s, it.team, it.stamp?.preset || 'freeze');
    } else if (stamp.vector === 'ping') {
      this.drawPing(ctx, stamp.ping, s);
    } else if (stamp.vector === 'role') {
      this.drawRole(ctx, stamp.role, s, it.team);
    } else if (stamp.vector === 'minion') {
      this.drawMinion(ctx, 0, 0, s * 0.23, stamp.team || it.team);
    } else if (stamp.vector === 'wave') {
      this.drawWaveShape(ctx, 0, 0, s, stamp.team || it.team, 'freeze');
    } else if (stamp.vector === 'eye') {
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.36, s * 0.22, 0, 0, TAU);
      ctx.fillStyle = 'rgba(10,200,185,.16)';
      ctx.fill();
      ctx.strokeStyle = '#0AC8B9'; ctx.lineWidth = Math.max(2, s * 0.04); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, s * 0.09, 0, TAU); ctx.fillStyle = '#3FF0E0'; ctx.fill();
    } else if (stamp.vector === 'scuttle') {
      this.drawScuttle(ctx, s);
    } else if (stamp.vector === 'camp') {
      ctx.beginPath(); ctx.arc(0, 0, s * 0.36, 0, TAU);
      ctx.fillStyle = 'rgba(200,170,110,.12)'; ctx.fill();
      ctx.strokeStyle = '#C8AA6E'; ctx.lineWidth = Math.max(2, s * .035); ctx.stroke();
      ctx.fillStyle = '#E8D5A5';
      ctx.font = `700 ${s * 0.36}px Rajdhani, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(stamp.glyph || 'C', 0, 1);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      if (showLabel) this.drawStampLabel(ctx, stamp.label, s, teamColor, s * 0.4);
    } else if (stamp.img) {
      const img = this.getImage(stamp.img);
      // base circular
      ctx.beginPath(); ctx.arc(0, 0, s * 0.46, 0, TAU);
      ctx.fillStyle = 'rgba(4,8,14,0.62)'; ctx.fill();
      ctx.strokeStyle = teamColor; ctx.lineWidth = Math.max(2, s * 0.035); ctx.stroke();
      if (img && img.complete && img.naturalWidth) {
        ctx.drawImage(img, -s * 0.38, -s * 0.38, s * 0.76, s * 0.76);
      }
      if (showLabel) this.drawStampLabel(ctx, stamp.label, s, teamColor, s * 0.62);
    }
    ctx.restore();
  }

  drawStampLabel(ctx, text, s, color, offset) {
    ctx.save();
    ctx.font = `650 ${Math.max(9, s * 0.16)}px Inter, sans-serif`;
    const w = ctx.measureText(text).width + s * 0.24;
    const h = Math.max(13, s * 0.22);
    const y = offset;
    ctx.fillStyle = 'rgba(4,8,14,.85)';
    roundRect(ctx, -w / 2, y, w, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = hexToRgba(color, 0.35);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#E9EFF7';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, y + h / 2 + 0.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  drawPing(ctx, kind, s) {
    const colors = {
      danger: '#FF4D5E', missing: '#FFD166', assist: '#28E0A0',
      omw: '#3FC7FF', vision: '#A78BFA', push: '#FF8A3D'
    };
    const color = colors[kind] || '#FFD166';
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, s * 0.38, 0, TAU);
    ctx.fillStyle = 'rgba(5,8,13,.82)'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, s * 0.05);
    ctx.shadowColor = color; ctx.shadowBlur = s * 0.18;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const glyph = { danger: '!', missing: '?', assist: '+', omw: '»', vision: '◉', push: '⇈' }[kind] || '!';
    ctx.font = `800 ${s * 0.5}px Rajdhani, Inter, sans-serif`;
    ctx.fillText(glyph, 0, s * 0.02);
    if (kind === 'omw') {
      ctx.beginPath(); ctx.arc(0, 0, s * 0.2, 0, TAU); ctx.lineWidth = Math.max(1.5, s * .03); ctx.strokeStyle = color; ctx.stroke();
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  drawRole(ctx, role, s, team) {
    const size = s * 0.78;
    const color = this.teamColor(team);
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i * TAU) / 6;
      const x = Math.cos(a) * size * 0.55;
      const y = Math.sin(a) * size * 0.55;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = hexToRgba(color, 0.16);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.8, s * 0.038);
    ctx.shadowColor = color;
    ctx.shadowBlur = s * 0.08;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(0, -size * 0.47, Math.max(2, s * 0.045), 0, TAU);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = team === 'enemy' || team === 'red' ? '#FFD6DB' : team === 'ally' || team === 'blue' ? '#CFF2FF' : '#F0DCA6';
    ctx.font = `700 ${s * 0.27}px Rajdhani, Inter, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(role, 0, 1);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  drawMinion(ctx, x, y, r, team) {
    const c = team === 'red' || team === 'enemy' ? '#FF4D5E' : '#3FC7FF';
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(0, r * 0.8, r * 0.85, r * 0.32, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0c1420';
    ctx.strokeStyle = c;
    ctx.lineWidth = Math.max(1, r * 0.22);
    ctx.beginPath();
    ctx.roundRect(-r * 0.62, -r * 0.5, r * 1.24, r * 1.35, r * 0.32);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = hexToRgba(c, 0.8);
    ctx.beginPath(); ctx.arc(0, -r * 0.55, r * 0.38, 0, TAU); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.65, r * 0.1); ctx.lineTo(-r * 1.1, -r * 0.5);
    ctx.moveTo(r * 0.65, r * 0.1); ctx.lineTo(r * 1.1, -r * 0.5);
    ctx.strokeStyle = c; ctx.lineWidth = Math.max(1, r * 0.16); ctx.stroke();
    ctx.restore();
  }

  drawWaveShape(ctx, x, y, s, team, preset) {
    ctx.save();
    ctx.translate(x, y);
    const color = team === 'red' || team === 'enemy' ? '#FF4D5E' : '#3FC7FF';
    const gap = preset === 'freeze' ? 0.2 : preset === 'fastpush' ? 0.52 : 0.36;
    const rows = [
      { n: 3, type: 'melee', dy: -s * 0.18 },
      { n: 3, type: 'caster', dy: s * 0.02 },
      { n: 1, type: 'cannon', dy: s * 0.24 }
    ];
    for (const row of rows) {
      for (let i = 0; i < row.n; i++) {
        const px = (i - (row.n - 1) / 2) * s * gap;
        this.drawMinion(ctx, px, row.dy + (preset === 'slowpush' ? (i % 2) * s * 0.03 : 0), row.type === 'cannon' ? s * 0.1 : s * 0.082, team);
      }
    }
    ctx.fillStyle = hexToRgba(color, 0.85);
    ctx.font = `700 ${Math.max(10, s * 0.13)}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    const label = { freeze: 'CONGELAR', slowpush: 'PUSH LENTO', fastpush: 'PUSH RÁPIDO' }[preset] || '';
    ctx.fillText(label, 0, -s * 0.4);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  drawWave(ctx, it) {
    this.drawWaveShape(ctx, it.x, it.y, it.size || 54, it.team, it.preset || 'freeze');
  }

  drawScuttle(ctx, s) {
    ctx.save();
    ctx.strokeStyle = '#C8AA6E';
    ctx.lineWidth = Math.max(2, s * 0.04);
    ctx.fillStyle = 'rgba(200,170,110,.14)';
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.34, s * 0.26, 0, 0, TAU); ctx.fill(); ctx.stroke();
    for (let i = -1; i <= 1; i += 2) {
      ctx.beginPath();
      ctx.moveTo(i * s * 0.28, -s * 0.12);
      ctx.lineTo(i * s * 0.5, -s * 0.34);
      ctx.moveTo(i * s * 0.33, 0);
      ctx.lineTo(i * s * 0.56, -s * 0.04);
      ctx.moveTo(i * s * 0.28, s * 0.13);
      ctx.lineTo(i * s * 0.5, s * 0.34);
      ctx.stroke();
    }
    ctx.fillStyle = '#F0DCA6';
    ctx.beginPath(); ctx.arc(-s * 0.1, -s * 0.06, s * 0.035, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(s * 0.1, -s * 0.06, s * 0.035, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawText(ctx, it) {
    const m = this.measureText(it);
    const size = it.size || 32;
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate(it.rotation || 0);
    if (it.background !== false) {
      ctx.fillStyle = 'rgba(4,8,13,.52)';
      roundRect(ctx, -7, -3, m.w + 14, m.h + 6, 5);
      ctx.fill();
    }
    ctx.fillStyle = it.color;
    ctx.font = `${it.weight || 650} ${size}px Inter, Segoe UI, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,.5)';
    ctx.shadowBlur = 4;
    m.lines.forEach((line, i) => ctx.fillText(line, 0, i * m.lineH));
    ctx.restore();
  }

  drawMarquee(ctx) {
    if (!this.marquee) return;
    const { start, current } = this.marquee;
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const w = Math.abs(current.x - start.x);
    const h = Math.abs(current.y - start.y);
    ctx.save();
    ctx.fillStyle = 'rgba(200,170,110,.06)';
    ctx.strokeStyle = 'rgba(200,170,110,.6)';
    ctx.lineWidth = 1 / this.view.scale;
    ctx.setLineDash([5 / this.view.scale, 4 / this.view.scale]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  drawSelection(ctx) {
    if (!this.selection.size) return;
    const b = this.selectionBounds();
    if (!b) return;
    const p1 = this.worldToScreen({ x: b.x, y: b.y });
    const p2 = this.worldToScreen({ x: b.x + b.w, y: b.y + b.h });
    const x = p1.x, y = p1.y, w = p2.x - p1.x, h = p2.y - p1.y;
    ctx.save();
    ctx.strokeStyle = 'rgba(200,170,110,.85)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    ctx.setLineDash([]);
    const handles = [
      [x, y], [x + w, y], [x, y + h], [x + w, y + h]
    ];
    for (const [hx, hy] of handles) {
      ctx.fillStyle = '#0a0e15';
      ctx.strokeStyle = '#C8AA6E';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE, 2);
      ctx.fill(); ctx.stroke();
    }
    const top = { x: x + w / 2, y };
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(top.x, top.y - ROT_OFFSET);
    ctx.strokeStyle = 'rgba(200,170,110,.55)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(top.x, top.y - ROT_OFFSET, HANDLE / 2 + 1, 0, TAU);
    ctx.fillStyle = '#0a0e15';
    ctx.strokeStyle = '#C8AA6E';
    ctx.fill(); ctx.stroke();
    // pequeno arco de rotação
    ctx.beginPath();
    ctx.arc(top.x, top.y - ROT_OFFSET, 4, 0.4, Math.PI - 0.4);
    ctx.strokeStyle = '#C8AA6E';
    ctx.stroke();
    ctx.restore();
  }

  drawEraserCursor(ctx) {
    const p = this.hover;
    if (!p) return;
    const s = this.worldToScreen(p);
    const r = ((this.style.width || 4) * 1.6 + 6) * this.view.scale;
    ctx.save();
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, TAU);
    ctx.fillStyle = 'rgba(255,77,94,.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,120,135,.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------ exports ----------------------------- */

  renderToCanvas({ includeBackground = true, scale = 1 } = {}) {
    const pad = 0;
    const w = Math.round(this.w * this.dpr * scale);
    const h = Math.round(this.h * this.dpr * scale);
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    const ctx = c.getContext('2d');
    ctx.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, 0, 0);
    if (includeBackground) {
      ctx.fillStyle = '#070b11';
      ctx.fillRect(0, 0, this.w, this.h);
    }
    ctx.save();
    ctx.translate(this.view.x, this.view.y);
    ctx.scale(this.view.scale, this.view.scale);
    if (includeBackground) this.renderBackground(ctx);
    const globalAlpha = clamp(this.style.globalOpacity ?? 1, 0.05, 1);
    for (const it of this.items) {
      const alpha = this.itemAlpha(it) * globalAlpha;
      if (alpha > 0) this.drawItem(ctx, it, alpha);
    }
    ctx.restore();
    return c;
  }

  async exportMarkingsPNG() {
    return this.renderToCanvas({ includeBackground: false }).toDataURL('image/png');
  }

  async exportBoardPNG() {
    return this.renderToCanvas({ includeBackground: true }).toDataURL('image/png');
  }
}
