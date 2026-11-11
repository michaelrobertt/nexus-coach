import { SceneEngine } from '../engine.js';
import { applyTheme, debounce, isTypingTarget, matchShortcut, toast } from '../ui.js';

const canvas = document.getElementById('draw');
const textLayer = document.getElementById('textLayer');

let state = null;
let catalog = null;
let settings = null;
let engine = null;
let drawMode = false;
let lastClearAt = Date.now();
let lastAutoClear = 0;
let lastUI = null;

const syncWidth = debounce((width) => {
  window.nexus.patchUI({ width }).catch(() => {});
}, 140);

function uiStyle(ui, s) {
  return {
    tool: ui.tool,
    color: ui.color,
    width: ui.width,
    opacity: Math.max(0.05, Math.min(1, ui.opacity ?? 1)),
    globalOpacity: Math.max(0.15, Math.min(1, s?.overlay?.markingsOpacity ?? 1)),
    arrowStyle: ui.arrowStyle,
    aoeId: ui.aoeId,
    stampId: ui.stampId,
    stampLabel: ui.stampLabel,
    stampTeam: ui.stampTeam,
    stampSize: ui.stampSize || 64,
    textSize: s?.drawing?.textSize || 38,
    fade: ui.fade,
    fadeSeconds: ui.fadeSeconds,
    lineStyle: ui.lineStyle || 'solid',
    showCursor: s?.overlay?.showCursor !== false,
    showLabels: true
  };
}

function applyState(next, opts = {}) {
  state = next;
  settings = next.settings;
  catalog = catalog || null;
  applyTheme(settings);
  const ui = next.ui;
  drawMode = !!ui.drawMode;
  if (engine) {
    engine.setCatalog(catalog);
    engine.setStyle(uiStyle(ui, settings));
    engine.setHidden(!ui.markingsVisible);
    engine.setInteractive(drawMode);
    engine.showSelection = drawMode;
    engine.renderSoon();
    canvas.style.opacity = '1';
    document.body.classList.toggle('no-cursor', drawMode && !settings.overlay?.showCursor);
    if (ui.tool === 'eraser') document.body.classList.add('selecting-cursor');
    else document.body.classList.remove('selecting-cursor');
    if (lastUI && engine.selection.size) {
      const styleChanged = lastUI.color !== ui.color || lastUI.width !== ui.width ||
        lastUI.opacity !== ui.opacity || (lastUI.lineStyle || 'solid') !== (ui.lineStyle || 'solid') ||
        lastUI.arrowStyle !== ui.arrowStyle;
      if (styleChanged) {
        engine.applyStyleToSelection({
          color: ui.color,
          width: ui.width,
          opacity: Math.max(0.05, Math.min(1, ui.opacity ?? 1)),
          lineStyle: ui.lineStyle || 'solid',
          arrowStyle: ui.arrowStyle
        });
      }
    }
    lastUI = { ...ui };
  }
  const auto = Number(settings.overlay?.autoClear) || 0;
  if (auto !== lastAutoClear) {
    lastAutoClear = auto;
    lastClearAt = Date.now();
  }
}

function ensureTool() { return state?.ui?.tool || 'select'; }

function toolsMap() {
  return state?.settings?.shortcuts?.tools || {};
}

function handleKey(e) {
  if (isTypingTarget()) return;
  if (!state) return;
  const t = toolsMap();
  const ui = state.ui;

  if (matchShortcut(e, t.undo) || (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z')) {
    e.preventDefault(); engine.undo(); return;
  }
  if (matchShortcut(e, t.redo) || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) {
    e.preventDefault(); engine.redo(); return;
  }
  if (matchShortcut(e, t.escape) || e.key === 'Escape') {
    e.preventDefault();
    if (engine.route) { engine.finishRoute(false); return; }
    if (engine._editing) { engine.cancelTextEdit(); return; }
    if (engine.selection.size) { engine.setSelection([]); return; }
    if (ui.tool !== 'select') window.nexus.patchUI({ tool: 'select' });
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault(); engine.deleteSelected(); return;
  }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); engine.copySelection(); return; }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'v') { e.preventDefault(); engine.paste(); return; }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); engine.selectAll(); return; }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); saveScene(); return; }
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); loadScene(); return; }
  if (e.ctrlKey && e.key.toLowerCase() === 'd') { e.preventDefault(); engine.duplicateSelected(); return; }
  if (e.key.startsWith('Arrow') && engine.selection.size) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    for (const it of engine.selectedItems()) {
      if (it.points) it.points = it.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      if (typeof it.x === 'number') it.x += dx;
      if (typeof it.y === 'number') it.y += dy;
    }
    engine.commit();
    return;
  }

  if (matchShortcut(e, t.fade)) {
    e.preventDefault();
    window.nexus.patchUI({ fade: !ui.fade });
    toast(ui.fade ? 'Tinta permanente' : 'Tinta temporária ativada', 'info');
    return;
  }
  if (matchShortcut(e, t.hideMarkings)) {
    e.preventDefault();
    window.nexus.command({ type: 'toggle-markings' });
    return;
  }
  if (matchShortcut(e, t.board)) {
    e.preventDefault();
    window.nexus.command({ type: 'toggle-board' });
    return;
  }

  const toolKeys = ['select', 'pen', 'pencil', 'marker', 'eraser', 'line', 'arrow', 'curve', 'route', 'circle', 'rect', 'triangle', 'hexagon', 'cone', 'text', 'stamp', 'aoe'];
  for (const key of toolKeys) {
    if (matchShortcut(e, t[key])) {
      e.preventDefault();
      if (engine.route) engine.finishRoute(true);
      window.nexus.patchUI({ tool: key });
      return;
    }
  }

  if (e.key === 'Enter' && engine.route) {
    e.preventDefault();
    engine.finishRoute(true);
  }
}

