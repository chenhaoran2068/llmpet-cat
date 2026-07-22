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
const doneStamp = $('done-stamp');
const errorBox = $('error-box');
const notesPanel = $('notes-panel');
const noteInput = $('note-input');
const noteList = $('note-list');
const focusPact = $('focus-pact');
const focusTime = $('focus-time');
const helpSign = $('help-sign');
const nextNote = $('next-note');
const workProp = $('work-prop');
const moodToggle = $('mood-toggle');
const quietToggle = $('quiet-toggle');
const clickThroughToggle = $('click-through-toggle');
let currentStats = { sessions: [] };
let bubbleTimer = null;
let stampTimer = null;
let errorTimer = null;
let displayedState = '';
let aggregateState = 'idle';
let workingSince = 0;
let displayedGif = '';
let gifRotationTimer = null;
let focusDeadline = 0;
let focusTimer = null;
let theaterTimer = null;
let petTapTimes = [];
let bellyPlayTimer = null;
let lastBellyMode = '';
let transitionTimer = null;
let petConfig = { quietMode: false, clickThrough: false, gifMood: 'balanced' };

const images = {
  idle: ['candidate-09.gif', 'candidate-02.gif', 'candidate-01.gif'],
  working: ['candidate-03.gif', 'candidate-01.gif', 'candidate-09.gif'],
  companion: ['candidate-03.gif', 'candidate-02.gif', 'candidate-09.gif'],
  thinking: ['candidate-03.gif', 'candidate-02.gif', 'candidate-09.gif'],
  sleeping: ['cat-sleeping.gif'],
  error: ['candidate-04.gif'],
  happy: ['candidate-05.gif', 'candidate-01.gif', 'cat-talking.gif'],
  talking: ['cat-talking.gif', 'candidate-01.gif', 'candidate-05.gif'],
  greet: ['candidate-01.gif', 'candidate-05.gif'],
  loafing: ['candidate-02.gif', 'candidate-09.gif', 'candidate-05.gif'],
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
    const data = JSON.parse(localStorage.getItem(key)) || { completed: 0, failures: 0, notes: [], focusPacts: 0, breaks: 0 };
    if (Object.hasOwn(data, 'stickers') || Object.hasOwn(data, 'nestItems')) {
      delete data.stickers; delete data.nestItems; localStorage.setItem(key, JSON.stringify(data));
    }
    return { key, data };
  }
  catch { return { key, data: { completed: 0, failures: 0, notes: [], focusPacts: 0, breaks: 0 } }; }
}

function saveDaily(data) {
  localStorage.setItem(`llmpet-cat-day-${localDay()}`, JSON.stringify(data));
  renderNotes(data);
}

