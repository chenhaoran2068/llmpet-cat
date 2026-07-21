'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell, globalShortcut, powerMonitor } = require('electron');
const config = require('./backend/config');
const { log, LOG_PATH } = require('./backend/log');
const { createCore } = require('./backend/core');
const { createCodexWatcher } = require('./backend/codex-watcher');

try { app.setName('LLMPET Cat'); } catch {}
// Keep the existing Windows identity for seamless upgrades from 0.2.x releases.
try { app.setAppUserModelId('com.myunwang.llmpetcat'); } catch {}

const WIDTH = 240;
const HEIGHT = 250;
const MUNCH_IDLE_MS = 5 * 60 * 1000;
const MUNCH_DURATION_MS = 18 * 1000;
const BREAK_INTERVAL_MS = 40 * 60 * 1000;
const VOUCHER_INTERVAL_MS = 25 * 60 * 1000;
const USER_ACTIVE_IDLE_SECONDS = 75;
let win = null;
let tray = null;
let core = null;
let stopCodexWatcher = null;
let emitTimer = null;
let savePositionTimer = null;
let munchWin = null;
let munchWarningWin = null;
let munchActive = false;
let munchDemoActive = false;
let munchWarningActive = false;
let munchCursor = null;
let munchTimer = null;
let munchWarningTimer = null;
let lastCodexActivityAt = Date.now();
let munchFiredForIdle = false;
let demoTimers = [];
let breakWin = null;
let breakTimer = null;
let activeWorkStartedAt = 0;
let completedWorkBlocks = 0;
let completedVoucherBlocks = 0;
let voucherTimer = null;
const taskToolCounts = new Map();
let focusPact = null;
let focusPactTimer = null;
let lastPetDragAt = Date.now();
let patrolActive = false;
let patrolTimers = [];

function frontendConfig() {
  const c = config.get();
  return { muted: c.muted, autostart: c.autostart, petPosition: c.petPosition };
}

function send(channel, payload) {
  if (win && !win.isDestroyed() && win.webContents) win.webContents.send(channel, payload);
}

function stats() {
  const snap = core ? core.buildSnapshot() : { sessions: [], active: null, ts: Date.now() };
  return {
    sessions: snap.sessions.map((s) => ({
      sessionId: s.id,
      project: path.basename(s.cwd || '') || 'Codex',
      state: s.state,
      badge: s.badge,
      model: s.model || null,
      idleMs: s.idleMs,
      taskTitle: s.sessionTitle || '',
      toolCalls: taskToolCounts.get(s.id) || 0,
    })),
    active: snap.active,
    userWorking: !hasActiveCodexWork() && isUserWorking(),
    ts: Date.now(),
  };
}

function scheduleStats() {
  clearTimeout(emitTimer);
  emitTimer = setTimeout(() => send('pet:stats', stats()), 30);
}

function hasActiveCodexWork() {
  const snap = core ? core.buildSnapshot() : { sessions: [] };
  return snap.sessions.some((s) => s.state === 'working' || s.state === 'thinking');
}

function isUserWorking() {
  try { return powerMonitor.getSystemIdleTime() < USER_ACTIVE_IDLE_SECONDS; }
  catch { return false; }
}

function snackOverlay(mode, duration = MUNCH_DURATION_MS) {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const bounds = display.bounds;
  const petBounds = win && !win.isDestroyed() ? win.getBounds() : { x: bounds.x + bounds.width - WIDTH, y: bounds.y + bounds.height - HEIGHT, width: WIDTH, height: HEIGHT };
  const catX = Math.round(petBounds.x + petBounds.width / 2 - bounds.x);
  const catY = Math.round(petBounds.y + petBounds.height / 2 - bounds.y);
  const overlay = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    frame: false, transparent: true, resizable: false, focusable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  overlay.setAlwaysOnTop(true, 'floating');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  overlay.webContents.on('will-navigate', (e) => e.preventDefault());
  overlay.once('ready-to-show', () => { if ((mode === 'warning' && munchWarningActive) || (mode === 'eat' && munchActive)) overlay.showInactive(); });
  overlay.loadFile(path.join(__dirname, 'renderer', 'munch.html'), {
    query: {
      mode, cursorX: String(cursor.x - bounds.x), cursorY: String(cursor.y - bounds.y),
      catX: String(catX), catY: String(catY), duration: String(duration),
    },
  });
  return { overlay, cursor };
}

