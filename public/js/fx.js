/**
 * Shared feedback layer: synthesized sound effects, haptics, and an
 * animated scoreboard renderer used by every game screen.
 */

const MUTE_KEY = 'shorot-muted';
const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let muted = localStorage.getItem(MUTE_KEY) === '1';
let audioCtx = null;

function getAudioCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctx({ latencyHint: 'interactive' });
    } catch (e) {
      audioCtx = new Ctx();
    }
  }
  if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  return audioCtx;
}

// Browsers block audio until a user gesture, and phones suspend the context again after
// backgrounding. A touch pointerdown doesn't count as a gesture on Android Chrome, so
// keep (re)priming on every touchend/click/keydown, and when the tab comes back.
['pointerdown', 'touchend', 'click', 'keydown'].forEach((evt) => {
  window.addEventListener(evt, () => getAudioCtx(), { capture: true, passive: true });
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && audioCtx) getAudioCtx();
});

function tone(freq, duration, { type = 'sine', gain = 0.12, delay = 0 } = {}) {
  if (muted) return;
  const ctx = getAudioCtx();
  // A suspended context queues the sound and plays it whenever it resumes, which is the
  // late "delayed" tap. Better to drop it than play it out of sync with the touch.
  if (!ctx || ctx.state !== 'running') return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const start = ctx.currentTime + delay;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

// A burst of filtered white noise - thuds, splats and booms for the Store gags.
function noise(duration, { gain = 0.2, delay = 0, freq = 1200, type = 'lowpass' } = {}) {
  if (muted) return;
  const ctx = getAudioCtx();
  if (!ctx || ctx.state !== 'running') return;
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  const g = ctx.createGain();
  const start = ctx.currentTime + delay;
  g.gain.setValueAtTime(gain, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  src.connect(filter);
  filter.connect(g);
  g.connect(ctx.destination);
  src.start(start);
  src.stop(start + duration + 0.02);
}

// A pitch slide (start -> end Hz) - whooshes and the drooping trombone.
function slide(from, to, duration, { type = 'sawtooth', gain = 0.08, delay = 0 } = {}) {
  if (muted) return;
  const ctx = getAudioCtx();
  if (!ctx || ctx.state !== 'running') return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  const start = ctx.currentTime + delay;
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(to, start + duration);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.03);
  g.gain.setValueAtTime(gain, start + duration * 0.8);
  g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

export const sfx = {
  click() {
    tone(520, 0.06, { type: 'square', gain: 0.05 });
  },
  scoreUp() {
    tone(660, 0.12, { type: 'triangle' });
    tone(880, 0.16, { type: 'triangle', delay: 0.07 });
  },
  scoreDown() {
    tone(220, 0.18, { type: 'sawtooth', gain: 0.08 });
  },
  win() {
    [523, 659, 784, 1046].forEach((freq, i) => tone(freq, 0.18, { type: 'triangle', delay: i * 0.09 }));
  },
  join() {
    tone(440, 0.08);
    tone(660, 0.1, { delay: 0.06 });
  },
  error() {
    tone(180, 0.15, { type: 'sawtooth', gain: 0.08 });
  },
  // Countdown beat - `step` counts down (3, 2, 1) and the pitch climbs as it does.
  tick(step = 1) {
    const freq = 440 + (4 - Math.max(1, Math.min(3, step))) * 110;
    tone(freq, 0.09, { type: 'square', gain: 0.06 });
    tone(freq / 2, 0.14, { type: 'triangle', gain: 0.1 });
  },
  flip() {
    tone(1200, 0.035, { type: 'triangle', gain: 0.05 });
    tone(700, 0.05, { type: 'triangle', gain: 0.05, delay: 0.025 });
  },
  fanfare() {
    [523, 659, 784].forEach((freq, i) => tone(freq, 0.14, { type: 'triangle', delay: i * 0.08 }));
    tone(1046, 0.45, { type: 'triangle', gain: 0.14, delay: 0.26 });
    tone(784, 0.45, { type: 'sine', gain: 0.08, delay: 0.26 });
  },
  buzzer() {
    tone(150, 0.5, { type: 'sawtooth', gain: 0.1 });
    tone(155, 0.5, { type: 'square', gain: 0.05 });
    tone(110, 0.35, { type: 'sawtooth', gain: 0.08, delay: 0.32 });
  },

  // ---- Store gags (public/js/shared/storeFx.js) ----
  // "Ha-ha-ha-ha": bouncing syllables, twice.
  laugh() {
    [0, 1].forEach((round) => {
      [620, 560, 640, 540, 600].forEach((freq, i) => {
        slide(freq * 1.15, freq, 0.11, { type: 'triangle', gain: 0.1, delay: round * 0.75 + i * 0.13 });
      });
    });
  },
  // The classic four-note sad trombone, the last one wobbling down.
  sadTrombone() {
    [392, 370, 349].forEach((freq, i) => slide(freq, freq * 0.97, 0.38, { gain: 0.07, delay: i * 0.42 }));
    slide(330, 240, 1.3, { gain: 0.08, delay: 1.26 });
    noise(1.3, { gain: 0.015, delay: 1.26, freq: 600 });
  },
  // Fuse hiss, then a deep boom and a pop of party horns.
  explosion() {
    noise(0.8, { gain: 0.05, freq: 5000, type: 'highpass' });
    noise(1.1, { gain: 0.45, delay: 0.85, freq: 500 });
    slide(120, 35, 0.9, { type: 'sine', gain: 0.25, delay: 0.85 });
    [784, 988, 1175, 1568].forEach((freq, i) => tone(freq, 0.2, { type: 'triangle', gain: 0.08, delay: 1.1 + i * 0.07 }));
  },
  // Whoosh in, wet squelch, then drips.
  splat() {
    noise(0.4, { gain: 0.08, freq: 2500, type: 'bandpass' });
    noise(0.35, { gain: 0.4, delay: 0.42, freq: 900 });
    slide(260, 70, 0.3, { type: 'sine', gain: 0.2, delay: 0.42 });
    [0, 1, 2].forEach((i) => tone(1400 - i * 150, 0.06, { type: 'sine', gain: 0.06, delay: 1.0 + i * 0.35 }));
  },
  // Wind-up whoosh, a heavy thump, then a dizzy "tweet-tweet".
  punch() {
    slide(300, 1200, 0.3, { type: 'sine', gain: 0.05 });
    noise(0.25, { gain: 0.55, delay: 0.32, freq: 700 });
    slide(160, 40, 0.35, { type: 'sine', gain: 0.35, delay: 0.32 });
    [0, 1, 2, 3].forEach((i) => tone(i % 2 ? 1760 : 2093, 0.08, { type: 'sine', gain: 0.05, delay: 0.9 + i * 0.16 }));
  },
  // Whoosh, a rubbery pop, a big splash, then drips.
  waterBalloon() {
    noise(0.45, { gain: 0.06, freq: 2000, type: 'bandpass' });
    slide(900, 300, 0.08, { type: 'square', gain: 0.08, delay: 0.5 });
    noise(0.7, { gain: 0.35, delay: 0.52, freq: 3000 });
    noise(0.5, { gain: 0.2, delay: 0.55, freq: 600 });
    [0, 1, 2, 3, 4].forEach((i) => slide(1600 - i * 120, 900, 0.07, { type: 'sine', gain: 0.07, delay: 1.0 + i * 0.4 }));
  },
  // Whoosh, a soft creamy smack, a sad slide as it drips off.
  pie() {
    noise(0.4, { gain: 0.07, freq: 1800, type: 'bandpass' });
    noise(0.3, { gain: 0.45, delay: 0.45, freq: 700 });
    slide(200, 90, 0.25, { type: 'sine', gain: 0.25, delay: 0.45 });
    slide(500, 180, 1.4, { type: 'triangle', gain: 0.05, delay: 1.2 });
  },
  // Electric crackle, a sharp crack, then rolling thunder.
  lightning() {
    [0, 1, 2, 3, 4, 5].forEach((i) => noise(0.05, { gain: 0.12, delay: i * 0.06, freq: 4000, type: 'highpass' }));
    noise(0.2, { gain: 0.6, delay: 0.42, freq: 6000, type: 'highpass' });
    noise(2.2, { gain: 0.5, delay: 0.5, freq: 260 });
    slide(90, 30, 1.8, { type: 'sine', gain: 0.25, delay: 0.5 });
  },
  // Footsteps across the room, three sharp smacks, then a yelp.
  spank() {
    for (let i = 0; i < 9; i++) tone(i % 2 ? 160 : 190, 0.05, { type: 'triangle', gain: 0.07, delay: 0.35 + i * 0.24 });
    [2.925, 3.425, 3.925].forEach((t) => {
      noise(0.09, { gain: 0.7, delay: t, freq: 2500, type: 'highpass' });
      noise(0.12, { gain: 0.35, delay: t, freq: 500 });
    });
    slide(820, 360, 0.45, { type: 'triangle', gain: 0.1, delay: 4.1 });
    slide(700, 300, 0.35, { type: 'triangle', gain: 0.08, delay: 4.6 });
  },
  // A royal fanfare with a shimmer on top.
  royal() {
    [392, 523, 659, 784].forEach((freq, i) => tone(freq, 0.16, { type: 'square', gain: 0.05, delay: i * 0.12 }));
    tone(1046, 0.8, { type: 'triangle', gain: 0.14, delay: 0.5 });
    tone(784, 0.8, { type: 'triangle', gain: 0.08, delay: 0.5 });
    [2093, 2637, 3136, 2637, 3136].forEach((freq, i) => tone(freq, 0.12, { type: 'sine', gain: 0.03, delay: 0.9 + i * 0.12 }));
  },
};

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = !!value;
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
}

export function toggleMuted() {
  setMuted(!muted);
  return muted;
}

export function haptic(pattern) {
  if (muted) return;
  if (navigator.vibrate) navigator.vibrate(pattern);
}

export const haptics = {
  tap() {
    haptic(10);
  },
  success() {
    haptic([15, 40, 15]);
  },
  warn() {
    haptic(60);
  },
};

// --- Animated scoreboard rendering, shared by every game's scoreboard list ---

const scoreboardPrev = new WeakMap();

function animateCount(el, from, to, duration = 650) {
  if (prefersReducedMotion) {
    el.textContent = to > 0 ? `+${to}` : String(to);
    return;
  }
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    const value = Math.round(from + (to - from) * eased);
    el.textContent = value > 0 ? `+${value}` : String(value);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/**
 * Renders a scoreboard <ol>/<ul> from {name, points} entries, animating any
 * point changes since the last render of this same list and playing a
 * score-up/score-down cue when something changes on a currently visible list.
 */
export function renderScoreboardFx(listEl, entries) {
  if (!listEl) return;
  const prev = scoreboardPrev.get(listEl) || new Map();
  const next = new Map();
  let anyUp = false;
  let anyDown = false;

  listEl.innerHTML = '';
  (entries || []).forEach(({ name, points }) => {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    const ptsSpan = document.createElement('span');
    ptsSpan.className = 'sb-points' + (points < 0 ? ' negative' : '');
    li.appendChild(nameSpan);
    li.appendChild(ptsSpan);
    listEl.appendChild(li);

    const hadPrev = prev.has(name);
    const from = hadPrev ? prev.get(name) : points;
    next.set(name, points);

    if (hadPrev && from !== points) {
      animateCount(ptsSpan, from, points);
      const up = points > from;
      li.classList.add(up ? 'sb-flash-up' : 'sb-flash-down');
      setTimeout(() => li.classList.remove('sb-flash-up', 'sb-flash-down'), 900);
      if (up) anyUp = true;
      else anyDown = true;
    } else {
      ptsSpan.textContent = points > 0 ? `+${points}` : String(points);
    }
  });

  scoreboardPrev.set(listEl, next);

  // offsetParent alone isn't enough: the header scoreboard dropdown stays attached
  // and laid out (grid-template-rows: 0fr, not display:none) while closed, so it
  // reports a non-null offsetParent even at zero height. Measure the actual box.
  const rect = listEl.getBoundingClientRect();
  const visible = rect.width > 0 && rect.height > 0;
  if (visible) {
    if (anyUp) {
      sfx.scoreUp();
      haptics.success();
    } else if (anyDown) {
      sfx.scoreDown();
      haptics.warn();
    }
  }
}
