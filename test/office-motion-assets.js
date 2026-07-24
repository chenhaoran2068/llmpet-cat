'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const identities = ['programmer', 'writer', 'chubby'];
const source = fs.readFileSync(path.join(root, 'renderer', 'pet.js'), 'utf8');

for (const identity of identities) {
  const asset = path.join(root, 'assets', 'cat', 'office-scene', 'actions', identity, 'work-overload.webp');
  assert(fs.existsSync(asset), `${identity} hand-busy action is missing`);
  const header = fs.readFileSync(asset).subarray(0, 12).toString('ascii');
  assert(header.startsWith('RIFF') && header.slice(8) === 'WEBP', `${identity} action must be a WebP animation`);
}

assert(source.includes("writing: ['work-overload']")
  && source.includes("coding: ['work-overload']"),
  'ordinary work states must use the user-selected hand-busy action');
assert(!source.includes('animations/${identity}/busy-scroll.webp'), 'the office renderer must not select the discarded busy-scroll action');
assert(!source.includes('native-coding.webp'), 'the office renderer must not select regenerated full-cat actions');

const idlePool = source.match(/idle:\s*\[([^\]]+)\],\s*\n\s*working:/s)?.[1] || '';
const fallbackWorkingPool = source.match(/working:\s*\[([^\]]+)\],\s*\n\s*companion:/s)?.[1] || '';
for (const rejected of ['cat-working.gif', 'cat-working-2.gif', 'cat-working-3.gif']) {
  assert(!idlePool.includes(rejected), `${rejected} must not appear in the ambient idle rotation`);
  assert(!fallbackWorkingPool.includes(rejected), `${rejected} must not appear in the fallback working rotation`);
}

console.log('office motion assets: ok');
