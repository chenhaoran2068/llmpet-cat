'use strict';

// Browser-safe, dependency-free project-state reducer.  One workstation can
// intentionally represent several sessions (all VS Code conversations, or
// several Codex conversations inside the same project).  The visual cat must
// therefore be selected from the most meaningful *current* session, rather
// than from whichever transcript happened to be written most recently.
(function exposeProjectState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LLMPETProjectState = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function updatedAt(session = {}) {
    const value = Number(session.updatedAt || 0);
    return Number.isFinite(value) ? value : 0;
  }

  function eventName(session = {}) {
    const value = session.lastEvent;
    if (value && typeof value === 'object') return String(value.rawEvent || value.event || '');
    return String(value || '');
  }

  // A fresh request for a decision must be visible first.  Its priority only
  // settles simultaneous or historical records; a genuinely newer lifecycle
  // event still has to reach the cat immediately (for example a completion
  // from a second Codex conversation in the same workspace).
  function presentationPriority(session = {}) {
    if (eventName(session) === 'NeedInput') return 60;
    if (session.state === 'working') return 50;
    if (session.state === 'thinking') return 40;
    if (session.state === 'error') return 30;
    if (session.badge === 'done') return 20;
    return 10;
  }

  function choosePresentation(previous = {}, next = {}) {
    const previousAt = updatedAt(previous);
    const nextAt = updatedAt(next);
    const priorPriority = presentationPriority(previous);
    const nextPriority = presentationPriority(next);
    // A newer meaningful event is the project’s current visual truth.  The
    // old reducer made an earlier `working` sibling permanently win over a
    // newer Stop/Error/Thinking update, which left project cats showing stale
    // work after the project had already progressed.  An ordinary newer idle
    // snapshot remains non-destructive: it cannot hide another live turn.
    if (nextAt > previousAt && (isBusy(next)
      || eventName(next) === 'NeedInput'
      || next.state === 'error'
      || next.badge === 'done')) return next;
    if (previousAt > nextAt && (isBusy(previous)
      || eventName(previous) === 'NeedInput'
      || previous.state === 'error'
      || previous.badge === 'done')) return previous;
    if (nextPriority !== priorPriority) return nextPriority > priorPriority ? next : previous;
    return nextAt >= previousAt ? next : previous;
  }

  function isBusy(session = {}) {
    return presentationPriority(session) >= 40;
  }

  // `current` means this is a live session rather than an archived known
  // project.  Archived metadata may refresh later, but it must never replace
  // a live session's state or nameplate data.
  function mergeTarget(previous, next) {
    if (!previous) return next;
    const metadata = next.current && !previous.current
      ? next
      : previous.current && !next.current
        ? previous
        : (updatedAt(next) >= updatedAt(previous) ? next : previous);
    return {
      ...metadata,
      updatedAt: Math.max(updatedAt(previous), updatedAt(next)),
      current: Boolean(previous.current || next.current),
      // A known-project catalog row is metadata only.  It must never replace
      // the live session presentation, even if the catalog scan observed a
      // newer filesystem timestamp.
      session: next.current && !previous.current
        ? next.session
        : previous.current && !next.current
          ? previous.session
          : choosePresentation(previous.session, next.session),
    };
  }

  return { eventName, presentationPriority, choosePresentation, isBusy, mergeTarget };
}));
