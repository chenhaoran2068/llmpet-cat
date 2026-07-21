'use strict';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'eat';
const num = (key, fallback) => {
  const value = Number(params.get(key));
  return Number.isFinite(value) ? value : fallback;
};
const cursor = { x: num('cursorX', innerWidth / 2), y: num('cursorY', innerHeight / 2) };
const cat = { x: num('catX', innerWidth - 120), y: num('catY', innerHeight - 120) };
const duration = num('duration', 18000);
const canvas = document.getElementById('munch');
const ctx = canvas.getContext('2d');
let startedAt = performance.now();
const hint = document.querySelector('.hint');
if (mode === 'warning') hint.textContent = '猫猫盯着鼠标流口水……10 秒后开始啃屏幕';

function resize() {
  const scale = devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * scale);
  canvas.height = Math.round(innerHeight * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

function pointOnPath(t) {
  const wobble = Math.sin(t * 17) * 22 * (1 - t);
  return {
    x: cat.x + (cursor.x - cat.x) * t + wobble,
    y: cat.y + (cursor.y - cat.y) * t + Math.cos(t * 13) * 14 * (1 - t),
  };
}

function draw(now) {
  const progress = Math.min(1, (now - startedAt) / duration);
  const width = innerWidth;
  const height = innerHeight;
  ctx.clearRect(0, 0, width, height);

  if (mode === 'warning') {
    const pulse = .5 + Math.sin(now / 220) * .5;
    for (let i = 0; i < 6; i += 1) {
      const p = pointOnPath((i + 1) / 7);
      const radius = 8 + (i % 3) * 3 + pulse * 3;
      ctx.fillStyle = `rgba(111, 188, 219, ${.3 + pulse * .24})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y + Math.sin(now / 280 + i) * 8, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    const ring = 20 + pulse * 9;
    ctx.strokeStyle = `rgba(255, 214, 134, ${.45 + pulse * .3})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, ring, 0, Math.PI * 2);
    ctx.stroke();
    requestAnimationFrame(draw);
    return;
  }

  // The soft sheet makes the last bites become a harmless black screen.
  ctx.fillStyle = `rgba(0,0,0,${Math.pow(progress, 1.6)})`;
  ctx.fillRect(0, 0, width, height);

  // Individual round bites travel from the cat toward the mouse cursor.
  const count = 24;
  for (let i = 0; i < count; i += 1) {
    const threshold = i / count;
    if (progress < threshold) continue;
    const local = Math.min(1, (progress - threshold) * count * 1.7);
    const p = pointOnPath((i + 1) / (count + 1));
    const radius = 35 + local * (105 + (i % 4) * 18);
    const gradient = ctx.createRadialGradient(p.x, p.y, radius * .22, p.x, p.y, radius);
    gradient.addColorStop(0, 'rgba(0,0,0,.98)');
    gradient.addColorStop(.72, 'rgba(0,0,0,.9)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // The final bite circles the mouse before the screen turns fully black.
  const mouth = 24 + progress * 74;
  ctx.fillStyle = 'rgba(0,0,0,.98)';
  ctx.beginPath();
  ctx.arc(cursor.x, cursor.y, mouth, 0, Math.PI * 2);
  ctx.fill();

  if (progress < 1) requestAnimationFrame(draw);
}

addEventListener('resize', resize);
resize();
requestAnimationFrame(draw);
