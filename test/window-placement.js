'use strict';

const assert = require('assert');
const { bottomRightInWorkArea, resizeBoundsInWorkArea } = require('../backend/window-placement');

assert.deepStrictEqual(
  bottomRightInWorkArea({ x: 0, y: 0, width: 1920, height: 1040 }, { width: 360, height: 250 }),
  { x: 1548, y: 778 },
);
assert.deepStrictEqual(
  bottomRightInWorkArea({ x: -1920, y: 0, width: 1920, height: 1040 }, { width: 360, height: 250 }),
  { x: -372, y: 778 },
);
assert.deepStrictEqual(
  bottomRightInWorkArea({ x: 0, y: 0, width: 300, height: 180 }, { width: 360, height: 250 }),
  { x: 0, y: 0 },
);

const area = { x: 0, y: 0, width: 1920, height: 1040 };
assert.deepStrictEqual(
  resizeBoundsInWorkArea(area, { x: 1700, y: 780, width: 200, height: 180 }, { width: 360, height: 250 }),
  { x: 1556, y: 710, width: 360, height: 250 },
);
assert.deepStrictEqual(
  resizeBoundsInWorkArea(area, { x: 4, y: 4, width: 200, height: 180 }, { width: 360, height: 250 }),
  { x: 4, y: 4, width: 360, height: 250 },
);
assert.deepStrictEqual(
  resizeBoundsInWorkArea({ x: -1920, y: 0, width: 1920, height: 1040 }, { x: -1880, y: 5, width: 200, height: 180 }, { width: 360, height: 500 }),
  { x: -1916, y: 4, width: 360, height: 500 },
);
console.log('window placement: ok');
