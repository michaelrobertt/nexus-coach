'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Map();
function on(channel, cb) {
  const wrapped = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, wrapped);
  listeners.set(cb, { channel, wrapped });
  return () => {
    const item = listeners.get(cb);
    if (item) ipcRenderer.removeListener(item.channel, item.wrapped);
    listeners.delete(cb);
  };
}

contextBridge.exposeInMainWorld('nexus', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  patchState: (patch) => ipcRenderer.invoke('state:patch', patch),
  patchUI: (patch) => ipcRenderer.invoke('ui:patch', patch),
  command: (cmd) => ipcRenderer.invoke('app:command', cmd),
  compactApp: () => ipcRenderer.invoke('app:compact'),
  restoreCompact: () => ipcRenderer.invoke('app:restore'),
  moveCompact: (x, y) => ipcRenderer.invoke('compact:move', { x, y }),
  autosaveScene: (which, scene) => ipcRenderer.send('scene:autosave', { which, scene }),
  setToolbarPanel: (open, height) => ipcRenderer.invoke('toolbar:set-panel', { open, height }),
  focusOverlay: () => ipcRenderer.invoke('toolbar:focus-overlay'),
  resetToolbarPosition: () => ipcRenderer.invoke('toolbar:reset-position'),
  suspendShortcuts: (suspend) => ipcRenderer.invoke('shortcuts:suspend', suspend),
  windowAction: (action) => ipcRenderer.invoke('window:action', action),
  listDisplays: () => ipcRenderer.invoke('display:list'),
  saveScene: (payload) => ipcRenderer.invoke('dialog:save-scene', payload),
  openScene: () => ipcRenderer.invoke('dialog:open-scene'),
  exportImage: (payload) => ipcRenderer.invoke('dialog:export-image', payload),
  captureScreen: () => ipcRenderer.invoke('capture:screen'),
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  resetSettings: () => ipcRenderer.invoke('app:reset-settings'),
  resetPresets: () => ipcRenderer.invoke('app:reset-presets'),
  clearScenes: () => ipcRenderer.invoke('app:clear-scenes'),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  openPath: (p) => ipcRenderer.invoke('app:open-path', p),
  quit: () => ipcRenderer.invoke('app:quit'),
  onState: (cb) => on('state:changed', cb),
  onCommand: (cb) => on('command', cb),
  onToast: (cb) => on('toast', cb),
  onShortcutStatus: (cb) => on('shortcuts:status', cb),
  onSettingsApplied: (cb) => on('settings:applied', cb)
});
