'use strict';

const $ = (id) => document.getElementById(id);
const cat = $('cat-img');
const bellyCat = $('belly-img');
const catShell = $('cat');
const status = $('status');
const bubble = $('bubble');
const bubbleTitle = $('bubble-title');
const bubbleDetail = $('bubble-detail');
const panel = $('sessions');
const list = $('session-list');
const sessionSummary = $('session-summary');
const taskBubbles = $('task-bubbles');
const officeBoard = $('office-board');
const officeMenu = $('office-menu');
const doneStamp = $('done-stamp');
const errorBox = $('error-box');
const notesPanel = $('notes-panel');
const noteInput = $('note-input');
const noteList = $('note-list');
const helpSign = $('help-sign');
const nextNote = $('next-note');
const workProp = $('work-prop');
let currentStats = { sessions: [] };
let bubbleTimer = null;
let stampTimer = null;
let errorTimer = null;
let displayedState = '';
let aggregateState = 'idle';
let workingSince = 0;
let displayedGif = '';
let gifRotationTimer = null;
let theaterTimer = null;
let petTapTimes = [];
let bellyPlayTimer = null;
let lastBellyMode = '';
let transitionTimer = null;
let appliedOfficeSize = '';
let verifiedOfficeSize = '';
let officeSizeVerificationInFlight = false;
let officeEmptySpaceIgnore = null;
let officeRefreshTimer = null;
let officeCalloutExpiryTimer = null;
let activeOfficeNoticeTarget = '';
let appliedOfficeSignature = '';
const officeCallouts = new Map();

const images = {
  // When there is no project desk to show, keep the companion in its own
  // no-desk downtime loop.  Project work always uses the fixed office cat.
  // Keep the three rejected working GIFs in the catalog for future redraws,
  // but never select them in the companion's ambient or fallback work loops.
  idle: ['cat-idle.gif', 'cat-waiting.gif', 'cat-loafing.gif', 'cat-loafing-2.gif', 'cat-loafing-3.gif', 'cat-sleeping.gif', 'cat-sleeping-2.gif', 'cat-roam.gif', 'cat-attention.gif', 'cat-greet.gif', 'cat-happy.gif', 'cat-juggling.gif', 'cat-sad.gif', 'cat-talking.gif', 'cat-thinking.gif', 'cat-thinking-2.gif', 'cat-needsinput.gif', 'cat-sweeping.gif', 'cat-working-4.gif', 'candidate-01.gif', 'candidate-02.gif', 'candidate-04.gif', 'candidate-05.gif', 'candidate-09.gif'],
  working: ['cat-working-4.gif'],
  companion: ['cat-attention.gif', 'cat-roam.gif', 'cat-sweeping.gif'],
  thinking: ['cat-thinking.gif', 'cat-thinking-2.gif', 'cat-needsinput.gif'],
  sleeping: ['cat-sleeping.gif', 'cat-sleeping-2.gif'],
  error: ['cat-error.gif', 'cat-sad.gif', 'candidate-04.gif'],
  happy: ['cat-happy.gif', 'cat-juggling.gif', 'candidate-05.gif', 'cat-talking.gif'],
  talking: ['cat-talking.gif', 'cat-greet.gif', 'candidate-01.gif', 'candidate-05.gif'],
  greet: ['cat-greet.gif', 'cat-happy.gif', 'candidate-01.gif'],
  loafing: ['cat-loafing.gif', 'cat-loafing-2.gif', 'cat-loafing-3.gif', 'candidate-02.gif', 'candidate-09.gif'],
};
const bellyModes = [
  { id: 'happy', image: 'cat-belly-play.png', title: '投降啦，肚肚给你玩！', detail: '猫猫趴下来，露出软软的肚肚和肉垫。' },
  { id: 'wave', image: 'cat-belly-wave.png', title: '肉垫挥挥！', detail: '猫猫躺好后举起爪爪和你玩。' },
  { id: 'roll', image: 'cat-belly-roll.png', title: '翻滚一下！', detail: '猫猫侧身打了个小滚，尾巴也翘起来了。' },
];
const labels = { idle: '待机中', working: '正在工作', companion: '陪你工作中', thinking: '思考中', sleeping: '睡觉中', error: '遇到错误', happy: '完成啦', talking: '回复中', greet: '你好呀', loafing: '休息一下' };

function localDay() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dailyStore() {
  const key = `llmpet-cat-day-${localDay()}`;
  try {
    const data = JSON.parse(localStorage.getItem(key)) || { completed: 0, failures: 0, notes: [], breaks: 0 };
    if (Object.hasOwn(data, 'stickers') || Object.hasOwn(data, 'nestItems')) {
      delete data.stickers; delete data.nestItems; localStorage.setItem(key, JSON.stringify(data));
    }
    return { key, data };
  }
  catch { return { key, data: { completed: 0, failures: 0, notes: [], breaks: 0 } }; }
}

function saveDaily(data) {
  localStorage.setItem(`llmpet-cat-day-${localDay()}`, JSON.stringify(data));
  renderNotes(data);
}

function prepareDaily(data) {
  data.notes ||= [];
  data.breaks ||= 0; data.failures ||= 0; data.completed ||= 0;
  return data;
}

function renderNotes(data = dailyStore().data) {
  prepareDaily(data);
  noteList.innerHTML = '';
  if (!data.notes.length) { noteList.textContent = '还没有便签，记下一件小事吧。'; return; }
  data.notes.forEach((note, index) => {
    const row = document.createElement('div');
    row.className = `note-row${note.done ? ' done' : ''}`;
    const text = document.createElement('span'); text.textContent = note.text;
    const toggle = document.createElement('button'); toggle.textContent = note.done ? '恢复' : '划掉';
    toggle.addEventListener('click', () => { const store = dailyStore(); store.data.notes[index].done = !store.data.notes[index].done; saveDaily(store.data); });
    const remove = document.createElement('button'); remove.textContent = '×';
    remove.addEventListener('click', () => { const store = dailyStore(); store.data.notes.splice(index, 1); saveDaily(store.data); });
    row.append(text, toggle, remove); noteList.appendChild(row);
  });
}

function recordCompletion(item = { icon: '🚩', label: '完成小旗子' }) {
  const store = dailyStore(); const data = store.data;
  prepareDaily(data);
  data.completed += 1; data.failures = 0;
  const pending = data.notes.find((note) => !note.done);
  if (pending) pending.done = true;
  saveDaily(data);
  return data.completed;
}

function recordFailure() {
  const store = dailyStore(); prepareDaily(store.data); store.data.failures += 1; saveDaily(store.data); return store.data.failures;
}

function difficultyFor(sessions) {
  const active = sessions.filter((s) => s.state === 'working' || s.state === 'thinking');
  const titleLength = Math.max(0, ...active.map((s) => String(s.taskTitle || '').length));
  const tools = active.reduce((total, s) => total + Number(s.toolCalls || 0), 0);
  if (tools >= 6 || titleLength >= 60) return 'hard';
  if (tools >= 2 || titleLength >= 24) return 'medium';
  return 'easy';
}

function updateWorkMotion() {
  const elapsed = workingSince ? Date.now() - workingSince : 0;
  const longWorking = elapsed >= 3 * 60 * 1000;
  catShell.classList.toggle('working-long', longWorking);
  catShell.dataset.workBeat = longWorking ? String(Math.floor(elapsed / (2 * 60 * 1000)) % 3) : '0';
}

function variantsFor(state) {
  return images[state] || images.idle;
}

function chooseGif(state) {
  const variants = variantsFor(state);
  const choices = variants.filter((gif) => gif !== displayedGif);
  return (choices.length ? choices : variants)[Math.floor(Math.random() * (choices.length || variants.length))];
}

function changeGif() {
  const next = chooseGif(displayedState || 'idle');
  if (next === displayedGif) return;
  displayedGif = next;
  cat.src = `../assets/cat/${next}`;
}

