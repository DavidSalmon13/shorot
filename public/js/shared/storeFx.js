/**
 * The visual + audio show for Store consumables (🥊 🍅 👑 😂 🎺 💣), played on every phone
 * by storeActions.js when the server broadcasts a `storeAction`. Each gag is a few seconds
 * long and built from several parts: an entrance, an impact (flash, burst, particles), a
 * lingering mark on the target's avatar (a splat, dizzy stars, a crown...), and a caption
 * saying who did what to whom.
 *
 * Everything renders into #store-fx-layer (fixed, pointer-events: none), so a gag never
 * blocks a tap. The "stage" follows the target's avatar (`[data-player]`) while it plays,
 * even if the screen re-renders underneath; if the target isn't on screen the gag plays
 * center-stage instead. Purely cosmetic. Styles: public/style.css ("Store gags").
 */

import { sfx, haptic } from '../fx.js';
import { emojiForName } from './playerEmoji.js';

const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const CONFETTI_COLORS = ['#c6ff4a', '#a78bfa', '#ff6b9a', '#ffd84a', '#4ad9ff', '#ff9f4a'];

// Per item: how long the whole show lasts, the avatar's mood class while it plays,
// the caption, and the builder that adds the parts.
const GAGS = {
  taunt: {
    ms: 3200,
    avatarClass: 'store-av-shake',
    caption: (from, to) => `😂 ${from} is laughing at ${to}`,
    sound: () => sfx.laugh(),
    haptic: [20, 60, 20, 60, 20],
    build: buildTaunt,
  },
  fanfare: {
    ms: 3800,
    avatarClass: 'store-av-sad',
    caption: (from, to) => `🎺 ${from}: womp womp, ${to}`,
    sound: () => sfx.sadTrombone(),
    haptic: [120, 80, 120, 80, 300],
    build: buildFanfare,
  },
  confetti_bomb: {
    ms: 4200,
    avatarClass: 'store-av-glow',
    caption: (from) => `💣 ${from} set off a confetti bomb!`,
    sound: () => sfx.explosion(),
    haptic: [30, 120, 30, 120, 30, 120, 250],
    build: buildBomb,
  },
  tomato: {
    ms: 4800,
    avatarClass: 'store-av-shake',
    caption: (from, to) => `🍅 ${from} splatted ${to}!`,
    sound: () => sfx.splat(),
    haptic: [0, 450, 140],
    build: buildTomato,
  },
  glove: {
    ms: 4500,
    avatarClass: 'store-av-dizzy',
    caption: (from, to) => `🥊 ${from} punched ${to}!`,
    sound: () => sfx.punch(),
    haptic: [0, 300, 220],
    build: buildGlove,
  },
  water_balloon: {
    ms: 4600,
    avatarClass: 'store-av-drenched',
    caption: (from, to) => `💦 ${from} soaked ${to}!`,
    sound: () => sfx.waterBalloon(),
    haptic: [0, 500, 160, 60, 40],
    build: buildWaterBalloon,
  },
  pie: {
    ms: 4800,
    avatarClass: 'store-av-shake',
    caption: (from, to) => `🥧 ${from} pied ${to}!`,
    sound: () => sfx.pie(),
    haptic: [0, 380, 200],
    build: buildPie,
  },
  spank: {
    ms: 5600,
    avatarClass: null,
    caption: (from, to) => `🍑 ${from} spanked ${to}!`,
    sound: () => sfx.spank(),
    haptic: [0, 2900, 70, 430, 70, 430, 120],
    build: buildSpank,
  },
  lightning: {
    ms: 4600,
    avatarClass: 'store-av-charred',
    caption: (from, to) => `⚡ ${from} struck ${to} with lightning!`,
    sound: () => sfx.lightning(),
    haptic: [0, 700, 60, 40, 60, 40, 300],
    build: buildLightning,
  },
  crown: {
    ms: 5200,
    avatarClass: 'store-av-glow',
    caption: (from, to) => `👑 ${from} crowned ${to}!`,
    sound: () => sfx.royal(),
    haptic: [20, 40, 20, 40, 120],
    build: buildCrown,
  },
};

function part(stage, className, text, style) {
  const el = document.createElement('span');
  el.className = `sfx-part ${className}`;
  if (text) el.textContent = text;
  if (style) Object.assign(el.style, style);
  stage.appendChild(el);
  return el;
}