function stopMunch(reason = 'stopped') {
  clearInterval(munchTimer);
  munchTimer = null;
  clearTimeout(munchWarningTimer);
  munchWarningTimer = null;
  if (!munchActive && !munchWarningActive && !munchWin && !munchWarningWin) return;
  munchActive = false;
  munchDemoActive = false;
  munchWarningActive = false;
  try { globalShortcut.unregister('Escape'); } catch {}
  if (munchWin && !munchWin.isDestroyed()) munchWin.destroy();
  if (munchWarningWin && !munchWarningWin.isDestroyed()) munchWarningWin.destroy();
  munchWin = null;
  munchWarningWin = null;
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(true, 'floating');
  rebuildTray();
  log('munch', `screen snack stopped: ${reason}`);
}

function startMunch(demo = false) {
  if (munchActive || (!demo && (hasActiveCodexWork() || isUserWorking()))) return;
  if (munchWarningWin && !munchWarningWin.isDestroyed()) munchWarningWin.destroy();
  munchWarningWin = null;
  munchWarningActive = false;
  clearTimeout(munchWarningTimer);
  munchActive = true;
  munchDemoActive = demo;
  const duration = demo ? 5 * 1000 : MUNCH_DURATION_MS;
  const snack = snackOverlay('eat', duration);
  munchWin = snack.overlay;
  munchCursor = snack.cursor;
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(true, 'screen-saver');
  munchWin.on('closed', () => { munchWin = null; });
  try { globalShortcut.register('Escape', () => stopMunch('escape')); } catch {}
  munchTimer = setInterval(() => {
    if (!munchActive || (!munchDemoActive && hasActiveCodexWork())) return stopMunch('Codex activity');
    const point = screen.getCursorScreenPoint();
    if (Math.hypot(point.x - munchCursor.x, point.y - munchCursor.y) > 3) stopMunch('mouse moved');
  }, 150);
  send('pet:event', { kind: 'munch-start', ts: Date.now() });
  rebuildTray();
  log('munch', 'screen snack started');
  if (demo) demoTimers.push(setTimeout(() => stopMunch('demo finished'), duration + 500));
}

function startMunchWarning() {
  if (munchActive || munchWarningActive || munchFiredForIdle || hasActiveCodexWork() || isUserWorking()) return;
  munchFiredForIdle = true;
  munchWarningActive = true;
  const snack = snackOverlay('warning');
  munchWarningWin = snack.overlay;
  munchWarningWin.on('closed', () => { munchWarningWin = null; });
  try { globalShortcut.register('Escape', () => stopMunch('escape')); } catch {}
  munchWarningTimer = setTimeout(() => {
    if (munchWarningActive && !hasActiveCodexWork() && !isUserWorking()) startMunch();
  }, 10 * 1000);
  send('pet:event', { kind: 'munch-warning', ts: Date.now() });
  rebuildTray();
  log('munch', 'screen snack warning started');
}

function startMunchWatch() {
  setInterval(() => {
    if (munchActive || munchWarningActive || munchFiredForIdle || hasActiveCodexWork() || isUserWorking()) return;
    if (Date.now() - lastCodexActivityAt >= MUNCH_IDLE_MS) startMunchWarning();
  }, 10 * 1000);
}

function closeBreakReminder() {
  clearTimeout(breakTimer);
  breakTimer = null;
  if (breakWin && !breakWin.isDestroyed()) breakWin.destroy();
  breakWin = null;
}

