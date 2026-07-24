'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCodexWatcher } = require('../backend/codex-watcher');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'octopus-codex-'));
const file = path.join(root, 'rollout-test.jsonl');
const rows = [
  { type: 'session_meta', payload: { id: 'codex-test', cwd: 'C:\\work', originator: 'Codex Desktop' } },
  { type: 'turn_context', payload: { cwd: 'C:\\work', model: 'gpt-test' } },
  { type: 'event_msg', payload: { type: 'user_message', message: '修复登录问题' } },
  { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec' } },
  { type: 'response_item', payload: { type: 'custom_tool_call', name: 'request_user_input' } },
  { type: 'event_msg', payload: { type: 'task_complete', last_agent_message: '已经修复' } },
];
fs.writeFileSync(file, rows.map((x) => JSON.stringify(x)).join('\n') + '\n');

const calls = [];
const watcher = createCodexWatcher({
  updateSession: (...args) => calls.push(args),
}, { root, pollMs: 60000 });

const stop = watcher.start();

assert(calls.some(([sid, state, event, f]) => sid === 'codex-test' && state === 'thinking' && event === 'UserPromptSubmit' && f.agentId === 'codex'));
assert(calls.some(([, state, event, f]) => state === 'working' && event === 'PreToolUse' && f.toolName === 'exec'));
assert(calls.some(([, state, event, f]) => state === 'thinking' && event === 'NeedInput' && f.toolName === 'request_user_input'));
assert(calls.some(([, state, event, f]) => state === 'idle' && event === 'Stop' && f.assistantLastOutput === '已经修复'));
assert(calls.some(([, , , f]) => f.model === 'gpt-test' && f.sessionTitle === '修复登录问题'));

assert(calls.every(([, , , fields]) => fields && fields.silent), 'initial transcript replay must be silent');
assert(watcher.knownProjects().some((project) => project.cwd === 'C:\\work' && project.originator === 'Codex Desktop'));

// A rollout can gain a record type before the watcher has an explicit branch
// for it. That new record must wake a cat that had gone into its rest loop.
fs.appendFileSync(file, JSON.stringify({ type: 'response_item', payload: { type: 'future_activity', detail: 'resume' } }) + '\n');
watcher.poll();
assert(calls.some(([sid, state, event, fields]) => sid === 'codex-test' && state === 'thinking' && event === 'SessionActivity' && !fields.silent));

stop();

fs.rmSync(root, { recursive: true, force: true });
console.log('codex watcher: ok');