/** Particles flung out from the stage center: `count` copies of a glyph (or a colored chip). */
function burst(stage, { count, glyphs, colors, spread = 140, className = 'sfx-particle', delay = 0 }) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const dist = spread * (0.6 + Math.random() * 0.6);
    const el = part(stage, className, glyphs ? glyphs[i % glyphs.length] : '', {
      '--dx': `${Math.cos(angle) * dist}px`,
      '--dy': `${Math.sin(angle) * dist}px`,
      '--rot': `${Math.round(Math.random() * 720 - 360)}deg`,
      animationDelay: `${delay + Math.random() * 120}ms`,
    });
    if (colors) el.style.background = colors[i % colors.length];
  }
}

function buildTaunt(stage) {
  part(stage, 'sfx-taunt-face', '😂');
  burst(stage, { count: 12, glyphs: ['😂', '🤣', '😆'], spread: 150, delay: 150 });
  const ha = part(stage, 'sfx-taunt-ha');
  ['H', 'A', ' ', 'H', 'A', ' ', 'H', 'A', '!'].forEach((ch, i) => {
    const s = document.createElement('span');
    s.textContent = ch;
    s.style.animationDelay = `${300 + i * 70}ms`;
    ha.appendChild(s);
  });
}

function buildFanfare(stage) {
  part(stage, 'sfx-trumpet', '🎺');
  part(stage, 'sfx-cloud', '🌧️');
  ['🎵', '🎶', '🎵', '🎶'].forEach((note, i) => {
    part(stage, 'sfx-sad-note', note, { animationDelay: `${300 + i * 450}ms`, '--nx': `${-30 + i * 22}px` });
  });
  for (let i = 0; i < 6; i++) {
    part(stage, 'sfx-drop', '💧', { animationDelay: `${700 + i * 350}ms`, '--nx': `${-24 + (i % 3) * 24}px` });
  }
}

function buildBomb(stage) {
  part(stage, 'sfx-bomb', '💣');
  part(stage, 'sfx-fuse', '✨');
  part(stage, 'sfx-shockwave');
  part(stage, 'sfx-boom', '💥');
  burst(stage, { count: 60, colors: CONFETTI_COLORS, spread: Math.min(window.innerWidth, 520) * 0.6, className: 'sfx-confetti', delay: 900 });
  burst(stage, { count: 8, glyphs: ['🎉', '🎊', '⭐'], spread: 170, delay: 950 });
}

function buildTomato(stage) {
  part(stage, 'sfx-tomato', '🍅');
  part(stage, 'sfx-splat');
  for (let i = 0; i < 4; i++) {
    part(stage, 'sfx-drip', '', { animationDelay: `${700 + i * 260}ms`, '--nx': `${-22 + i * 15}px` });
  }
  burst(stage, { count: 10, colors: ['#e0321e', '#ff5a3c', '#b81c10'], spread: 90, className: 'sfx-juice', delay: 520 });
}

function buildGlove(stage) {
  part(stage, 'sfx-glove', '🥊');
  part(stage, 'sfx-pow', 'POW!');
  part(stage, 'sfx-impact-flash');
  part(stage, 'sfx-bandage', '🩹');
  const orbit = part(stage, 'sfx-orbit');
  ['💫', '⭐', '💫'].forEach((g, i) => {
    const s = document.createElement('span');
    s.textContent = g;
    s.style.setProperty('--a', `${i * 120}deg`);
    orbit.appendChild(s);
  });
}

function buildCrown(stage) {
  part(stage, 'sfx-halo');
  part(stage, 'sfx-crown', '👑');
  burst(stage, { count: 14, glyphs: ['✨', '⭐', '✨'], spread: 120, delay: 700 });
  for (let i = 0; i < 6; i++) {
    part(stage, 'sfx-sparkle', '✨', {
      animationDelay: `${1300 + i * 420}ms`,
      '--nx': `${Math.round(Math.random() * 90 - 45)}px`,
      '--ny': `${Math.round(Math.random() * 70 - 35)}px`,
    });
  }
}

function buildWaterBalloon(stage) {
  part(stage, 'sfx-balloon');
  part(stage, 'sfx-splash-ring');
  burst(stage, { count: 18, colors: ['#4ad9ff', '#8ee8ff', '#2aa8e0'], spread: 120, className: 'sfx-droplet', delay: 520 });
  burst(stage, { count: 6, glyphs: ['💦', '💧'], spread: 110, delay: 540 });
  part(stage, 'sfx-wet-sheen');
  part(stage, 'sfx-puddle');
  for (let i = 0; i < 7; i++) {
    part(stage, 'sfx-wet-drip', '', { animationDelay: `${900 + i * 420}ms`, '--nx': `${-26 + (i % 4) * 17}px` });
  }
}

