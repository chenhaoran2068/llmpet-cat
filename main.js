'use strict';

const path = require('path');
const { execFile } = require('child_process');
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell, globalShortcut, powerMonitor } = require('electron');
const config = require('./backend/config');
const { log, LOG_PATH } = require('./backend/log');
const { createCore } = require('./backend/core');
const { createCodexWatcher } = require('./backend/codex-watcher');
const { createKimiDesktopWatcher } = require('./backend/kimi-desktop-watcher');
const { workTargetFor } = require('./backend/work-target');
const { normalizeWorkSourcePresence, isWorkSourceAvailable } = require('./backend/work-source-presence');
const { bottomRightInWorkArea, resizeBoundsInWorkArea } = require('./backend/window-placement');

try { app.setName('LLMPET Cat'); } catch {}
// Keep the existing Windows identity for seamless upgrades from 0.2.x releases.
try { app.setAppUserModelId('com.myunwang.llmpetcat'); } catch {}

const WIDTH = 240;
const HEIGHT = 250;
const MUNCH_IDLE_MS = 5 * 60 * 1000;
const MUNCH_DURATION_MS = 18 * 1000;
const BREAK_INTERVAL_MS = 40 * 60 * 1000;
const BREAK_REMINDER_DURATION_MS = 5 * 60 * 1000;
const VOUCHER_INTERVAL_MS = 25 * 60 * 1000;
const USER_ACTIVE_IDLE_SECONDS = 75;
const DEFAULT_WINDOW_EDGE_GAP = 12;
let win = null;
let tray = null;
let core = null;
let stopCodexWatcher = null;
let codexWatcher = null;
let stopKimiWatcher = null;
let kimiWatcher = null;
let emitTimer = null;
let emitDueAt = 0;
let savePositionTimer = null;
let munchWin = null;
let munchWarningWin = null;
let munchActive = false;
let munchWarningActive = false;
let munchCursor = null;
let munchTimer = null;
let munchWarningTimer = null;
let munchPetWasVisible = false;
let lastCodexActivityAt = Date.now();
let munchFiredForIdle = false;
let breakWin = null;
let breakTimer = null;
let activeWorkStartedAt = 0;
let completedWorkBlocks = 0;
let completedVoucherBlocks = 0;
let voucherTimer = null;
const taskToolCounts = new Map();
let lastPetDragAt = Date.now();
let patrolActive = false;
let patrolTimers = [];
let fullscreenHidden = false;
let fullscreenProbeBusy = false;
let lastCodexWindowPid = 0;
let lastCodexWindowAt = 0;
let officeManagement = [];
let officeTargets = [];
// Start optimistic so the first render never flashes all cats away while the
// Windows process probe is still starting.  The probe replaces this within a
// couple of seconds and then drives immediate hide/show updates.
let workSourcePresence = normalizeWorkSourcePresence();
let workSourcePresenceProbeBusy = false;
let keepBottomRightDock = true;
let officeEmptySpaceIgnore = false;

const OFFICE_IDENTITY_LABELS = {
  plain: '原味猫',
  programmer: '圆墨镜程序猫',
  writer: '贝雷帽作家猫',
  analyst: '英伦西服分析猫',
  chubby: '可乐小胖猫',
};

function applyOfficeEmptySpaceHitTesting() {
  if (!win || win.isDestroyed()) return;
  // This is not a user preference: in project-office mode, unused transparent
  // pixels are simply not part of the pet's visible interface and must not
  // block the real desktop beneath them.
  win.setIgnoreMouseEvents(officeEmptySpaceIgnore, { forward: true });
}

function send(channel, payload) {
  if (win && !win.isDestroyed() && win.webContents) win.webContents.send(channel, payload);
}

