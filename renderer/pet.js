'use strict';

const $ = (id) => document.getElementById(id);
const cat = $('cat-img');
const catShell = $('cat');
const status = $('status');
const bubble = $('bubble');
const bubbleTitle = $('bubble-title');
const bubbleDetail = $('bubble-detail');
const panel = $('sessions');
const list = $('session-list');
const taskBubbles = $('task-bubbles');
const doneStamp = $('done-stamp');
const errorBox = $('error-box');
const achievementStrip = $('achievement-strip');
const notesPanel = $('notes-panel');
const noteInput = $('note-input');
const noteList = $('note-list');
let currentStats = { sessions: [] };
let bubbleTimer = null;
let stampTimer = null;
let errorTimer = null;
let displayedState = '';
let aggregateState = 'idle';
let workingSince = 0;

const images = {
  idle: 'candidate-09.gif',
  working: 'candidate-03.gif',
  companion: 'candidate-03.gif',
  thinking: 'candidate-03.gif',
  sleeping: 'cat-sleeping.gif',
  error: 'candidate-04.gif',
  happy: 'candidate-05.gif',
  talking: 'cat-talking.gif',
  greet: 'candidate-01.gif',
  loafing: 'candidate-02.gif',
};
const labels = { idle: '待机中', working: '正在工作', companion: '陪你工作中', thinking: '思考中', sleeping: '睡觉中', error: '遇到错误', happy: '完成啦', talking: '回复中', greet: '你好呀', loafing: '休息一下' };

function localDay() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dailyStore() {
  const key = `llmpet-cat-day-${localDay()}`;
  try { return { key, data: JSON.parse(localStorage.getItem(key)) || { completed: 0, failures: 0, notes: [], achievements: [] } }; }
  catch { return { key, data: { completed: 0, failures: 0, notes: [], achievements: [] } }; }
}

function saveDaily(data) {
  localStorage.setItem(`llmpet-cat-day-${localDay()}`, JSON.stringify(data));
  renderNotesAndAchievements(data);
}

function addAchievement(data, id, label) {
  if (!data.achievements.some((item) => item.id === id)) data.achievements.push({ id, label });
}

function renderNotesAndAchievements(data = dailyStore().data) {
  achievementStrip.textContent = data.achievements.length ? `今日贴纸：${data.achievements.map((item) => item.label).join(' · ')}` : '今日贴纸：完成任务就会慢慢收集哦。';
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

function recordCompletion() {
  const store = dailyStore(); const data = store.data;
  data.completed += 1; data.failures = 0;
  const milestones = { 3: '三连完成', 5: '任务达人', 10: '十全十美' };
  if (milestones[data.completed]) addAchievement(data, `complete-${data.completed}`, milestones[data.completed]);
  if (new Date().getHours() >= 21) addAchievement(data, 'night-owl', '夜猫子');
  const pending = data.notes.find((note) => !note.done);
  if (pending) pending.done = true;
  saveDaily(data);
  return milestones[data.completed] || null;
}

function recordFailure() {
  const store = dailyStore(); store.data.failures += 1; saveDaily(store.data); return store.data.failures;
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

function showState(state) {
  const s = images[state] ? state : 'idle';
  if (displayedState !== s) cat.src = `../assets/cat/${images[s]}`;
  displayedState = s;
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

function showBubble(title, detail = '', ms = 5000, completion = false) {
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
  for (const s of sessions) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<i class="dot ${s.badge === 'done' ? 'done' : s.state}"></i><span class="name"></span><span class="state"></span>`;
    row.querySelector('.name').textContent = s.project || 'Codex';
    row.querySelector('.state').textContent = s.badge === 'done' ? '完成' : (labels[s.state] || s.state);
    list.appendChild(row);
  }
  if (!sessions.length) list.textContent = '暂无 Codex 会话，猫猫正在待机。';
  showDailyReport(nextAggregate, sessions);
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

function showDailyReport(state, sessions) {
  const hour = new Date().getHours();
  if (hour < 20 || state !== 'idle' || sessions.some((s) => s.state !== 'idle')) return;
  const key = `llmpet-cat-report-${localDay()}`;
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, '1');
  const data = dailyStore().data;
  setTimeout(() => showBubble('今天的猫猫战绩。', `今天一起完成了 ${data.completed} 个任务，辛苦啦！`, 6500, true), 900);
}

window.pet.onStats(render);
window.pet.onLook((data) => { catShell.dataset.look = ['left', 'right'].includes(data && data.direction) ? data.direction : 'center'; });
window.pet.onEvent((e) => {
  if (e.kind === 'turn-done') {
    showState('happy');
    showStamp();
    const streak = recordCompletion();
    const extra = streak ? ` 连胜贴纸「${streak}」到手！` : '';
    showBubble(`「${e.task || e.project || '这个任务'}」完成了哦！`, `${e.detail || ''}${extra}`, 11000, true);
  }
  else if (e.kind === 'greet') { showState('greet'); showBubble(`开始关注 ${e.project || 'Codex'}。`, '', 3000); }
  else if (e.kind === 'operation') showState('working');
  else if (e.kind === 'user-turn') {
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
    const store = dailyStore(); addAchievement(store.data, 'long-focus', '长时专注'); saveDaily(store.data);
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
    showBubble('猫猫把错误塞进纸箱啦。', failures >= 2 ? '先喝口水，我们再来。' : '没关系，我们换个方式再试一次！', 6500, true);
  }
});

let drag = null;
$('cat').addEventListener('pointerdown', async (event) => {
  if (event.button !== 0) return;
  const [wx, wy] = await window.pet.getWindowPosition();
  drag = { pointerId: event.pointerId, sx: event.screenX, sy: event.screenY, wx, wy, moved: false };
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
  if (!moved) panel.classList.toggle('hidden');
});
$('cat').addEventListener('pointercancel', () => { drag = null; });
$('close').addEventListener('click', () => panel.classList.add('hidden'));
$('notes-toggle').addEventListener('click', () => { notesPanel.classList.toggle('hidden'); renderNotesAndAchievements(); });
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
renderNotesAndAchievements();
window.pet.getStats().then((data) => { render(data); greetOncePerDay(); });
