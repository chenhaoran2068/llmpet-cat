'use strict';

// Kimi Desktop keeps its own agent runtime under the app-data directory. This
// watcher intentionally uses only its conversation index, runtime state, and
// per-conversation wire records. It never reads Kimi web storage, a browser,
// a VS Code extension, credentials, titles, or message bodies.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { log } = require('./log');

const APP_DATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
const DEFAULT_ROOT = path.join(APP_DATA, 'kimi-desktop', 'daimon-share', 'daimon', 'agents', 'main');
const POLL_MS = 900;

// This tiny query runs with Kimi Desktop's bundled Python. That makes the
// integration self-contained whenever Kimi Desktop is installed; LLMPET does
// not add a native SQLite dependency and does not need system Python.
const SQLITE_QUERY = [
  'import json, sqlite3, sys',
  'db = sys.argv[1]',
  "conn = sqlite3.connect('file:' + db.replace('\\\\', '/') + '?mode=ro', uri=True)",
  "rows = conn.execute(\"SELECT conversation_key, conversation_id, COALESCE(workspace_path, ''), kernel_records_path, COALESCE(updated_at_ms, 0) FROM conversations ORDER BY updated_at_ms DESC\").fetchall()",
  'print(json.dumps([{\"conversationKey\": r[0], \"conversationId\": r[1], \"workspacePath\": r[2], \"recordsPath\": r[3], \"updatedAt\": r[4]} for r in rows]))',
].join('\n');

function desktopRoot(agentRoot) {
  return path.resolve(agentRoot, '..', '..', '..', '..');
}

function bundledPython(agentRoot) {
  return path.join(desktopRoot(agentRoot), 'daimon-bundle', 'runtime', 'python', 'cpython-3.12', 'python.exe');
}

function shortConversationId(record = {}) {
  const id = String(record.conversationId || record.conversationKey || '').replace(/[^a-z0-9]/gi, '');
  return id ? id.slice(0, 6) : '对话';
}

function desktopProjectName(record = {}) {
  const workspace = String(record.workspacePath || '').trim();
  return path.basename(workspace) || `Kimi Desktop 对话 ${shortConversationId(record)}`;
}

function readSqliteConversations(agentRoot) {
  const db = path.join(agentRoot, 'sessions', 'hosted-logical', 'conversations.sqlite');
  const python = bundledPython(agentRoot);
  if (!fs.existsSync(db) || !fs.existsSync(python)) return [];
  try {
    const stdout = execFileSync(python, ['-c', SQLITE_QUERY, db], {
      encoding: 'utf8', windowsHide: true, timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const rows = JSON.parse(String(stdout || '[]'));
    return Array.isArray(rows) ? rows.filter((row) => row && row.conversationKey && row.recordsPath) : [];
  } catch {
    return [];
  }
}

function emptyRunnerState() {
  return {
    activeKernelToolCalls: [], activeKernelTurns: [], activeOperations: [], activePendingInteractions: [],
  };
}

function readRunnerState(agentRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(agentRoot, 'runner.state.json'), 'utf8'));
    return { ...emptyRunnerState(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return emptyRunnerState();
  }
}

function matchingConversationKeys(value, keyByIdentifier, result = new Set(), depth = 0) {
  if (depth > 4 || value == null) return result;
  if (typeof value === 'string') {
    const key = keyByIdentifier.get(value);
    if (key) result.add(key);
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) matchingConversationKeys(item, keyByIdentifier, result, depth + 1);
    return result;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) matchingConversationKeys(item, keyByIdentifier, result, depth + 1);
  }
  return result;
}

