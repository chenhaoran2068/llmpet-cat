'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('pet', {
  onEvent: (cb) => ipcRenderer.on('pet:event', (_e, data) => cb(data)),
  onStats: (cb) => ipcRenderer.on('pet:stats', (_e, data) => cb(data)),
  onLook: (cb) => ipcRenderer.on('pet:look', (_e, data) => cb(data)),
  onAvoid: (cb) => ipcRenderer.on('pet:avoid', (_e, data) => cb(data)),
  onOfficeSetting: (cb) => ipcRenderer.on('pet:office-setting', (_e, data) => cb(data)),
  getStats: () => ipcRenderer.invoke('get-stats'),
  getWindowPosition: () => ipcRenderer.invoke('get-window-position'),
  getWindowSize: () => ipcRenderer.invoke('get-window-size'),
  setWindowPosition: (x, y) => ipcRenderer.send('set-window-position', x, y),
  setWindowSize: (width, height) => ipcRenderer.send('set-window-size', width, height),
  setOfficeEmptySpaceIgnore: (enabled) => ipcRenderer.send('set-office-empty-space-ignore', Boolean(enabled)),
  focusCodex: (options = {}) => ipcRenderer.send('focus-codex', options),
  focusWorkTarget: (target) => ipcRenderer.invoke('focus-work-target', target),
  breakAction: (action) => ipcRenderer.send('break-action', action),
  updateOfficeManagement: (projects) => ipcRenderer.send('office-management', projects),
  hide: () => ipcRenderer.send('hide-pet'),
  quit: () => ipcRenderer.send('quit-app'),
});