function showBreakReminder(blocks) {
  closeBreakReminder();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = display.workArea;
  const width = 520;
  const height = 270;
  breakWin = new BrowserWindow({
    x: Math.round(wa.x + (wa.width - width) / 2), y: Math.round(wa.y + (wa.height - height) / 2),
    width, height, frame: false, transparent: true, resizable: false, focusable: true,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  breakWin.setAlwaysOnTop(true, 'floating');
  breakWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  breakWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  breakWin.webContents.on('will-navigate', (e) => e.preventDefault());
  breakWin.once('ready-to-show', () => { if (breakWin) breakWin.showInactive(); });
  breakWin.on('closed', () => { breakWin = null; });
  breakWin.loadFile(path.join(__dirname, 'renderer', 'break.html'), { query: { blocks: String(blocks) } });
  breakTimer = setTimeout(closeBreakReminder, 55 * 1000);
  send('pet:event', { kind: 'break-reminder', blocks, ts: Date.now() });
  log('break', `rest reminder shown after ${blocks * 40} minutes`);
}

function startBreakWatch() {
  setInterval(() => {
    if (!hasActiveCodexWork() && !isUserWorking()) {
      activeWorkStartedAt = 0;
      completedWorkBlocks = 0;
      completedVoucherBlocks = 0;
      clearTimeout(voucherTimer);
      voucherTimer = null;
      return;
    }
    if (!activeWorkStartedAt) activeWorkStartedAt = Date.now();
    const blocks = Math.floor((Date.now() - activeWorkStartedAt) / BREAK_INTERVAL_MS);
    if (blocks > completedWorkBlocks) {
      completedWorkBlocks = blocks;
      showBreakReminder(blocks);
    }
    const voucherBlocks = Math.floor((Date.now() - activeWorkStartedAt) / VOUCHER_INTERVAL_MS);
    if (voucherBlocks > completedVoucherBlocks) {
      completedVoucherBlocks = voucherBlocks;
      send('pet:event', { kind: 'rest-voucher', blocks: voucherBlocks, ts: Date.now() });
      clearTimeout(voucherTimer);
      voucherTimer = setTimeout(() => send('pet:event', { kind: 'rest-return', ts: Date.now() }), 3 * 60 * 1000);
    }
  }, 30 * 1000);
}

function clearDemo() {
  for (const timer of demoTimers) clearTimeout(timer);
  demoTimers = [];
}

function stopFocusPact(reason = 'cancelled', announce = true) {
  if (!focusPact) return;
  const pact = focusPact;
  focusPact = null;
  clearTimeout(focusPactTimer); focusPactTimer = null;
  if (announce) send('pet:event', { kind: 'focus-cancel', minutes: pact.minutes, reason, ts: Date.now() });
  rebuildTray();
}

function startFocusPact(minutes) {
  const safeMinutes = Number(minutes);
  if (![25, 50].includes(safeMinutes)) return;
  stopFocusPact('restarted', false);
  const endsAt = Date.now() + safeMinutes * 60 * 1000;
  focusPact = { minutes: safeMinutes, endsAt };
  focusPactTimer = setTimeout(() => {
    const pact = focusPact;
    focusPact = null;
    focusPactTimer = null;
    if (pact) send('pet:event', { kind: 'focus-finish', minutes: pact.minutes, ts: Date.now() });
    rebuildTray();
  }, safeMinutes * 60 * 1000);
  send('pet:event', { kind: 'focus-start', minutes: safeMinutes, endsAt, ts: Date.now() });
  rebuildTray();
  log('focus', `focus pact started: ${safeMinutes}m`);
}

function runDemo() {
  clearDemo();
  stopMunch('demo restart');
  const cue = (ms, event) => demoTimers.push(setTimeout(() => send('pet:event', { ...event, ts: Date.now() }), ms));
  cue(0, { kind: 'greet', project: '今日剧情演示' });
  cue(2600, { kind: 'user-turn', project: '猫猫演示', task: '整理今天的任务清单' });
  cue(6000, { kind: 'demo-parallel' });
  cue(9500, { kind: 'demo-long-work' });
  cue(13500, { kind: 'turn-done', project: '猫猫演示', task: '整理今天的任务清单', detail: '完成啦！猫猫已经把清单叠好。' });
  cue(17700, { kind: 'demo-error' });
  cue(21700, { kind: 'demo-night' });
  cue(25700, { kind: 'munch-warning' });
  demoTimers.push(setTimeout(() => startMunch(true), 34700));
  log('demo', 'story demo started');
}

function activityEvents(act) {
  const s = act.session;
  if (!s) return [];
  const project = path.basename(s.cwd || '') || 'Codex';
  if (act.event === 'SessionStart') return [{ kind: 'greet', project }];
  if (act.event === 'UserPromptSubmit') {
    taskToolCounts.set(s.id, 0);
    const task = String(s.sessionTitle || project).replace(/\s+/g, ' ').trim().slice(0, 52);
    return [{ kind: 'user-turn', project, task }];
  }
  if (act.event === 'NeedInput') {
    return [{ kind: 'needs-input', project, task: String(s.sessionTitle || project).slice(0, 52) }];
  }
  if (act.event === 'PreToolUse') {
    const toolCalls = (taskToolCounts.get(s.id) || 0) + 1;
    taskToolCounts.set(s.id, toolCalls);
    if (/request[_-]?user[_-]?input|ask[_-]?user|user[_-]?input/i.test(s.lastEventTool || '')) {
      return [{ kind: 'needs-input', project }];
    }
    return [{ kind: 'operation', project, tool: s.lastEventTool || 'tool', item: taskProp(s.lastEventTool, toolCalls) }];
  }
  if (act.event === 'Error') return [{ kind: 'task-error', project, task: String(s.sessionTitle || project).slice(0, 52) }];
  if (act.event === 'Stop' && act.realCompletion) {
    const task = String(s.sessionTitle || project).replace(/\s+/g, ' ').trim().slice(0, 52);
    const detail = String(s.assistantLastOutput || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    return [{ kind: 'turn-done', project, task, detail, item: taskProp(s.lastEventTool, taskToolCounts.get(s.id) || 0) }];
  }
  return [];
}

function createWindow() {
  const saved = config.get().petPosition;
  let x = saved && saved.x;
  let y = saved && saved.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    const wa = screen.getPrimaryDisplay().workArea;
    x = wa.x + wa.width - WIDTH - 24;
    y = wa.y + wa.height - HEIGHT - 24;
  }
  win = new BrowserWindow({
    width: WIDTH, height: HEIGHT, x, y,
    frame: false, transparent: true, hasShadow: false,
    resizable: false, alwaysOnTop: true, skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('did-finish-load', () => {
    send('pet:config', frontendConfig());
    send('pet:stats', stats());
  });
  win.on('moved', () => {
    clearTimeout(savePositionTimer);
    savePositionTimer = setTimeout(() => {
      if (!win) return;
      const [px, py] = win.getPosition();
      config.save({ petPosition: { x: px, y: py } });
    }, 200);
  });
  win.on('closed', () => { win = null; });
}

function setAutostart(enabled) {
  const value = enabled !== false;
  config.save({ autostart: value });
  if (process.platform === 'win32' && app.isPackaged) {
    try { app.setLoginItemSettings({ openAtLogin: value, path: process.execPath }); }
    catch (e) { log('main', 'autostart failed:', e.message); }
  }
  rebuildTray();
}

function rebuildTray() {
  if (!tray) return;
  const c = config.get();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '🧶 陪我专注', submenu: [
      { label: '签下 25 分钟契约', click: () => startFocusPact(25) },
      { label: '签下 50 分钟契约', click: () => startFocusPact(50) },
      { type: 'separator' },
      { label: '结束本次契约', enabled: Boolean(focusPact), click: () => stopFocusPact('tray') },
    ] },
    { label: '🎲 换一个动作', click: () => send('pet:event', { kind: 'next-gif', ts: Date.now() }) },
    { label: '🐱 显示猫猫', click: () => win && win.show() },
    { label: '🎬 演示全部剧情', click: runDemo },
    { label: '🍽 停止啃屏幕', enabled: munchActive || munchWarningActive, click: () => stopMunch('tray menu') },
    { label: c.muted ? '🔔 取消静音' : '🔇 静音', click: () => { config.save({ muted: !c.muted }); send('pet:config', frontendConfig()); rebuildTray(); } },
    { label: '🪟 Windows 开机自启', type: 'checkbox', checked: c.autostart !== false, click: () => setAutostart(c.autostart === false) },
    { type: 'separator' },
    { label: '📄 打开日志', click: () => shell.openPath(LOG_PATH) },
    { label: '⏻ 退出', click: () => app.quit() },
  ]));
}

