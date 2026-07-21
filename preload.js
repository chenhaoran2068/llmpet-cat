'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pet', {
  onEvent: (cb) => ipcRenderer.on('pet:event', (_e, data) => cb(data)),
  onStats: (cb) => ipcRenderer.on('pet:stats', (_e, data) => cb(data)),
  onConfig: (cb) => ipcRenderer.on('pet:config', (_e, data) => cb(data)),
  onLook: (cb) => ipcRenderer.on('pet:look', (_e, data) => cb(data)),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getStats: () => ipcRenderer.invoke('get-stats'),
  getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
  savePostcard: (dataUrl, weekKey) => ipcRenderer.invoke('save-postcard', dataUrl, weekKey),
  setWindowPosition: (x, y) => ipcRenderer.send('set-window-position', x, y),
  nextGif: () => ipcRenderer.send('next-gif'),
  startFocus: (minutes) => ipcRenderer.send('start-focus', minutes),
  focusCodex: () => ipcRenderer.send('focus-codex'),
  breakAction: (action) => ipcRenderer.send('break-action', action),
  hide: () => ipcRenderer.send('hide-pet'),
  quit: () => ipcRenderer.send('quit-app'),
});
