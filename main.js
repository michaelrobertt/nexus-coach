'use strict';

const {
  app, BrowserWindow, ipcMain, screen, globalShortcut, dialog, desktopCapturer,
  shell, Tray, Menu, nativeImage, clipboard
} = require('electron');
const path = require('path');
const fs = require('fs');
const catalog = require('./src/shared/catalog.json');

const IS_DEV = process.argv.includes('--dev');
const ASSETS = path.join(__dirname, 'assets');
const PRELOAD = path.join(__dirname, 'preload.js');

const DEFAULT_SETTINGS = {
  locale: 'pt-BR',
  theme: 'hextech',
  accent: 'gold',
  colors: catalog.palette.map((p) => p.color),
  overlay: {
    display: 'primary',
    markingsOpacity: 1,
    autoClear: 0,
    alwaysOnTop: true,
    showCursor: true,
    startInDrawMode: false
  },
  toolbar: {
    x: null,
    y: null,
    width: 1080,
    height: 158,
    scale: 1,
    layout: 'horizontal',
    size: 'medium',
    compact: { x: null, y: null }
  },
  interface: {
    displayMode: 'specialist'
  },
  drawing: {
    color: '#C8AA6E',
    width: 4,
    opacity: 1,
    arrowStyle: 'attack',
    aoeId: 'range',
    stampSize: 64,
    textSize: 38,
    fade: false,
    fadeSeconds: 4,
    lineStyle: 'solid'
  },
  shortcuts: {
    drawMode: 'Control+Shift+D',
    hideUI: 'Control+Shift+H',
    board: 'Control+Shift+M',
    clear: 'Control+Shift+X',
    tools: {
      select: 'V',
      pen: 'P',
      pencil: 'B',
      marker: 'H',
      eraser: 'E',
      line: 'L',
      arrow: 'A',
      curve: '',
      route: 'R',
      circle: 'C',
      rect: 'X',
      triangle: '',
      hexagon: '',
      cone: '',
      text: 'T',
      stamp: 'S',
      aoe: 'O',
      fade: 'I',
      hideMarkings: 'F',
      board: 'M',
      undo: 'Control+Z',
      redo: 'Control+Shift+Z',
      escape: 'Escape'
    }
  },
  favorites: ['select', 'pen', 'arrow', 'route', 'circle', 'text', 'aoe', 'stamp'],
  board: {
    alwaysOnTop: false,
    background: 'hd',
    grid: false,
    brightness: 1,
    showLabels: true,
    bounds: null
  },
  startup: {
    launchAtLogin: false,
    minimized: false
  },
  settingsBounds: null
};

const DEFAULT_UI = {
  tool: 'select',
  color: '#C8AA6E',
  width: 4,
  opacity: 1,
  arrowStyle: 'attack',
  aoeId: 'range',
  stampId: null,
  stampTeam: 'ally',
  stampSize: 64,
  fade: false,
  fadeSeconds: 4,
  lineStyle: 'solid',
  panel: null,
  drawMode: false,
  markingsVisible: true,
  uiVisible: true,
  boardOpen: false,
  compact: false,
  canUndo: false,
  canRedo: false,
  selectedCount: 0
};

const TOOLBAR_PRESETS = {
  horizontal: {
    small: { width: 900, height: 150 },
    medium: { width: 1080, height: 158 },
    large: { width: 1240, height: 180 }
  },
  vertical: {
    small: { width: 292, height: 470 },
    medium: { width: 324, height: 480 },
    large: { width: 360, height: 530 }
  }
};

const COMPACT_SIZE = 56;

let store = null;
let storePath = '';
let saveTimer = null;
let overlay = null;
let toolbar = null;
let board = null;
let settingsWin = null;
let tray = null;
let shortcutStatus = {};
let shortcutsSuspended = false;
let collapsedToolbarHeight = 172;
let panelOpen = false;
let shuttingDown = false;
let compactMode = false;
let compactTransition = 0;
let preCompact = null;
let needsToolbarPreset = false;

/* ------------------------------------------------------------------ */
/* Store                                                              */
/* ------------------------------------------------------------------ */

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const key of Object.keys(patch)) {
    const val = patch[key];
    if (val === undefined) continue;
    if (isPlainObject(val) && isPlainObject(out[key])) out[key] = deepMerge(out[key], val);
    else out[key] = clone(val);
  }
  return out;
}

function loadStore() {
  storePath = path.join(app.getPath('userData'), 'nexus-coach.json');
  let loaded = {};
  try {
    if (fs.existsSync(storePath)) loaded = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch (err) {
    console.error('Falha ao ler configurações:', err);
  }
  store = {
    settings: deepMerge(clone(DEFAULT_SETTINGS), loaded.settings || {}),
    ui: deepMerge(clone(DEFAULT_UI), loaded.ui || {}),
    presets: deepMerge({ custom: [] }, loaded.presets || {}),
    scenes: { overlay: loaded.scenes?.overlay || null, board: loaded.scenes?.board || null }
  };
  // UI de sessão: o modo de desenho inicial é uma preferência opcional.
  needsToolbarPreset = !loaded.settings?.toolbar?.size;
  store.ui.drawMode = !!store.settings.overlay.startInDrawMode;
  store.ui.panel = null;
  store.ui.compact = false;
  store.ui.uiVisible = true;
  collapsedToolbarHeight = Number(store.settings.toolbar.height) || 158;
}

function saveStoreNow() {
  if (!store) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const tmp = storePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
    fs.renameSync(tmp, storePath);
  } catch (err) {
    console.error('Falha ao salvar configurações:', err);
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveStoreNow, 350);
}

