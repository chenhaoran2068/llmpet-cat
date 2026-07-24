'use strict';

const assert = require('assert');
const { normalizeWorkSourcePresence, isWorkSourceAvailable } = require('../backend/work-source-presence');

const presence = normalizeWorkSourcePresence({ desktop: false, vscode: true, unknown: false });
assert.deepStrictEqual(presence, { desktop: false, vscode: true, cli: true, 'kimi-desktop': true });
assert.strictEqual(isWorkSourceAvailable(presence, 'desktop'), false);
assert.strictEqual(isWorkSourceAvailable(presence, 'vscode'), true);
assert.strictEqual(isWorkSourceAvailable(presence, 'unknown-source'), false);
console.log('work source presence: ok');
