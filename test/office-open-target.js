'use strict';

const assert = require('assert');
const fs = require('fs');
const source = fs.readFileSync(require('path').join(__dirname, '..', 'renderer', 'pet.js'), 'utf8');

assert(source.includes("focus.textContent = '打开对应软件'"), 'the cat menu must label the action as opening the linked application');
assert(!source.includes('进入工作区'), 'the obsolete workspace wording must not remain in the cat menu');
assert(source.includes("window.pet.focusWorkTarget({"), 'opening the linked application must keep using the per-cat target focus route');
console.log('office open target: ok');
