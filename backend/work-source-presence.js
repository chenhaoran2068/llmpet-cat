'use strict';

// The watcher can still see a recent local transcript after the application
// that produced it has been closed.  Keep that history for later, but do not
// leave a ghost cat on the desktop while its source application is absent.
const WORK_SOURCES = Object.freeze(['desktop', 'vscode', 'cli', 'kimi-desktop']);

function normalizeWorkSourcePresence(value = {}) {
  const result = {};
  for (const source of WORK_SOURCES) result[source] = value[source] !== false;
  return result;
}

function isWorkSourceAvailable(presence, source) {
  return WORK_SOURCES.includes(source) && normalizeWorkSourcePresence(presence)[source] !== false;
}

module.exports = { WORK_SOURCES, normalizeWorkSourcePresence, isWorkSourceAvailable };
