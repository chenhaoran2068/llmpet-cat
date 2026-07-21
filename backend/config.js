'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { log } = require('./log');
const CONFIG_DIR = path.join(os.homedir(), '.octopus');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const DEFAULTS = Object.freeze({ petPosition: null, muted: false, autostart: true, quietMode: false, clickThrough: false, gifMood: 'balanced', fullscreenHide: true });
let cache = null;
function sanitize(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  if (raw.petPosition && Number.isFinite(raw.petPosition.x) && Number.isFinite(raw.petPosition.y)) {
    out.petPosition = { x: Math.round(raw.petPosition.x), y: Math.round(raw.petPosition.y) };
  }
  out.muted = !!raw.muted;
  out.autostart = raw.autostart !== false;
  out.quietMode = !!raw.quietMode;
  out.clickThrough = !!raw.clickThrough;
  out.gifMood = ['calm', 'balanced', 'lively'].includes(raw.gifMood) ? raw.gifMood : 'balanced';
  out.fullscreenHide = raw.fullscreenHide !== false;
  return out;
}
function load() {
  if (cache) return cache;
  try { cache = sanitize(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))); }
  catch { cache = { ...DEFAULTS }; }
  return cache;
}
function save(partial) {
  cache = sanitize({ ...load(), ...partial });
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const tmp = path.join(CONFIG_DIR, `.config.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_PATH);
  } catch (e) { log('config', 'save failed:', e.message); }
  return cache;
}
module.exports = { get: load, save, CONFIG_PATH, DEFAULTS };