function loadChampions() {
  try {
    const file = path.join(__dirname, 'assets/champions/champion.pt_BR.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8')).data;
    return Object.values(data).map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      title: c.title,
      tags: c.tags,
      image: c.image.full
    })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  } catch (err) {
    console.error('Falha ao carregar campeões:', err);
    return [];
  }
}

function loadLolVersion() {
  try {
    return fs.readFileSync(path.join(__dirname, 'assets/champions/version.txt'), 'utf8').trim();
  } catch {
    return '';
  }
}

function publicState() {
  return {
    settings: store.settings,
    ui: store.ui,
    presets: store.presets,
    shortcutStatus,
    displays: getDisplays(),
    version: app.getVersion(),
    platform: process.platform
  };
}

function broadcastState() {
  const state = publicState();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('state:changed', state);
  }
}

function getDisplays() {
  const primaryId = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, index) => ({
    id: String(d.id),
    label: `${d.label || `Monitor ${index + 1}`} · ${d.size.width}×${d.size.height}${d.id === primaryId ? ' (principal)' : ''}`,
    primary: d.id === primaryId,
    bounds: d.bounds,
    workArea: d.workArea,
    scaleFactor: d.scaleFactor
  }));
}

/* ------------------------------------------------------------------ */
/* Display / overlay bounds                                           */
/* ------------------------------------------------------------------ */

function displayForSetting() {
  const all = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const choice = store.settings.overlay.display;
  if (choice === 'all') return { display: unionDisplay(all), all: true };
  if (!choice || choice === 'primary') return { display: primary, all: false };
  return { display: all.find((d) => String(d.id) === String(choice)) || primary, all: false };
}

function unionDisplay(displays) {
  const left = Math.min(...displays.map((d) => d.bounds.x));
  const top = Math.min(...displays.map((d) => d.bounds.y));
  const right = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
  const bottom = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));
  return {
    id: 'all',
    bounds: { x: left, y: top, width: right - left, height: bottom - top },
    workArea: { x: left, y: top, width: right - left, height: bottom - top },
    scaleFactor: screen.getPrimaryDisplay().scaleFactor
  };
}

function overlayBounds() {
  return displayForSetting().display.bounds;
}

function clampToDisplays(bounds, minVisible = 80) {
  const displays = screen.getAllDisplays();
  const intersects = displays.some((d) => {
    const a = d.workArea;
    return bounds.x + minVisible < a.x + a.width && bounds.x + bounds.width - minVisible > a.x &&
      bounds.y + 20 < a.y + a.height && bounds.y + bounds.height > a.y;
  });
  if (!intersects) {
    const primary = screen.getPrimaryDisplay().workArea;
    bounds.x = Math.round(primary.x + (primary.width - bounds.width) / 2);
    bounds.y = Math.round(primary.y + 20);
  }
  return bounds;
}

/* ------------------------------------------------------------------ */
/* Windows                                                            */
/* ------------------------------------------------------------------ */

