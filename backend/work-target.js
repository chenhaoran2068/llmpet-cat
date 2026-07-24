'use strict';

const path = require('path');

function workTargetSource(record = {}) {
  // Codex Desktop currently writes `source: vscode` in some local rollouts.
  // Its explicit originator is authoritative, otherwise it is mistaken for a
  // VS Code extension session and both workstations collapse together.
  const originator = String(record.originator || '').trim().toLowerCase();
  if (/^kimi(?:[ _-]?desktop)?$/.test(originator) && /desktop/.test(originator)) return 'kimi-desktop';
  if (/^codex[_ -]?vscode$|^vscode$/.test(originator)) return 'vscode';
  if (/desktop/.test(originator)) return 'desktop';
  if (/cli|terminal|shell|command line/.test(originator)) return 'cli';
  const fingerprint = [record.sessionSource, record.threadSource]
    .filter(Boolean).join(' ').toLowerCase();
  if (/kimi[ _-]?desktop/.test(fingerprint)) return 'kimi-desktop';
  if (/vscode|codex[_ -]?vscode/.test(fingerprint)) return 'vscode';
  if (/cli|terminal|shell|command line/.test(fingerprint)) return 'cli';
  return 'desktop';
}

function workTargetFor(record = {}) {
  const source = workTargetSource(record);
  const projectPath = String(record.cwd || record.projectPath || '').trim();
  const project = path.basename(projectPath) || String(record.project || record.sessionTitle || '').trim() || 'Codex';
  const key = source === 'vscode'
    ? 'vscode:codex'
    : `${source}:${(projectPath || String(record.id || project)).toLowerCase()}`;
  const sourceLabel = { vscode: 'VS Code', desktop: 'Codex Desktop', cli: 'Codex CLI', 'kimi-desktop': 'Kimi Desktop' }[source];
  return { key, source, project, projectPath, label: `${project} — ${sourceLabel}` };
}

module.exports = { workTargetSource, workTargetFor };