async function saveScene() {
  const res = await window.nexus.saveScene({
    which: 'overlay',
    data: engine.serialize(),
    defaultName: `nexus-overlay-${stampName()}.json`
  });
  if (res.ok) toast('Cenário salvo', 'success');
  else if (res.error) toast(res.error, 'error');
}

async function loadScene() {
  const res = await window.nexus.openScene();
  if (!res.ok) {
    if (res.error) toast(res.error, 'error');
    return;
  }
  if (engine.loadScene(res.data)) {
    window.nexus.autosaveScene('overlay', engine.serialize());
    toast('Cenário carregado', 'success');
  } else toast('Arquivo de cenário inválido', 'error');
}

async function exportMarkings() {
  const dataUrl = await engine.exportMarkingsPNG();
  const res = await window.nexus.exportImage({ dataUrl, defaultName: `nexus-marcacoes-${stampName()}.png` });
  if (res.ok) toast('Imagem exportada', 'success');
  else if (res.error) toast(res.error, 'error');
}

async function exportComposite() {
  const cap = await window.nexus.captureScreen();
  if (!cap.ok) { toast(cap.error || 'Falha ao capturar a tela', 'error'); return; }
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = cap.dataUrl;
  });
  const out = document.createElement('canvas');
  out.width = img.width;
  out.height = img.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const marks = engine.renderToCanvas({ includeBackground: false });
  const k = img.width / (cap.size?.width || img.width);
  const ox = (cap.overlayBounds.x - cap.bounds.x) * k;
  const oy = (cap.overlayBounds.y - cap.bounds.y) * k;
  ctx.drawImage(marks, ox, oy, cap.overlayBounds.width * k, cap.overlayBounds.height * k);
  const dataUrl = out.toDataURL('image/png');
  const res = await window.nexus.exportImage({ dataUrl, defaultName: `nexus-analise-${stampName()}.png` });
  if (res.ok) toast('Captura com marcações exportada', 'success');
  else if (res.error) toast(res.error, 'error');
}

function stampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function handleCommand(cmd) {
  if (!cmd || !engine) return;
  switch (cmd.type) {
    case 'clear': engine.clear(); toast('Marcações limpas', 'info'); break;
    case 'clear-temp': engine.clearTemporary(); break;
    case 'undo': engine.undo(); break;
    case 'redo': engine.redo(); break;
    case 'delete': engine.deleteSelected(); break;
    case 'copy': engine.copySelection(); break;
    case 'paste': engine.paste(); break;
    case 'duplicate': engine.duplicateSelected(); break;
    case 'select-all': engine.selectAll(); break;
    case 'set-markings-visible': engine.setHidden(!cmd.value); break;
    case 'save': saveScene(); break;
    case 'load': loadScene(); break;
    case 'export': exportComposite(); break;
    case 'export-markings': exportMarkings(); break;
    case 'reset-scene': engine.clear(); break;
    case 'sync-style': applyState(state); break;
    case 'fit': break;
    default: break;
  }
}

async function boot() {
  const bootData = await window.nexus.bootstrap();
  catalog = bootData.catalog;
  state = bootData.state;
  settings = state.settings;

  engine = new SceneEngine(canvas, {
    mode: 'overlay',
    catalog,
    textLayer,
    zoomable: false,
    panEnabled: false,
    showSelection: true,
    onHistory: () => {},
    onChange: (scene) => window.nexus.autosaveScene('overlay', scene),
    onBrushSize: (width) => syncWidth(width)
  });

  window.__nexusEngine = engine;
  const saved = bootData.scenes?.overlay;
  if (saved && Array.isArray(saved.items)) {
    engine.loadScene(saved);
  }
  applyState(state);

  // Alguns itens podem usar imagens; re-renderiza quando estiverem prontas.
  engine.renderSoon();

  setInterval(() => {
    const auto = Number(settings?.overlay?.autoClear) || 0;
    if (!auto || !engine) return;
    if (!engine.items.length) { lastClearAt = Date.now(); return; }
    if (Date.now() - lastClearAt >= auto * 1000) {
      engine.clear();
      lastClearAt = Date.now();
    }
  }, 800);
}

window.nexus.onState((next) => applyState(next));
window.nexus.onCommand(handleCommand);
window.addEventListener('keydown', handleKey);
window.addEventListener('beforeunload', () => {
  if (engine) window.nexus.autosaveScene('overlay', engine.serialize());
});

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#ff8f9a;padding:20px;font:12px monospace">Falha ao iniciar o overlay:\n${String(err?.stack || err)}</pre>`;
});
