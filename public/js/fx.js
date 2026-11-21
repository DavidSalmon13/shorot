/**
 * Shared feedback layer: synthesized sound effects, haptics, and an
 * animated scoreboard renderer used by every game screen.
 *
 * All audio is synthesized live with the Web Audio API - no asset files, in
 * keeping with the app's zero-build static-serving design. Every voice routes
 * through one master bus (a limiter + master gain) so layered cues glue
 * together and never clip harshly. The building blocks are `voice()` (a tonal
 * oscillator with an ADSR envelope, optional pitch glide, detuned fattening and
 * a filter) and `noiseBurst()` (a filtered white-noise transient - the "ticks"
 * and "swishes" that make UI taps feel physical). `sfx.*` composes these into
 * named cues; keep the method names stable since every game imports them.
 */

const MUTE_KEY = 'shorot-muted';
const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let muted = localStorage.getItem(MUTE_KEY) === '1';
let audioCtx = null;
let master = null; // { input, gain } - the shared limiter bus every voice connects to
let noiseBuffer = null;

const MASTER_GAIN = 0.85;

function buildMaster(ctx) {
  // A gentle limiter so stacked voices (chords, fanfares) stay punchy without clipping.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 24;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.14;
  const gain = ctx.createGain();
  gain.gain.value = MASTER_GAIN;
  limiter.connect(gain);
  gain.connect(ctx.destination);
  return { input: limiter, gain };
}

function getAudioCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    try {
      audioCtx = new Ctx({ latencyHint: 'interactive' });
    } catch (e) {
      audioCtx = new Ctx();
    }
    master = buildMaster(audioCtx);
  }
  if (audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  return audioCtx;
}