function stats() {
  const snap = core ? core.buildSnapshot() : { sessions: [], active: null, ts: Date.now() };
  return {
    sessions: snap.sessions.map((s) => {
      const target = workTargetFor(s);
      return {
      sessionId: s.id,
      project: target.project,
      projectPath: s.cwd || '',
      targetKey: target.key,
      targetSource: target.source,
      targetLabel: target.label,
      sourceAvailable: isWorkSourceAvailable(workSourcePresence, target.source),
      state: s.state,
      badge: s.badge,
      model: s.model || null,
      idleMs: s.idleMs,
      updatedAt: s.updatedAt || 0,
      lastEvent: s.lastEvent?.rawEvent || null,
      taskTitle: s.sessionTitle || '',
      lastTool: s.lastEventTool || '',
      originator: s.originator || '',
      sessionSource: s.sessionSource || '',
      threadSource: s.threadSource || '',
      toolCalls: taskToolCounts.get(s.id) || 0,
      };
    }),
    active: snap.active,
    knownProjects: [
      ...(codexWatcher ? codexWatcher.knownProjects() : []),
      ...(kimiWatcher ? kimiWatcher.knownProjects() : []),
    ].map((project) => {
      const target = workTargetFor(project);
      return {
        project: target.project,
        projectPath: project.cwd || '',
        targetKey: target.key,
        targetSource: target.source,
        targetLabel: target.label,
        sourceAvailable: isWorkSourceAvailable(workSourcePresence, target.source),
        originator: project.originator || '',
        sessionSource: project.sessionSource || '',
        threadSource: project.threadSource || '',
        updatedAt: project.updatedAt || 0,
      };
    }),
    userWorking: !hasActiveCodexWork() && isUserWorking(),
    ts: Date.now(),
  };
}

function scheduleStats(delay = 30) {
  const safeDelay = Math.max(0, Number(delay) || 0);
  const dueAt = Date.now() + safeDelay;
  // `updateSession` invokes onActivity and then onDirty synchronously.  Keep
  // the immediate activity refresh instead of letting the later dirty debounce
  // postpone it.  This is what makes a resumed project leave its rest pose in
  // the same event turn rather than appearing one poll behind.
  if (emitTimer && emitDueAt <= dueAt) return;
  clearTimeout(emitTimer);
  emitDueAt = dueAt;
  emitTimer = setTimeout(() => {
    emitTimer = null;
    emitDueAt = 0;
    send('pet:stats', stats());
  }, safeDelay);
}

function hasActiveCodexWork() {
  const snap = core ? core.buildSnapshot() : { sessions: [] };
  return snap.sessions.some((s) => (s.state === 'working' || s.state === 'thinking')
    && isWorkSourceAvailable(workSourcePresence, workTargetFor(s).source));
}

function isUserWorking() {
  try { return powerMonitor.getSystemIdleTime() < USER_ACTIVE_IDLE_SECONDS; }
  catch { return false; }
}

// Windows sometimes reports a shifted work-area origin to the Electron main
// process even though the primary display itself begins at (0, 0).  This pet
// is explicitly docked above the bottom taskbar, so pair the display origin
// with the usable work-area width/height for stable lower-right placement.
function primaryBottomWorkArea() {
  const display = screen.getPrimaryDisplay();
  return { ...display.workArea, x: display.bounds.x, y: display.bounds.y };
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
  munchWarningActive = false;
  try { globalShortcut.unregister('Escape'); } catch {}
  if (munchWin && !munchWin.isDestroyed()) munchWin.destroy();
  if (munchWarningWin && !munchWarningWin.isDestroyed()) munchWarningWin.destroy();
  munchWin = null;
  munchWarningWin = null;
  if (win && !win.isDestroyed()) {
    win.setAlwaysOnTop(true, 'floating');
    if (munchPetWasVisible) { win.showInactive(); applyOfficeEmptySpaceHitTesting(); }
  }
  munchPetWasVisible = false;
  rebuildTray();
  log('munch', `screen snack stopped: ${reason}`);
}

