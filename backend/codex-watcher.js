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
const MAX_FILES = 24;

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

function createCodexWatcher(core, options = {}) {
  const root = options.root || process.env.CODEX_HOME && path.join(process.env.CODEX_HOME, 'sessions') || DEFAULT_ROOT;
  const cursors = new Map();
  const meta = new Map();
  let timer = null;
  let stopped = false;

  function fields(file, extra = {}) {
    const m = meta.get(file) || {};
    return { agentId: 'codex', cwd: m.cwd, model: m.model, sessionTitle: m.title, ...extra };
  }

  function ingest(file, row) {
    if (!row || !row.type || !row.payload) return;
    const p = row.payload;
    let m = meta.get(file) || {};

    if (row.type === 'session_meta') {
      m = { ...m, sid: p.session_id || p.id, cwd: p.cwd };
      meta.set(file, m);
      if (m.sid) core.updateSession(m.sid, 'idle', 'SessionStart', fields(file, { sessionSource: 'startup' }));
      return;
    }
    if (row.type === 'turn_context') {
      m = { ...m, cwd: p.cwd || m.cwd, model: p.model || m.model };
      meta.set(file, m);
      return;
    }
    const sid = m.sid;
    if (!sid) return;

    if (row.type === 'event_msg') {
      if (p.type === 'user_message') {
        const candidate = clipTitle(p.message);
        // Keep the first meaningful task title, but allow a later substantive
        // prompt to replace it; short acknowledgements such as “确认” should
        // never turn the completion card into a meaningless label.
        if (candidate && (!m.title || candidate.length >= 12)) { m.title = candidate; meta.set(file, m); }
        core.updateSession(sid, 'thinking', 'UserPromptSubmit', fields(file));
      } else if (p.type === 'task_started') {
        core.updateSession(sid, 'thinking', 'UserPromptSubmit', fields(file));
      } else if (p.type === 'agent_message' && p.phase === 'commentary') {
        core.updateSession(sid, 'working', 'PostToolUse', fields(file, { assistantLastOutput: p.message }));
      } else if (p.type === 'task_complete') {
        const failed = p.success === false || p.status === 'failed' || Boolean(p.error);
        core.updateSession(sid, failed ? 'error' : 'idle', failed ? 'Error' : 'Stop', fields(file, { assistantLastOutput: p.last_agent_message || p.error }));
      } else if (p.type === 'task_failed' || p.type === 'task_error' || p.type === 'error') {
        core.updateSession(sid, 'error', 'Error', fields(file, { assistantLastOutput: p.message || p.error }));
      }
      return;
    }

    if (row.type === 'response_item') {
      if (p.type === 'custom_tool_call') {
        core.updateSession(sid, 'working', 'PreToolUse', fields(file, { toolName: p.name || 'tool' }));
      } else if (p.type === 'custom_tool_call_output') {
        core.updateSession(sid, 'working', 'PostToolUse', fields(file));
      } else if (p.type === 'reasoning') {
        core.updateSession(sid, 'thinking', 'Thinking', fields(file));
      }
    }
  }

  function tail(file, size) {
    const prior = cursors.get(file) || { offset: 0, rest: '' };
    const offset = size < prior.offset ? 0 : prior.offset;
    if (size <= offset) return;
    let chunk;
    try {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(size - offset);
      fs.readSync(fd, buf, 0, buf.length, offset);
      fs.closeSync(fd);
      chunk = prior.rest + buf.toString('utf8');
    } catch { return; }
    const lines = chunk.split(/\r?\n/);
    const rest = lines.pop() || '';
    cursors.set(file, { offset: size, rest });
    for (const line of lines) {
      if (!line.trim()) continue;
      try { ingest(file, JSON.parse(line)); } catch {}
    }
  }

  function poll() {
    if (stopped) return;
    const files = [];
    walkJsonl(root, files);
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const f of files.slice(0, MAX_FILES).reverse()) tail(f.fp, f.size);
  }

  function start() {
    if (timer) return stop;
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

  return { start, stop, poll };
}

module.exports = { createCodexWatcher };
