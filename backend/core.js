'use strict';

const VALID_STATES = new Set(['idle', 'working', 'thinking', 'error', 'sleeping']);
const BUSY = new Set(['working', 'thinking']);
const SESSION_STALE_MS = 30 * 60 * 1000;
const BUSY_STALE_MS = 5 * 60 * 1000;

function createCore(options = {}) {
  const sessions = new Map();
  const onActivity = typeof options.onActivity === 'function' ? options.onActivity : () => {};
  const onDirty = typeof options.onDirty === 'function' ? options.onDirty : () => {};
  let cleanupTimer = null;

  function updateSession(sid, incomingState, event, fields = {}) {
    if (!sid) return null;
    const now = Date.now();
    const previous = sessions.get(sid);
    const s = previous || { id: sid, state: 'idle', createdAt: now, recentEvents: [] };
    const prevState = s.state;
    for (const key of ['agentId', 'cwd', 'model', 'sessionTitle']) {
      if (fields[key] != null) s[key] = fields[key];
    }
    if (fields.toolName) s.lastEventTool = fields.toolName;
    let assistantChanged = false;
    if (fields.assistantLastOutput) {
      assistantChanged = s.assistantLastOutput !== fields.assistantLastOutput;
      s.assistantLastOutput = fields.assistantLastOutput;
    }
    s.state = VALID_STATES.has(incomingState) ? incomingState : 'idle';
    let realCompletion = false;
    if (event === 'Stop') {
      s.state = 'idle';
      s.requiresCompletionAck = true;
      realCompletion = true;
    } else if (event === 'UserPromptSubmit' || event === 'PreToolUse') {
      s.requiresCompletionAck = false;
    }
    s.lastEvent = { rawEvent: event || null, at: now };
    s.recentEvents = [...s.recentEvents.slice(-7), { event, state: s.state, at: now }];
    s.updatedAt = now;
    sessions.set(sid, s);
    onActivity({ session: s, event, prevState, newState: s.state, isNew: !previous, realCompletion, assistantChanged });
    onDirty();
    return s;
  }

  function buildSnapshot() {
    const now = Date.now();
    const list = [...sessions.values()].map((s) => ({
      id: s.id, agentId: 'codex', state: s.state,
      badge: s.requiresCompletionAck ? 'done' : (BUSY.has(s.state) ? 'running' : 'idle'),
      cwd: s.cwd || '', model: s.model || null, sessionTitle: s.sessionTitle || null,
      lastEvent: s.lastEvent || null, lastEventTool: s.lastEventTool || null,
      updatedAt: s.updatedAt || 0, idleMs: now - (s.updatedAt || now),
    }));
    const active = list.sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
    return { sessions: list, active: active ? { sessionId: active.id, project: active.cwd, model: active.model } : null, ts: now };
  }

  function cleanStaleSessions() {
    const now = Date.now();
    let dirty = false;
    for (const [id, s] of sessions) {
      const idle = now - s.updatedAt;
      if (idle > SESSION_STALE_MS) { sessions.delete(id); dirty = true; }
      else if (BUSY.has(s.state) && idle > BUSY_STALE_MS) { s.state = 'idle'; dirty = true; }
    }
    if (dirty) onDirty();
  }

  return {
    sessions, VALID_STATES, updateSession, buildSnapshot,
    getSession: (id) => sessions.get(id) || null,
    ackCompletion: (id) => { const s = sessions.get(id); if (!s) return false; s.requiresCompletionAck = false; onDirty(); return true; },
    cleanStaleSessions,
    startStaleCleanup: () => { if (!cleanupTimer) { cleanupTimer = setInterval(cleanStaleSessions, 10000); if (cleanupTimer.unref) cleanupTimer.unref(); } },
    stopStaleCleanup: () => { if (cleanupTimer) clearInterval(cleanupTimer); cleanupTimer = null; },
  };
}

module.exports = { createCore, VALID_STATES };
