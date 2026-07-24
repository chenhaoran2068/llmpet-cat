'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'renderer', 'pet.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

assert(renderer.includes('function renderTargetCatalog(sessions = currentStats.sessions || [])'),
  'the office needs a dedicated live-project target catalog');
assert(renderer.includes('return targetCatalog(sessions, []);'),
  'the live office catalog must not auto-render archived known projects');
assert(renderer.includes('const targets = renderTargetCatalog(sessions);'),
  'both the board and management sync must use the same live project catalog');
assert(renderer.includes('ensureWorkstationsForTargets(targets)'),
  'a newly active project must receive a real workstation instead of leaving an empty slot');
assert(renderer.includes('normalizeWorkstationIdentities(ensureWorkstationsForTargets(targets), targets)'),
  'only simultaneously visible cats may consume the no-duplicate identity allocation');
assert(main.includes('key: station.id.slice(0, 240)'),
  'tray management must retain the workstation id used by renderer settings');

console.log('office management sync: ok');
