'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createKimiDesktopWatcher } = require('../backend/kimi-desktop-watcher');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmpet-kimi-desktop-'));
const wire = path.join(root, 'records', 'conversation-a', 'wire.jsonl');
fs.mkdirSync(path.dirname(wire), { recursive: true });
fs.writeFileSync(wire, '');

const conversation = {
  conversationKey: 'desktop-conversation-key-a',
  conversationId: 'desktop-conversation-id-a',
  workspacePath: '', recordsPath: wire, updatedAt: Date.now(),
};
let runner = {
  activeKernelToolCalls: [], activeKernelTurns: [], activeOperations: [], activePendingInteractions: [],
};
const calls = [];
const touched = [];
const watcher = createKimiDesktopWatcher({
  updateSession: (...args) => calls.push(args),
  touchSession: (sid) => touched.push(sid),
}, {
  root, pollMs: 60000,
  readConversations: () => [conversation],
  readRunnerState: () => runner,
});
const stop = watcher.start();

assert(calls.some(([sid, state, event, fields]) => sid === 'kimi-desktop:desktop-conversation-key-a'
  && state === 'idle' && event === 'SessionStart' && fields.originator === 'Kimi Desktop'));
assert(watcher.knownProjects().some((project) => project.originator === 'Kimi Desktop' && project.sessionSource === 'kimi-desktop'));

fs.appendFileSync(wire, [
  { type: 'turn.prompt', input: '<not inspected>' },
  { type: 'llm.request', model: 'kimi' },
  { type: 'context.append_loop_event', event: { type: 'step.begin' } },
].map((row) => JSON.stringify(row)).join('\n') + '\n');
watcher.poll();
assert(calls.some(([, state, event]) => state === 'thinking' && event === 'UserPromptSubmit'));
assert(calls.some(([, state, event]) => state === 'thinking' && event === 'Thinking'));
assert(calls.some(([, state, event, fields]) => state === 'working' && event === 'PreToolUse' && fields.toolName === 'Kimi Desktop'));

runner = { ...runner, activePendingInteractions: [{ conversationKey: conversation.conversationKey }] };
watcher.poll();
assert(calls.some(([, state, event]) => state === 'thinking' && event === 'NeedInput'));
watcher.poll();
assert(touched.includes('kimi-desktop:desktop-conversation-key-a'), 'stable active state should refresh without replaying a bubble');

runner = { activeKernelToolCalls: [], activeKernelTurns: [], activeOperations: [], activePendingInteractions: [] };
watcher.poll();
assert(calls.some(([, state, event]) => state === 'idle' && event === 'Stop'));

fs.appendFileSync(wire, JSON.stringify({ type: 'desktop.future.event' }) + '\n');
watcher.poll();
assert(calls.some(([, state, event]) => state === 'thinking' && event === 'SessionActivity'));

stop();
fs.rmSync(root, { recursive: true, force: true });
console.log('kimi desktop watcher: ok');
