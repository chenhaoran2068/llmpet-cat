'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const files = ['main.js', 'preload.js', 'renderer/pet.js', 'renderer/pet.html', 'backend/config.js'];
const source = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');

for (const obsolete of ['quietMode', 'clickThrough', 'quiet-toggle', 'click-through-toggle', 'set-preference']) {
  assert(!source.includes(obsolete), `${obsolete} must be fully removed`);
}
assert(source.includes('setOfficeEmptySpaceIgnore'), 'transparent unused office pixels must remain non-blocking automatically');
console.log('preferences removed: ok');