// One second of white noise, reused for every transient (taps, swishes, impacts).
function getNoiseBuffer(ctx) {
  if (noiseBuffer) return noiseBuffer;
  const len = Math.floor(ctx.sampleRate * 1);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
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

/**
 * One tonal voice: an oscillator (optionally fattened with a detuned twin) shaped by an
 * attack / hold / exponential-decay envelope, with an optional pitch glide and lowpass
 * filter whose cutoff can sweep. Everything is relative to `delay` seconds from now.
 */
function voice({
  freq,
  freqEnd = null,
  type = 'sine',
  dur = 0.2,
  attack = 0.006,
  hold = 0,
  peak = 0.2,
  delay = 0,
  fat = 0, // detune in cents for a second layered oscillator (0 = single osc)
  glide = 'exp', // 'exp' | 'lin'
  cutoff = null, // lowpass cutoff in Hz (null = no filter)
  cutoffEnd = null, // sweep the cutoff to this value over `dur`
} = {}) {
  if (muted) return;
  const ctx = getAudioCtx();
  // A suspended context queues the sound and plays it whenever it resumes, which lands as a
  // late/out-of-sync blip. Better to drop it than play it detached from the gesture.
  if (!ctx || ctx.state !== 'running' || !master) return;

  const t0 = ctx.currentTime + delay;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
  if (hold) g.gain.setValueAtTime(Math.max(0.0002, peak), t0 + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  let out = g;
  if (cutoff) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(cutoff, t0);
    if (cutoffEnd) filter.frequency.exponentialRampToValueAtTime(Math.max(40, cutoffEnd), t0 + dur);
    g.connect(filter);
    filter.connect(master.input);
    out = filter;
  } else {
    g.connect(master.input);
  }

  const detunes = fat ? [-fat, fat] : [0];
  detunes.forEach((d) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) {
      if (glide === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
      else osc.frequency.linearRampToValueAtTime(freqEnd, t0 + dur);
    }
    if (d) osc.detune.setValueAtTime(d, t0);
    osc.connect(g);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  });
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
  g.connect(master ? master.input : ctx.destination);
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
  g.connect(master ? master.input : ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

// Back-compat single beep used by the Store gag cues below: a thin wrapper over voice() so
// they keep working after the engine rewrite, now routed through the master limiter bus.
function tone(freq, duration, { type = 'sine', gain = 0.12, delay = 0 } = {}) {
  voice({ freq, type, dur: duration, peak: gain, delay, attack: 0.012 });
}

/** A short filtered white-noise transient - the physical "tick"/"swish"/"impact" layer. */
function noiseBurst({ dur = 0.06, peak = 0.15, delay = 0, hp = 0, lp = 9000, q = 0.7, sweepLp = null } = {}) {
  if (muted) return;
  const ctx = getAudioCtx();
  if (!ctx || ctx.state !== 'running' || !master) return;

  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  // Start at a random offset so repeated taps don't sound like an identical sample.
  const offset = Math.random() * 0.9;

  let node = src;
  if (hp) {
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    node.connect(f);
    node = f;
  }
  const lpF = ctx.createBiquadFilter();
  lpF.type = 'lowpass';
  lpF.Q.value = q;
  lpF.frequency.setValueAtTime(lp, t0);
  if (sweepLp) lpF.frequency.exponentialRampToValueAtTime(Math.max(80, sweepLp), t0 + dur);
  node.connect(lpF);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  lpF.connect(g);
  g.connect(master.input);

  src.start(t0, offset);
  src.stop(t0 + dur + 0.03);
}

// Musical note frequencies (equal temperament), for readable cue definitions.
const N = {
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98,
};

export const sfx = {
  // Fires on every button tap, so it stays quiet and crisp: a filtered noise tick with a
  // tiny pitched blip underneath, like a soft mechanical key.
  click() {
    noiseBurst({ dur: 0.028, peak: 0.07, hp: 1400, lp: 7000 });
    voice({ freq: 880, freqEnd: 560, type: 'sine', dur: 0.05, peak: 0.045 });
  },
  // A rounder, more satisfying "pick this" pop (selection, toggles).
  pop() {
    noiseBurst({ dur: 0.03, peak: 0.06, hp: 900, lp: 6000 });
    voice({ freq: 420, freqEnd: 900, type: 'sine', dur: 0.09, peak: 0.14 });
  },
  scoreUp() {
    voice({ freq: N.E5, type: 'triangle', dur: 0.14, peak: 0.16, fat: 6 });
    voice({ freq: N.A5, type: 'triangle', dur: 0.18, peak: 0.14, delay: 0.08, fat: 6 });
    voice({ freq: N.E6, type: 'sine', dur: 0.14, peak: 0.05, delay: 0.08 });
  },
  scoreDown() {
    voice({ freq: 300, freqEnd: 150, type: 'sawtooth', dur: 0.22, peak: 0.1, cutoff: 1600, cutoffEnd: 400 });
  },
  // A bright, upward major run - generic "something good happened / you won".
  win() {
    [N.C5, N.E5, N.G5, N.C6].forEach((freq, i) =>
      voice({ freq, type: 'triangle', dur: 0.26, peak: 0.16, delay: i * 0.08, fat: 5 })
    );
    voice({ freq: N.G6, type: 'sine', dur: 0.4, peak: 0.05, delay: 0.26 });
  },
  join() {
    voice({ freq: N.A4, type: 'triangle', dur: 0.1, peak: 0.13, fat: 4 });
    voice({ freq: N.E5, type: 'triangle', dur: 0.14, peak: 0.12, delay: 0.07, fat: 4 });
  },
  error() {
    voice({ freq: 200, freqEnd: 150, type: 'sawtooth', dur: 0.18, peak: 0.09, cutoff: 1200, cutoffEnd: 500 });
  },
  // Countdown beat - `step` counts down (3, 2, 1); pitch climbs and the final beat is fuller.
  tick(step = 1) {
    const s = Math.max(1, Math.min(3, step));
    const freq = 440 + (4 - s) * 110;
    const last = s === 1;
    voice({ freq, type: 'square', dur: last ? 0.14 : 0.09, peak: last ? 0.1 : 0.07, cutoff: 2600 });
    voice({ freq: freq / 2, type: 'triangle', dur: 0.16, peak: 0.09 });
    noiseBurst({ dur: 0.02, peak: 0.04, hp: 2000 });
  },
  // A light card/tile flip: a noise swish with a quick upward chirp.
  flip() {
    noiseBurst({ dur: 0.05, peak: 0.08, hp: 1200, lp: 8000, sweepLp: 2500 });
    voice({ freq: 700, freqEnd: 1200, type: 'triangle', dur: 0.05, peak: 0.05 });
  },
  // A woodier reveal than `flip`, for turning over a board tile / card face.
  reveal() {
    noiseBurst({ dur: 0.045, peak: 0.07, hp: 700, lp: 5000 });
    voice({ freq: 360, freqEnd: 240, type: 'triangle', dur: 0.12, peak: 0.12, cutoff: 2200 });
  },
  // A dealing swish, for cards flying out.
  deal() {
    noiseBurst({ dur: 0.1, peak: 0.1, hp: 2000, lp: 9000, sweepLp: 1200 });
  },
  // Happy confirmation: a short ascending major triad bell (right answer, own-team card).
  correct() {
    voice({ freq: N.C5, type: 'triangle', dur: 0.12, peak: 0.15, fat: 5 });
    voice({ freq: N.E5, type: 'triangle', dur: 0.14, peak: 0.14, delay: 0.06, fat: 5 });
    voice({ freq: N.G5, type: 'sine', dur: 0.22, peak: 0.1, delay: 0.12 });
  },
  // Soft negative: two descending notes, rounded by a lowpass so it stings without being harsh.
  wrong() {
    voice({ freq: N.F4, type: 'sawtooth', dur: 0.16, peak: 0.1, cutoff: 1500, cutoffEnd: 700 });
    voice({ freq: N.C4, type: 'sawtooth', dur: 0.22, peak: 0.1, delay: 0.12, cutoff: 1300, cutoffEnd: 500 });
  },
  // A dramatic doom hit - the assassin, a fatal mistake.
  assassin() {
    voice({ freq: 160, freqEnd: 55, type: 'sawtooth', dur: 0.7, peak: 0.16, cutoff: 900, cutoffEnd: 120 });
    voice({ freq: 110, freqEnd: 48, type: 'square', dur: 0.7, peak: 0.08 });
    noiseBurst({ dur: 0.35, peak: 0.14, lp: 1800, sweepLp: 200 });
  },
  // Gentle two-note chime: it's your turn / you're up.
  turn() {
    voice({ freq: N.G5, type: 'sine', dur: 0.16, peak: 0.12, fat: 4 });
    voice({ freq: N.C6, type: 'sine', dur: 0.24, peak: 0.12, delay: 0.1, fat: 4 });
  },
  // A descending "you lost" stinger - sad but short, not a harsh buzzer.
  lose() {
    voice({ freq: N.E4, freqEnd: N.D4, type: 'sawtooth', dur: 0.26, peak: 0.12, cutoff: 1400, cutoffEnd: 600 });
    voice({ freq: N.C4, freqEnd: N.B4 / 2, type: 'sawtooth', dur: 0.5, peak: 0.12, delay: 0.22, cutoff: 1200, cutoffEnd: 300 });
    noiseBurst({ dur: 0.12, peak: 0.05, lp: 1500, delay: 0.22, sweepLp: 300 });
  },
  // A classic two-note reward coin.
  coin() {
    voice({ freq: N.B5, type: 'square', dur: 0.07, peak: 0.1, cutoff: 3500 });
    voice({ freq: N.E6, type: 'square', dur: 0.2, peak: 0.1, delay: 0.06, cutoff: 3500 });
  },
  fanfare() {
    [N.C5, N.E5, N.G5].forEach((freq, i) =>
      voice({ freq, type: 'triangle', dur: 0.18, peak: 0.15, delay: i * 0.08, fat: 5 })
    );
    voice({ freq: N.C6, type: 'triangle', dur: 0.5, peak: 0.15, delay: 0.26, fat: 5 });
    voice({ freq: N.G5, type: 'sine', dur: 0.5, peak: 0.07, delay: 0.26 });
  },
  buzzer() {
    voice({ freq: 150, type: 'sawtooth', dur: 0.5, peak: 0.12, cutoff: 1200 });
    voice({ freq: 155, type: 'square', dur: 0.5, peak: 0.06, cutoff: 1200 });
    voice({ freq: 110, type: 'sawtooth', dur: 0.4, peak: 0.1, delay: 0.32, cutoff: 900 });
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
  // Angry stomps across the room, a yelled "hey-HEY!", then the sink filling,
  // scrub-scrub-scrub, and a clink + shine per clean plate.
  // With an AI video ({ video: true }) the clip brings its own sound, so only the walk-up plays.
  dishes({ video = false } = {}) {
    for (let t = 0.3; t < 2.2; t += 0.25) {
      tone(70, 0.12, { type: 'sine', gain: 0.3, delay: t });
      noise(0.08, { gain: 0.12, delay: t, freq: 300 });
    }
    slide(520, 380, 0.16, { type: 'sawtooth', gain: 0.06, delay: 2.2 });
    slide(660, 420, 0.3, { type: 'sawtooth', gain: 0.07, delay: 2.42 });
    if (video) return;
    noise(0.9, { gain: 0.16, delay: 3.6, freq: 1400, type: 'bandpass' });
    for (let t = 4.8; t < 7.8; t += 0.25) noise(0.12, { gain: 0.08, delay: t, freq: 3200, type: 'bandpass' });
    [5.3, 6.3, 7.3].forEach((t) => {
      tone(2637, 0.12, { type: 'sine', gain: 0.07, delay: t });
      tone(3520, 0.25, { type: 'sine', gain: 0.04, delay: t + 0.08 });
    });
  },
  // Footsteps across the room, three sharp smacks, then a yelp.
  // With an AI video ({ video: true }) the clip brings its own sound, so only the footsteps play.
  spank({ video = false } = {}) {
    for (let i = 0; i < 9; i++) tone(i % 2 ? 160 : 190, 0.05, { type: 'triangle', gain: 0.07, delay: 0.35 + i * 0.24 });
    if (video) return;
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