function scheduleGifRotation() {
  clearTimeout(gifRotationTimer);
  const variants = variantsFor(displayedState);
  if (variants.length < 2) return;
  const delay = displayedState === 'companion'
    ? 7_000 + Math.floor(Math.random() * 5_000)
    : ['working', 'thinking'].includes(displayedState)
      ? 9_000 + Math.floor(Math.random() * 6_000)
      : 16_000 + Math.floor(Math.random() * 10_000);
  gifRotationTimer = setTimeout(() => {
    changeGif();
    scheduleGifRotation();
  }, delay);
}

function showState(state) {
  const s = images[state] ? state : 'idle';
  if (displayedState !== s) {
    const previous = displayedState;
    displayedState = s;
    changeGif();
    scheduleGifRotation();
    const transition = previous ? `${previous}-${s}` : '';
    if (transition) {
      clearTimeout(transitionTimer);
      catShell.dataset.transition = transition;
      transitionTimer = setTimeout(() => delete catShell.dataset.transition, 950);
    }
  }
  status.textContent = labels[s];
  if (s === 'working' && !workingSince) workingSince = Date.now();
  if (s !== 'working') workingSince = 0;
  catShell.dataset.state = s;
  updateWorkMotion();
}

function updateDifficulty(sessions) {
  const difficulty = difficultyFor(sessions);
  catShell.dataset.difficulty = difficulty;
  if (displayedState === 'working') {
    const suffix = difficulty === 'hard' ? ' · 全力攻坚中' : difficulty === 'medium' ? ' · 专注处理中' : '';
    status.textContent = `${labels.working}${suffix}`;
  }
}

function showBubble(title, detail = '', ms = 5000, completion = false, urgent = false) {
  // A Codex event belongs to one work target.  In office mode it must never
  // fall back to the old, window-wide banner: a hidden/unbound workstation is
  // quieter than telling the story from the wrong cat.
  if (activeOfficeNoticeTarget) {
    clearTimeout(bubbleTimer);
    bubble.classList.add('hidden');
    showOfficeCallout(activeOfficeNoticeTarget, title, detail, ms);
    return;
  }
  clearTimeout(bubbleTimer);
  bubbleTitle.textContent = String(title || '').trim();
  bubbleDetail.textContent = String(detail || '').trim();
  if (!bubbleTitle.textContent && !bubbleDetail.textContent) return bubble.classList.add('hidden');
  bubble.classList.toggle('completion', completion);
  bubbleDetail.classList.toggle('hidden', !bubbleDetail.textContent);
  bubble.classList.remove('hidden');
  bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), ms);
}

function showStamp() {
  clearTimeout(stampTimer);
  doneStamp.classList.remove('hidden', 'pop');
  void doneStamp.offsetWidth;
  doneStamp.classList.add('pop');
  stampTimer = setTimeout(() => doneStamp.classList.add('hidden'), 2600);
}

function showErrorBox() {
  clearTimeout(errorTimer);
  errorBox.classList.remove('hidden');
  errorTimer = setTimeout(() => errorBox.classList.add('hidden'), 7000);
}

function playTheater(kind, ms = 7000) {
  clearTimeout(theaterTimer);
  catShell.dataset.theater = kind;
  theaterTimer = setTimeout(() => { delete catShell.dataset.theater; }, ms);
}


function showHelpSign() {
  helpSign.classList.remove('hidden');
  nextNote.classList.remove('hidden');
}

function hideHelpSign() {
  helpSign.classList.add('hidden');
  nextNote.classList.add('hidden');
}

function setWorkProp(prop) {
  if (!prop || !prop.icon) return;
  workProp.textContent = prop.icon;
  workProp.title = prop.label || '';
  workProp.classList.remove('hidden');
}

function clearWorkProp() {
  workProp.classList.add('hidden');
  workProp.textContent = '';
}

function recordBreak() {
  const store = dailyStore();
  prepareDaily(store.data);
  store.data.breaks += 1;
  saveDaily(store.data);
}

function startBellyPlay() {
  clearTimeout(bellyPlayTimer);
  petTapTimes = [];
  const choices = bellyModes.filter((mode) => mode.id !== lastBellyMode);
  const mode = (choices.length ? choices : bellyModes)[Math.floor(Math.random() * (choices.length || bellyModes.length))];
  lastBellyMode = mode.id;
  bellyCat.src = `../assets/cat/${mode.image}`;
  delete catShell.dataset.trick;
  catShell.dataset.bellyMode = mode.id;
  catShell.classList.remove('petted', 'belly');
  catShell.classList.add('belly-play');
  clearWorkProp();
  showBubble(mode.title, mode.detail, 4200, true);
  bellyPlayTimer = setTimeout(() => { catShell.classList.remove('belly-play'); delete catShell.dataset.bellyMode; }, 4200);
}

function reactToPetTap() {
  if (catShell.classList.contains('belly-play')) {
    clearTimeout(bellyPlayTimer);
    bellyPlayTimer = setTimeout(() => { catShell.classList.remove('belly-play'); delete catShell.dataset.bellyMode; }, 4200);
    showBubble('肚肚被摸到了！', '猫猫开心地扭来扭去。', 2200);
    return;
  }
  const now = Date.now();
  petTapTimes.push(now);
  petTapTimes = petTapTimes.filter((time) => now - time <= 1250);
  const tapCount = petTapTimes.length;
  const hour = new Date().getHours();
  if (tapCount >= 8) {
    startBellyPlay();
    return;
  }
  if (tapCount === 5) {
    catShell.dataset.trick = 'yarn';
    showBubble('毛线球出现！', '猫猫开启追球秘密动作。', 2600);
    setTimeout(() => delete catShell.dataset.trick, 1900);
    return;
  }
  if (tapCount === 3) {
    catShell.classList.remove('petted');
    catShell.classList.add('belly');
    showBubble('这里最软软的地方只给你摸哦。', '再摸两下，也许会发现秘密。', 2600);
    setTimeout(() => catShell.classList.remove('belly'), 1300);
    return;
  }
  catShell.classList.remove('belly');
  catShell.classList.add('petted');
  const detail = hour < 11 ? '早上好，先伸个懒腰吧。' : hour >= 21 || hour < 6 ? '夜里也要轻轻地摸哦，猫猫快困了。' : '摸摸收到了，猫猫继续陪你。';
  showBubble('喵呜～', detail, 1800);
  setTimeout(() => catShell.classList.remove('petted'), 700);
}

function dominantState(sessions, userWorking) {
  if (sessions.some((s) => s.state === 'error')) return 'error';
  if (sessions.some((s) => s.state === 'working')) return 'working';
  if (sessions.some((s) => s.state === 'thinking')) return 'thinking';
  if (userWorking) return 'companion';
  return 'idle';
}

function renderTaskBubbles(sessions) {
  const active = sessions.filter((s) => s.state === 'working' || s.state === 'thinking');
  taskBubbles.innerHTML = '';
  taskBubbles.classList.toggle('hidden', active.length < 2);
  active.slice(0, 4).forEach((s, index) => {
    const mark = document.createElement('i');
    mark.className = `task-bubble ${s.state}`;
    mark.textContent = index + 1;
    mark.title = s.project || 'Codex';
    taskBubbles.appendChild(mark);
  });
  if (active.length > 4) {
    const more = document.createElement('i');
    more.className = 'task-bubble more';
    more.textContent = `+${active.length - 4}`;
    taskBubbles.appendChild(more);
  }
}

function sessionEventName(session = {}) {
  const event = session.lastEvent;
  return typeof event === 'string' ? event : String(event?.rawEvent || '');
}

function taskCardState(session) {
  if (session.badge === 'done') return { kind: 'done', icon: '✓', label: '已完成' };
  if (session.state === 'error') return { kind: 'error', icon: '!', label: '遇到问题' };
  if (session.state === 'working') return { kind: 'working', icon: '●', label: '进行中' };
  if (session.state === 'thinking' && sessionEventName(session) === 'NeedInput') return { kind: 'needs-input', icon: '!', label: '需要你决定' };
  if (session.state === 'thinking') return { kind: 'thinking', icon: '…', label: '正在思考' };
  return { kind: 'paused', icon: '○', label: '暂时停下' };
}

