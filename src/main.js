import './style.css';
import { beatmap } from './beatmap.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const stageWrap = document.getElementById('stageWrap');
const audio = document.getElementById('song');

const scoreEl = document.getElementById('score');
const comboEl = document.getElementById('combo');
const missEl = document.getElementById('miss');
const feedbackEl = document.getElementById('feedback');
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const restartBtn = document.getElementById('restartBtn');
const exitBtn = document.getElementById('exitBtn');

const lanes = 4;
const travelTime = 2.15;
const noteHeightRatio = 0.105;
const hitWindowPerfect = 0.08;
const hitWindowGood = 0.16;
const playableFallbackInterval = 0.46;
const fallbackLanePattern = [0, 2, 1, 3, 1, 0, 3, 2, 0, 1, 2, 3, 2, 0, 1, 3];

let notes = [];
let score = 0;
let combo = 0;
let miss = 0;
let running = false;
let paused = false;
let rafId = null;
let lastDuration = 0;
let lastFeedbackTimer = 0;

function lockPage() {
  const h = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${h}px`);
  window.scrollTo(0, 0);
}

function preventDefaultTouch(e) {
  if (e.cancelable) e.preventDefault();
}

['touchmove', 'gesturestart', 'gesturechange', 'gestureend'].forEach((type) => {
  document.addEventListener(type, preventDefaultTouch, { passive: false });
});

document.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', () => { lockPage(); resizeCanvas(); });
window.visualViewport?.addEventListener('resize', () => { lockPage(); resizeCanvas(); });
window.visualViewport?.addEventListener('scroll', lockPage);
lockPage();

function resizeCanvas() {
  const rect = stageWrap.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function getStageSize() {
  const rect = stageWrap.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function getJudgementTopY(height) {
  // v6: 判定白线就是灰色长框的顶线；只保留这一条白线。
  return height * 0.765;
}

function getHitZoneHeight(height) {
  return Math.max(78, height * 0.125);
}

function prepareNotes(duration) {
  const safeDuration = Number.isFinite(duration) && duration > 4 ? duration : 60;
  const source = [...beatmap].sort((a, b) => a.time - b.time);
  const generated = source.map((n, i) => ({
    id: `base-${i}`,
    time: n.time,
    lane: Math.max(0, Math.min(lanes - 1, n.lane)),
    hit: false,
    missed: false,
  }));

  let t = generated.length ? generated[generated.length - 1].time + playableFallbackInterval : 1.2;
  let patternIndex = generated.length;
  while (t < safeDuration - 0.3) {
    let lane = fallbackLanePattern[patternIndex % fallbackLanePattern.length];

    // 避免测试谱后半段变成只在右侧两列循环，也避免连续同一列。
    const previous = generated[generated.length - 1];
    if (previous && previous.lane === lane) {
      lane = (lane + 1) % lanes;
    }

    generated.push({
      id: `auto-${generated.length}`,
      time: Number(t.toFixed(3)),
      lane,
      hit: false,
      missed: false,
    });
    patternIndex += 1;
    t += playableFallbackInterval;
  }
  notes = generated;
}

function resetState(keepFeedback = false) {
  score = 0;
  combo = 0;
  miss = 0;
  running = false;
  paused = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  audio.pause();
  audio.currentTime = 0;
  prepareNotes(lastDuration || audio.duration || 60);
  updateHud();
  pauseBtn.textContent = '暂停';
  if (!keepFeedback) setFeedback('Ready');
  draw();
}

function updateHud() {
  scoreEl.textContent = score;
  comboEl.textContent = combo;
  missEl.textContent = miss;
}

function setFeedback(text, temporary = false) {
  feedbackEl.textContent = text;
  feedbackEl.style.opacity = '1';
  if (lastFeedbackTimer) clearTimeout(lastFeedbackTimer);
  if (temporary) {
    lastFeedbackTimer = setTimeout(() => {
      if (running && !paused) feedbackEl.style.opacity = '0';
    }, 460);
  }
}

function requestFullscreenSoft() {
  const el = document.documentElement;
  if (el.requestFullscreen && !document.fullscreenElement) {
    el.requestFullscreen().catch(() => {});
  }
}

async function startGame() {
  lockPage();
  requestFullscreenSoft();
  resizeCanvas();

  if (!audio.getAttribute('src')) {
    setFeedback('请先放入歌曲');
    return;
  }

  if (!running) {
    resetState(true);
    running = true;
    paused = false;
  }

  try {
    await audio.play();
    lastDuration = audio.duration || lastDuration;
    prepareNotes(lastDuration || 60);
    setFeedback('Go!', true);
    loop();
  } catch (err) {
    setFeedback('歌曲无法播放');
    console.error(err);
  }
}

function pauseGame() {
  if (!running) return;
  if (paused) {
    paused = false;
    pauseBtn.textContent = '暂停';
    audio.play().catch(() => {});
    setFeedback('Go!', true);
    loop();
  } else {
    paused = true;
    pauseBtn.textContent = '继续';
    audio.pause();
    setFeedback('Paused');
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    draw();
  }
}

function exitGame() {
  resetState();
  setFeedback('Ready');
}

function noteY(note, currentTime, height) {
  const judgementY = getJudgementTopY(height);
  return judgementY - ((note.time - currentTime) / travelTime) * judgementY;
}

function draw() {
  resizeCanvas();
  const { width, height } = getStageSize();
  const laneW = width / lanes;
  const judgementY = getJudgementTopY(height);
  const hitZoneH = getHitZoneHeight(height);
  const now = running ? audio.currentTime : 0;

  ctx.clearRect(0, 0, width, height);

  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#161616');
  bg.addColorStop(1, '#0e0e0e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  for (let i = 1; i < lanes; i += 1) {
    const x = i * laneW;
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // v6: 灰色判定区从白线开始，白线与灰框顶线完全重合。
  ctx.fillStyle = 'rgba(255,255,255,.085)';
  ctx.fillRect(0, judgementY, width, hitZoneH);

  // v6: 只画这一条白色判定线，不再画灰框内部的额外横线。
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,.9)';
  ctx.shadowBlur = 8;
  ctx.strokeStyle = 'rgba(255,255,255,.94)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, judgementY);
  ctx.lineTo(width, judgementY);
  ctx.stroke();
  ctx.restore();

  const noteH = Math.max(56, height * noteHeightRatio);
  notes.forEach((note) => {
    if (note.hit || note.missed) return;
    const y = noteY(note, now, height);
    if (y < -noteH || y > height + noteH) return;
    const x = note.lane * laneW + 7;
    const w = laneW - 14;
    const radius = Math.min(16, w * .16);
    roundRect(ctx, x, y - noteH / 2, w, noteH, radius);
    const grad = ctx.createLinearGradient(0, y - noteH / 2, 0, y + noteH / 2);
    grad.addColorStop(0, '#080808');
    grad.addColorStop(.5, '#000');
    grad.addColorStop(1, '#1d1d1d');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

function roundRect(context, x, y, w, h, r) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function updateMisses() {
  const { height } = getStageSize();
  const now = audio.currentTime;
  notes.forEach((note) => {
    if (note.hit || note.missed) return;
    const y = noteY(note, now, height);
    const bottomLimit = getJudgementTopY(height) + getHitZoneHeight(height) + height * .02;
    if (y > bottomLimit) {
      note.missed = true;
      combo = 0;
      miss += 1;
      setFeedback('Miss', true);
      updateHud();
    }
  });
}

function loop() {
  if (!running || paused) return;
  updateMisses();
  draw();
  if (audio.ended) {
    running = false;
    setFeedback('Done');
    draw();
    return;
  }
  rafId = requestAnimationFrame(loop);
}

function handlePointerDown(event) {
  event.preventDefault();
  if (!running || paused) return;

  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const lane = Math.max(0, Math.min(lanes - 1, Math.floor(x / (rect.width / lanes))));
  hitLane(lane, y);
}

function hitLane(lane, pointerY) {
  const { height } = getStageSize();
  const now = audio.currentTime;
  const judgementY = getJudgementTopY(height);
  const hitZoneH = getHitZoneHeight(height);
  const noteH = Math.max(56, height * noteHeightRatio);

  const candidates = notes
    .filter((note) => !note.hit && !note.missed && note.lane === lane)
    .map((note) => {
      const y = noteY(note, now, height);
      const timeDiff = Math.abs(note.time - now);
      const touchedNote = pointerY >= y - noteH / 2 - 8 && pointerY <= y + noteH / 2 + 8;
      const inZone = y >= judgementY - noteH * .45 && y <= judgementY + hitZoneH;
      return { note, y, timeDiff, touchedNote, inZone };
    })
    .filter((item) => item.timeDiff <= hitWindowGood || item.touchedNote || item.inZone)
    .sort((a, b) => {
      if (a.touchedNote !== b.touchedNote) return a.touchedNote ? -1 : 1;
      return a.timeDiff - b.timeDiff;
    });

  if (!candidates.length) {
    combo = 0;
    miss += 1;
    setFeedback('Miss', true);
    updateHud();
    return;
  }

  const target = candidates[0].note;
  const diff = Math.abs(target.time - now);
  target.hit = true;
  combo += 1;

  if (diff <= hitWindowPerfect || candidates[0].touchedNote) {
    score += 100 + combo;
    setFeedback('Perfect', true);
  } else {
    score += 50 + combo;
    setFeedback('Good', true);
  }
  updateHud();
  draw();
}

audio.addEventListener('loadedmetadata', () => {
  lastDuration = audio.duration || 60;
  prepareNotes(lastDuration);
  draw();
});

audio.addEventListener('error', () => {
  setFeedback('请先放入歌曲');
  console.warn('Audio failed to load. Expected file: public/audio/song.mp3');
});

canvas.addEventListener('pointerdown', handlePointerDown, { passive: false });
startBtn.addEventListener('click', startGame);
pauseBtn.addEventListener('click', pauseGame);
restartBtn.addEventListener('click', startGame);
exitBtn.addEventListener('click', exitGame);

prepareNotes(60);
resizeCanvas();
draw();