function buildPie(stage) {
  part(stage, 'sfx-pie', '🥧');
  part(stage, 'sfx-cream');
  for (let i = 0; i < 3; i++) {
    part(stage, 'sfx-cream-drip', '', { animationDelay: `${900 + i * 500}ms`, '--nx': `${-18 + i * 18}px` });
  }
  part(stage, 'sfx-cherry', '🍒');
  burst(stage, { count: 14, colors: ['#fffaf0', '#ffe9c7', '#fff'], spread: 100, className: 'sfx-cream-blob', delay: 480 });
}

function buildLightning(stage) {
  part(stage, 'sfx-screen-flash');
  part(stage, 'sfx-storm', '🌩️');
  const bolt = part(stage, 'sfx-bolt');
  bolt.innerHTML = '<svg viewBox="0 0 40 120" preserveAspectRatio="none" aria-hidden="true"><polygon points="24,0 6,58 20,58 10,120 36,46 21,46 32,0" /></svg>';
  part(stage, 'sfx-zap', 'ZAP!');
  burst(stage, { count: 10, glyphs: ['⚡', '✨'], spread: 110, delay: 450 });
  for (let i = 0; i < 6; i++) {
    part(stage, 'sfx-smoke', '💨', { animationDelay: `${1000 + i * 450}ms`, '--nx': `${-22 + (i % 3) * 22}px` });
  }
}

// A stick figure (head, body, two arms, two legs) drawn facing right; --face flips it.
const STICK_SVG = `<svg viewBox="0 0 44 72" aria-hidden="true">
  <g class="st-body">
    <circle class="st-head" cx="22" cy="11" r="7" />
    <g class="st-face"></g>
    <line x1="22" y1="18" x2="22" y2="44" />
    <circle class="st-butt" cx="17" cy="45" r="5.5" />
    <g class="st-arm st-arm-back"><line x1="22" y1="24" x2="22" y2="41" /></g>
    <g class="st-arm st-arm-front"><line x1="22" y1="24" x2="22" y2="41" /></g>
  </g>
  <g class="st-leg st-leg-a"><line x1="22" y1="44" x2="22" y2="68" /></g>
  <g class="st-leg st-leg-b"><line x1="22" y1="44" x2="22" y2="68" /></g>
</svg>`;

const FIG_W = 56; // rendered size of a figure (the SVG is drawn on a 44x72 grid)
const FIG_H = 92;

/**
 * A player's face as shown on their icon: their sticker image, else their emoji. Looks at
 * every rendered copy of their icon (a hidden lobby roster still has it), falling back to
 * the name's default emoji.
 */
