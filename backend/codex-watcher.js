'use strict';

// Codex does not expose Claude-style lifecycle hooks. Its local JSONL rollout
// files do contain stable task, message, and tool events, so tail them and feed
// the existing Octopus state machine with equivalent lifecycle events.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { log } = require('./log');

const DEFAULT_ROOT = path.join(os.homedir(), '.codex', 'sessions');
const POLL_MS = 700;
const ACTIVE_AGE_MS = 12 * 60 * 60 * 1000;
// This is deliberately longer than ACTIVE_AGE_MS.  A project that has gone
// quiet should leave its little cat available in the office chooser, without
// making the live state machine treat an old rollout as active work.
const PROJECT_CATALOG_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FILES = 24;
const MAX_CATALOG_FILES = 80;
// Some active Codex rollout files are hundreds of megabytes.  A bounded tail
// is enough to recover their latest state at startup; reading every byte would
// stall LLMPET and replay an entire day's task history as fresh activity.
const HISTORY_TAIL_BYTES = 768 * 1024;

function walkJsonl(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJsonl(fp, out);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      try {
        const st = fs.statSync(fp);
        if (Date.now() - st.mtimeMs <= ACTIVE_AGE_MS) out.push({ fp, mtimeMs: st.mtimeMs, size: st.size });
      } catch {}
    }
  }
}

function clipTitle(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 80) : null;
}

