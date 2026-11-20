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

/**
 * A player's look as shown on their icon: their photo sticker, else their emoji. Looks at
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

/** Where a player's icon is on screen (its center), or null if they aren't shown. */
function centerOf(name) {
  const a = findAnchor(name);
  if (!a) return null;
  const r = a.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

const PUPPET_H = 128; // how tall a player's photo stands, in px

/**
 * A player as a standing cut-out: their own photo sticker (or a big emoji), with a shadow
 * at their feet. Positioned by its feet (bottom center) via the outer element's transform;
 * poses (pp-walk, pp-bent, ...) animate the inner body around the feet.
 */
function puppet(stage, className, name) {
  const look = faceOf(name);
  const el = document.createElement('span');
  el.className = `sfx-puppet ${className}`;
  el.innerHTML = '<span class="pp-shadow"></span><span class="pp-anchor"><span class="pp-body"></span></span>';
  const body = el.querySelector('.pp-body');
  if (look.src) {
    const img = document.createElement('img');
    img.src = look.src;
    img.alt = '';
    body.appendChild(img);
  } else {
    body.classList.add('pp-emoji');
    body.textContent = look.emoji;
  }
  stage.appendChild(el);
  return el;
}

/**
 * 🍑 Spanking with the players' own photos: the sender's photo waddles over from their icon
 * to the target, whose photo bends over; a hand swings down three times (SMACK!), then the
 * target hops around while the sender bounces. Stage-relative positions (the stage sits on
 * the target's icon); the walk is a Web Animation, poses are CSS classes on a timeline.
 */
function buildSpank(stage, { fromName, targetName }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const target = centerOf(targetName) || { x: vw / 2, y: vh * 0.45 };
  const from = fromName !== targetName ? centerOf(fromName) : null;
  // The sender ends up on the side with room, else the side they walk in from.
  let side;
  if (target.x < 110) side = 1;
  else if (target.x > vw - 110) side = -1;
  else side = from && from.x < target.x ? -1 : 1;

  // Feet a little below the icon, everything kept on screen.
  const onX = (x) => Math.max(62, Math.min(vw - 62, x));
  const onY = (y) => Math.max(PUPPET_H + 30, Math.min(vh - 10, y));
  // The target bends away from the sender, so leave room on that side for the lean.
  const lean = 70;
  const victimX = Math.max(62 + (side === 1 ? lean : 0), Math.min(vw - 62 - (side === -1 ? lean : 0), target.x));
  const victimAt = { x: victimX, y: onY(target.y + 40) };
  const endAbs = { x: Math.max(40, Math.min(vw - 40, victimAt.x + side * 80)), y: victimAt.y };
  let startAbs = from ? { x: onX(from.x), y: onY(from.y + 40) } : { x: onX(victimAt.x + side * 220), y: victimAt.y };
  if (Math.hypot(startAbs.x - endAbs.x, startAbs.y - endAbs.y) < 60) startAbs = { x: onX(victimAt.x + side * 200), y: victimAt.y };
  const rel = (p) => ({ x: p.x - target.x, y: p.y - target.y });
  const vic = rel(victimAt);
  const end = rel(endAbs);
  const start = rel(startAbs);
  const at = (p) => `translate(${p.x}px, ${p.y}px)`;

  const victim = puppet(stage, 'pp-victim', targetName);
  victim.style.transform = at(vic);
  victim.style.setProperty('--bend', `${-side * 38}deg`); // leans away from the sender
  victim.style.setProperty('--side', side);
  const walker = puppet(stage, 'pp-walker', fromName || targetName);
  walker.style.transform = at(start);
  walker.style.setProperty('--lean', `${-side * 12}deg`); // leans in toward the target
  walker.style.setProperty('--side', side);

  // The spanking hand, swinging from the sender's side down onto the target's backside.
  const butt = { x: vic.x + side * 26, y: vic.y - PUPPET_H * 0.3 };
  const hand = part(stage, 'sfx-spank-hand', '✋');
  hand.style.setProperty('--hx', `${butt.x}px`);
  hand.style.setProperty('--hy', `${butt.y}px`);
  hand.style.setProperty('--side', side);

  const later = (ms, fn) => setTimeout(() => stage.isConnected && fn(), ms);
  later(300, () => {
    walker.classList.add('pp-walk');
    if (walker.animate) {
      walker.animate([{ transform: at(start) }, { transform: at(end) }], { duration: 2200, easing: 'ease-in-out', fill: 'forwards' });
    } else {
      walker.style.transform = at(end);
    }
  });
  later(2050, () => victim.classList.add('pp-bent'));
  later(2500, () => {
    walker.classList.remove('pp-walk');
    walker.classList.add('pp-swing');
    victim.classList.add('pp-spanked');
    hand.classList.add('sfx-spank-hand-on');
  });
  later(4050, () => {
    walker.classList.remove('pp-swing');
    walker.classList.add('pp-cheer');
    victim.classList.remove('pp-spanked', 'pp-bent');
    victim.classList.add('pp-ow');
  });
  later(5000, () => {
    walker.classList.add('pp-out');
    victim.classList.add('pp-out');
  });

  // Each smack lands 425ms into a 500ms swing: SMACK! and a red handprint on the backside.
  [2925, 3425, 3925].forEach((t, i) => {
    part(stage, 'sfx-handprint', '🖐️', { left: `${butt.x + (i - 1) * 6 * side}px`, top: `${butt.y + (i - 1) * 5}px`, animationDelay: `${t}ms` });
    part(stage, 'sfx-smack', 'SMACK!', { left: `calc(${butt.x + side * 34}px + var(--nudge))`, top: `${butt.y - 70 - i * 8}px`, animationDelay: `${t}ms` });
  });
  part(stage, 'sfx-ow', 'OW!', { left: `calc(${vic.x - side * 10}px + var(--nudge))`, top: `${vic.y - PUPPET_H - 20}px` });
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
    prepare(action).then(() => playNow(layer, action));
    return;
  }
  const key = action.targetName;
  if (queues.has(key)) {
    queues.get(key).push(action);
    return;
  }
  queues.set(key, []);
  const next = (a) => {
    prepare(a).then(() => {
      const ms = playNow(layer, a);
      setTimeout(() => {
        const waiting = queues.get(key);
        if (waiting && waiting.length) next(waiting.shift());
        else queues.delete(key);
      }, ms);
    });
  };
  next(action);
}

/**
 * Anything a gag needs loaded before it starts: the Spanking shows both players' photos, so
 * it waits (up to 1.5s) for them to load and doesn't start with blank bodies.
 */
function prepare(action) {
  if (action.itemId !== 'spank') return Promise.resolve();
  const srcs = [action.fromName, action.targetName].filter(Boolean).map((n) => faceOf(n).src).filter(Boolean);
  const loads = srcs.map((src) => new Promise((resolve) => {
    const img = new Image();
    img.onload = img.onerror = resolve;
    img.src = src;
  }));
  return Promise.race([Promise.all(loads), new Promise((resolve) => setTimeout(resolve, 1500))]);
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