function prepareDaily(data) {
  data.notes ||= [];
  data.focusPacts ||= 0; data.breaks ||= 0; data.failures ||= 0; data.completed ||= 0;
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
  const variants = images[state] || images.idle;
  if (petConfig.gifMood === 'calm') return variants.slice(0, Math.min(2, variants.length));
  if (petConfig.gifMood === 'lively') return variants;
  return variants.slice(0, Math.min(3, variants.length));
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
    ? 8_000 + Math.floor(Math.random() * 6_000)
    : ['working', 'thinking'].includes(displayedState)
      ? 18_000 + Math.floor(Math.random() * 12_000)
      : 35_000 + Math.floor(Math.random() * 20_000);
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
  const hour = new Date().getHours();
  if (petConfig.quietMode && (hour >= 23 || hour < 8) && !urgent) return;
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

function applyPetConfig(next = {}) {
  petConfig = { ...petConfig, ...next };
  document.body.classList.toggle('quiet-mode', Boolean(petConfig.quietMode));
  moodToggle.textContent = `🎞️ ${{ calm: '安静', balanced: '均衡', lively: '活泼' }[petConfig.gifMood] || '均衡'}`;
  quietToggle.classList.toggle('active', Boolean(petConfig.quietMode));
  clickThroughToggle.classList.toggle('active', Boolean(petConfig.clickThrough));
  quietToggle.textContent = petConfig.quietMode ? '🌙 安静中' : '🌙 安静时段';
  clickThroughToggle.textContent = petConfig.clickThrough ? '🫧 已穿透' : '🫧 点击穿透';
  changeGif();
  scheduleGifRotation();
}

function playTheater(kind, ms = 7000) {
  clearTimeout(theaterTimer);
  catShell.dataset.theater = kind;
  theaterTimer = setTimeout(() => { delete catShell.dataset.theater; }, ms);
}

function renderFocusTime() {
  if (!focusDeadline) return;
  const remaining = Math.max(0, focusDeadline - Date.now());
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  focusTime.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function startFocusPact(endsAt) {
  focusDeadline = Number(endsAt) || 0;
  if (!focusDeadline) return;
  clearInterval(focusTimer);
  focusPact.classList.remove('hidden');
  catShell.dataset.focus = 'true';
  renderFocusTime();
  focusTimer = setInterval(renderFocusTime, 1000);
}

function finishFocusPact() {
  focusDeadline = 0;
  clearInterval(focusTimer); focusTimer = null;
  focusPact.classList.add('hidden');
  delete catShell.dataset.focus;
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

function recordFocusPact() {
  const store = dailyStore();
  prepareDaily(store.data);
  store.data.focusPacts += 1;
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

function taskCardState(session) {
  if (session.badge === 'done') return { kind: 'done', icon: '✓', label: '已完成' };
  if (session.state === 'error') return { kind: 'error', icon: '!', label: '遇到问题' };
  if (session.state === 'working') return { kind: 'working', icon: '●', label: '进行中' };
  if (session.state === 'thinking' && session.lastEvent === 'NeedInput') return { kind: 'needs-input', icon: '!', label: '需要你决定' };
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

function render(stats) {
  currentStats = stats || { sessions: [] };
  const sessions = currentStats.sessions || [];
  const nextAggregate = dominantState(sessions, Boolean(currentStats.userWorking));
  showState(nextAggregate);
  updateDifficulty(sessions);
  if (nextAggregate === 'error' && aggregateState !== 'error') {
    showBubble('猫猫把错误塞进纸箱啦。', '没关系，我们换个方式再试一次！', 6500, true);
    showErrorBox();
  }
  aggregateState = nextAggregate;
  renderTaskBubbles(sessions);
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

window.pet.onConfig(applyPetConfig);
window.pet.onStats(render);
window.pet.onLook((data) => { catShell.dataset.look = ['left', 'right'].includes(data && data.direction) ? data.direction : 'center'; });
window.pet.onAvoid((data) => {
  const shouldAvoid = Boolean(data && data.near) && !drag && panel.classList.contains('hidden') && !catShell.classList.contains('belly-play');
  catShell.classList.toggle('avoiding', shouldAvoid);
});
window.pet.onEvent((e) => {
  if (e.kind === 'focus-start') {
    startFocusPact(e.endsAt);
    showState('working');
    showBubble('猫猫已就位！', `我们一起专注 ${e.minutes} 分钟，不赶路也不走神。`, 5200, true);
  }
  else if (e.kind === 'focus-finish') {
    finishFocusPact();
    recordFocusPact();
    showState('happy');
    playTheater('crown', 6000);
    showStamp();
    showBubble('专注契约完成！', `${e.minutes} 分钟认真守约，现在起身伸个懒腰吧！`, 8500, true);
  }
  else if (e.kind === 'focus-cancel') {
    finishFocusPact();
    showBubble('专注契约先放一放。', '猫猫会等你下次想认真的时候。', 3600);
  }
  else if (e.kind === 'needs-input') {
    showState('thinking');
    showHelpSign();
    showBubble('这一步需要你决定哦。', '可能是“要继续吗？”或“选 A 还是 B？”，点下便签就回去回复 Codex。', 12000, true, true);
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
  else if (e.kind === 'next-gif') {
    changeGif();
    scheduleGifRotation();
    showBubble('猫猫换了个动作。', '每次都想给你一点新鲜感！', 3200);
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
    showStamp();
    hideHelpSign();
    const completed = recordCompletion(e.item);
    if (new Date().getHours() >= 21) playTheater('nightcap', 8500);
    else if (dailyStore().data.completed % 3 === 0) playTheater('crown', 7000);
    showBubble('任务完成了哦！', `${e.detail || ''}今日第 ${completed} 件。`, 11000, true);
  }
  else if (e.kind === 'greet') { clearWorkProp(); showState('greet'); showBubble(`开始关注 ${e.project || 'Codex'}。`, '', 3000); }
  else if (e.kind === 'operation') { showState('working'); setWorkProp(e.item); }
  else if (e.kind === 'user-turn') {
    hideHelpSign();
    clearWorkProp();
    showState('thinking');
    const task = String(e.task || e.project || '新任务');
    const easter = /加油/.test(task) ? '收到加油，猫猫能量满格！' : /辛苦/.test(task) ? '你也辛苦啦，猫猫陪你一起做。' : /休息/.test(task) ? '好呀，休息也要认真休息。' : '猫猫开始认真处理啦。';
    showBubble(`收到「${task}」的委托！`, easter, 4800, true);
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
    showState('error'); showErrorBox();
    if (failures >= 2) playTheater('comfort', 8000);
    showBubble('猫猫把错误塞进纸箱啦。', failures >= 2 ? '先喝口水，我们再来。' : '没关系，我们换个方式再试一次！', 6500, true);
  }
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
  const heldMs = Date.now() - drag.startedAt;
  drag = null;
  if (!moved && heldMs >= 550) panel.classList.toggle('hidden');
  else if (!moved) reactToPetTap();
});
$('cat').addEventListener('pointercancel', () => { drag = null; });
$('close').addEventListener('click', () => panel.classList.add('hidden'));
$('notes-toggle').addEventListener('click', () => { notesPanel.classList.toggle('hidden'); renderNotes(); });
$('focus-25').addEventListener('click', () => window.pet.startFocus(25));
$('focus-50').addEventListener('click', () => window.pet.startFocus(50));
 moodToggle.addEventListener('click', () => {
  const order = ['calm', 'balanced', 'lively'];
  const next = order[(order.indexOf(petConfig.gifMood) + 1) % order.length];
  window.pet.setPreference('gifMood', next);
 });
quietToggle.addEventListener('click', () => window.pet.setPreference('quietMode', !petConfig.quietMode));
clickThroughToggle.addEventListener('click', () => window.pet.setPreference('clickThrough', !petConfig.clickThrough));
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
window.pet.getConfig().then(applyPetConfig);
window.pet.getStats().then((data) => { render(data); greetOncePerDay(); });