function createTray() {
  let img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  if (img.isEmpty()) img = nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('LLMPET Cat — Codex 猫猫桌宠');
  tray.on('click', () => win && (win.isVisible() ? win.hide() : win.show()));
  rebuildTray();
}

function bootCore() {
  core = createCore({
    onActivity: (act) => {
      lastCodexActivityAt = Date.now();
      munchFiredForIdle = false;
      if (munchActive || munchWarningActive) stopMunch('Codex activity');
      for (const event of activityEvents(act)) send('pet:event', { ...event, ts: Date.now() });
      scheduleStats();
    },
    onDirty: scheduleStats,
  });
  core.startStaleCleanup();
  stopCodexWatcher = createCodexWatcher(core).start();
}

function startUserActivityWatch() {
  setInterval(() => {
    if (!hasActiveCodexWork()) send('pet:stats', stats());
  }, 10 * 1000);
}

function startCursorLookWatch() {
  setInterval(() => {
    if (!win || win.isDestroyed() || hasActiveCodexWork() || !isUserWorking()) return send('pet:look', { direction: 'center' });
    const point = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    const direction = point.x < bounds.x ? 'left' : point.x > bounds.x + bounds.width ? 'right' : 'center';
    send('pet:look', { direction });
  }, 4 * 1000);
}

function taskProp(toolName, toolCalls) {
  const tool = String(toolName || '');
  if (Number(toolCalls) >= 6) return { icon: '☕', label: '长任务咖啡' };
  if (/web|search|browser|fetch|research/i.test(tool)) return { icon: '🔍', label: '查资料放大镜' };
  if (/write|edit|apply[_-]?patch|shell|command|exec|file/i.test(tool)) return { icon: '⌨️', label: '写代码键盘' };
  return { icon: '🚩', label: '完成小旗子' };
}