function taskCardRank(session) {
  const kind = taskCardState(session).kind;
  return ({ working: 0, thinking: 1, 'needs-input': 1, error: 2, done: 3, paused: 4 })[kind] ?? 5;
}

function relativeUpdateTime(updatedAt) {
  const seconds = Math.max(0, Math.round((Date.now() - Number(updatedAt || 0)) / 1000));
  if (seconds < 60) return '刚刚更新';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前更新`;
  return `${Math.floor(minutes / 60)} 小时前更新`;
}

// The first automatically assigned desk starts as the original cat.
const OFFICE_IDENTITIES = ['plain', 'programmer', 'writer', 'chubby'];
const OFFICE_IDENTITY_LABELS = {
  plain: '原味猫',
  programmer: '圆墨镜程序猫',
  writer: '贝雷帽作家猫',
  chubby: '可乐小胖猫',
};
const OFFICE_STATE_LABELS = {
  resting: '休息中',
  writing: '写东西',
  research: '查资料',
  analysis: '分析中',
  coding: '写代码',
  'needs-input': '等你决定',
  'gentle-failure': '整理一下',
  celebration: '完成啦',
  'micro-break': '小憩中',
};

const OFFICE_WORKSTATIONS_KEY = 'llmpet-office-workstations-v2';
const MAX_VISIBLE_WORK_TARGETS = 5;
const projectState = window.LLMPETProjectState;

function targetKeyOf(session = {}) {
  return String(session.targetKey || '').trim() || String(session.projectPath || session.project || session.sessionId || 'codex').toLowerCase();
}

function targetSourceOf(session = {}) {
  return String(session.targetSource || 'desktop').trim() || 'desktop';
}

function targetLabelOf(session = {}) {
  return String(session.targetLabel || session.project || 'Codex').trim() || 'Codex';
}

function workstationStore() {
  try {
    const value = JSON.parse(localStorage.getItem(OFFICE_WORKSTATIONS_KEY));
    return Array.isArray(value) ? value.filter((item) => item && typeof item.id === 'string') : [];
  } catch { return []; }
}

function saveWorkstations(stations) {
  localStorage.setItem(OFFICE_WORKSTATIONS_KEY, JSON.stringify(stations));
}

function newWorkstationId() {
  return `station-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// A work target is a precise source/project pair.  A workstation owns its
// cat identity and can later be rebound to another target without changing
// the cat itself.
function targetCatalog(sessions, knownProjects = currentStats.knownProjects || []) {
  const targets = new Map();
  function add(session, current) {
    // Keep the configured workstation in storage, but do not render it when
    // its own desktop application is closed.  It returns automatically when
    // that source application is opened again.
    if (session?.sourceAvailable === false) return;
    const key = targetKeyOf(session);
    const next = {
      key,
      source: targetSourceOf(session),
      label: targetLabelOf(session),
      project: String(session.project || '').trim(),
      projectPath: String(session.projectPath || '').trim(),
      updatedAt: Number(session.updatedAt || 0),
      session: { ...session },
      current: Boolean(current),
    };
    targets.set(key, projectState.mergeTarget(targets.get(key), next));
  }
  for (const session of sessions) add(session, true);
  for (const project of knownProjects) add(project, false);
  // A long-lived Desktop installation can retain dozens of old projects.  The
  // office is intentionally a current-work view, not a session archive: keep
  // only the five most recently active targets.  All VS Code windows already
  // share the stable `vscode:codex` target key, so multi-window VS Code can
  // never multiply cats here.
  const ranked = [...targets.values()]
    .sort((a, b) => {
      const aBusy = projectState.isBusy(a.session);
      const bBusy = projectState.isBusy(b.session);
      return Number(bBusy) - Number(aBusy)
        || Number(b.current) - Number(a.current)
        || b.updatedAt - a.updatedAt
        || a.label.localeCompare(b.label, 'zh-CN');
    })
    .slice(0, MAX_VISIBLE_WORK_TARGETS);
  return new Map(ranked.map((target) => [target.key, target]));
}

// The office itself is a live-work view.  `knownProjects` intentionally keeps
// a longer history for the optional chooser, but treating that archive as
// current work produced empty cats for projects that merely existed recently.
// Both the visible cats and the tray's managed-workstation list must be built
// from this exact live target set.
function renderTargetCatalog(sessions = currentStats.sessions || []) {
  return targetCatalog(sessions, []);
}

function bootstrapWorkstations(targets) {
  const existing = workstationStore();
  if (existing.length) return existing;
  const legacyIdentities = (() => {
    try { return JSON.parse(localStorage.getItem('llmpet-office-project-identities-v1')) || {}; }
    catch { return {}; }
  })();
  const legacySettings = (() => {
    try { return JSON.parse(localStorage.getItem('llmpet-office-project-settings-v1')) || {}; }
    catch { return {}; }
  })();
  const stations = [...targets.values()]
    .sort((a, b) => Number(b.current) - Number(a.current) || b.updatedAt - a.updatedAt)
    .slice(0, MAX_VISIBLE_WORK_TARGETS)
    .map((target, index) => ({
      id: newWorkstationId(),
      targetKey: target.key,
      name: String(legacySettings[target.key]?.name || '').slice(0, 24),
      visible: legacySettings[target.key]?.visible !== false,
      identity: OFFICE_IDENTITIES.includes(legacyIdentities[target.key]) ? legacyIdentities[target.key] : OFFICE_IDENTITIES[index % OFFICE_IDENTITIES.length],
    }));
  if (stations.length) saveWorkstations(stations);
  return stations;
}

function nextWorkstationIdentity(stations, targets) {
  const used = new Set(stations
    .filter((station) => targets.has(station.targetKey))
    .map((station) => station.identity)
    .filter((identity) => OFFICE_IDENTITIES.includes(identity)));
  return OFFICE_IDENTITIES.find((identity) => !used.has(identity))
    || OFFICE_IDENTITIES[used.size % OFFICE_IDENTITIES.length];
}

function ensureWorkstationsForTargets(targets) {
  const stations = bootstrapWorkstations(targets);
  let changed = false;
  for (const target of targets.values()) {
    if (stations.some((station) => station.targetKey === target.key)) continue;
    stations.push({
      id: newWorkstationId(), targetKey: target.key, name: '', visible: true,
      identity: nextWorkstationIdentity(stations, targets),
    });
    changed = true;
  }
  if (changed) saveWorkstations(stations);
  return stations;
}

function normalizeWorkstationIdentities(stations, targets = null) {
  const used = new Set();
  let changed = false;
  const relevant = targets
    ? stations.filter((station) => targets.has(station.targetKey))
    : stations;
  for (const station of relevant) {
    if (OFFICE_IDENTITIES.includes(station.identity) && !used.has(station.identity)) { used.add(station.identity); continue; }
    station.identity = OFFICE_IDENTITIES.find((identity) => !used.has(identity)) || OFFICE_IDENTITIES[0];
    used.add(station.identity);
    changed = true;
  }
  if (changed) saveWorkstations(stations);
  return stations;
}

function workstationName(station, target) {
  return String(station?.name || target?.label || '未绑定工位').trim() || '未绑定工位';
}

function setWorkstationIdentity(stationId, identity) {
  if (!OFFICE_IDENTITIES.includes(identity)) return;
  const stations = workstationStore();
  const station = stations.find((item) => item.id === stationId);
  if (!station || station.identity === identity) return;
  const other = stations.find((item) => item.id !== stationId && item.identity === identity);
  const previous = station.identity;
  station.identity = identity;
  if (other && OFFICE_IDENTITIES.includes(previous)) other.identity = previous;
  saveWorkstations(stations);
}

function bindWorkstationTarget(stationId, targetKey) {
  const stations = workstationStore();
  const station = stations.find((item) => item.id === stationId);
  if (!station || !targetKey || station.targetKey === targetKey) return;
  const other = stations.find((item) => item.id !== stationId && item.targetKey === targetKey);
  const previous = station.targetKey || '';
  station.targetKey = targetKey;
  if (other) other.targetKey = previous;
  saveWorkstations(stations);
}

function addWorkstation(targetKey) {
  const targets = targetCatalog(currentStats.sessions || []);
  if (!targets.has(targetKey)) return;
  const stations = workstationStore();
  if (stations.some((station) => station.targetKey === targetKey)) return;
  const used = new Set(stations.map((station) => station.identity));
  stations.push({
    id: newWorkstationId(), targetKey, name: '', visible: true,
    identity: OFFICE_IDENTITIES.find((identity) => !used.has(identity)) || OFFICE_IDENTITIES[0],
  });
  saveWorkstations(stations);
}

const OFFICE_IDLE_AFTER_MS = 60 * 1000;

function isOfficeResting(session, now = Date.now()) {
  if (session.state === 'error' || sessionEventName(session) === 'NeedInput') return false;
  const updatedAt = Number(session.updatedAt || 0);
  return updatedAt > 0 && now - updatedAt >= OFFICE_IDLE_AFTER_MS;
}

function officeState(session) {
  if (isOfficeResting(session)) return 'resting';
  if (session.badge === 'done') return 'celebration';
  if (session.state === 'error') return 'gentle-failure';
  if (sessionEventName(session) === 'NeedInput') return 'needs-input';
  if (session.state === 'thinking') return 'analysis';
  const activity = `${session.lastEventTool || session.lastTool || ''} ${session.taskTitle || ''}`.toLowerCase();
  if (/web|search|browser|fetch|read|research/.test(activity)) return 'research';
  if (/write|edit|patch|shell|terminal|code|file/.test(activity)) return 'coding';
  return 'writing';
}

// High-frame action set: these files preserve the 21–55 frame original-cat
// performances (with the rare 9-frame juggling flourish), then apply each
// project's fixed identity treatment to every individual frame.  This is the
// replacement for the old four-to-six-frame generated pose wobble.
const OFFICE_HIGH_FRAME_POOLS = {
  research: ['research'],
  analysis: ['analysis'],
  'needs-input': ['needs-input'],
  'gentle-failure': ['failure'],
  celebration: ['celebration'],
  // The user selected the original high-expression hand-busy performance for
  // all identities.
  writing: ['work-overload'],
  coding: ['work-overload'],
  // Phone use is deliberately the dominant rest beat.  The approved patrol
  // and roll only enter the rotation once per several five-minute intervals.
  resting: ['rest-phone', 'rest-phone', 'rest-phone', 'rest-phone', 'rest-phone', 'rest-special', 'rest-roam', 'rest-roll'],
};
const OFFICE_ACTION_ROTATE_MS = 5 * 60 * 1000;

// The plain cat is intentionally special: it plays the original source GIFs
// directly.  The other fixed identities retain their fitted action WebPs, but
// the default original cat keeps the richer source performances the user
// selected rather than a derived copy of them.
const OFFICE_ORIGINAL_PLAIN_GIF_POOLS = {
  research: ['cat-attention.gif'],
  analysis: ['cat-thinking-2.gif'],
  'needs-input': ['cat-needsinput.gif'],
  'gentle-failure': ['cat-sad.gif'],
  writing: ['cat-juggling.gif'],
  coding: ['cat-juggling.gif'],
  resting: ['cat-loafing-2.gif', 'cat-loafing-2.gif', 'cat-roam.gif', 'candidate-04.gif', 'cat-sleeping-2.gif'],
};

function highFrameMotionIndex(identity, state, session) {
  let seed = 0;
  for (const character of `${identity}:${state}:${targetKeyOf(session)}`) seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
  return seed + Math.floor(Date.now() / OFFICE_ACTION_ROTATE_MS);
}

function officeOriginalPlainAsset(state, session) {
  // Completion always begins with the user-selected ball kick.  The rest of
  // the pool rotates no more often than every five minutes through the same
  // stable project seed as the other identities.
  if (state === 'celebration') return '../assets/cat/cat-happy.gif';
  const pool = OFFICE_ORIGINAL_PLAIN_GIF_POOLS[state] || ['cat-idle.gif'];
  const name = pool[highFrameMotionIndex('plain', state, session) % pool.length];
  return `../assets/cat/${name}`;
}

function officeMotionAsset(identity, state, session) {
  if (identity === 'plain') return officeOriginalPlainAsset(state, session);
  const pool = OFFICE_HIGH_FRAME_POOLS[state] || [];
  // Do not fall back to separately redrawn identity PNGs. Every visible cat
  // must retain the original GIF's face, side fur, tail and palette.
  if (!pool.length) return '../assets/cat/cat-idle.gif';
  // Completion always opens with the original-cat ball kick, per the user's
  // choice; it does not randomly swap to a different celebration on arrival.
  const action = state === 'celebration'
    ? 'celebration'
    : pool[highFrameMotionIndex(identity, state, session) % pool.length];
  return `../assets/cat/office-scene/actions/${identity}/${action}.webp`;
}

// The rest-phone GIF is the visual ruler for the office.  Action files have
// different transparent canvases (and some include a toy or another animal),
// so we scale from the hand-reviewed *cat* key pose rather than the full image
// bounds.  Props remain visible; they simply never make the cat look smaller.
function officeMotionProfile(asset) {
  // Original 120px source GIFs are already authored at pet scale.  The wide
  // 240px rolling performance needs a slight reduction to preserve spacing.
  if (/candidate-04\.gif$/.test(asset)) return { scale: .82, y: 0 };
  if (/assets\/cat\/[^/]+\.gif$/.test(asset)) return { scale: 1, y: 0 };
  // The high-frame WebP has a fixed 192×208 canvas so that its feet and face
  // never drift between frames.  A modest scale makes the cat match the phone
  // rest pose without enlarging the blank transparent border or held scroll.
  if (/\/office-scene\/actions\//.test(asset)) return { scale: .96, y: 0 };
  return { scale: 1, y: 0 };
}

function shortTaskTitle(session) {
  const title = String(session.taskTitle || session.project || 'Codex').replace(/\s+/g, ' ').trim();
  return title.length > 26 ? `${title.slice(0, 26)}…` : title;
}

let lastOfficeManagementSignature = '';
function syncOfficeManagement(sessions = currentStats.sessions || []) {
  const targets = renderTargetCatalog(sessions);
  const stations = normalizeWorkstationIdentities(ensureWorkstationsForTargets(targets), targets);
  const payload = {
    stations: stations.filter((station) => targets.has(station.targetKey)).map((station) => ({
      id: station.id,
      label: workstationName(station, targets.get(station.targetKey)),
      targetLabel: targets.get(station.targetKey)?.label || '未绑定工作目标',
      visible: station.visible !== false,
      identity: station.identity || '',
    })),
    targets: [...targets.values()]
      .filter((target) => !stations.some((station) => station.targetKey === target.key))
      .map((target) => ({ key: target.key, label: target.label })),
  };
  const signature = JSON.stringify(payload);
  if (signature === lastOfficeManagementSignature) return;
  lastOfficeManagementSignature = signature;
  window.pet.updateOfficeManagement(payload);
}

function expireOfficeCallouts(now = Date.now()) {
  let changed = false;
  for (const [key, callout] of officeCallouts) {
    if (Number(callout?.expiresAt || 0) > now) continue;
    officeCallouts.delete(key);
    changed = true;
  }
  if (changed) appliedOfficeSignature = '';
  return changed;
}

function scheduleOfficeCalloutExpiry() {
  clearTimeout(officeCalloutExpiryTimer);
  const nextExpiry = Math.min(...[...officeCallouts.values()]
    .map((callout) => Number(callout?.expiresAt || 0))
    .filter((expiresAt) => expiresAt > Date.now()));
  if (!Number.isFinite(nextExpiry)) return;
  officeCalloutExpiryTimer = setTimeout(() => {
    officeCalloutExpiryTimer = null;
    if (expireOfficeCallouts()) renderOfficeBoard(currentStats.sessions || []);
    scheduleOfficeCalloutExpiry();
  }, Math.max(30, nextExpiry - Date.now() + 20));
}

// The transparent Electron window must never retain an old speech area's
// height.  Renderer state can be stable while Windows is still displaying a
// previously taller native window, so verify the actual bounds once per
// requested layout and correct it if necessary.
function applyOfficeWindowSize(width, height, sizeKey) {
  const resize = () => window.pet.setWindowSize(width, height);
  if (sizeKey !== appliedOfficeSize) {
    appliedOfficeSize = sizeKey;
    verifiedOfficeSize = '';
    resize();
    return;
  }
  if (verifiedOfficeSize === sizeKey || officeSizeVerificationInFlight || typeof window.pet.getWindowSize !== 'function') return;
  officeSizeVerificationInFlight = true;
  window.pet.getWindowSize().then(([actualWidth, actualHeight]) => {
    if (Math.abs(Number(actualWidth) - width) > 1 || Math.abs(Number(actualHeight) - height) > 1) resize();
    verifiedOfficeSize = sizeKey;
  }).catch(() => {}).finally(() => { officeSizeVerificationInFlight = false; });
}

function setOfficeEmptySpaceIgnore(enabled) {
  const next = Boolean(enabled);
  if (officeEmptySpaceIgnore === next || typeof window.pet.setOfficeEmptySpaceIgnore !== 'function') return;
  officeEmptySpaceIgnore = next;
  window.pet.setOfficeEmptySpaceIgnore(next);
}

function officeElementReceivesPointer(target) {
  return Boolean(target?.closest?.('.office-station, #office-menu, .office-callout'));
}

// Electron transparent windows are still rectangular hit targets.  Use
// forward:true in the main process and flip it only while the pointer is over
// actual visible project content, so the clear area above/between cats acts
// exactly like the desktop behind it.
document.addEventListener('mousemove', (event) => {
  if (!document.body.classList.contains('office-mode')) {
    setOfficeEmptySpaceIgnore(false);
    return;
  }
  setOfficeEmptySpaceIgnore(!officeElementReceivesPointer(event.target));
}, true);

function showOfficeCallout(targetKey, title, detail = '', ms = 5000) {
  if (!targetKey) return false;
  // A new project's lifecycle event can arrive a few milliseconds before its
  // first workstation is bootstrapped. Keep the message briefly so the next
  // stats render can attach it to that cat instead of losing the speech.
  const expiresAt = Date.now() + ms;
  officeCallouts.set(targetKey, { title: String(title || '').trim(), detail: String(detail || '').trim(), expiresAt });
  scheduleOfficeCalloutExpiry();
  renderOfficeBoard(currentStats.sessions || []);
  return true;
}

function shortProjectTitle(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

function showProjectCallout(event, title, detail = '', ms = 5000) {
  const targetKey = String(event?.target?.key || '');
  if (!targetKey) return false;
  return showOfficeCallout(targetKey, title, detail, ms);
}

function positionOfficeCallouts() {
  const boardRect = officeBoard.getBoundingClientRect();
  if (boardRect.width < 20 || boardRect.height < 20) return;
  const margin = 5;
  const maxWidth = Math.max(112, Math.min(206, boardRect.width - margin * 2));
  for (const note of officeBoard.querySelectorAll('.office-callout')) {
    const station = note.closest('.office-station');
    if (!station) continue;
    const stationRect = station.getBoundingClientRect();
    note.style.width = `${maxWidth}px`;
    note.style.maxWidth = `${maxWidth}px`;
    note.style.right = 'auto';
    note.style.left = '50%';
    note.style.top = 'auto';
    note.style.bottom = '100%';
    note.style.transform = 'translateX(-50%)';
    const noteRect = note.getBoundingClientRect();
    const left = Math.max(
      boardRect.left + margin,
      Math.min(boardRect.right - noteRect.width - margin, stationRect.left + (stationRect.width - noteRect.width) / 2),
    );
    // Speech always rises from its own cat.  renderOfficeBoard reserves a
    // temporary speech area above the cast, so never flip it underneath the
    // speaker or across another project's face.
    const top = Math.max(boardRect.top + margin, stationRect.top - noteRect.height - 10);
    const tailLeft = Math.max(10, Math.min(noteRect.width - 22, stationRect.left + stationRect.width / 2 - left - 6));
    note.style.left = `${Math.round(left - stationRect.left)}px`;
    note.style.top = `${Math.round(top - stationRect.top)}px`;
    note.style.bottom = 'auto';
    note.style.transform = 'none';
    note.style.setProperty('--callout-tail-left', `${Math.round(tailLeft)}px`);
  }
}

// The frosted stage should hug the cast rather than filling an empty window.
// Use the visible cat and its nameplate, with one small shared margin; speech
// bubbles are deliberately excluded so they never widen the glass.
function positionOfficeStageGlass() {
  const boardRect = officeBoard.getBoundingClientRect();
  if (boardRect.width < 20 || boardRect.height < 20) return;
  const parts = [...officeBoard.querySelectorAll('.office-station')]
    .flatMap((station) => [station.querySelector('.office-nameplate'), station.querySelector('.office-cat-layer')])
    .filter(Boolean)
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  if (!parts.length) {
    officeBoard.style.removeProperty('--office-stage-glass-left');
    officeBoard.style.removeProperty('--office-stage-glass-width');
    return;
  }
  const margin = 13;
  const minWidth = Math.min(104, boardRect.width);
  let left = Math.min(...parts.map((rect) => rect.left)) - boardRect.left - margin;
  let right = Math.max(...parts.map((rect) => rect.right)) - boardRect.left + margin;
  if (right - left < minWidth) {
    const center = (left + right) / 2;
    left = center - minWidth / 2;
    right = center + minWidth / 2;
  }
  left = Math.max(0, left);
  right = Math.min(boardRect.width, right);
  if (right - left < minWidth) {
    left = Math.max(0, Math.min(boardRect.width - minWidth, (left + right - minWidth) / 2));
    right = Math.min(boardRect.width, left + minWidth);
  }
  officeBoard.style.setProperty('--office-stage-glass-left', `${Math.round(left)}px`);
  officeBoard.style.setProperty('--office-stage-glass-width', `${Math.round(Math.max(0, right - left))}px`);
}

// BrowserWindow resizing is asynchronous. Reposition after its new dimensions
// are committed so a speech tail remains attached to the speaking cat.
window.addEventListener('resize', () => requestAnimationFrame(() => {
  positionOfficeStageGlass();
  positionOfficeCallouts();
}));

function scheduleOfficeRefresh(sessions) {
  clearTimeout(officeRefreshTimer);
  let nextDelay = Infinity;
  const now = Date.now();
  for (const session of sessions) {
    if (session.state === 'error' || sessionEventName(session) === 'NeedInput') continue;
    const updatedAt = Number(session.updatedAt || 0);
    if (!updatedAt) continue;
    const age = now - updatedAt;
    if (age < OFFICE_IDLE_AFTER_MS) nextDelay = Math.min(nextDelay, OFFICE_IDLE_AFTER_MS - age + 60);
    else nextDelay = Math.min(nextDelay, OFFICE_REST_MOTION_ROTATE_MS - (now % OFFICE_REST_MOTION_ROTATE_MS) + 40);
    // A long live task can remain in the same state for several minutes.  Its
    // high-frame action is therefore allowed to rotate on the same calm
    // five-minute cadence as a resting cat, never on every polling update.
    nextDelay = Math.min(nextDelay, OFFICE_ACTION_ROTATE_MS - (now % OFFICE_ACTION_ROTATE_MS) + 40);
  }
  if (Number.isFinite(nextDelay)) {
    officeRefreshTimer = setTimeout(() => renderOfficeBoard(currentStats.sessions || []), Math.max(180, nextDelay));
  }
}

function closeOfficeMenu() {
  officeMenu.classList.add('hidden');
  officeMenu.replaceChildren();
}

function openOfficeMenu(event, station, target, targets) {
  event.preventDefault();
  event.stopPropagation();
  officeMenu.replaceChildren();
  const heading = document.createElement('strong');
  heading.textContent = `🐾 ${workstationName(station, target)}`;
  const renameRow = document.createElement('div'); renameRow.className = 'office-rename-row';
  const nameInput = document.createElement('input');
  nameInput.type = 'text'; nameInput.maxLength = 24; nameInput.value = station.name || '';
  nameInput.placeholder = '猫猫名字（默认联动目标）'; nameInput.setAttribute('aria-label', '猫猫名字');
  const saveName = document.createElement('button');
  saveName.type = 'button'; saveName.textContent = '保存';
  saveName.addEventListener('click', () => {
    const stations = workstationStore();
    const current = stations.find((item) => item.id === station.id);
    if (current) { current.name = nameInput.value.trim(); saveWorkstations(stations); }
    closeOfficeMenu(); renderOfficeBoard(currentStats.sessions || []); syncOfficeManagement(currentStats.sessions || []);
  });
  renameRow.append(nameInput, saveName);
  const targetSelect = document.createElement('select');
  targetSelect.className = 'office-target-select';
  targetSelect.setAttribute('aria-label', '联动工作目标');
  for (const item of [...targets.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))) {
    const option = document.createElement('option');
    option.value = item.key; option.textContent = item.label; option.selected = item.key === station.targetKey;
    targetSelect.appendChild(option);
  }
  targetSelect.addEventListener('change', () => {
    bindWorkstationTarget(station.id, targetSelect.value);
    closeOfficeMenu(); renderOfficeBoard(currentStats.sessions || []); syncOfficeManagement(currentStats.sessions || []);
  });
  const focus = document.createElement('button');
  // This action opens the actual application bound to this cat.  It is not a
  // separate LLMPET "workspace", which made the old wording misleading.
  focus.type = 'button'; focus.className = 'office-focus-button'; focus.textContent = '打开对应软件';
  focus.addEventListener('click', async () => {
    closeOfficeMenu();
    if (!target) return showOfficeCallout(station.targetKey, '未打开对应软件', '这只猫猫还没有绑定软件。', 4500);
    const result = await window.pet.focusWorkTarget({
      source: target.source, project: target.project, projectPath: target.projectPath,
    });
    if (!result?.ok) showOfficeCallout(station.targetKey, '未打开对应软件', result?.reason || '未找到对应的软件窗口。', 4500);
  });
  officeMenu.append(heading, renameRow, targetSelect, focus);
  officeMenu.classList.remove('hidden');
  // Keep this as a small, anchored sheet instead of covering the whole office.
  // Opening upward for a lower cat leaves the other project cats reachable.
  requestAnimationFrame(() => {
    const margin = 6;
    const menuWidth = officeMenu.offsetWidth;
    const menuHeight = officeMenu.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = Math.max(margin, Math.min(viewportWidth - menuWidth - margin, event.clientX - menuWidth / 2));
    const preferAbove = event.clientY > viewportHeight / 2;
    const desiredTop = preferAbove ? event.clientY - menuHeight - 8 : event.clientY + 8;
    const top = Math.max(margin, Math.min(viewportHeight - menuHeight - margin, desiredTop));
    officeMenu.style.left = `${Math.round(left)}px`;
    officeMenu.style.top = `${Math.round(top)}px`;
  });
}

officeMenu.addEventListener('pointerdown', (event) => event.stopPropagation());
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.office-station') && !event.target.closest('#office-menu')) closeOfficeMenu();
});

