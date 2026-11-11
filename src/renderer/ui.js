import { icon } from './icons.js';

export function applyTheme(settings = {}) {
  document.body.dataset.theme = settings.theme || 'hextech';
  document.body.dataset.accent = settings.accent || 'gold';
  const scale = Number(settings.toolbar?.scale) || 1;
  document.documentElement.style.setProperty('--tool-scale', String(scale));
}

export function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function uid(prefix = 'it') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function assetUrl(rel) {
  return new URL('../../assets/' + String(rel).replace(/^\/+/, ''), import.meta.url).href;
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(message, type = 'info', duration = 2300) {
  let layer = document.querySelector('.toast-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'toast-layer';
    document.body.appendChild(layer);
  }
  const el = document.createElement('div');
  const iconName = type === 'error' ? 'warning' : type === 'success' ? 'check' : type === 'draw' ? 'draw' : type === 'interact' ? 'mouse' : 'info';
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(iconName)}<span>${escapeHtml(message)}</span>`;
  layer.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 240);
  }, duration);
}

export function formatShortcut(accel) {
  if (!accel) return '—';
  return String(accel)
    .replace(/CommandOrControl|Control/g, 'Ctrl')
    .replace(/Shift/g, 'Shift')
    .replace(/Alt/g, 'Alt')
    .replace(/Meta/g, 'Win')
    .split('+')
    .join(' + ');
}

export function shortcutFromEvent(e) {
  const keys = [];
  if (e.ctrlKey) keys.push('Control');
  if (e.altKey) keys.push('Alt');
  if (e.shiftKey) keys.push('Shift');
  if (e.metaKey) keys.push('Meta');
  let key = e.key;
  if (!key || ['Control', 'Shift', 'Alt', 'Meta', 'Dead'].includes(key)) return keys.length ? null : '';
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();
  if (key === 'Escape') key = 'Escape';
  if (key === 'ArrowUp') key = 'Up';
  if (key === 'ArrowDown') key = 'Down';
  if (key === 'ArrowLeft') key = 'Left';
  if (key === 'ArrowRight') key = 'Right';
  keys.push(key);
  return keys.join('+');
}

export function matchShortcut(e, accel) {
  if (!accel) return false;
  const parts = String(accel).split('+').map((s) => s.trim()).filter(Boolean);
  const key = parts[parts.length - 1]?.toLowerCase();
  const wantCtrl = parts.some((p) => /^(control|ctrl|commandorcontrol|cmdorctrl)$/i.test(p));
  const wantShift = parts.some((p) => /^shift$/i.test(p));
  const wantAlt = parts.some((p) => /^alt$/i.test(p));
  const wantMeta = parts.some((p) => /^(meta|super|win)$/i.test(p));
  if (e.ctrlKey !== wantCtrl || e.shiftKey !== wantShift || e.altKey !== wantAlt) return false;
  if (e.metaKey !== wantMeta) return false;
  const k = String(e.key || '').toLowerCase();
  const aliases = { space: ' ', esc: 'escape', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' };
  const normalized = aliases[key] || key;
  return k === normalized;
}

export function isTypingTarget(el = document.activeElement) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function hexToRgba(hex, alpha = 1) {
  let h = String(hex || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return `rgba(255,255,255,${alpha})`;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function luminance(hex) {
  let h = String(hex || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return 0;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function setupRangeFill(input) {
  const update = () => {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const val = Number(input.value) || 0;
    const pct = ((val - min) / (max - min)) * 100;
    input.style.setProperty('--fill', `${pct}%`);
  };
  input.addEventListener('input', update);
  update();
  return update;
}

export function createTooltip(el, text) {
  el.dataset.tip = text;
  return el;
}

export const TOOL_LABELS = {
  select: 'Selecionar', pen: 'Caneta', pencil: 'Lápis', marker: 'Marca-texto', eraser: 'Borracha',
  line: 'Linha reta', arrow: 'Seta', curve: 'Seta curva', route: 'Rota tática',
  circle: 'Círculo', rect: 'Retângulo', triangle: 'Triângulo', hexagon: 'Hexágono', cone: 'Cone',
  text: 'Texto', stamp: 'Elemento', aoe: 'Zona AoE'
};

export const TOOL_ICONS = {
  select: 'select', pen: 'pen', pencil: 'pencil', marker: 'marker', eraser: 'eraser',
  line: 'line', arrow: 'arrow', curve: 'curve', route: 'route', circle: 'circle',
  rect: 'square', triangle: 'triangle', hexagon: 'hexagon', cone: 'cone', text: 'text',
  stamp: 'stamp', aoe: 'aoe'
};

export const TOOL_SHORTCUT_LABELS = {
  select: 'Selecionar', pen: 'Caneta', pencil: 'Lápis', marker: 'Marca-texto', eraser: 'Borracha',
  line: 'Linha', arrow: 'Seta', route: 'Rota', circle: 'Círculo', rect: 'Retângulo',
  text: 'Texto', stamp: 'Carimbo', aoe: 'Zona AoE', fade: 'Tinta temporária',
  hideMarkings: 'Ocultar marcações', board: 'Mini-Quadro', undo: 'Desfazer', redo: 'Refazer', escape: 'Cancelar ferramenta'
};

export const STAMP_CATEGORIES = {
  champions: { label: 'Campeões', icon: 'swords' },
  objectives: { label: 'Objetivos', icon: 'target' },
  vision: { label: 'Sentinelas', icon: 'eye' },
  structures: { label: 'Estruturas', icon: 'shield' },
  jungle: { label: 'Jungle', icon: 'layers' },
  pings: { label: 'Pings', icon: 'bolt' },
  roles: { label: 'Posições', icon: 'crosshair' },
  minions: { label: 'Minions', icon: 'wave' }
};

export function sortByCategory(stamps, cat) {
  return stamps.filter((s) => s.cat === cat);
}