function createOverlay() {
  const bounds = overlayBounds();
  overlay = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: true,
    enableLargerThanScreen: true,
    title: 'Nexus Coach Overlay',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  overlay.setAlwaysOnTop(!!store.settings.overlay.alwaysOnTop, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setSkipTaskbar(true);
  overlay.setIgnoreMouseEvents(true, { forward: true });

  overlay.loadFile(path.join(__dirname, 'src/renderer/overlay/index.html'));
  overlay.once('ready-to-show', () => {
    if (store.ui.uiVisible) overlay.showInactive();
    syncClickThrough();
  });
  overlay.on('focus', () => {
    if (toolbar && !toolbar.isDestroyed()) toolbar.moveTop();
  });
  overlay.on('close', (e) => {
    if (shuttingDown) return;
    e.preventDefault();
    overlay.hide();
  });
  overlay.on('closed', () => { overlay = null; });
  overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function toolbarMinSize(layout = store.settings.toolbar.layout) {
  return layout === 'vertical' ? { width: 280, height: 360 } : { width: 900, height: 138 };
}

function toolbarPresetDims(layout = store.settings.toolbar.layout, size = store.settings.toolbar.size) {
  const table = TOOLBAR_PRESETS[layout] || TOOLBAR_PRESETS.horizontal;
  const dims = table[size] || table.medium;
  const minimal = store.settings.interface?.displayMode === 'minimal';
  const targetHeight = minimal ? (layout === 'vertical' ? 360 : 138) : dims.height;
  const area = screen.getPrimaryDisplay().workArea;
  return {
    width: Math.min(dims.width, area.width - 16),
    height: Math.min(targetHeight, area.height - 24)
  };
}

function defaultToolbarBounds() {
  const area = screen.getPrimaryDisplay().workArea;
  const saved = store.settings.toolbar;
  const preset = toolbarPresetDims(saved.layout, saved.size);
  const width = needsToolbarPreset
    ? preset.width
    : Math.max(280, Math.min(Number(saved.width) || preset.width, area.width - 24));
  const height = needsToolbarPreset
    ? preset.height
    : Math.max(138, Math.min(Number(saved.height) || preset.height, area.height - 40));
  let x = Number.isFinite(saved.x) ? saved.x : Math.round(area.x + (area.width - width) / 2);
  let y = Number.isFinite(saved.y) ? saved.y : area.y + 18;
  return clampToDisplays({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
}

function applyToolbarPreset() {
  if (!toolbar || toolbar.isDestroyed() || compactMode) return;
  const layout = store.settings.toolbar.layout || 'horizontal';
  const size = store.settings.toolbar.size || 'medium';
  const dims = toolbarPresetDims(layout, size);
  if (panelOpen) {
    setToolbarPanel(false, 0);
    store.ui.panel = null;
  }
  if (toolbar.isMinimized()) toolbar.restore();
  const b = toolbar.getBounds();
  const display = screen.getDisplayMatching(b);
  const area = display.workArea;
  const width = Math.min(dims.width, area.width - 12);
  const height = Math.min(dims.height, area.height - 12);
  let x = Math.min(Math.max(b.x, area.x), area.x + area.width - width);
  let y = Math.min(Math.max(b.y, area.y), area.y + area.height - height);
  toolbar.setResizable(true);
  const min = toolbarMinSize(layout);
  toolbar.setMinimumSize(min.width, min.height);
  toolbar.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
  store.settings.toolbar.x = Math.round(x);
  store.settings.toolbar.y = Math.round(y);
  store.settings.toolbar.width = Math.round(width);
  store.settings.toolbar.height = Math.round(height);
  collapsedToolbarHeight = Math.round(height);
  scheduleSave();
  broadcastState();
}

function asCompactBounds(x, y) {
  return clampToDisplays({
    x: Math.round(x), y: Math.round(y), width: COMPACT_SIZE, height: COMPACT_SIZE
  });
}

function compactButtonPosition(expandedBounds) {
  const saved = store.settings.toolbar.compact;
  if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) {
    return asCompactBounds(saved.x, saved.y);
  }
  return asCompactBounds(expandedBounds.x + expandedBounds.width - 96, expandedBounds.y + 2);
}

function animateWindowBounds(win, to, duration, isCancelled) {
  return new Promise((resolve) => {
    const from = win.getBounds();
    const start = Date.now();
    const tick = () => {
      if (win.isDestroyed() || isCancelled?.()) { resolve(false); return; }
      const t = Math.min(1, (Date.now() - start) / duration);
      const e = 1 - Math.pow(1 - t, 3);
      win.setBounds({
        x: Math.round(from.x + (to.x - from.x) * e),
        y: Math.round(from.y + (to.y - from.y) * e),
        width: Math.max(COMPACT_SIZE, Math.round(from.width + (to.width - from.width) * e)),
        height: Math.max(COMPACT_SIZE, Math.round(from.height + (to.height - from.height) * e))
      });
      if (t < 1) setTimeout(tick, 16);
      else { win.setBounds(to); resolve(true); }
    };
    tick();
  });
}

async function compactApp() {
  if (compactMode || !toolbar || toolbar.isDestroyed()) return;
  const token = ++compactTransition;
  compactMode = true;
  store.ui.uiVisible = true;
  if (board && !board.isDestroyed()) board.close();
  const currentBounds = toolbar.getBounds();
  preCompact = {
    bounds: {
      x: currentBounds.x,
      y: currentBounds.y,
      width: currentBounds.width,
      height: panelOpen ? collapsedToolbarHeight : currentBounds.height
    },
    drawMode: !!store.ui.drawMode,
    settingsOpen: !!(settingsWin && !settingsWin.isDestroyed() && settingsWin.isVisible())
  };
  store.ui.panel = null;
  panelOpen = false;
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.hide();
  if (store.ui.drawMode) {
    store.ui.drawMode = false;
  }
  if (overlay && !overlay.isDestroyed()) overlay.hide();
  const compactBounds = compactButtonPosition(preCompact.bounds);
  toolbar.setResizable(false);
  toolbar.setMinimumSize(COMPACT_SIZE, COMPACT_SIZE);
  toolbar.showInactive();
  toolbar.moveTop();
  const completed = await animateWindowBounds(toolbar, compactBounds, 190, () => token !== compactTransition);
  if (!completed || token !== compactTransition) return;
  store.ui.compact = true;
  store.settings.toolbar.compact = { x: compactBounds.x, y: compactBounds.y };
  collapsedToolbarHeight = preCompact.bounds.height;
  scheduleSave();
  broadcastState();
  refreshTray();
}

function restoreApp() {
  if (!compactMode || !toolbar || toolbar.isDestroyed()) return;
  ++compactTransition;
  store.ui.uiVisible = true;
  const fallback = defaultToolbarBounds();
  const target = preCompact?.bounds || fallback;
  const display = screen.getDisplayMatching({ x: target.x, y: target.y, width: target.width, height: target.height });
  const area = display.workArea;
  const width = Math.min(target.width, area.width - 12);
  const height = Math.min(target.height, area.height - 12);
  const x = Math.min(Math.max(target.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(target.y, area.y), area.y + area.height - height);
  compactMode = false;
  store.ui.compact = false;
  const min = toolbarMinSize(store.settings.toolbar.layout);
  toolbar.setMinimumSize(min.width, min.height);
  toolbar.setResizable(true);
  toolbar.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) });
  store.settings.toolbar.x = Math.round(x);
  store.settings.toolbar.y = Math.round(y);
  store.settings.toolbar.width = Math.round(width);
  store.settings.toolbar.height = Math.round(height);
  collapsedToolbarHeight = Math.round(height);
  if (store.ui.uiVisible) {
    toolbar.showInactive();
    if (preCompact?.settingsOpen && settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.show();
      settingsWin.focus();
    } else {
      if (overlay && !overlay.isDestroyed()) overlay.showInactive();
      if (preCompact?.drawMode) store.ui.drawMode = true;
      syncClickThrough();
    }
  }
  preCompact = null;
  scheduleSave();
  broadcastState();
  refreshTray();
}

function moveCompactTo(x, y) {
  if (!compactMode || !toolbar || toolbar.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
  const area = display.workArea;
  const nx = Math.min(Math.max(Math.round(x), area.x), area.x + area.width - COMPACT_SIZE);
  const ny = Math.min(Math.max(Math.round(y), area.y), area.y + area.height - COMPACT_SIZE);
  toolbar.setPosition(nx, ny);
  store.settings.toolbar.compact = { x: nx, y: ny };
  scheduleSave();
}

function createToolbar() {
  const b = defaultToolbarBounds();
  needsToolbarPreset = false;
  collapsedToolbarHeight = b.height;
  toolbar = new BrowserWindow({
    ...b,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    minWidth: 280,
    minHeight: 138,
    title: 'Nexus Coach',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  const initialMin = toolbarMinSize(store.settings.toolbar.layout);
  toolbar.setMinimumSize(initialMin.width, initialMin.height);
  toolbar.setAlwaysOnTop(true, 'screen-saver');
  toolbar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  toolbar.setSkipTaskbar(true);
  toolbar.loadFile(path.join(__dirname, 'src/renderer/toolbar/index.html'));

  const persist = () => {
    if (!toolbar || toolbar.isDestroyed() || panelOpen || compactMode) return;
    const [x, y] = toolbar.getPosition();
    const [width, height] = toolbar.getSize();
    store.settings.toolbar.x = x;
    store.settings.toolbar.y = y;
    store.settings.toolbar.width = width;
    store.settings.toolbar.height = height;
    collapsedToolbarHeight = height;
    scheduleSave();
  };
  let moveTimer = null;
  const lazyPersist = () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(persist, 280);
  };
  toolbar.on('move', lazyPersist);
  toolbar.on('resize', lazyPersist);

  toolbar.once('ready-to-show', () => {
    if (store.ui.uiVisible && !store.settings.startup.minimized) toolbar.showInactive();
  });
  toolbar.on('close', (e) => {
    if (shuttingDown) return;
    e.preventDefault();
    toolbar.hide();
    store.ui.uiVisible = false;
    if (overlay && !overlay.isDestroyed()) overlay.hide();
    broadcastState();
  });
  toolbar.on('closed', () => {
    compactTransition++;
    toolbar = null;
  });
  toolbar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function createBoard() {
  if (compactMode) restoreApp();
  if (board && !board.isDestroyed()) {
    board.show();
    board.focus();
    return;
  }
  if (store.ui.drawMode) {
    store.ui.drawMode = false;
    syncClickThrough();
  }
  if (overlay && !overlay.isDestroyed()) overlay.hide();
  if (toolbar && !toolbar.isDestroyed()) toolbar.hide();
  refreshTray();
  const primary = screen.getPrimaryDisplay().workArea;
  const saved = store.settings.board.bounds;
  const width = Math.min(saved?.width || 1440, primary.width - 40);
  const height = Math.min(saved?.height || 900, primary.height - 40);
  const bounds = clampToDisplays({
    x: saved?.x ?? Math.round(primary.x + (primary.width - width) / 2),
    y: saved?.y ?? Math.round(primary.y + (primary.height - height) / 2),
    width,
    height
  });

  board = new BrowserWindow({
    ...bounds,
    minWidth: 980,
    minHeight: 660,
    show: false,
    frame: false,
    backgroundColor: '#070a10',
    title: 'Mini-Quadro Tático · Nexus Coach',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });
  board.setAlwaysOnTop(!!store.settings.board.alwaysOnTop, 'floating');
  board.loadFile(path.join(__dirname, 'src/renderer/board/index.html'));

  board.once('ready-to-show', () => {
    board.show();
    board.focus();
    store.ui.boardOpen = true;
    broadcastState();
    refreshTray();
  });

  const persist = () => {
    if (!board || board.isDestroyed()) return;
    store.settings.board.bounds = board.getBounds();
    scheduleSave();
  };
  board.on('moved', persist);
  board.on('resized', persist);
  board.on('closed', () => {
    board = null;
    store.ui.boardOpen = false;
    if (store.ui.uiVisible && !compactMode && !(settingsWin && !settingsWin.isDestroyed())) {
      if (overlay && !overlay.isDestroyed()) overlay.showInactive();
      if (toolbar && !toolbar.isDestroyed()) toolbar.showInactive();
      syncClickThrough();
    }
    broadcastState();
  });
  board.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function createSettings() {
  if (compactMode) restoreApp();
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  if (store.ui.drawMode) {
    store.ui.drawMode = false;
    syncClickThrough();
    broadcastState();
  }
  if (overlay && !overlay.isDestroyed()) overlay.hide();
  refreshTray();
  const primary = screen.getPrimaryDisplay().workArea;
  const saved = store.settings.settingsBounds;
  const width = Math.min(saved?.width || 1060, primary.width - 60);
  const height = Math.min(saved?.height || 760, primary.height - 60);
  const bounds = clampToDisplays({
    x: saved?.x ?? Math.round(primary.x + (primary.width - width) / 2),
    y: saved?.y ?? Math.round(primary.y + (primary.height - height) / 2),
    width,
    height
  });

  settingsWin = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    backgroundColor: '#080b11',
    title: 'Configurações · Nexus Coach',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });
  settingsWin.loadFile(path.join(__dirname, 'src/renderer/settings/index.html'));
  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    settingsWin.focus();
  });
  const persist = () => {
    if (!settingsWin || settingsWin.isDestroyed()) return;
    store.settings.settingsBounds = settingsWin.getBounds();
    scheduleSave();
  };
  settingsWin.on('moved', persist);
  settingsWin.on('resized', persist);
  settingsWin.on('closed', () => {
    settingsWin = null;
    if (shortcutsSuspended) registerShortcuts();
    if (store.ui.uiVisible && !(board && !board.isDestroyed()) && !(settingsWin && !settingsWin.isDestroyed())) {
      if (overlay && !overlay.isDestroyed()) overlay.showInactive();
      syncClickThrough();
    }
  });
  settingsWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function refreshTray() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    {
      label: store.ui.uiVisible ? 'Ocultar interface' : 'Mostrar interface',
      accelerator: shortcutLabel(store.settings.shortcuts.hideUI),
      click: () => toggleUI()
    },
    {
      label: compactMode ? 'Restaurar aplicativo' : 'Minimizar em botão flutuante',
      click: () => compactMode ? restoreApp() : compactApp()
    },
    {
      label: startDrawingLabel(),
      accelerator: shortcutLabel(store.settings.shortcuts.drawMode),
      click: () => setDrawMode(!store.ui.drawMode)
    },
    { type: 'separator' },
    { label: 'Mini-Quadro Tático', accelerator: shortcutLabel(store.settings.shortcuts.board), click: () => toggleBoard() },
    { label: 'Configurações', click: () => createSettings() },
    { type: 'separator' },
    { label: 'Limpar marcações', accelerator: shortcutLabel(store.settings.shortcuts.clear), click: () => sendOverlayCommand({ type: 'clear' }) },
    { type: 'separator' },
    { label: 'Sair do Nexus Coach', click: () => { shuttingDown = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(compactMode ? 'Nexus Coach · minimizado' : `Nexus Coach · ${store.ui.drawMode ? 'Modo desenho' : 'Interação'}`);
}

function startDrawingLabel() {
  return store.ui.drawMode ? 'Voltar à interação' : 'Ativar modo desenho';
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
    tray = new Tray(img);
    tray.on('click', () => compactMode ? restoreApp() : toggleUI());
    refreshTray();
  } catch (err) {
    console.error('Tray indisponível:', err);
  }
}

/* ------------------------------------------------------------------ */
/* Modes                                                              */
/* ------------------------------------------------------------------ */

function syncClickThrough() {
  if (!overlay || overlay.isDestroyed()) return;
  if (compactMode) {
    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.hide();
    return;
  }
  const draw = store.ui.drawMode && store.ui.uiVisible;
  overlay.setIgnoreMouseEvents(!draw, { forward: true });
  if (draw) {
    overlay.showInactive();
    overlay.focus();
    if (toolbar && !toolbar.isDestroyed()) toolbar.moveTop();
  }
}

function setDrawMode(on, opts = {}) {
  if (on && compactMode) restoreApp();
  if (on && settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  if (on && board && !board.isDestroyed()) board.close();
  store.ui.drawMode = !!on;
  if (on && !store.ui.uiVisible) {
    store.ui.uiVisible = true;
    if (toolbar) toolbar.showInactive();
    if (overlay) overlay.showInactive();
  }
  if (!on && overlay && !overlay.isDestroyed()) overlay.blur();
  syncClickThrough();
  broadcastState();
  refreshTray();
  if (toolbar && !toolbar.isDestroyed()) toolbar.moveTop();
  if (!opts.silent) notify(on ? 'Modo desenho ativado' : 'Interação com o sistema ativada', on ? 'draw' : 'interact');
}

function toggleUI() {
  store.ui.uiVisible = !store.ui.uiVisible;
  if (compactMode) {
    if (store.ui.uiVisible) {
      if (toolbar) toolbar.showInactive();
    } else if (toolbar) {
      toolbar.hide();
    }
    broadcastState();
    refreshTray();
    return;
  }
  if (store.ui.uiVisible) {
    if (overlay) overlay.showInactive();
    if (toolbar) toolbar.showInactive();
    syncClickThrough();
  } else {
    if (store.ui.drawMode) {
      store.ui.drawMode = false;
    }
    if (overlay) overlay.hide();
    if (toolbar) toolbar.hide();
  }
  broadcastState();
  refreshTray();
  notify(store.ui.uiVisible ? 'Interface restaurada' : 'Interface oculta · use o atalho para voltar', 'info');
}

function toggleBoard() {
  if (compactMode) restoreApp();
  if (board && !board.isDestroyed()) {
    board.close();
  } else {
    createBoard();
  }
  refreshTray();
}

function sendOverlayCommand(payload) {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send('command', { target: 'overlay', ...payload });
}

function sendBoardCommand(payload) {
  if (board && !board.isDestroyed()) board.webContents.send('command', { target: 'board', ...payload });
}

function notify(message, type = 'info') {
  if (toolbar && !toolbar.isDestroyed()) toolbar.webContents.send('toast', { message, type });
}

/* ------------------------------------------------------------------ */
/* Shortcuts                                                          */
/* ------------------------------------------------------------------ */

function shortcutLabel(accel) {
  return String(accel || '').replace(/Control/g, 'Ctrl').replace(/CommandOrControl/g, 'Ctrl');
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  shortcutsSuspended = false;
  shortcutStatus = {};
  const s = store.settings.shortcuts;
  const entries = [
    ['drawMode', s.drawMode, () => setDrawMode(!store.ui.drawMode)],
    ['hideUI', s.hideUI, () => toggleUI()],
    ['board', s.board, () => toggleBoard()],
    ['clear', s.clear, () => {
      if (store.ui.drawMode) sendOverlayCommand({ type: 'clear' });
      else sendOverlayCommand({ type: 'clear' });
      notify('Marcações limpas', 'info');
    }]
  ];
  for (const [id, accel, fn] of entries) {
    if (!accel) { shortcutStatus[id] = false; continue; }
    try {
      shortcutStatus[id] = globalShortcut.register(accel, fn);
    } catch {
      shortcutStatus[id] = false;
    }
  }
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('shortcuts:status', shortcutStatus);
}

function applyLoginItem() {
  try {
    if (process.platform === 'win32') {
      app.setLoginItemSettings({
        openAtLogin: !!store.settings.startup.launchAtLogin,
        args: store.settings.startup.minimized ? ['--hidden'] : []
      });
    }
  } catch (err) {
    console.error('Falha ao configurar inicialização:', err);
  }
}

function applyOverlaySettings() {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setAlwaysOnTop(!!store.settings.overlay.alwaysOnTop, 'screen-saver');
  const bounds = overlayBounds();
  overlay.setBounds(bounds);
  syncClickThrough();
}

function applyBoardSettings() {
  if (!board || board.isDestroyed()) return;
  board.setAlwaysOnTop(!!store.settings.board.alwaysOnTop, 'floating');
}

/* ------------------------------------------------------------------ */
/* IPC                                                                */
/* ------------------------------------------------------------------ */

function setupIpc() {
  ipcMain.handle('app:bootstrap', () => ({
    state: publicState(),
    scenes: store.scenes,
    catalog,
    champions: loadChampions(),
    lolVersion: loadLolVersion()
  }));

  ipcMain.handle('state:patch', (_e, patch) => {
    if (patch.settings) {
      store.settings = deepMerge(store.settings, patch.settings);
      applySettingsSideEffects(patch.settings);
    }
    if (patch.presets) store.presets = deepMerge(store.presets, patch.presets);
    if (patch.ui) {
      const wasDraw = store.ui.drawMode;
      store.ui = deepMerge(store.ui, patch.ui);
      if (typeof patch.ui.drawMode === 'boolean' && patch.ui.drawMode !== wasDraw) {
        syncClickThrough();
      }
    }
    scheduleSave();
    broadcastState();
    return publicState();
  });

  ipcMain.handle('ui:patch', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return publicState();
    const wasDraw = store.ui.drawMode;
    store.ui = deepMerge(store.ui, patch);
    if (typeof patch.drawMode === 'boolean' && patch.drawMode !== wasDraw) syncClickThrough();
    scheduleSave();
    broadcastState();
    return publicState();
  });

  ipcMain.handle('app:command', (_e, cmd) => {
    handleCommand(cmd || {});
    return true;
  });

  ipcMain.on('scene:autosave', (_e, payload) => {
    if (!payload || (payload.which !== 'overlay' && payload.which !== 'board')) return;
    store.scenes[payload.which] = payload.scene || null;
    scheduleSave();
  });

  ipcMain.handle('toolbar:set-panel', (_e, { open, height }) => {
    setToolbarPanel(!!open, Number(height) || 520);
  });

  ipcMain.handle('toolbar:focus-overlay', () => {
    if (compactMode) return;
    if (store.ui.drawMode && overlay && !overlay.isDestroyed()) overlay.focus();
  });

  ipcMain.handle('app:compact', () => { compactApp(); return true; });
  ipcMain.handle('app:restore', () => { restoreApp(); return true; });
  ipcMain.handle('compact:move', (_e, { x, y }) => {
    moveCompactTo(Number(x), Number(y));
    return true;
  });

  ipcMain.handle('toolbar:reset-position', () => {
    if (!toolbar || toolbar.isDestroyed()) return false;
    panelOpen = false;
    toolbar.setResizable(true);
    const area = screen.getPrimaryDisplay().workArea;
    const [width] = toolbar.getSize();
    const height = Math.max(160, collapsedToolbarHeight);
    const bounds = {
      x: Math.round(area.x + (area.width - width) / 2),
      y: area.y + 18,
      width,
      height
    };
    toolbar.setBounds(bounds);
    store.settings.toolbar.x = bounds.x;
    store.settings.toolbar.y = bounds.y;
    store.settings.toolbar.width = width;
    store.settings.toolbar.height = height;
    scheduleSave();
    broadcastState();
    return true;
  });

  ipcMain.handle('shortcuts:suspend', (_e, suspend) => {
    if (suspend) {
      globalShortcut.unregisterAll();
      shortcutsSuspended = true;
    } else {
      registerShortcuts();
      shortcutsSuspended = false;
    }
    return true;
  });

  ipcMain.handle('window:action', (e, action) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win.isDestroyed()) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
    else if (action === 'hide') win.hide();
  });

  ipcMain.handle('display:list', () => getDisplays());

  ipcMain.handle('dialog:save-scene', async (e, { which, data, defaultName }) => {
    const parent = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showSaveDialog(parent, {
      title: 'Salvar desenho tático',
      defaultPath: path.join(app.getPath('documents'), defaultName || `nexus-${which}-${stamp()}.json`),
      filters: [{ name: 'Cenário Nexus Coach', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false };
    try {
      const payload = {
        app: 'nexus-coach',
        kind: 'scene',
        version: 1,
        which: which === 'board' ? 'board' : 'overlay',
        savedAt: new Date().toISOString(),
        scene: data
      };
      fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('dialog:open-scene', async (e) => {
    const parent = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showOpenDialog(parent, {
      title: 'Abrir desenho tático',
      properties: ['openFile'],
      filters: [{ name: 'Cenário Nexus Coach', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths?.length) return { ok: false };
    try {
      const raw = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
      const scene = raw.scene || raw;
      return { ok: true, data: scene, meta: raw, path: result.filePaths[0] };
    } catch (err) {
      return { ok: false, error: 'Arquivo inválido: ' + String(err.message || err) };
    }
  });

  ipcMain.handle('dialog:export-image', async (e, { dataUrl, defaultName }) => {
    const parent = BrowserWindow.fromWebContents(e.sender);
    const result = await dialog.showSaveDialog(parent, {
      title: 'Exportar imagem',
      defaultPath: path.join(app.getPath('pictures'), defaultName || `nexus-${stamp()}.png`),
      filters: [{ name: 'Imagem PNG', extensions: ['png'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false };
    try {
      const base64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'));
      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle('capture:screen', async () => {
    const { display } = displayForSetting();
    const tmpShow = [];
    if (overlay && !overlay.isDestroyed() && overlay.isVisible()) { overlay.hide(); tmpShow.push('overlay'); }
    if (toolbar && !toolbar.isDestroyed() && toolbar.isVisible()) { toolbar.hide(); tmpShow.push('toolbar'); }
    await new Promise((r) => setTimeout(r, 220));
    try {
      const scale = display.scaleFactor || 1;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(display.size.width * scale),
          height: Math.round(display.size.height * scale)
        },
        fetchWindowIcons: false
      });
      const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
      if (!source) throw new Error('Não foi possível capturar a tela.');
      return {
        ok: true,
        dataUrl: source.thumbnail.toDataURL(),
        bounds: display.bounds,
        size: display.size,
        scaleFactor: scale,
        overlayBounds: overlay ? overlay.getBounds() : display.bounds
      };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    } finally {
      if (tmpShow.includes('overlay') && overlay && !overlay.isDestroyed() && store.ui.uiVisible) {
        overlay.showInactive();
        if (store.ui.drawMode) overlay.focus();
      }
      if (tmpShow.includes('toolbar') && toolbar && !toolbar.isDestroyed() && store.ui.uiVisible) toolbar.showInactive();
    }
  });

  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
  ipcMain.handle('clipboard:read', () => clipboard.readText());

  ipcMain.handle('app:reset-settings', () => {
    const preserved = {
      boardBounds: store.settings.board.bounds,
      settingsBounds: store.settings.settingsBounds,
      toolbar: {
        x: store.settings.toolbar.x,
        y: store.settings.toolbar.y,
        compact: { ...(store.settings.toolbar.compact || { x: null, y: null }) }
      }
    };
    store.settings = deepMerge(clone(DEFAULT_SETTINGS), preserved);
    store.ui = deepMerge(clone(DEFAULT_UI), {
      tool: store.ui.tool,
      color: store.settings.drawing.color,
      width: store.settings.drawing.width,
      opacity: store.settings.drawing.opacity,
      arrowStyle: store.settings.drawing.arrowStyle,
      aoeId: store.settings.drawing.aoeId,
      fade: store.settings.drawing.fade,
      fadeSeconds: store.settings.drawing.fadeSeconds,
      lineStyle: store.settings.drawing.lineStyle || 'solid',
      compact: false,
      drawMode: false,
      markingsVisible: true,
      uiVisible: true
    });
    compactMode = false;
    applyLoginItem();
    applyOverlaySettings();
    applyBoardSettings();
    applyToolbarPreset();
    registerShortcuts();
    scheduleSave();
    broadcastState();
    refreshTray();
    sendOverlayCommand({ type: 'sync-style' });
    sendBoardCommand({ type: 'sync-style' });
    return publicState();
  });

  ipcMain.handle('app:reset-presets', () => {
    store.presets = { custom: [] };
    scheduleSave();
    broadcastState();
    return true;
  });

  ipcMain.handle('app:clear-scenes', () => {
    store.scenes.overlay = null;
    store.scenes.board = null;
    scheduleSave();
    sendOverlayCommand({ type: 'reset-scene' });
    sendBoardCommand({ type: 'reset-scene' });
    return true;
  });

  ipcMain.handle('app:relaunch', () => {
    saveStoreNow();
    app.relaunch();
    app.exit(0);
  });

  ipcMain.handle('app:open-path', (_e, p) => {
    if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p);
  });

  ipcMain.handle('app:quit', () => { shuttingDown = true; app.quit(); });
}

function applySettingsSideEffects(patch) {
  if (patch.toolbar && (patch.toolbar.layout || patch.toolbar.size)) applyToolbarPreset();
  if (patch.interface && patch.interface.displayMode) applyToolbarPreset();
  if (patch.overlay) {
    applyOverlaySettings();
    if (overlay) overlay.webContents.send('settings:applied', publicState());
  }
  if (patch.board) applyBoardSettings();
  if (patch.shortcuts) registerShortcuts();
  if (patch.startup) applyLoginItem();
  if (patch.theme || patch.accent || patch.colors) {
    // broadcast happens in caller
  }
}

function setToolbarPanel(open, height) {
  if (!toolbar || toolbar.isDestroyed() || compactMode) return;
  if (open) {
    if (!panelOpen) {
      const bounds = toolbar.getBounds();
      collapsedToolbarHeight = Math.max(150, bounds.height);
      store.settings.toolbar.height = collapsedToolbarHeight;
    }
    panelOpen = true;
    toolbar.setResizable(false);
    const b = toolbar.getBounds();
    const display = screen.getDisplayMatching(b);
    const area = display.workArea;
    const targetH = Math.min(Math.max(height, 280), area.height - 20);
    let y = b.y;
    if (y + targetH > area.y + area.height) y = Math.max(area.y + 8, area.y + area.height - targetH);
    toolbar.setBounds({ x: b.x, y, width: b.width, height: targetH });
  } else {
    panelOpen = false;
    toolbar.setResizable(true);
    const b = toolbar.getBounds();
    toolbar.setBounds({ x: b.x, y: b.y, width: b.width, height: collapsedToolbarHeight });
  }
}

function handleCommand(cmd) {
  const { type, target } = cmd;
  switch (type) {
    case 'toggle-draw': setDrawMode(!store.ui.drawMode); return;
    case 'set-draw': setDrawMode(!!cmd.value); return;
    case 'toggle-ui': toggleUI(); return;
    case 'compact': compactApp(); return;
    case 'restore-compact': restoreApp(); return;
    case 'hide-ui': if (store.ui.uiVisible) toggleUI(); return;
    case 'toggle-board': toggleBoard(); return;
    case 'open-board': createBoard(); return;
    case 'open-settings': createSettings(); return;
    case 'clear':
      sendOverlayCommand({ type: 'clear' });
      return;
    case 'clear-temp':
      sendOverlayCommand({ type: 'clear-temp' });
      sendBoardCommand({ type: 'clear-temp' });
      return;
    case 'undo': sendOverlayCommand({ type: 'undo' }); return;
    case 'redo': sendOverlayCommand({ type: 'redo' }); return;
    case 'toggle-markings':
      store.ui.markingsVisible = !store.ui.markingsVisible;
      sendOverlayCommand({ type: 'set-markings-visible', value: store.ui.markingsVisible });
      broadcastState();
      return;
    case 'overlay':
      if (target === 'board') sendBoardCommand(cmd);
      else sendOverlayCommand(cmd);
      return;
    case 'board':
      sendBoardCommand(cmd);
      return;
    case 'notify':
      notify(cmd.message || '', cmd.level || 'info');
      return;
    default:
      // Demais comandos são roteados para os renderers.
      if (target === 'board') sendBoardCommand(cmd);
      else if (target === 'overlay') sendOverlayCommand(cmd);
  }
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                          */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (store && (!store.ui.uiVisible)) {
      store.ui.uiVisible = true;
      if (overlay) overlay.showInactive();
      if (toolbar) toolbar.showInactive();
      broadcastState();
    }
    if (toolbar) { toolbar.show(); toolbar.focus(); }
    if (settingsWin) { settingsWin.show(); settingsWin.focus(); }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.nexuscoach.app');
    Menu.setApplicationMenu(null);
    loadStore();
    setupIpc();
    createOverlay();
    createToolbar();
    createTray();
    registerShortcuts();
    applyLoginItem();

    setInterval(() => {
      if (!store || !store.ui.drawMode) return;
      if (toolbar && !toolbar.isDestroyed() && toolbar.isVisible()) toolbar.moveTop();
    }, 1200);

    app.on('activate', () => {
      if (!store.ui.uiVisible) toggleUI();
      if (toolbar && !toolbar.isVisible()) toolbar.show();
    });
  });
}

app.on('window-all-closed', (e) => {
  // Mantém o app no tray.
  e.preventDefault?.();
});

app.on('before-quit', () => {
  shuttingDown = true;
  saveStoreNow();
  globalShortcut.unregisterAll();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('display-metrics-changed', () => {
  if (!store) return;
  applyOverlaySettings();
  broadcastState();
});
app.on('display-added', () => {
  if (!store) return;
  applyOverlaySettings();
  broadcastState();
});
app.on('display-removed', () => {
  if (!store) return;
  applyOverlaySettings();
  broadcastState();
});

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
