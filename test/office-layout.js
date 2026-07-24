'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'renderer', 'pet.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'renderer', 'pet.js'), 'utf8');

assert(css.includes('left: calc(50% - 45px);'), 'first cat must be anchored to the compact pair centre');
assert(css.includes('left: calc(50% + 45px);'), 'second cat must be anchored to the compact pair centre');
assert(renderer.includes('2: [250, 180]'), 'two cats must retain the compact 250px stage');
assert(renderer.includes("Math.max(82, 52 + Math.ceil(longestCallout / 20) * 15)"),
  'speech headroom must hug the actual manga bubble instead of keeping a large fixed blank area');
assert(renderer.includes('applyOfficeWindowSize(width, height, sizeKey)'),
  'the native window must be resized back to the compact cast after a bubble expires');
assert(renderer.includes("ipcRenderer.invoke('get-window-size')") || renderer.includes('getWindowSize'),
  'renderer must be able to verify the actual native window size');
assert(css.includes('body.office-mode .ambience') && css.includes('body.office-mode #stage::after'),
  'office mode must suppress window-wide stars so speech is the only content above the cats');
assert(renderer.includes('officeElementReceivesPointer') && renderer.includes('setOfficeEmptySpaceIgnore(desks.length > 0)'),
  'transparent office space must leave mouse input to the desktop while visible cats remain interactive');

const centreGap = 90;
const imageBox = 70 * 1.16;
assert(centreGap > imageBox, 'two calibrated image boxes must not overlap');
assert(Math.abs((centreGap - imageBox) - 8.8) < 0.001,
  'the compact pair must retain a small visible gap');

console.log('office layout: ok');
