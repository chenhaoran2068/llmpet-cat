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
const screenCat = document.getElementById('screen-cat');
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
    screenCat.style.display = 'none';
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

  // A soft twilight sheet is nibbled away, so the desktop remains visible through the bites.
  ctx.fillStyle = `rgba(59,47,71,${.12 + Math.pow(progress, 1.45) * .55})`;
  ctx.fillRect(0, 0, width, height);

  // Individual round bites travel from the desktop cat toward the mouse cursor.
  const count = 28;
  for (let i = 0; i < count; i += 1) {
    const threshold = i / count;
    if (progress < threshold) continue;
    const local = Math.min(1, (progress - threshold) * count * 1.7);
    const p = pointOnPath((i + 1) / (count + 1));
    const radius = 22 + local * (66 + (i % 4) * 11);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (local > .28) {
      ctx.fillStyle = 'rgba(255,222,158,.82)';
      ctx.beginPath(); ctx.arc(p.x + radius * .66, p.y - radius * .46, 3 + (i % 3), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(222,153,104,.7)';
      ctx.beginPath(); ctx.arc(p.x - radius * .55, p.y + radius * .5, 2 + (i % 2), 0, Math.PI * 2); ctx.fill();
    }
  }

  // The final bite stays a playful hole around the mouse, never a hard black screen.
  const mouth = 18 + progress * 52;
  ctx.save(); ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cursor.x, cursor.y, mouth, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const catProgress = Math.min(.94, progress * 1.08);
  const catPoint = pointOnPath(catProgress);
  screenCat.style.display = 'block';
  screenCat.style.left = `${catPoint.x - 63}px`;
  screenCat.style.top = `${catPoint.y - 82}px`;
  screenCat.style.transform = `rotate(${Math.sin(now / 120) * 5}deg) scale(${1 + Math.sin(now / 140) * .045})`;

  if (progress < 1) requestAnimationFrame(draw);
}

addEventListener('resize', resize);
resize();
requestAnimationFrame(draw);