function startMunch() {
  if (munchActive || hasActiveCodexWork() || isUserWorking()) return;
  if (munchWarningWin && !munchWarningWin.isDestroyed()) munchWarningWin.destroy();
  munchWarningWin = null;
  munchWarningActive = false;
  clearTimeout(munchWarningTimer);
  munchActive = true;
  const duration = MUNCH_DURATION_MS;
  const snack = snackOverlay('eat', duration);
  munchWin = snack.overlay;
  munchCursor = snack.cursor;
  if (win && !win.isDestroyed()) {
    munchPetWasVisible = win.isVisible();
    win.hide();
  }
  munchWin.on('closed', () => { munchWin = null; });
  try { globalShortcut.register('Escape', () => stopMunch('escape')); } catch {}
  munchTimer = setInterval(() => {
    if (!munchActive || hasActiveCodexWork()) return stopMunch('Codex activity');
    const point = screen.getCursorScreenPoint();
    if (Math.hypot(point.x - munchCursor.x, point.y - munchCursor.y) > 3) stopMunch('mouse moved');
  }, 150);
  send('pet:event', { kind: 'munch-start', ts: Date.now() });
  rebuildTray();
  log('munch', 'screen snack started');
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
  breakTimer = setTimeout(closeBreakReminder, BREAK_REMINDER_DURATION_MS);
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

function activityEvents(act) {
  const s = act.session;
  if (!s) return [];
  const target = workTargetFor(s);
  const project = target.project;
  if (act.event === 'SessionStart') return [{ kind: 'greet', project, target }];
  if (act.event === 'UserPromptSubmit') {
    taskToolCounts.set(s.id, 0);
    const task = String(s.sessionTitle || project).replace(/\s+/g, ' ').trim().slice(0, 52);
    return [{ kind: 'user-turn', project, task, target }];
  }
  if (act.event === 'NeedInput') {
    return [{ kind: 'needs-input', project, task: String(s.sessionTitle || project).slice(0, 52), target }];
  }
  if (act.event === 'PreToolUse') {
    const toolCalls = (taskToolCounts.get(s.id) || 0) + 1;
    taskToolCounts.set(s.id, toolCalls);
    if (/request[_-]?user[_-]?input|ask[_-]?user|user[_-]?input/i.test(s.lastEventTool || '')) {
      return [{ kind: 'needs-input', project, target }];
    }
    return [{ kind: 'operation', project, tool: s.lastEventTool || 'tool', item: taskProp(s.lastEventTool, toolCalls), target }];
  }
  if (act.event === 'Error') return [{ kind: 'task-error', project, task: String(s.sessionTitle || project).slice(0, 52), target }];
  if (act.event === 'Stop' && act.realCompletion) {
    const task = String(s.sessionTitle || project).replace(/\s+/g, ' ').trim().slice(0, 52);
    const detail = String(s.assistantLastOutput || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    return [{ kind: 'turn-done', project, task, detail, item: taskProp(s.lastEventTool, taskToolCounts.get(s.id) || 0), target }];
  }
  return [];
}

function createWindow() {
  // Every app launch starts in the predictable lower-right work area, above
  // the Windows taskbar. A user may still drag it freely for this session.
  const { x, y } = bottomRightInWorkArea(
    primaryBottomWorkArea(),
    { width: WIDTH, height: HEIGHT },
    DEFAULT_WINDOW_EDGE_GAP,
  );
  keepBottomRightDock = true;
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
  applyOfficeEmptySpaceHitTesting();
  const dockAtBottomRight = (width = win.getBounds().width, height = win.getBounds().height) => {
    if (!win || win.isDestroyed()) return;
    const position = bottomRightInWorkArea(
      primaryBottomWorkArea(),
      { width, height },
      DEFAULT_WINDOW_EDGE_GAP,
    );
    win.setPosition(position.x, position.y);
  };
  // Windows can reconcile an initially hidden transparent window after its
  // renderer is ready. Apply the same work-area placement once more after that
  // reconciliation, rather than trusting the constructor coordinates alone.
  win.once('ready-to-show', () => { if (keepBottomRightDock) dockAtBottomRight(); });
  win.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('did-finish-load', () => {
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
  let officeMenu = officeManagement.length ? officeManagement.map((project) => ({
    label: project.label,
    submenu: [
      {
        label: '显示这个项目', type: 'checkbox', checked: project.visible !== false,
        click: (item) => send('pet:office-setting', { kind: 'station-visible', id: project.key, visible: item.checked }),
      },
      { type: 'separator' },
      {
        label: '负责猫猫',
        submenu: [
          ...Object.entries(OFFICE_IDENTITY_LABELS).map(([identity, label]) => ({
            label, type: 'radio', checked: project.identity === identity,
            click: () => send('pet:office-setting', { kind: 'station-identity', id: project.key, identity }),
          })),
        ],
      },
    ],
  })) : [{ label: '暂时没有可管理的工位', enabled: false }];
  if (officeTargets.length) {
    officeMenu.push({
      label: '新增工位',
      submenu: officeTargets.map((target) => ({
        label: target.label,
        click: () => send('pet:office-setting', { kind: 'station-add', targetKey: target.key }),
      })),
    });
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '🐱 显示猫猫', click: () => win && win.show() },
    { label: '🐾 办公桌管理', submenu: officeMenu },
    { label: '🍽 停止啃屏幕', enabled: munchActive || munchWarningActive, click: () => stopMunch('tray menu') },
    { label: '🖥️ 全屏自动隐藏', type: 'checkbox', checked: c.fullscreenHide !== false, click: () => { config.save({ fullscreenHide: c.fullscreenHide === false }); rebuildTray(); } },
    ...(process.platform === 'win32' ? [{
      label: '🪟 Windows 开机自启', type: 'checkbox', checked: c.autostart !== false,
      click: () => setAutostart(c.autostart === false),
    }] : []),
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
      scheduleStats(0);
    },
    onDirty: scheduleStats,
  });
  core.startStaleCleanup();
  codexWatcher = createCodexWatcher(core);
  stopCodexWatcher = codexWatcher.start();
  kimiWatcher = createKimiDesktopWatcher(core);
  stopKimiWatcher = kimiWatcher.start();
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

const WORK_WINDOW_PROBE = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class LLMPETWorkWindowProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$h = [LLMPETWorkWindowProbe]::GetForegroundWindow()
if ($h -eq [IntPtr]::Zero) { exit }
[uint32]$foregroundPid = 0; [void][LLMPETWorkWindowProbe]::GetWindowThreadProcessId($h, [ref]$foregroundPid)
try { $p = Get-Process -Id $foregroundPid -ErrorAction Stop } catch { exit }
@{ pid = [int]$foregroundPid; name = $p.ProcessName } | ConvertTo-Json -Compress
`;

// Keep the office tied to actual applications, not merely to their recent
// transcript files.  A hidden PowerShell probe has no MainWindowHandle, so it
// cannot accidentally keep the CLI source alive by observing itself.
const WORK_SOURCE_PRESENCE_PROBE = `
$sources = [ordered]@{
  'desktop' = @('codex')
  'vscode' = @('code')
  'cli' = @('windowsterminal', 'powershell', 'pwsh', 'cmd')
  'kimi-desktop' = @('kimi')
}
$result = [ordered]@{}
foreach ($entry in $sources.GetEnumerator()) {
  $processes = @(Get-Process -Name $entry.Value -ErrorAction SilentlyContinue)
  # Desktop Electron apps can keep their actual UI in a child process whose
  # MainWindowHandle is zero.  A CLI, by contrast, needs a real terminal
  # window so our own hidden PowerShell probe cannot count as user work.
  if ($entry.Key -eq 'cli') { $processes = @($processes | Where-Object { $_.MainWindowHandle -ne 0 }) }
  $result[$entry.Key] = $processes.Count -gt 0
}
$result | ConvertTo-Json -Compress
`;

function refreshWorkSourcePresence() {
  if (process.platform !== 'win32' || workSourcePresenceProbeBusy) return;
  workSourcePresenceProbeBusy = true;
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WORK_SOURCE_PRESENCE_PROBE], { windowsHide: true, timeout: 1400 }, (_error, stdout) => {
    workSourcePresenceProbeBusy = false;
    let next;
    try { next = normalizeWorkSourcePresence(JSON.parse(String(stdout || '').trim())); }
    catch { return; }
    if (JSON.stringify(next) === JSON.stringify(workSourcePresence)) return;
    workSourcePresence = next;
    scheduleStats();
  });
}

function startWorkSourcePresenceWatch() {
  if (process.platform !== 'win32') return;
  refreshWorkSourcePresence();
  setInterval(refreshWorkSourcePresence, 2200);
}

function startWorkWindowWatch() {
  if (process.platform !== 'win32') return;
  setInterval(() => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WORK_WINDOW_PROBE], { windowsHide: true, timeout: 1200 }, (_error, stdout) => {
      try {
        const data = JSON.parse(String(stdout || '').trim());
        if (/^(code|codex|windowsterminal|powershell|pwsh|cmd)$/i.test(String(data.name || ''))) {
          lastCodexWindowPid = Number(data.pid) || 0;
          lastCodexWindowAt = Date.now();
        }
      } catch {}
    });
  }, 1800);
}

function focusRecentCodexWindow() {
  if (process.platform !== 'win32' || !lastCodexWindowPid || Date.now() - lastCodexWindowAt > 30 * 60 * 1000) return;
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class LLMPETWindowFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int cmd);
}
"@
try {
  $p = Get-Process -Id ${lastCodexWindowPid} -ErrorAction Stop
  $h = $p.MainWindowHandle
  if ($h -ne 0) {
    [void][LLMPETWindowFocus]::ShowWindowAsync([IntPtr]$h, 9)
    Start-Sleep -Milliseconds 50
    [void][LLMPETWindowFocus]::SetForegroundWindow([IntPtr]$h)
  }
} catch {}
`;
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 1500 }, () => {});
}

