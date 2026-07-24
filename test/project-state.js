'use strict';

const assert = require('assert');
const state = require('../renderer/project-state');

const working = { state: 'working', updatedAt: 100 };
const newerIdle = { state: 'idle', updatedAt: 200 };
const oldError = { state: 'error', updatedAt: 50 };
const needsInput = { state: 'thinking', lastEvent: 'NeedInput', updatedAt: 175 };
const newerCompletion = { state: 'idle', badge: 'done', lastEvent: 'Stop', updatedAt: 220 };
const newerAnalysis = { state: 'thinking', lastEvent: 'Thinking', updatedAt: 230 };

assert.strictEqual(state.choosePresentation(working, newerIdle), working,
  'an active sibling session must not be hidden by a newer idle transcript');
assert.strictEqual(state.choosePresentation(oldError, working), working,
  'a new active turn must replace an earlier error pose for the shared project cat');
assert.strictEqual(state.choosePresentation(working, needsInput), needsInput,
  'a request for a user decision must take precedence over ordinary work');
assert.strictEqual(state.choosePresentation(working, newerCompletion), newerCompletion,
  'a newer completion from the same project must replace a stale working sibling immediately');
assert.strictEqual(state.choosePresentation(working, newerAnalysis), newerAnalysis,
  'a newer active project phase must replace an older sibling phase immediately');
assert.strictEqual(state.choosePresentation(working, newerIdle), working,
  'a newer plain idle snapshot must not hide a still-active sibling session');
assert.strictEqual(state.choosePresentation(newerAnalysis, needsInput), newerAnalysis,
  'an older input request must not pull a project back from a newer active phase');
assert.strictEqual(state.isBusy(needsInput), true);

const current = {
  key: 'vscode:codex', label: 'VS Code', current: true, updatedAt: 100, session: working,
};
const archived = {
  key: 'vscode:codex', label: 'old archive label', current: false, updatedAt: 300, session: newerIdle,
};
const merged = state.mergeTarget(current, archived);
assert.strictEqual(merged.label, 'VS Code', 'archived metadata must not replace a live work target');
assert.strictEqual(merged.session, working, 'active presentation remains attached to the shared target');
assert.strictEqual(merged.updatedAt, 300, 'the catalog can still rank by most recent activity');

const sharedWorking = {
  key: 'desktop:c:\\demo', label: 'demo', current: true, updatedAt: 100, session: working,
};
const sharedCompleted = {
  key: 'desktop:c:\\demo', label: 'demo', current: true, updatedAt: 220, session: newerCompletion,
};
assert.strictEqual(state.mergeTarget(sharedWorking, sharedCompleted).session, newerCompletion,
  'a project merge must surface its latest completed turn instead of lagging on the old active turn');

console.log('project state: ok');