function createKimiDesktopWatcher(core, options = {}) {
  const root = options.root || process.env.KIMI_DESKTOP_AGENT_HOME || DEFAULT_ROOT;
  const readConversations = options.readConversations || readSqliteConversations;
  const readState = options.readRunnerState || readRunnerState;
  const cursors = new Map();
  const conversations = new Map();
  const knownProjects = new Map();
  let lastActive = new Map();
  let timer = null;
  let stopped = false;

  function sessionId(record) {
    return `kimi-desktop:${record.conversationKey}`;
  }

  function fields(record, extra = {}) {
    return {
      agentId: 'kimi-desktop',
      cwd: String(record.workspacePath || '').trim(),
      sessionTitle: desktopProjectName(record),
      originator: 'Kimi Desktop',
      sessionSource: 'kimi-desktop',
      threadSource: 'desktop',
      ...extra,
    };
  }

  function remember(record) {
    const key = String(record.conversationKey || '');
    if (!key) return;
    knownProjects.set(key, {
      id: sessionId(record), cwd: String(record.workspacePath || '').trim(),
      project: desktopProjectName(record), sessionTitle: desktopProjectName(record),
      originator: 'Kimi Desktop', sessionSource: 'kimi-desktop', threadSource: 'desktop',
      updatedAt: Number(record.updatedAt || Date.now()),
    });
  }

  function discover() {
    const rows = readConversations(root) || [];
    const current = new Map();
    for (const row of rows) {
      const record = {
        conversationKey: String(row.conversationKey || ''),
        conversationId: String(row.conversationId || ''),
        workspacePath: String(row.workspacePath || ''),
        recordsPath: String(row.recordsPath || ''),
        updatedAt: Number(row.updatedAt || Date.now()),
      };
      if (!record.conversationKey || !record.recordsPath) continue;
      current.set(record.conversationKey, record);
      remember(record);
      const previous = conversations.get(record.conversationKey);
      conversations.set(record.conversationKey, record);
      if (!previous) {
        core.updateSession(sessionId(record), 'idle', 'SessionStart', fields(record));
        // Existing history must never be replayed as live activity at startup.
        // The runtime state below still discovers a task already in progress.
        try { cursors.set(record.recordsPath, { offset: fs.statSync(record.recordsPath).size, rest: '' }); } catch {}
      }
    }
    return current;
  }

  function update(record, state, event, extra = {}) {
    core.updateSession(sessionId(record), state, event, fields(record, extra));
  }

  function ingest(record, row) {
    if (!row || typeof row.type !== 'string') return false;
    if (row.type === 'turn.prompt') {
      update(record, 'thinking', 'UserPromptSubmit');
      return true;
    }
    if (row.type === 'llm.request') {
      update(record, 'thinking', 'Thinking');
      return true;
    }
    if (row.type === 'context.append_loop_event') {
      const eventType = String(row.event?.type || '').toLowerCase();
      if (/error|fail|interrupt/.test(eventType)) update(record, 'error', 'Error');
      else if (/complete|finish|end|stop/.test(eventType)) update(record, 'idle', 'Stop');
      else if (/begin|tool|step/.test(eventType)) update(record, 'working', 'PreToolUse', { toolName: 'Kimi Desktop' });
      else update(record, 'thinking', 'SessionActivity');
      return true;
    }
    if (row.type === 'context.append_message') {
      // The message body remains private; its arrival only proves that this
      // conversation progressed.
      update(record, 'working', 'PostToolUse');
      return true;
    }
    return false;
  }

  function tail(record) {
    let size;
    try { size = fs.statSync(record.recordsPath).size; } catch { return; }
    const prior = cursors.get(record.recordsPath) || { offset: 0, rest: '' };
    const offset = size < prior.offset ? 0 : prior.offset;
    if (size <= offset) return;
    let chunk;
    try {
      const fd = fs.openSync(record.recordsPath, 'r');
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      fs.closeSync(fd);
      chunk = prior.rest + buf.toString('utf8');
    } catch { return; }
    const lines = chunk.split(/\r?\n/);
    const rest = lines.pop() || '';
    cursors.set(record.recordsPath, { offset: size, rest });
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (!ingest(record, row)) update(record, 'thinking', 'SessionActivity');
      } catch {}
    }
  }

  function activeStates(records) {
    const identifierToKey = new Map();
    for (const record of records.values()) {
      identifierToKey.set(record.conversationKey, record.conversationKey);
      if (record.conversationId) identifierToKey.set(record.conversationId, record.conversationKey);
    }
    const state = readState(root) || emptyRunnerState();
    const states = new Map();
    const apply = (entries, value) => {
      for (const key of matchingConversationKeys(entries, identifierToKey)) states.set(key, value);
    };
    apply(state.activeKernelTurns, { state: 'thinking', event: 'Thinking' });
    apply(state.activeOperations, { state: 'working', event: 'PreToolUse', toolName: 'Kimi Desktop' });
    apply(state.activeKernelToolCalls, { state: 'working', event: 'PreToolUse', toolName: 'Kimi Desktop' });
    apply(state.activePendingInteractions, { state: 'thinking', event: 'NeedInput' });
    return states;
  }

  function reconcileRunner(records) {
    const active = activeStates(records);
    for (const [key, status] of active) {
      const record = records.get(key);
      if (!record) continue;
      const before = lastActive.get(key);
      if (!before || before.state !== status.state || before.event !== status.event) update(record, status.state, status.event, { toolName: status.toolName });
      else if (typeof core.touchSession === 'function') core.touchSession(sessionId(record));
    }
    for (const key of lastActive.keys()) {
      if (active.has(key)) continue;
      const record = records.get(key) || conversations.get(key);
      if (record) update(record, 'idle', 'Stop');
    }
    lastActive = active;
  }

  function poll() {
    if (stopped) return;
    const records = discover();
    reconcileRunner(records);
    for (const record of records.values()) tail(record);
  }

  function start() {
    if (timer) return stop;
    poll();
    timer = setInterval(poll, Number(options.pollMs) || POLL_MS);
    if (timer.unref) timer.unref();
    log('kimi-desktop', `watching ${root}`);
    return stop;
  }

  function stop() { stopped = true; if (timer) clearInterval(timer); timer = null; }
  return { start, stop, poll, knownProjects: () => [...knownProjects.values()].sort((a, b) => b.updatedAt - a.updatedAt) };
}

module.exports = { createKimiDesktopWatcher, readSqliteConversations };