function focusWorkTarget(target = {}) {
  const source = ['vscode', 'desktop', 'cli', 'kimi-desktop'].includes(target.source) ? target.source : '';
  const project = String(target.project || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 120);
  const projectPath = String(target.projectPath || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 360);
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, reason: '此平台暂不支持窗口唤回。' });
  if (!source) return Promise.resolve({ ok: false, reason: '这个工位尚未绑定可唤回的工作目标。' });
  if (!project && !projectPath) return Promise.resolve({ ok: false, reason: '这个工位缺少项目位置，未尝试跳转。' });
  const sourceLiteral = JSON.stringify(source);
  const projectLiteral = JSON.stringify(project);
  const projectPathLiteral = JSON.stringify(projectPath);
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class LLMPETProjectFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int cmd);
}
"@
$source = ${sourceLiteral}
$project = ${projectLiteral}
$projectPath = ${projectPathLiteral}
$pattern = switch ($source) {
  'vscode' { '^(code)$' }
  'desktop' { '^(codex)$' }
  'cli' { '^(windowsterminal|powershell|pwsh|cmd)$' }
  'kimi-desktop' { '^(kimi)$' }
  default { '^$' }
}
$matches = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.MainWindowHandle -ne 0 -and $_.ProcessName -match $pattern
} | ForEach-Object {
  $title = [string]$_.MainWindowTitle
  $score = 0
  if ($projectPath -and $title.IndexOf($projectPath, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $score += 2000 }
  if ($project -and $project -ne 'Codex' -and $title.IndexOf($project, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $score += 1000 }
  [PSCustomObject]@{ Process = $_; Score = $score }
} | Sort-Object Score -Descending)
$best = $matches | Select-Object -First 1
# A lone Codex Desktop window is safe to activate even when its title does not
# expose the project.  VS Code and terminal targets require a title match so
# they never fall through to an unrelated recent window.
$allowSingleDesktop = ($source -eq 'desktop' -or $source -eq 'kimi-desktop') -and $matches.Count -eq 1
if ($best -and ($best.Score -ge 1000 -or $allowSingleDesktop)) {
  [void][LLMPETProjectFocus]::ShowWindowAsync([IntPtr]$best.Process.MainWindowHandle, 9)
  Start-Sleep -Milliseconds 40
  [void][LLMPETProjectFocus]::SetForegroundWindow([IntPtr]$best.Process.MainWindowHandle)
  '{"ok":true}'
} else { '{"ok":false,"reason":"未找到与该工位绑定目标匹配的窗口。"}' }
`;
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 1800 }, (error, stdout) => {
      if (error) return resolve({ ok: false, reason: '查找目标窗口时超时或失败。' });
      try { return resolve(JSON.parse(String(stdout || '').trim())); }
      catch { return resolve({ ok: false, reason: '未找到与该工位绑定目标匹配的窗口。' }); }
    });
  });
}

function startAvoidanceWatch() {
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const bounds = win.getBounds();
    const point = screen.getCursorScreenPoint();
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 78 };
    const near = Math.hypot(point.x - center.x, point.y - center.y) < 112;
    send('pet:avoid', { near });
  }, 180);
}

const FULLSCREEN_PROBE = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class LLMPETFullscreenProbe {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, int flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@
$petPid = ${process.pid}
$h = [LLMPETFullscreenProbe]::GetForegroundWindow()
if ($h -eq [IntPtr]::Zero) { '0'; exit }
[uint32]$foregroundPid = 0; [void][LLMPETFullscreenProbe]::GetWindowThreadProcessId($h, [ref]$foregroundPid)
try { $selfName = (Get-Process -Id $petPid -ErrorAction Stop).ProcessName; $frontName = (Get-Process -Id $foregroundPid -ErrorAction Stop).ProcessName } catch { '0'; exit }
if ($frontName -eq $selfName) { '0'; exit }
$rect = New-Object LLMPETFullscreenProbe+RECT; if (-not [LLMPETFullscreenProbe]::GetWindowRect($h, [ref]$rect)) { '0'; exit }
$info = New-Object LLMPETFullscreenProbe+MONITORINFO; $info.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($info)
if (-not [LLMPETFullscreenProbe]::GetMonitorInfo([LLMPETFullscreenProbe]::MonitorFromWindow($h, 2), [ref]$info)) { '0'; exit }
$full = [Math]::Abs($rect.Left - $info.rcMonitor.Left) -le 8 -and [Math]::Abs($rect.Top - $info.rcMonitor.Top) -le 8 -and [Math]::Abs($rect.Right - $info.rcMonitor.Right) -le 8 -and [Math]::Abs($rect.Bottom - $info.rcMonitor.Bottom) -le 8
if ($full) { '1' } else { '0' }
`;

function startFullscreenWatch() {
  if (process.platform !== 'win32') return;
  setInterval(() => {
    if (fullscreenProbeBusy || !win || win.isDestroyed()) return;
    if (config.get().fullscreenHide === false) {
      if (fullscreenHidden) { fullscreenHidden = false; win.showInactive(); applyOfficeEmptySpaceHitTesting(); }
      return;
    }
    fullscreenProbeBusy = true;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', FULLSCREEN_PROBE], { windowsHide: true, timeout: 1500 }, (_error, stdout) => {
      fullscreenProbeBusy = false;
      const isFullscreen = String(stdout || '').trim().endsWith('1');
      if (isFullscreen && !fullscreenHidden) { fullscreenHidden = true; win.hide(); }
      else if (!isFullscreen && fullscreenHidden) { fullscreenHidden = false; win.showInactive(); applyOfficeEmptySpaceHitTesting(); }
    });
  }, 3500);
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