function renderOfficeBoard(sessions) {
  expireOfficeCallouts();
  const targets = renderTargetCatalog(sessions);
  const stations = normalizeWorkstationIdentities(ensureWorkstationsForTargets(targets), targets);
  const desks = stations
    .filter((station) => station.visible !== false)
    .map((station) => {
      const target = targets.get(station.targetKey);
      if (!target) return null;
      const session = { state: 'idle', badge: 'idle', lastEvent: null, lastTool: '', taskTitle: '', ...target.session };
      return { station, target, session };
    })
    .filter(Boolean)
    .slice(0, MAX_VISIBLE_WORK_TARGETS);
  const presentations = new Map();
  for (const desk of desks) {
    const { station, target, session } = desk;
    const identity = station.identity;
    const state = officeState(session);
    const asset = officeMotionAsset(identity, state, session);
    const callout = officeCallouts.get(target.key);
    presentations.set(station.id, { identity, state, asset, callout });
  }
  const officeSignature = desks.map(({ station, target }) => {
    const view = presentations.get(station.id);
    const notice = view.callout && view.callout.expiresAt > Date.now()
      ? [view.callout.title, view.callout.detail, view.callout.expiresAt].join('|')
      : '';
    // A renamed cat must invalidate the office DOM immediately. Previously
    // the tray read the new stored name while this signature stayed unchanged,
    // leaving the large nameplate stale until the pet window was reopened.
    return [station.id, target.key, workstationName(station, target), view.identity, view.state, view.asset, notice].join('|');
  }).join('||');
  // State polling happens often. Rebuilding an <img> restarts a GIF from
  // frame one, so keep the same DOM while the project presentation is stable.
  if (officeSignature === appliedOfficeSignature && appliedOfficeSize) {
    scheduleOfficeRefresh(desks.map((desk) => desk.session));
    return;
  }
  appliedOfficeSignature = officeSignature;
  officeBoard.innerHTML = '';
  officeBoard.classList.toggle('hidden', desks.length === 0);
  document.body.classList.toggle('office-mode', desks.length > 0);
  document.body.dataset.officeCount = String(desks.length);
  // Start in pass-through mode.  Moving onto a cat/menu/bubble re-enables
  // interaction; empty transparent space never blocks the app underneath.
  setOfficeEmptySpaceIgnore(desks.length > 0);
  // This is a shared room, not a grid of task cards. Keep the cast close
  // together. A speaking cat temporarily grows a clear stage above the group;
  // the cats remain anchored along the bottom while the whole bubble stays
  // readable inside the window.
  const activeCallouts = [...presentations.values()].map((view) => view.callout).filter((callout) => (
    callout && callout.expiresAt > Date.now() && (String(callout.title || '').trim() || String(callout.detail || '').trim())
  ));
  const longestCallout = activeCallouts.reduce((longest, callout) => Math.max(longest, String(callout.title || '').length + String(callout.detail || '').length), 0);
  // Reserve only the speech itself plus its small tail/air gap.  The old
  // 150px minimum produced a large, transparent, clickable rectangle over
  // the desktop even for a one-line manga bubble.
  const calloutHeadroom = activeCallouts.length ? Math.min(180, Math.max(82, 52 + Math.ceil(longestCallout / 20) * 15)) : 0;
  document.body.classList.toggle('office-has-callout', activeCallouts.length > 0);
  // The room grows with the visible cast, rather than squeezing the same
  // stage around every project count. Cats retain their chosen visual size;
  // the extra room is reserved for readable nameplates and non-overlapping
  // speech bubbles.
  const OFFICE_LAYOUTS = {
    0: [240, 250],
    1: [190, 180],
    2: [250, 180],
    3: [360, 180],
    // Multi-row casts reserve a full cat-height plus a visible air gap between
    // rows.  This is intentionally based on the largest calibrated cat pose,
    // not the transparent GIF canvas or a prop that happens to share it.
    4: [300, 264],
    5: [340, 360],
  };
  const [baseWidth, baseHeight] = OFFICE_LAYOUTS[desks.length] || OFFICE_LAYOUTS[5];
  const [width, height] = [baseWidth + (activeCallouts.length ? 20 : 0), baseHeight + calloutHeadroom];
  const sizeKey = `${desks.length}:${width}x${height}:${activeCallouts.length ? 'speech' : 'cast'}`;
  applyOfficeWindowSize(width, height, sizeKey);
  for (const { station, target, session } of desks) {
    const view = presentations.get(station.id);
    const { identity, state } = view;
    const desk = document.createElement('button');
    desk.type = 'button';
    desk.className = 'office-station';
    desk.dataset.state = state;
    desk.dataset.identity = identity;
    desk.dataset.stationId = station.id;
    desk.title = '拖动移动猫猫；右键修改名字、联动目标或打开对应软件';
    const nameplate = document.createElement('span');
    nameplate.className = 'office-nameplate';
    const task = document.createElement('b');
    task.textContent = workstationName(station, target);
    const stateLabel = document.createElement('small');
    stateLabel.textContent = OFFICE_STATE_LABELS[state];
    nameplate.append(task, stateLabel);
    const scene = document.createElement('span');
    scene.className = 'office-scene-desk';
    const image = document.createElement('img');
    image.className = 'office-cat-layer office-action-gif';
    image.src = view.asset;
    const profile = officeMotionProfile(view.asset);
    image.style.setProperty('--office-motion-scale', String(profile.scale));
    image.style.setProperty('--office-motion-y', `${profile.y}px`);
    image.alt = `${OFFICE_STATE_LABELS[state]}的${OFFICE_IDENTITY_LABELS[identity] || '猫猫'}`;
    const deskLayer = document.createElement('img');
    deskLayer.className = 'office-desk-layer';
    deskLayer.src = `../assets/cat/office-scene/desks/${identity}.png`;
    deskLayer.alt = '';
    const lot = document.createElement('span');
    lot.className = 'office-lot';
    scene.append(lot, image, deskLayer);
    desk.append(nameplate, scene);
    const callout = view.callout;
    if (callout && callout.expiresAt > Date.now()) {
      const note = document.createElement('span');
      note.className = 'office-callout';
      const noteTitle = document.createElement('b'); noteTitle.textContent = callout.title;
      const noteDetail = document.createElement('small'); noteDetail.textContent = callout.detail;
      if (!callout.detail) noteDetail.classList.add('hidden');
      note.append(noteTitle, noteDetail);
      desk.appendChild(note);
    }
    let press = null;
    const finishPress = () => {
      if (press && press.longPress) clearTimeout(press.longPress);
      press = null;
    };
    desk.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      // A simple left click on any visible cat dismisses the right-click sheet.
      if (!officeMenu.classList.contains('hidden')) {
        closeOfficeMenu();
        return;
      }
      event.preventDefault();
      closeOfficeMenu();
      press = { pointerId: event.pointerId, sx: event.screenX, sy: event.screenY, wx: null, wy: null, moved: false };
      desk.setPointerCapture(event.pointerId);
      window.pet.getWindowPosition().then(([wx, wy]) => {
        if (press && press.pointerId === event.pointerId) { press.wx = wx; press.wy = wy; }
      });
    });
    desk.addEventListener('pointermove', (event) => {
      if (!press || press.pointerId !== event.pointerId || !Number.isFinite(press.wx)) return;
      const dx = event.screenX - press.sx;
      const dy = event.screenY - press.sy;
      if (Math.abs(dx) + Math.abs(dy) <= 4) return;
      press.moved = true;
      window.pet.setWindowPosition(press.wx + dx, press.wy + dy);
    });
    desk.addEventListener('pointerup', (event) => {
      if (!press || press.pointerId !== event.pointerId) return;
      try { desk.releasePointerCapture(event.pointerId); } catch {}
      finishPress();
    });
    desk.addEventListener('pointercancel', finishPress);
    desk.addEventListener('contextmenu', (event) => {
      openOfficeMenu(event, station, target, targets);
    });
    officeBoard.appendChild(desk);
  }
  requestAnimationFrame(() => {
    positionOfficeStageGlass();
    positionOfficeCallouts();
  });
  scheduleOfficeRefresh(desks.map((desk) => desk.session));
}

