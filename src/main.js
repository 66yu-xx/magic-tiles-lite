import './style.css';

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
const noteHeightRatio = 0.105;
const hitWindowPerfect = 0.07;
const hitWindowGood = 0.14;
const hitWindowOk = 0.22;
const selectedDifficulty = 'easy';
const TEST_SONG = {
  bpm: 120,
  firstBeatTime: 1.2,
  difficulties: {
    easy: {
      noteTravelTime: 2.15,
      chart: Array.from({ length: 240 }, (_, beat) => ({
        beat,
        lane: beat % lanes,
        type: 'tap',
      })),
    },
  },
};
const selectedChart = TEST_SONG.difficulties[selectedDifficulty];
const travelTime = selectedChart.noteTravelTime;
const bpm = TEST_SONG.bpm;
const beatInterval = 60000 / bpm;
const firstBeatTime = TEST_SONG.firstBeatTime;

let notes = [];
let score = 0;
let combo = 0;
let miss = 0;
let running = false;
let paused = false;
let rafId = null;
let lastDuration = 0;
let lastFeedbackTimer = 0;

audio.src = `${import.meta.env.BASE_URL}audio/song.mp3`;

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

function getHitZoneHeight(height) {
  return Math.max(78, height * 0.125);
}

function getJudgementTopY(height) {
  // v7：在 v6 基础上，白线和灰色判定区整体上移半个灰框高度。
  const oldY = height * 0.765;
  return Math.max(height * 0.62, oldY - getHitZoneHeight(height) * 1);
}

function getHitLineY(height) {
  return getJudgementTopY(height) + getHitZoneHeight(height);
}

function prepareNotes(duration) {
  const safeDuration = Number.isFinite(duration) && duration > 4 ? duration : 60;
  const beatIntervalSeconds = beatInterval / 1000;
  const generated = selectedChart.chart
    .map((chartNote, index) => {
      const targetTime = firstBeatTime + chartNote.beat * beatIntervalSeconds;
      return {
        id: `beat-${chartNote.beat}-${index}`,
        time: Number(targetTime.toFixed(3)),
        targetTime: Number(targetTime.toFixed(3)),
        spawnTime: Number((targetTime - travelTime).toFixed(3)),
        lane: Math.max(0, Math.min(lanes - 1, chartNote.lane)),
        type: chartNote.type,
        hit: false,
        missed: false,
      };
    })
    .filter((note) => note.targetTime < safeDuration - 0.3);

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

  if (!audio.src) {
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
  const hitLineY = getHitLineY(height);
  return hitLineY - ((note.time - currentTime) / travelTime) * hitLineY;
}

function getHitWindowPx(seconds, height) {
  return (getHitLineY(height) / travelTime) * seconds;
}

function getNoteBottomY(note, currentTime, height, noteH) {
  return noteY(note, currentTime, height) + noteH / 2;
}

function getNoteTopY(note, currentTime, height, noteH) {
  return noteY(note, currentTime, height) - noteH / 2;
}

function isNotePastScreen(note, currentTime, height, noteH) {
  return getNoteTopY(note, currentTime, height, noteH) > height;
}

function draw() {
  resizeCanvas();
  const { width, height } = getStageSize();
  const laneW = width / lanes;
  const judgementY = getJudgementTopY(height);
  const hitZoneH = getHitZoneHeight(height);
  const hitLineY = getHitLineY(height);
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

  ctx.fillStyle = 'rgba(255,255,255,.085)';
  ctx.fillRect(0, judgementY, width, hitZoneH);

  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,.9)';
  ctx.shadowBlur = 8;
  ctx.strokeStyle = 'rgba(255,255,255,.94)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, hitLineY);
  ctx.lineTo(width, hitLineY);
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

function markMiss(note) {
  if (note.hit || note.missed) return;
  note.missed = true;
  combo = 0;
  miss += 1;
  setFeedback('Miss', true);
  updateHud();
}

function updateMisses() {
  // v8：方块只是超过白线不再立刻 Miss。
  // 只有当方块完全离开屏幕底部还没被处理，才算真正漏点。
  const now = audio.currentTime;
  const { height } = getStageSize();
  const noteH = Math.max(56, height * noteHeightRatio);
  notes.forEach((note) => {
    if (note.hit || note.missed) return;
    if (isNotePastScreen(note, now, height, noteH)) markMiss(note);
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
  const lane = Math.max(0, Math.min(lanes - 1, Math.floor(x / (rect.width / lanes))));
  hitLane(lane);
}

function hitLane(lane) {
  const now = audio.currentTime;
  const { height } = getStageSize();
  const judgementY = getJudgementTopY(height);
  const hitLineY = getHitLineY(height);
  const noteH = Math.max(56, height * noteHeightRatio);
  const perfectWindowPx = getHitWindowPx(hitWindowPerfect, height);
  const goodWindowPx = getHitWindowPx(hitWindowGood, height);
  const okWindowPx = getHitWindowPx(hitWindowOk, height);

  const laneNotes = notes
    .filter((note) => !note.hit && !note.missed && note.lane === lane);

  if (!laneNotes.length) return;

  const lateTarget = laneNotes
    .filter((note) => {
      const noteTopY = getNoteTopY(note, now, height, noteH);
      return noteTopY > hitLineY && !isNotePastScreen(note, now, height, noteH);
    })
    .sort((a, b) => getNoteBottomY(b, now, height, noteH) - getNoteBottomY(a, now, height, noteH))[0];

  const target = lateTarget || laneNotes
    .sort((a, b) => {
      const aBottomOffset = getNoteBottomY(a, now, height, noteH) - hitLineY;
      const bBottomOffset = getNoteBottomY(b, now, height, noteH) - hitLineY;
      return Math.abs(aBottomOffset) - Math.abs(bBottomOffset);
    })[0];

  const targetBottomY = getNoteBottomY(target, now, height, noteH);
  const targetTopY = getNoteTopY(target, now, height, noteH);
  const offset = targetBottomY - hitLineY;
  const diff = Math.abs(offset);

  // v7：太早点击无效，不加分、不扣分，也不清 combo。
  if (targetBottomY < judgementY || offset < -okWindowPx) {
    target.hit = true;
    setFeedback('Early', true);
    draw();
    return;
  }

  // v8：超过白线太久但还在屏幕里，点击后只算 Late。
  // Late 不加分、不增加 Miss，也不扣分；该方块会被移除。
  if (targetTopY > hitLineY) {
    if (!isNotePastScreen(target, now, height, noteH)) {
      target.hit = true;
      setFeedback('Late', true);
      draw();
    }
    return;
  }

  target.hit = true;
  combo += 1;

  if (diff <= perfectWindowPx) {
    score += 100 + combo;
    setFeedback('Perfect', true);
  } else if (diff <= goodWindowPx) {
    score += 70 + combo;
    setFeedback('Good', true);
  } else {
    score += 30 + combo;
    setFeedback('OK', true);
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