function returnToPreviousApp(options = {}) {
  if (!win || win.isDestroyed()) return;
  win.blur();
  if (!options.keepPet) win.hide();
  focusRecentCodexWindow();
}

ipcMain.handle('get-stats', () => stats());
ipcMain.handle('get-window-position', () => win ? win.getPosition() : [0, 0]);
ipcMain.handle('get-window-size', () => win ? win.getSize() : [WIDTH, HEIGHT]);
ipcMain.on('set-window-position', (_event, x, y) => {
  if (!win || !Number.isFinite(x) || !Number.isFinite(y)) return;
  lastPetDragAt = Date.now();
  keepBottomRightDock = false;
  stopPatrol();
  win.setPosition(Math.round(x), Math.round(y));
});
ipcMain.on('set-window-size', (_event, width, height) => {
  if (!win || !Number.isFinite(width) || !Number.isFinite(height)) return;
  // Five visible projects plus a manga speech balloon legitimately need a
  // taller stage.  Leave the normal compact layouts unchanged, but never clip
  // a speaking cat simply because the old fixed cap assumed one-row scenes.
  const requested = { width: Math.max(180, Math.min(420, Math.round(width))), height: Math.max(170, Math.min(760, Math.round(height))) };
  const current = win.getBounds();
  // Use the display where the pet already is, not the primary display and not
  // the cursor display.  A user can freely park it on any monitor/edge.
  const display = screen.getDisplayMatching(current) || screen.getPrimaryDisplay();
  const nextBounds = resizeBoundsInWorkArea(display.workArea, current, requested, 4);
  // One atomic native update prevents the intermediate off-screen flash caused
  // by setSize() followed by a separate setPosition().
  win.setBounds(nextBounds);
});
ipcMain.on('set-office-empty-space-ignore', (_event, enabled) => {
  officeEmptySpaceIgnore = Boolean(enabled);
  applyOfficeEmptySpaceHitTesting();
});
ipcMain.on('hide-pet', () => win && win.hide());
ipcMain.on('focus-codex', (_event, options) => returnToPreviousApp({ keepPet: Boolean(options && options.keepPet) }));
ipcMain.handle('focus-work-target', (_event, target) => {
  if (!win || win.isDestroyed()) return { ok: false, reason: '猫猫窗口当前不可用。' };
  win.blur();
  return focusWorkTarget(target && typeof target === 'object' ? target : {});
});
ipcMain.on('break-action', (_event, action) => {
  if (action === 'close') {
    closeBreakReminder();
    send('pet:event', { kind: 'break-dismissed', ts: Date.now() });
    return;
  }
  const kind = { water: 'break-water', breathe: 'break-breathe', find: 'break-find-cat' }[action];
  if (kind) send('pet:event', { kind, ts: Date.now() });
});
ipcMain.on('office-management', (_event, payload) => {
  if (!payload || !Array.isArray(payload.stations)) return;
  officeManagement = payload.stations
    .filter((station) => station && typeof station.id === 'string' && typeof station.label === 'string')
    .slice(0, 12)
    .map((station) => ({
      key: station.id.slice(0, 240),
      label: station.label.slice(0, 80),
      visible: station.visible !== false,
      identity: Object.hasOwn(OFFICE_IDENTITY_LABELS, station.identity) ? station.identity : '',
    }));
  officeTargets = Array.isArray(payload.targets)
    ? payload.targets
      .filter((target) => target && typeof target.key === 'string' && typeof target.label === 'string')
      .slice(0, 12)
      .map((target) => ({ key: target.key.slice(0, 240), label: target.label.slice(0, 100) }))
    : [];
  rebuildTray();
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
    startWorkWindowWatch();
    startWorkSourcePresenceWatch();
    startAvoidanceWatch();
    startFullscreenWatch();
    startPatrolWatch();
    if (process.env.LLMPET_BREAK_DEMO === '1') setTimeout(() => showBreakReminder(1), 1200);
    log('main', 'LLMPET Cat ready');
  });
}

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  stopMunch('app quit');
  closeBreakReminder();
  stopPatrol();
  clearTimeout(voucherTimer);
  try { if (stopCodexWatcher) stopCodexWatcher(); } catch {}
  try { if (stopKimiWatcher) stopKimiWatcher(); } catch {}
  try { if (core) core.stopStaleCleanup(); } catch {}
  log('main', 'LLMPET Cat quit');
});