function render(stats) {
  currentStats = stats || { sessions: [] };
  const sessions = currentStats.sessions || [];
  const nextAggregate = dominantState(sessions, Boolean(currentStats.userWorking));
  showState(nextAggregate);
  updateDifficulty(sessions);
  if (nextAggregate === 'error' && aggregateState !== 'error' && !document.body.classList.contains('office-mode')) {
    showBubble('猫猫把错误塞进纸箱啦。', '没关系，我们换个方式再试一次！', 6500, true);
    showErrorBox();
  }
  aggregateState = nextAggregate;
  renderTaskBubbles(sessions);
  renderOfficeBoard(sessions);
  syncOfficeManagement(sessions);
  list.innerHTML = '';
  const activeCount = sessions.filter((s) => ['working', 'thinking'].includes(s.state) && s.badge !== 'done').length;
  const completedCount = sessions.filter((s) => s.badge === 'done').length;
  sessionSummary.textContent = activeCount
    ? `进行中 ${activeCount} 项 · 已完成 ${completedCount} 项`
    : completedCount ? `已完成 ${completedCount} 项 · 现在没有进行中的任务` : '现在没有进行中的任务';
  const ordered = [...sessions].sort((a, b) => taskCardRank(a) - taskCardRank(b) || Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  for (const s of ordered) {
    const view = taskCardState(s);
    const row = document.createElement('div');
    row.className = `task-card ${view.kind}`;
    row.title = '点击回到 Codex';
    row.innerHTML = '<div class="task-card-copy"><strong class="name"></strong><small></small></div><span class="task-card-state"></span><span class="state hidden"></span>';
    row.querySelector('.name').textContent = s.project || 'Codex';
    const title = String(s.taskTitle || s.project || 'Codex').replace(/\s+/g, ' ').trim();
    const source = s.taskTitle && s.project && s.taskTitle !== s.project ? `${s.project} · ` : '';
    row.querySelector('.name').textContent = title;
    row.querySelector('small').textContent = `${source}${relativeUpdateTime(s.updatedAt)}`;
    row.querySelector('.task-card-state').textContent = `${view.icon} ${view.label}`;
    row.addEventListener('click', () => window.pet.focusCodex());
    row.querySelector('.state').textContent = s.badge === 'done' ? '完成' : (labels[s.state] || s.state);
    list.appendChild(row);
  }
  if (!sessions.length) list.textContent = '暂无 Codex 会话，猫猫正在待机。';
}

function applyTimeTheme() {
  const hour = new Date().getHours();
  document.body.classList.toggle('night', hour >= 21 || hour < 6);
  document.body.classList.toggle('dusk-rain', hour >= 17 && hour < 21);
}

function greetOncePerDay() {
  const now = new Date();
  const key = `llmpet-cat-greeting-${now.toISOString().slice(0, 10)}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, '1');
  const hour = now.getHours();
  const choices = hour < 11
    ? ['早安！今天也拜托你啦。', '早上好，猫猫已经伸好懒腰啦！', '新的一天，要从一个小任务开始吗？']
    : hour < 18
      ? ['下午好！要一起完成什么？', '猫猫下午也在认真值班哦。', '喝口水，再继续推进任务吧！']
      : ['晚上好！猫猫还在值班哦。', '夜晚模式开启，慢慢来也没关系。', '今晚也一起把事情收个尾吧。'];
  const title = choices[Math.floor(Math.random() * choices.length)];
  setTimeout(() => showBubble(title, '今天的第一条问候送给你。', 4200), 1000);
}

window.pet.onStats(render);
window.pet.onOfficeSetting((setting) => {
  if (!setting || typeof setting.kind !== 'string') return;
  if (setting.kind === 'station-visible' && typeof setting.id === 'string') {
    const stations = workstationStore();
    const station = stations.find((item) => item.id === setting.id);
    if (!station) return;
    station.visible = Boolean(setting.visible);
    saveWorkstations(stations);
  } else if (setting.kind === 'station-identity' && typeof setting.id === 'string') {
    setWorkstationIdentity(setting.id, setting.identity);
  } else if (setting.kind === 'station-add' && typeof setting.targetKey === 'string') {
    addWorkstation(setting.targetKey);
  } else return;
  renderOfficeBoard(currentStats.sessions || []);
  syncOfficeManagement(currentStats.sessions || []);
});
window.pet.onLook((data) => { catShell.dataset.look = ['left', 'right'].includes(data && data.direction) ? data.direction : 'center'; });
window.pet.onAvoid((data) => {
  const shouldAvoid = Boolean(data && data.near) && !drag && panel.classList.contains('hidden') && !catShell.classList.contains('belly-play');
  catShell.classList.toggle('avoiding', shouldAvoid);
});
window.pet.onEvent((e) => {
  activeOfficeNoticeTarget = String(e?.target?.key || '');
  if (e.kind === 'needs-input') {
    showState('thinking');
    showHelpSign();
    showProjectCallout(e, '这一步需要你决定哦。', shortProjectTitle(e.task) || '请回到工作区告诉我下一步。', 12000);
  }
  else if (e.kind === 'break-water') {
    recordBreak();
    showBubble('水分已补充！', '猫猫也在空气里喝了一口水。', 4200, true);
  }
  else if (e.kind === 'break-breathe') {
    recordBreak();
    showBubble('做得好。', '肉肉和脑袋都获得了 30 秒休息。', 4200, true);
  }
  else if (e.kind === 'break-find-cat') {
    recordBreak();
    showBubble('找到猫猫啦！', '小小的胜利也是休息的一部分。', 4200, true);
  }
  else if (e.kind === 'patrol-start') {
    showState('companion');
    workProp.textContent = '🧶 巡逻中';
    workProp.classList.remove('hidden');
    catShell.dataset.trick = 'yarn';
  }
  else if (e.kind === 'patrol-end') {
    clearWorkProp();
    delete catShell.dataset.trick;
    if (aggregateState === 'idle') showState('idle');
  }
  else if (e.kind === 'turn-done') {
    showState('happy');
    if (!document.body.classList.contains('office-mode')) showStamp();
    hideHelpSign();
    recordCompletion(e.item);
    showProjectCallout(
      e,
      `「${shortProjectTitle(e.task || e.project) || '这项工作'}」完成啦！`,
      String(e.detail || '').replace(/\s+/g, ' ').trim() || '已经好好收尾，等你来验收哦。',
      8200,
    );
    if (new Date().getHours() >= 21) playTheater('nightcap', 8500);
    else if (dailyStore().data.completed % 3 === 0) playTheater('crown', 7000);
  }
  else if (e.kind === 'greet') { clearWorkProp(); showState('greet'); showProjectCallout(e, `开始关注 ${shortProjectTitle(e.project) || 'Codex'}。`, '猫猫已经到这个工位报到啦。', 3000); }
  else if (e.kind === 'operation') {
    showState('working'); setWorkProp(e.item);
    showOfficeCallout(e.target?.key, '猫猫开始忙啦。', '', 1900);
  }
  else if (e.kind === 'user-turn') {
    hideHelpSign();
    clearWorkProp();
    showState('thinking');
    const task = String(e.task || e.project || '新任务');
    const easter = /加油/.test(task) ? '收到加油，猫猫能量满格！' : /辛苦/.test(task) ? '你也辛苦啦，猫猫陪你一起做。' : /休息/.test(task) ? '好呀，休息也要认真休息。' : '猫猫开始认真处理啦。';
    showProjectCallout(e, `收到「${shortProjectTitle(task)}」的委托！`, easter, 4800);
  }
  else if (e.kind === 'munch-warning') {
    showState('loafing');
    showBubble('猫猫盯着鼠标流口水……', '再不派任务，10 秒后它就要开始啃屏幕啦！', 9000, true);
  }
  else if (e.kind === 'munch-start') {
    showState('loafing');
    showBubble('太久没有任务啦…', '猫猫开始啃屏幕！移动鼠标、按 Esc 或开始 Codex 任务即可停止。', 9000, true);
  }
  else if (e.kind === 'demo-parallel') {
    showState('working');
    renderTaskBubbles([
      { state: 'working', project: '整理资料' },
      { state: 'thinking', project: '核对结果' },
      { state: 'working', project: '编写总结' },
    ]);
    showBubble('三个小委托一起到啦！', '猫猫头顶出现了并行任务气泡。', 3600, true);
  }
  else if (e.kind === 'demo-long-work') {
    workingSince = Date.now() - 3 * 60 * 1000;
    showState('working');
    updateWorkMotion();
    showBubble('已经认真工作一会儿啦。', '猫猫会换成轻微的长期工作动作。', 3600, true);
  }
  else if (e.kind === 'demo-error') {
    showState('error');
    showErrorBox();
    showBubble('猫猫把错误塞进纸箱啦。', '没关系，我们换个方式再试一次！', 6500, true);
  }
  else if (e.kind === 'demo-night') {
    document.body.classList.add('night');
    showBubble('深夜暖色模式。', '夜里也别忘了让眼睛休息一下。', 3600, true);
    setTimeout(applyTimeTheme, 3900);
  }
  else if (e.kind === 'break-reminder') {
    showBubble('40 分钟专注达成！', '猫猫已经把休息卡送到屏幕中央啦。', 5000, true);
  }
  else if (e.kind === 'rest-voucher') {
    showState('loafing');
    showBubble('📜 猫猫摸鱼许可证', '你已经认真很久啦，批准休息 3 分钟！', 9000, true);
  }
  else if (e.kind === 'rest-return') showBubble('休息券到期啦。', '喝过水就回来和猫猫继续吧！', 5000, true);
  else if (e.kind === 'task-error') {
    const failures = recordFailure();
    showState('error'); if (!document.body.classList.contains('office-mode')) showErrorBox();
    if (failures >= 2) playTheater('comfort', 8000);
    showProjectCallout(e, '这里遇到一点小问题。', failures >= 2 ? '先喝口水，我们再一起整理。' : '没关系，我们换个方式再试一次！', 6500);
  }
  activeOfficeNoticeTarget = '';
});

let drag = null;
$('cat').addEventListener('pointerdown', async (event) => {
  if (event.button !== 0) return;
  const [wx, wy] = await window.pet.getWindowPosition();
  drag = { pointerId: event.pointerId, sx: event.screenX, sy: event.screenY, wx, wy, moved: false, startedAt: Date.now() };
  $('cat').setPointerCapture(event.pointerId);
  event.preventDefault();
});
$('cat').addEventListener('pointermove', (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const dx = event.screenX - drag.sx;
  const dy = event.screenY - drag.sy;
  if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
  if (drag.moved) window.pet.setWindowPosition(drag.wx + dx, drag.wy + dy);
});
$('cat').addEventListener('pointerup', (event) => {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const moved = drag.moved;
  drag = null;
  if (!moved) reactToPetTap();
});
$('cat').addEventListener('pointercancel', () => { drag = null; });
$('close').addEventListener('click', () => {
  panel.classList.add('hidden');
  appliedOfficeSize = '';
  renderOfficeBoard(currentStats.sessions || []);
});
$('notes-toggle').addEventListener('click', () => { notesPanel.classList.toggle('hidden'); renderNotes(); });
nextNote.addEventListener('click', () => {
  hideHelpSign();
  window.pet.focusCodex();
});
$('note-add').addEventListener('click', () => {
  const text = noteInput.value.trim(); if (!text) return;
  const store = dailyStore(); store.data.notes.push({ text, done: false }); noteInput.value = ''; saveDaily(store.data);
});
noteInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); $('note-add').click(); } });
$('hide').addEventListener('click', () => window.pet.hide());
$('quit').addEventListener('click', () => window.pet.quit());
setInterval(updateWorkMotion, 15 * 1000);
setInterval(applyTimeTheme, 60 * 1000);
applyTimeTheme();
renderNotes();
window.pet.getStats().then((data) => { render(data); greetOncePerDay(); });