function faceOf(name) {
  const escaped = window.CSS && CSS.escape ? CSS.escape(name) : String(name).replace(/["\\]/g, '\\$&');
  for (const el of document.querySelectorAll(`[data-player="${escaped}"]`)) {
    const img = el.tagName === 'IMG' ? el : el.querySelector('img');
    if (img && img.getAttribute('src')) return { src: img.getAttribute('src') };
    const text = el.textContent.trim();
    if (text) return { emoji: [...text].slice(0, 2).join('') };
  }
  return { emoji: emojiForName(name) };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A stick figure wearing `name`'s face as its head, facing right unless face is -1. */
function stickFigure(stage, className, face, name) {
  const fig = document.createElement('span');
  fig.className = `sfx-stick ${className}`;
  fig.style.setProperty('--face', face);
  fig.innerHTML = `<span class="st-inner">${STICK_SVG}</span>`;
  // The face sits inside the body group, so it tilts with the figure (bending over, etc.).
  // Drawn bigger than the stick head (r=7) so it reads at a glance; the outline circle hides.
  const holder = fig.querySelector('.st-face');
  const look = faceOf(name);
  let faceEl;
  if (look.src) {
    faceEl = document.createElementNS(SVG_NS, 'image');
    faceEl.setAttribute('href', look.src);
    faceEl.setAttribute('x', '5');
    faceEl.setAttribute('y', '-9');
    faceEl.setAttribute('width', '34');
    faceEl.setAttribute('height', '34');
    faceEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  } else {
    faceEl = document.createElementNS(SVG_NS, 'text');
    faceEl.setAttribute('x', '22');
    faceEl.setAttribute('y', '10');
    faceEl.setAttribute('font-size', '23');
    faceEl.setAttribute('text-anchor', 'middle');
    faceEl.setAttribute('dominant-baseline', 'central');
    faceEl.textContent = look.emoji;
  }
  holder.appendChild(faceEl);
  fig.classList.add('st-has-face');
  stage.appendChild(fig);
  return fig;
}

/** Where a player's icon is on screen (its center), or null if they aren't shown. */
function centerOf(name) {
  const a = findAnchor(name);
  if (!a) return null;
  const r = a.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * 🍑 Spanking: the sender's figure walks from their icon to the target, whose own figure
 * bends over; three smacks, then the target hops around while the sender cheers. Positions
 * are stage-relative (the stage sits on the target's icon); the walk is a Web Animation.
 */
function buildSpank(stage, { fromName, targetName }) {
  const vw = window.innerWidth;
  const target = centerOf(targetName) || { x: vw / 2, y: window.innerHeight * 0.45 };
  const from = fromName !== targetName ? centerOf(fromName) : null;
  // Which side of the target the spanker ends up on: the side with room, else the side
  // they're walking in from. Both figures then face the same way (target's back to them).
  let side;
  if (target.x < 90) side = 1;
  else if (target.x > vw - 90) side = -1;
  else side = from && from.x < target.x ? -1 : 1;
  const face = -side;
  const FOOT_Y = 18; // feet a little below the icon's center, so the figure stands over it
  const end = { x: side * 44, y: FOOT_Y };
  let start = from ? { x: from.x - target.x, y: from.y - target.y + FOOT_Y } : { x: side * 160, y: FOOT_Y };
  if (Math.hypot(start.x - end.x, start.y - end.y) < 50) start = { x: side * 150, y: FOOT_Y };
  // Keep the walker's start on screen.
  start.x = Math.max(FIG_W / 2 - target.x, Math.min(vw - FIG_W / 2 - target.x, start.x));

  const victim = stickFigure(stage, 'st-victim', face, targetName);
  victim.style.transform = `translate(${-FIG_W / 2}px, ${FOOT_Y - FIG_H}px)`;
  const walker = stickFigure(stage, 'st-walker', face, fromName || targetName);
  const at = (p) => `translate(${p.x - FIG_W / 2}px, ${p.y - FIG_H}px)`;
  walker.style.transform = at(start);

  const later = (ms, fn) => setTimeout(() => stage.isConnected && fn(), ms);
  later(300, () => {
    walker.classList.add('st-walking');
    if (walker.animate) {
      walker.animate([{ transform: at(start) }, { transform: at(end) }], { duration: 2200, easing: 'ease-in-out', fill: 'forwards' });
    } else {
      walker.style.transform = at(end);
    }
  });
  later(2100, () => victim.classList.add('st-bent'));
  later(2500, () => {
    walker.classList.remove('st-walking');
    walker.classList.add('st-spanking');
    victim.classList.add('st-spanked');
  });
  later(4050, () => {
    walker.classList.remove('st-spanking');
    walker.classList.add('st-cheer');
    victim.classList.remove('st-spanked', 'st-bent');
    victim.classList.add('st-ow');
  });
  later(5000, () => {
    walker.classList.add('st-out');
    victim.classList.add('st-out');
  });

  // Each smack lands 425ms into a 500ms swing: a SMACK! burst and a handprint on the butt.
  const butt = { x: -12 * face, y: FOOT_Y - 38 };
  [2925, 3425, 3925].forEach((t, i) => {
    part(stage, 'sfx-handprint', '🖐️', { left: `${butt.x + (i - 1) * 6 * face}px`, top: `${butt.y + (i - 1) * 4}px`, animationDelay: `${t}ms` });
    part(stage, 'sfx-smack', 'SMACK!', { left: `calc(${butt.x - face * 30}px + var(--nudge))`, top: `${butt.y - 46 - i * 6}px`, animationDelay: `${t}ms` });
  });
  part(stage, 'sfx-ow', 'OW!', { left: `calc(${face * 6}px + var(--nudge))`, top: `${FOOT_Y - FIG_H - 22}px` });
}

/**
 * The player's icon that is actually on screen. The same player can be rendered in several
 * places (the hidden lobby roster stays in the DOM during a game), so skip any that have no
 * size - otherwise a gag in a game would land at the top-left corner.
 */
function findAnchor(name) {
  const escaped = window.CSS && CSS.escape ? CSS.escape(name) : String(name).replace(/["\\]/g, '\\$&');
  for (const el of document.querySelectorAll(`[data-player="${escaped}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** The column captions stack in (newest at the bottom), created on first use. */
function captionStack(layer) {
  let stack = layer.querySelector('.sfx-captions');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'sfx-captions';
    layer.appendChild(stack);
  }
  return stack;
}

function showCaption(layer, text, ms) {
  const cap = document.createElement('div');
  cap.className = 'sfx-caption';
  cap.textContent = text;
  cap.style.setProperty('--life', `${ms}ms`);
  captionStack(layer).appendChild(cap);
  setTimeout(() => cap.remove(), ms + 200);
}

// target name -> gags waiting for the one currently playing on them to finish.
const queues = new Map();

/**
 * Plays a gag, or lines it up behind the one already playing on the same player so hits
 * never pile on top of each other. Every phone gets the same broadcasts in the same order,
 * so the queue plays out identically everywhere (the server caps its length, server/store.js).
 * Self-targeted gags (the confetti bomb) never wait.
 */
export function playStoreFx(layer, action) {
  if (!layer) return;
  const self = !action.fromName || action.fromName === action.targetName;
  if (self) {
    playNow(layer, action);
    return;
  }
  const key = action.targetName;
  if (queues.has(key)) {
    queues.get(key).push(action);
    return;
  }
  queues.set(key, []);
  const next = (a) => {
    const ms = playNow(layer, a);
    setTimeout(() => {
      const waiting = queues.get(key);
      if (waiting && waiting.length) next(waiting.shift());
      else queues.delete(key);
    }, ms);
  };
  next(action);
}

/**
 * Plays one gag right away and returns how long it lasts. `icon` is the catalog emoji, used
 * as a fallback for an unknown item id.
 */
function playNow(layer, { itemId, fromName, targetName, icon }) {
  const gag = GAGS[itemId];
  const ms = gag ? gag.ms : 2000;
  if (gag) {
    gag.sound();
    haptic(gag.haptic);
  }

  const stage = document.createElement('div');
  stage.className = `sfx-stage sfx-gag-${itemId}`;
  stage.style.setProperty('--life', `${ms}ms`);
  layer.appendChild(stage);

  if (reducedMotion || !gag) {
    stage.classList.add('sfx-simple');
    part(stage, 'sfx-simple-glyph', icon || '✨');
  } else {
    gag.build(stage, { fromName, targetName });
  }

  const self = !fromName || fromName === targetName;
  if (gag && fromName) showCaption(layer, gag.caption(fromName, targetName), ms);
  else if (!self) showCaption(layer, `${icon || '✨'} ${fromName} → ${targetName}`, ms);

  // Follow the target's avatar for the whole show (screens re-render, lists scroll), and
  // keep the avatar's mood class on whichever element currently represents them.
  let anchor = null;
  const moodClass = gag && !reducedMotion ? gag.avatarClass : null;
  const place = () => {
    const next = findAnchor(targetName);
    if (next !== anchor) {
      if (anchor && moodClass) anchor.classList.remove(moodClass);
      anchor = next;
      if (anchor && moodClass) anchor.classList.add(moodClass);
    }
    let x = window.innerWidth / 2;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      x = r.left + r.width / 2;
      stage.classList.remove('sfx-floating');
      stage.style.left = `${x}px`;
      stage.style.top = `${r.top + r.height / 2}px`;
      // Avatars range from tiny roster icons to big seats; keep the show readable.
      stage.style.setProperty('--size', `${Math.round(Math.max(72, Math.min(Math.max(r.width, r.height) * 1.4, 130)))}px`);
    } else {
      stage.classList.add('sfx-floating');
      stage.style.left = '50%';
      stage.style.top = '45%';
      stage.style.setProperty('--size', '110px');
    }
    // Things that fly in (glove, trumpet, tomato) come from the side with more room, and
    // wide labels (POW!, HA HA HA) are nudged back onscreen near the edges.
    stage.style.setProperty('--side', x < window.innerWidth / 2 ? '-1' : '1');
    const margin = 95;
    const nudge = Math.max(0, margin - x) - Math.max(0, x - (window.innerWidth - margin));
    stage.style.setProperty('--nudge', `${Math.round(nudge)}px`);
  };
  place();
  const tracker = setInterval(place, 100);

  setTimeout(() => {
    clearInterval(tracker);
    if (anchor && moodClass) anchor.classList.remove(moodClass);
    stage.remove();
  }, ms);
  return ms;
}