function stopPatrol() {
  for (const timer of patrolTimers) clearTimeout(timer);
  patrolTimers = [];
  if (!patrolActive) return;
  patrolActive = false;
  send('pet:event', { kind: 'patrol-end', ts: Date.now() });
}

function patrolOnce() {
  if (!win || win.isDestroyed() || patrolActive || hasActiveCodexWork() || isUserWorking()) return;
  // A user drag should always win over the little patrol routine.
  if (Date.now() - lastPetDragAt < 2 * 60 * 1000 || Math.random() > 0.42) return;
  const bounds = win.getBounds();
  const display = screen.getDisplayNearestPoint({ x: bounds.x + 20, y: bounds.y + 20 });
  const area = display.workArea;
  const direction = Math.random() < 0.5 ? -1 : 1;
  const distance = direction * (38 + Math.floor(Math.random() * 28));
  const targetX = Math.max(area.x, Math.min(area.x + area.width - bounds.width, bounds.x + distance));
  if (targetX === bounds.x) return;
  patrolActive = true;
  send('pet:event', { kind: 'patrol-start', ts: Date.now() });
  const steps = 3;
  for (let index = 1; index <= steps; index += 1) {
    patrolTimers.push(setTimeout(() => {
      if (!win || win.isDestroyed() || !patrolActive) return;
      win.setPosition(Math.round(bounds.x + ((targetX - bounds.x) * index) / steps), bounds.y);
      if (index === steps) {
        patrolTimers.push(setTimeout(stopPatrol, 900));
      }
    }, index * 360));
  }
}

function startPatrolWatch() {
  setInterval(patrolOnce, 45 * 1000);
}

function savePostcard(dataUrl, weekKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(weekKey))) throw new Error('Invalid postcard week');
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('Invalid postcard data');
  const content = Buffer.from(match[1], 'base64');
  if (content.length === 0 || content.length > 4 * 1024 * 1024) throw new Error('Invalid postcard size');
  const directory = path.join(app.getPath('pictures'), 'LLMPET Cat');
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `LLMPET-Cat-Weekly-${weekKey}.png`);
  fs.writeFileSync(filePath, content);
  return filePath;
}

function returnToPreviousApp() {
  if (!win || win.isDestroyed()) return;
  win.blur();
  win.hide();
}

ipcMain.handle('get-config', () => frontendConfig());
ipcMain.handle('get-stats', () => stats());
ipcMain.handle('get-window-position', () => win ? win.getPosition() : [0, 0]);
ipcMain.handle('save-postcard', (_event, dataUrl, weekKey) => savePostcard(dataUrl, weekKey));
ipcMain.on('set-window-position', (_event, x, y) => {
  if (!win || !Number.isFinite(x) || !Number.isFinite(y)) return;
  lastPetDragAt = Date.now();
  stopPatrol();
  win.setPosition(Math.round(x), Math.round(y));
});
ipcMain.on('hide-pet', () => win && win.hide());
ipcMain.on('next-gif', () => send('pet:event', { kind: 'next-gif', ts: Date.now() }));
ipcMain.on('start-focus', (_event, minutes) => startFocusPact(minutes));
ipcMain.on('focus-codex', returnToPreviousApp);
ipcMain.on('break-action', (_event, action) => {
  const kind = { water: 'break-water', breathe: 'break-breathe', find: 'break-find-cat' }[action];
  if (kind) send('pet:event', { kind, ts: Date.now() });
});
ipcMain.on('quit-app', () => app.quit());

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(() => {
    setAutostart(config.get().autostart);
    bootCore();
    createWindow();
    createTray();
    startMunchWatch();
    startBreakWatch();
    startUserActivityWatch();
    startCursorLookWatch();
    startPatrolWatch();
    if (process.env.LLMPET_DEMO === '1') setTimeout(runDemo, 1200);
    if (process.env.LLMPET_BREAK_DEMO === '1') setTimeout(() => showBreakReminder(1), 1200);
    log('main', 'LLMPET Cat ready');
  });
}

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  stopMunch('app quit');
  closeBreakReminder();
  stopFocusPact('app quit', false);
  stopPatrol();
  clearTimeout(voucherTimer);
  try { if (stopCodexWatcher) stopCodexWatcher(); } catch {}
  try { if (core) core.stopStaleCleanup(); } catch {}
  log('main', 'LLMPET Cat quit');
});