function rowEventAt(row) {
  const parsed = Date.parse(String(row?.timestamp || row?.payload?.timestamp || ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();
}

function createCodexWatcher(core, options = {}) {
  const root = options.root || process.env.CODEX_HOME && path.join(process.env.CODEX_HOME, 'sessions') || DEFAULT_ROOT;
  const cursors = new Map();
  const meta = new Map();
  const knownProjects = new Map();
  let timer = null;
  let stopped = false;

  function fields(file, extra = {}) {
    const m = meta.get(file) || {};
    return {
      agentId: 'codex',
      cwd: m.cwd,
      model: m.model,
      sessionTitle: m.title,
      originator: m.originator,
      sessionSource: m.sessionSource,
      threadSource: m.threadSource,
      ...extra,
    };
  }

  function rememberProject(record = {}) {
    const cwd = String(record.cwd || '').trim();
    const originator = String(record.originator || '').trim();
    if (!cwd && !originator) return;
    const key = `${originator.toLowerCase()}\u0000${cwd.toLowerCase()}`;
    const next = {
      cwd,
      originator,
      sessionSource: String(record.sessionSource || '').trim(),
      threadSource: String(record.threadSource || '').trim(),
      updatedAt: Number(record.updatedAt || Date.now()),
    };
    const previous = knownProjects.get(key);
    if (!previous || next.updatedAt >= previous.updatedAt) knownProjects.set(key, { ...previous, ...next });
  }

  function readProjectMeta(file, updatedAt) {
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const size = Math.min(fs.fstatSync(fd).size, 192 * 1024);
      const buffer = Buffer.alloc(size);
      fs.readSync(fd, buffer, 0, size, 0);
      const lines = buffer.toString('utf8').split(/\r?\n/);
      const found = {};
      for (const line of lines) {
        if (!line.trim()) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        const payload = row && row.payload;
        if (!payload) continue;
        if (row.type === 'session_meta') {
          found.sid = payload.session_id || payload.id || found.sid;
          found.cwd = payload.cwd || found.cwd;
          found.originator = payload.originator || found.originator;
          found.sessionSource = typeof payload.source === 'string' ? payload.source : found.sessionSource;
          found.threadSource = payload.thread_source || found.threadSource;
        } else if (row.type === 'turn_context') {
          found.cwd = payload.cwd || found.cwd;
          found.model = payload.model || found.model;
        }
      }
      if (Object.keys(found).length) meta.set(file, { ...(meta.get(file) || {}), ...found });
      rememberProject({ ...found, updatedAt });
    } catch {}
    finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
  }

  function hydrateKnownProjects() {
    const files = [];
    // Reuse the normal walker and then apply the longer, catalog-only cutoff.
    // It is called once at startup, so it never adds disk work to the 700 ms
    // tail loop.
    function walkCatalog(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const fp = path.join(dir, entry.name);
        if (entry.isDirectory()) walkCatalog(fp);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          try {
            const st = fs.statSync(fp);
            if (Date.now() - st.mtimeMs <= PROJECT_CATALOG_AGE_MS) files.push({ fp, mtimeMs: st.mtimeMs });
          } catch {}
        }
      }
    }
    walkCatalog(root);
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const file of files.slice(0, MAX_CATALOG_FILES)) readProjectMeta(file.fp, file.mtimeMs);
  }

  function ingest(file, row, historical = false) {
    if (!row || !row.type || !row.payload) return false;
    const p = row.payload;
    let m = meta.get(file) || {};
    const eventFields = (extra = {}) => fields(file, {
      ...extra,
      eventAt: rowEventAt(row),
      silent: Boolean(historical),
    });

    if (row.type === 'session_meta') {
      m = {
        ...m,
        sid: p.session_id || p.id,
        cwd: p.cwd,
        originator: p.originator || m.originator || '',
        sessionSource: typeof p.source === 'string' ? p.source : (m.sessionSource || ''),
        threadSource: p.thread_source || m.threadSource || '',
      };
      meta.set(file, m);
      rememberProject({ ...m, updatedAt: rowEventAt(row) });
      if (m.sid) { core.updateSession(m.sid, 'idle', 'SessionStart', eventFields()); return true; }
      return false;
    }
    if (row.type === 'turn_context') {
      m = { ...m, cwd: p.cwd || m.cwd, model: p.model || m.model };
      meta.set(file, m);
      return false;
    }
    const sid = m.sid;
    if (!sid) return false;

    if (row.type === 'event_msg') {
      if (p.type === 'user_message') {
        const candidate = clipTitle(p.message);
        // Keep the first meaningful task title, but allow a later substantive
        // prompt to replace it; short acknowledgements such as “确认” should
        // never turn the completion card into a meaningless label.
        if (candidate && (!m.title || candidate.length >= 12)) { m.title = candidate; meta.set(file, m); }
        core.updateSession(sid, 'thinking', 'UserPromptSubmit', eventFields());
      } else if (p.type === 'task_started') {
        core.updateSession(sid, 'thinking', 'UserPromptSubmit', eventFields());
      } else if (p.type === 'agent_message' && p.phase === 'commentary') {
        core.updateSession(sid, 'working', 'PostToolUse', eventFields({ assistantLastOutput: p.message }));
      } else if (p.type === 'task_complete') {
        const failed = p.success === false || p.status === 'failed' || Boolean(p.error);
        core.updateSession(sid, failed ? 'error' : 'idle', failed ? 'Error' : 'Stop', eventFields({ assistantLastOutput: p.last_agent_message || p.error }));
      } else if (p.type === 'task_failed' || p.type === 'task_error' || p.type === 'error') {
        core.updateSession(sid, 'error', 'Error', eventFields({ assistantLastOutput: p.message || p.error }));
      }
      return p.type === 'user_message'
        || p.type === 'task_started'
        || (p.type === 'agent_message' && p.phase === 'commentary')
        || p.type === 'task_complete'
        || p.type === 'task_failed'
        || p.type === 'task_error'
        || p.type === 'error';
    }
    if (row.type === 'response_item') {
      if (p.type === 'custom_tool_call') {
        const toolName = p.name || 'tool';
        const asksUser = /request[_-]?user[_-]?input|ask[_-]?user|user[_-]?input/i.test(toolName);
        core.updateSession(sid, asksUser ? 'thinking' : 'working', asksUser ? 'NeedInput' : 'PreToolUse', eventFields({ toolName }));
      } else if (p.type === 'custom_tool_call_output') {
        core.updateSession(sid, 'working', 'PostToolUse', eventFields());
      } else if (p.type === 'reasoning') {
        core.updateSession(sid, 'thinking', 'Thinking', eventFields());
      }
      return p.type === 'custom_tool_call' || p.type === 'custom_tool_call_output' || p.type === 'reasoning';
    }
    return false;
  }

  function ingestLines(file, chunk, historical, skipLeadingPartial = false) {
    const lines = chunk.split(/\r?\n/);
    const rest = lines.pop() || '';
    if (skipLeadingPartial) lines.shift();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        const handled = ingest(file, row, historical);
        // A fresh event from an unrecognised Codex schema variant still proves
        // that this exact session resumed.  Historical rows only restore the
        // pose silently; they never re-trigger an old speech bubble.
        if (!handled && (row.type === 'event_msg' || row.type === 'response_item')) {
          const sid = meta.get(file)?.sid;
          if (sid) core.updateSession(sid, 'thinking', 'SessionActivity', fields(file, {
            eventAt: rowEventAt(row), silent: Boolean(historical),
          }));
        }
      } catch {}
    }
    return rest;
  }

  function primeHistory(file, size) {
    // The catalog pass normally already read this header.  Calling it again is
    // harmless and covers a rollout that appeared between startup phases.
    if (!meta.has(file)) readProjectMeta(file, Date.now());
    const offset = Math.max(0, size - HISTORY_TAIL_BYTES);
    try {
      const fd = fs.openSync(file, 'r');
      const buffer = Buffer.alloc(size - offset);
      fs.readSync(fd, buffer, 0, buffer.length, offset);
      fs.closeSync(fd);
      ingestLines(file, buffer.toString('utf8'), true, offset > 0);
    } catch {}
    // The first live write begins exactly at the current end of the file.
    cursors.set(file, { offset: size, rest: '' });
  }

  function tail(file, size) {
    if (!cursors.has(file)) {
      primeHistory(file, size);
      return;
    }
    const prior = cursors.get(file);
    const truncated = size < prior.offset;
    const offset = truncated ? 0 : prior.offset;
    if (size <= offset) return;
    let chunk;
    try {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      fs.closeSync(fd);
      // A rollout can be replaced or truncated while Codex rotates logs.
      // Never prepend a half-line from its former contents to the new session.
      chunk = (truncated ? '' : prior.rest) + buf.toString('utf8');
    } catch { return; }
    const rest = ingestLines(file, chunk, false);
    cursors.set(file, { offset: size, rest });
  }

  function poll() {
    if (stopped) return;
    const files = [];
    walkJsonl(root, files);
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const f of files.slice(0, MAX_FILES).reverse()) tail(f.fp, f.size);
    // Discard a restored but already-old transcript before the first renderer
    // snapshot.  Without this, a previous day's completion can briefly claim
    // a live workstation immediately after LLMPET starts.
    if (typeof core.cleanStaleSessions === 'function') core.cleanStaleSessions();
  }

  function start() {
    if (timer) return stop;
    hydrateKnownProjects();
    poll();
    timer = setInterval(poll, Number(options.pollMs) || POLL_MS);
    if (timer.unref) timer.unref();
    log('codex', `watching ${root}`);
    return stop;
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    start, stop, poll,
    knownProjects: () => [...knownProjects.values()].sort((a, b) => b.updatedAt - a.updatedAt),
  };
}

module.exports = { createCodexWatcher };
