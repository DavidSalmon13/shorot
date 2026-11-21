/**
 * The visual + audio show for Store consumables (🥊 🍅 👑 😂 🎺 💣 🧽 ...), played on every phone
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

import { sfx, haptic, isMuted } from '../fx.js';
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
    // With the target's AI video (server/spankVideos.js) the sender walks over, then the clip
    // plays (SPANK_T0 + 5s) instead of the drawn smacks.
    ms: (a) => (a.video ? SPANK_T0 + 5600 : 5600),
    avatarClass: null,
    caption: (from, to) => `🍑 ${from} spanked ${to}!`,
    sound: (a) => sfx.spank({ video: !!a.video }),
    haptic: (a) => (a.video ? [0, 350, 40, 200, 40, 200, 40, 200, 40] : [0, 2900, 70, 430, 70, 430, 120]),
    build: buildSpank,
  },
  dishes: {
    ms: 8400,
    avatarClass: null,
    caption: (from, to) => `🧽 ${from} to ${to}: go do the dishes!!!`,
    sound: (a) => sfx.dishes({ video: !!a.video }),
    haptic: [40, 210, 40, 210, 40, 210, 40, 210, 40, 210, 40, 210, 40, 200, 300, 2400, 30, 220, 30, 220, 30, 220, 30, 220, 30],
    build: buildDishes,
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
  // Custom properties (--nx, --at, ...) need setProperty; Object.assign silently drops them.
  if (style) for (const [k, v] of Object.entries(style)) k.startsWith('--') ? el.style.setProperty(k, v) : (el.style[k] = v);
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
const BODY_H = 168; // how tall a realistic generated body stands, in px

/**
 * A player as a standing figure, placed by its feet (bottom center) via the outer element's
 * transform; poses (pp-walk, pp-bent, ...) animate the inner body around the feet. With
 * `poses` (realistic body images from server/bodies.js, drawn facing right) it shows those
 * and `setPose(name)` switches between them; `flip` mirrors it to face left. Without, it's
 * the player's own photo sticker (or a big emoji).
 */
function puppet(stage, className, name, poses, flip) {
  const el = document.createElement('span');
  el.className = `sfx-puppet ${className}`;
  el.innerHTML = '<span class="pp-shadow"></span><span class="pp-anchor"><span class="pp-body"></span></span>';
  const body = el.querySelector('.pp-body');
  let img = null;
  if (poses) {
    el.classList.add('pp-real');
    el.style.setProperty('--flip', flip ? -1 : 1);
    img = document.createElement('img');
    img.src = poses.stand;
    img.alt = '';
    body.appendChild(img);
  } else {
    const look = faceOf(name);
    if (look.src) {
      img = document.createElement('img');
      img.src = look.src;
      img.alt = '';
      body.appendChild(img);
    } else {
      body.classList.add('pp-emoji');
      body.textContent = look.emoji;
    }
  }
  el.setPose = (pose) => {
    if (poses && img && poses[pose]) img.src = poses[pose];
  };
  stage.appendChild(el);
  return el;
}

/**
 * 🍑 Spanking with the players' own photos: the sender's photo waddles over from their icon
 * to the target, whose photo bends over; a hand swings down three times (SMACK!), then the
 * target hops around while the sender bounces. Stage-relative positions (the stage sits on
 * the target's icon); the walk is a Web Animation, poses are CSS classes on a timeline.
 */
const SPANK_T0 = 2600; // with an AI video, when the clip pops up, in ms

function buildSpank(stage, { fromName, targetName, bodies, video }) {
  const walkerPoses = (bodies && bodies.from) || null;
  const victimPoses = (bodies && bodies.target) || null;
  const victimH = victimPoses ? BODY_H : PUPPET_H;
  const tallest = walkerPoses || victimPoses ? BODY_H : PUPPET_H;
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
  const onY = (y) => Math.max(tallest + 30, Math.min(vh - 10, y));
  // The target bends away from the sender, so leave room on that side for the lean.
  const lean = 70;
  const victimX = Math.max(62 + (side === 1 ? lean : 0), Math.min(vw - 62 - (side === -1 ? lean : 0), target.x));
  const victimAt = { x: victimX, y: onY(target.y + 40) };
  const gap = walkerPoses || victimPoses ? 92 : 80;
  const endAbs = { x: Math.max(40, Math.min(vw - 40, victimAt.x + side * gap)), y: victimAt.y };
  let startAbs = from ? { x: onX(from.x), y: onY(from.y + 40) } : { x: onX(victimAt.x + side * 220), y: victimAt.y };
  if (Math.hypot(startAbs.x - endAbs.x, startAbs.y - endAbs.y) < 60) startAbs = { x: onX(victimAt.x + side * 200), y: victimAt.y };
  const rel = (p) => ({ x: p.x - target.x, y: p.y - target.y });
  const vic = rel(victimAt);
  const end = rel(endAbs);
  const start = rel(startAbs);
  const at = (p) => `translate(${p.x}px, ${p.y}px)`;

  // Realistic bodies are drawn facing right: both face left when the sender is on the right
  // (the sender toward the target, the target away from them).
  const flip = side === 1;
  const victim = puppet(stage, 'pp-victim', targetName, victimPoses, flip);
  victim.style.transform = at(vic);
  victim.style.setProperty('--bend', `${-side * 38}deg`); // leans away from the sender
  victim.style.setProperty('--side', side);
  const walker = puppet(stage, 'pp-walker', fromName || targetName, walkerPoses, flip);
  walker.style.transform = at(start);
  walker.style.setProperty('--lean', `${-side * 12}deg`); // leans in toward the target
  walker.style.setProperty('--side', side);

  // Where the smacks land: the target's backside (higher up on a bent-over real body).
  const butt = victimPoses
    ? { x: vic.x + side * BODY_H * 0.2, y: vic.y - BODY_H * 0.47 }
    : { x: vic.x + side * 26, y: vic.y - PUPPET_H * 0.3 };

  const later = (ms, fn) => setTimeout(() => stage.isConnected && fn(), ms);
  if (video) {
    // The walk-up, then both puppets vanish and the target's AI clip takes over.
    later(300, () => {
      walker.classList.add('pp-walk');
      if (walker.animate) {
        walker.animate([{ transform: at(start) }, { transform: at(end) }], { duration: 2200, easing: 'ease-in-out', fill: 'forwards' });
      } else {
        walker.style.transform = at(end);
      }
    });
    if (walkerPoses) for (let t = 300, i = 0; t < 2500; t += 240, i++) later(t, () => walker.setPose(i % 2 ? 'walk2' : 'walk1'));
    later(SPANK_T0 - 300, () => {
      walker.classList.add('pp-out');
      victim.classList.add('pp-out');
    });
    stage.style.setProperty('--t0', `${SPANK_T0 / 1000}s`);
    playGagVideo(stage, target, video, later, SPANK_T0);
    return;
  }
  // A photo has no arm, so a hand swings in for it; a realistic body swings its own.
  let hand = null;
  if (!walkerPoses) {
    hand = part(stage, 'sfx-spank-hand', '✋');
    hand.style.setProperty('--hx', `${butt.x}px`);
    hand.style.setProperty('--hy', `${butt.y}px`);
    hand.style.setProperty('--side', side);
  }
  later(300, () => {
    walker.classList.add('pp-walk');
    if (walker.animate) {
      walker.animate([{ transform: at(start) }, { transform: at(end) }], { duration: 2200, easing: 'ease-in-out', fill: 'forwards' });
    } else {
      walker.style.transform = at(end);
    }
  });
  later(2050, () => {
    victim.classList.add('pp-bent');
    victim.setPose('bent');
  });
  later(2500, () => {
    walker.classList.remove('pp-walk');
    walker.classList.add('pp-swing');
    victim.classList.add('pp-spanked');
    if (hand) hand.classList.add('sfx-spank-hand-on');
  });
  later(4050, () => {
    walker.classList.remove('pp-swing');
    walker.classList.add('pp-cheer');
    walker.setPose('cheer');
    victim.classList.remove('pp-spanked', 'pp-bent');
    victim.classList.add('pp-ow');
    victim.setPose('rub');
  });
  if (walkerPoses) {
    // Real walk cycle while crossing, then wind up / swing through on each smack.
    for (let t = 300, i = 0; t < 2500; t += 240, i++) later(t, () => walker.setPose(i % 2 ? 'walk2' : 'walk1'));
    later(2500, () => walker.setPose('stand'));
    // Wind up between smacks; the swung-through pose holds ~225ms after each hit.
    [2560, 3150, 3650].forEach((t) => later(t, () => walker.setPose('raise')));
    [2925, 3425, 3925].forEach((t) => later(t, () => walker.setPose('slap')));
  }
  later(5000, () => {
    walker.classList.add('pp-out');
    victim.classList.add('pp-out');
  });

  // Each smack lands 425ms into a 500ms swing: SMACK! and a red handprint on the backside.
  [2925, 3425, 3925].forEach((t, i) => {
    part(stage, 'sfx-handprint', '🖐️', { left: `${butt.x + (i - 1) * 6 * side}px`, top: `${butt.y + (i - 1) * 5}px`, animationDelay: `${t}ms` });
    part(stage, 'sfx-smack', 'SMACK!', { left: `calc(${butt.x + side * 34}px + var(--nudge))`, top: `${butt.y - 70 - i * 8}px`, animationDelay: `${t}ms` });
  });
  part(stage, 'sfx-ow', 'OW!', { left: `calc(${vic.x - side * 10}px + var(--nudge))`, top: `${vic.y - victimH - 20}px` });
}

/**
 * 🧽 Go do the dishes, in two acts. First the sender's photo pops out of their icon (or walks
 * in from the edge) and stomps over to the target, red in the face with a 💢, stands beside
 * them, points and yells "GO DO THE DISHES!!!", then storms off. Then the target's photo pops
 * up behind a sink, grows stick arms and scrubs plates: one a second goes from the dirty stack
 * to the clean one. Stage-relative positions, kept on screen. The walk is a Web Animation;
 * the rest of the timeline is CSS animation delays (public/style.css "Go do the dishes"),
 * the dishes part offset by --t0 (DISHES_T0).
 */
// Stick-arm geometry for the dishes gag, in px. The photo floats `lift` above the sink's rim; the
// arms grow from its two bottom corners (`shoulderUp` above its bottom edge) and reach down to
// the plate on the rim (hands `hand` out from the middle, `handUp` above the rim).
const ARM = { lift: 56, shoulderUp: 8, upper: 52, fore: 58, hand: 24, handUp: 4 };

/**
 * Where the sticker's visible pixels start and end (px from its center, left negative) on the
 * row `up` px above its feet, as drawn by .pp-body (PUPPET_H tall, max 130 wide, bottom-aligned).
 * Falls back to a typical width for an emoji, an unloaded image or an unreadable one.
 */
function stickerEdges(img, up) {
  const fallback = { left: -40, right: 40 };
  if (!img || !img.naturalWidth || !img.naturalHeight) return fallback;
  const cw = Math.round(Math.min(130, (PUPPET_H * img.naturalWidth) / img.naturalHeight));
  const ch = Math.round((cw * img.naturalHeight) / img.naturalWidth);
  const y = Math.max(0, Math.min(ch - 1, ch - up));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, cw, ch);
    // A few rows around shoulder height, so a single see-through pixel doesn't decide it.
    const rows = g.getImageData(0, Math.max(0, y - 3), cw, Math.min(7, ch - Math.max(0, y - 3))).data;
    let lo = cw;
    let hi = -1;
    for (let i = 3; i < rows.length; i += 4) {
      if (rows[i] < 80) continue;
      const x = ((i - 3) / 4) % cw;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    if (hi < lo) return fallback;
    return { left: lo - cw / 2, right: hi - cw / 2 };
  } catch (e) {
    return fallback; // e.g. a cross-origin image taints the canvas
  }
}

/**
 * Two-bone reach in the right arm's frame (x outward, y down): the upper arm's angle and the
 * forearm's angle relative to it (degrees, CSS rotate) so a hand `dx`, `dy` from the shoulder is
 * reached with the elbow bent outward. Out of reach = arm pointing straight at it.
 */
function reach(dx, dy, upper, fore) {
  const d = Math.min(Math.hypot(dx, dy), upper + fore - 1);
  const toHand = Math.atan2(dy, dx);
  const bend = Math.acos(Math.max(-1, Math.min(1, (upper * upper + d * d - fore * fore) / (2 * upper * d))));
  const a1 = toHand - bend; // elbow out to the side
  const ex = upper * Math.cos(a1);
  const ey = upper * Math.sin(a1);
  const hx = d * Math.cos(toHand);
  const hy = d * Math.sin(toHand);
  const a2 = Math.atan2(hy - ey, hx - ex) - a1;
  const deg = (r) => Math.round((r * 180) / Math.PI);
  return { a1: deg(a1), a2: deg(a2) };
}

const DISHES_T0 = 3000; // when the sink scene starts, in ms (matches --t0 in style.css)
const SINK_RIM = 30; // how far the sink's rim is above the scene's feet line, in px

function buildDishes(stage, { fromName, targetName, video }) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const target = centerOf(targetName) || { x: vw / 2, y: vh * 0.45 };
  const feet = {
    x: Math.max(122, Math.min(vw - 122, target.x)),
    y: Math.max(PUPPET_H + 150, Math.min(vh - 30, target.y + 40)),
  };
  const rel = (p) => ({ x: p.x - target.x, y: p.y - target.y });
  const at = (p) => `translate(${p.x}px, ${p.y}px)`;
  const f = rel(feet);
  const centered = (x, half) => Math.max(half, Math.min(vw - half, x)) - target.x;

  // --- Act 1: the angry walk-up -------------------------------------------------------
  const from = fromName && fromName !== targetName ? centerOf(fromName) : null;
  let side = from ? (from.x < target.x ? -1 : 1) : 1;
  if (target.x + side * 105 < 60 || target.x + side * 105 > vw - 60) side = -side;
  const standAbs = { x: Math.max(60, Math.min(vw - 60, target.x + side * 105)), y: feet.y };
  let startAbs = from
    ? { x: Math.max(60, Math.min(vw - 60, from.x)), y: Math.max(PUPPET_H + 30, Math.min(vh - 10, from.y + 40)) }
    : { x: side === 1 ? vw + 70 : -70, y: feet.y };
  if (Math.hypot(startAbs.x - standAbs.x, startAbs.y - standAbs.y) < 60) startAbs = { x: side === 1 ? vw + 70 : -70, y: feet.y };
  const start = rel(startAbs);
  const stand = rel(standAbs);

  const boss = puppet(stage, 'pp-boss', fromName || targetName, null, false);
  boss.style.transform = at(start);
  boss.style.setProperty('--side', side);
  const fume = document.createElement('span');
  fume.className = 'dd-fume';
  fume.innerHTML = '<span class="dd-anger">💢</span><span class="dd-steam dd-steam-l">💨</span><span class="dd-steam dd-steam-r">💨</span>';
  boss.appendChild(fume);
  if (boss.animate) {
    boss.animate([{ transform: at(start) }, { transform: at(stand) }], { duration: 1750, delay: 400, easing: 'ease-in-out', fill: 'forwards' });
  } else {
    boss.style.transform = at(stand);
  }

  part(stage, 'sfx-dish-shout', 'GO DO THE DISHES!!!', { left: `${centered(standAbs.x, 150)}px`, top: `${f.y - PUPPET_H - 30}px` });
  part(stage, 'sfx-dish-point', '👉', {
    left: `${stand.x - side * 62}px`,
    top: `${f.y - PUPPET_H * 0.5}px`,
    '--fx': side === 1 ? -1 : 1,
  });

  const later = (ms, fn) => setTimeout(() => stage.isConnected && fn(), ms);
  later(400, () => boss.classList.add('pp-stomp'));
  later(2150, () => {
    boss.classList.remove('pp-stomp');
    boss.classList.add('pp-yell');
  });
  later(DISHES_T0 - 300, () => boss.classList.add('pp-out'));

  // --- Act 2: the dishes --------------------------------------------------------------
  if (video) {
    playGagVideo(stage, target, video, later, DISHES_T0);
    return;
  }
  part(stage, 'sfx-dish-spot', '', { left: `${f.x}px`, top: `${f.y - 95}px` });
  // The photo floats above the sink's rim (SINK_RIM above the scene's feet line), so none of it
  // is hidden and its arms have room to reach down to the plate.
  const onRim = { x: f.x, y: f.y - SINK_RIM - ARM.lift };
  const washer = puppet(stage, 'pp-washer', targetName, null, false);
  washer.style.transform = at(onRim);

  // Each arm grows from one of the sticker's bottom corners (its visible edge, found from its
  // pixels), and a two-bone reach (shoulder -> elbow -> hand) bends the elbow outward so the hand
  // lands on the plate at the rim.
  const edges = stickerEdges(washer.querySelector('img'), ARM.shoulderUp);
  const rig = document.createElement('span');
  rig.className = 'sfx-dish-rig';
  rig.style.transform = at(onRim);
  rig.innerHTML = [-1, 1]
    .map((s) => {
      const shoulder = Math.max(14, (s === 1 ? edges.right : -edges.left) - 4);
      const { a1, a2 } = reach(ARM.hand - shoulder, ARM.shoulderUp + ARM.lift - ARM.handUp, ARM.upper, ARM.fore);
      const vars = `--s:${s};--sx:${shoulder}px;--sy:${-ARM.shoulderUp}px;--u:${ARM.upper}px;--l:${ARM.fore}px;--a1:${a1}deg;--a2:${a2}deg`;
      return `<span class="dd-arm" style="${vars}"><span class="dd-upper"><span class="dd-fore"><span class="dd-hand">${s === 1 ? '<span class="dd-sponge">🧽</span>' : ''}</span></span></span></span>`;
    })
    .join('');
  stage.appendChild(rig);

  const grimy = (el) => {
    const g = document.createElement('span');
    g.className = 'dd-grime';
    el.appendChild(g);
    return el;
  };
  grimy(part(stage, 'sfx-dish-plate', '🍽️', { left: `${f.x}px`, top: `${f.y - SINK_RIM - 2}px` }));
  part(stage, 'sfx-dish-sink', '', { left: `${f.x}px`, top: `${f.y - 10}px` }).innerHTML = '<span class="dd-water"></span>';

  // Dirty stack on one side of the sink, clean stack on the other: one plate moves per second.
  const cleanTimes = [2300, 3300, 4300].map((t) => t + DISHES_T0);
  cleanTimes.forEach((t, i) => {
    grimy(part(stage, 'sfx-dish-dirty', '🍽️', { left: `${f.x - 102}px`, top: `${f.y - 22 - i * 8}px`, '--gone': `${cleanTimes[2 - i] - 300}ms` }));
    part(stage, 'sfx-dish-clean', '🍽️', { left: `${f.x + 102}px`, top: `${f.y - 22 - i * 8}px`, '--at': `${t}ms` });
    part(stage, 'sfx-dish-shine', '✨', { left: `${f.x + 112}px`, top: `${f.y - 40 - i * 8}px`, '--at': `${t}ms` });
  });

  for (let i = 0; i < 10; i++) {
    const size = 8 + Math.round(Math.random() * 7);
    part(stage, 'sfx-dish-bubble', '', {
      left: `${f.x - 45 + Math.random() * 90}px`,
      top: `${f.y - 30}px`,
      width: `${size}px`,
      height: `${size}px`,
      '--drift': `${Math.round(Math.random() * 30 - 15)}px`,
      animationDelay: `${DISHES_T0 + 1900 + i * 290}ms`,
    });
  }

  later(DISHES_T0, () => washer.classList.add('dd-on'));
  later(DISHES_T0 + 4950, () => washer.classList.add('pp-out'));
}

/**
 * A gag's realistic AI video of the target (server/gagVideos.js; the Dishes act 2, the Spanking
 * after the walk-up): a 4:5 card that pops up over a dimmed screen near the target at `t0` ms
 * (the stage's --t0 in CSS) and plays the clip once. It plays with sound unless
 * the app is muted or the phone won't autoplay sound, in which case it plays silently.
 */
function playGagVideo(stage, target, src, later, t0) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // 4:5 portrait. The clips come out square from a square sticker, sometimes with a black band
  // down the right edge, which the card crops off (the video is pinned to its left edge).
  const w = Math.min(270, vw - 40, ((vh - 120) * 4) / 5);
  const h = (w * 5) / 4;
  const cx = Math.max(w / 2 + 16, Math.min(vw - w / 2 - 16, target.x));
  const cy = Math.max(h / 2 + 70, Math.min(vh - h / 2 - 16, target.y));
  part(stage, 'sfx-video-dim', '', { left: `${vw / 2 - target.x}px`, top: `${vh / 2 - target.y}px` });
  const card = part(stage, 'sfx-video-card', '', { left: `${cx - target.x}px`, top: `${cy - target.y}px`, width: `${w}px`, height: `${h}px` });
  const v = document.createElement('video');
  v.src = src;
  v.playsInline = true;
  v.preload = 'auto';
  v.muted = true;
  card.appendChild(v);
  later(t0, () => {
    v.currentTime = 0;
    v.muted = isMuted();
    const p = v.play();
    if (p && p.catch) {
      p.catch(() => {
        v.muted = true;
        v.play().catch(() => {});
      });
    }
  });
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
 * Anything a gag needs loaded before it starts: the Spanking shows both players' photos (and
 * their realistic body poses, when the server has them - server/bodies.js), so it waits up to
 * 2.5s for those images and doesn't start with blank bodies. A body whose poses didn't all
 * load in time isn't used this time (usableBodies) - the photo version plays instead.
 */
const loadedImages = new Set();

function loadImage(src) {
  if (loadedImages.has(src)) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      loadedImages.add(src);
      resolve();
    };
    img.onerror = resolve;
    img.src = src;
  });
}

// Video URLs that have loaded enough to play through (the Dishes and Spanking AI videos).
const loadedVideos = new Set();

function loadVideo(src) {
  if (loadedVideos.has(src)) return Promise.resolve();
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.oncanplaythrough = () => {
      loadedVideos.add(src);
      resolve();
    };
    v.onerror = resolve;
    v.src = src;
    v.load();
  });
}

function prepare(action) {
  if (action.itemId === 'dishes') {
    const srcs = [action.fromName, action.targetName].filter(Boolean).map((n) => faceOf(n).src).filter(Boolean);
    const loads = srcs.map(loadImage);
    if (action.video) loads.push(loadVideo(action.video));
    return Promise.race([Promise.all(loads), new Promise((resolve) => setTimeout(resolve, 2500))]);
  }
  if (action.itemId !== 'spank') return Promise.resolve();
  const srcs = [action.fromName, action.targetName].filter(Boolean).map((n) => faceOf(n).src).filter(Boolean);
  for (const set of Object.values(action.bodies || {})) if (set) srcs.push(...Object.values(set));
  const loads = srcs.map(loadImage);
  if (action.video) loads.push(loadVideo(action.video));
  return Promise.race([Promise.all(loads), new Promise((resolve) => setTimeout(resolve, 2500))]);
}

/** The body sets whose every pose image is loaded; the others become null. */
function usableBodies(bodies) {
  const ok = (set) => (set && Object.values(set).every((src) => loadedImages.has(src)) ? set : null);
  return { from: ok(bodies && bodies.from), target: ok(bodies && bodies.target) };
}

/**
 * Plays one gag right away and returns how long it lasts. `icon` is the catalog emoji, used
 * as a fallback for an unknown item id.
 */
function playNow(layer, { itemId, fromName, targetName, icon, bodies, video }) {
  const gag = GAGS[itemId];
  const usable = { bodies: usableBodies(bodies), video: video && loadedVideos.has(video) ? video : null };
  const pick = (v) => (typeof v === 'function' ? v(usable) : v);
  const ms = gag ? pick(gag.ms) : 2000;
  if (gag) {
    gag.sound({ video: usable.video });
    haptic(pick(gag.haptic));
  }

  const stage = document.createElement('div');
  stage.className = `sfx-stage sfx-gag-${itemId}`;
  stage.style.setProperty('--life', `${ms}ms`);
  layer.appendChild(stage);

  if (reducedMotion || !gag) {
    stage.classList.add('sfx-simple');
    part(stage, 'sfx-simple-glyph', icon || '✨');
  } else {
    gag.build(stage, { fromName, targetName, bodies: usable.bodies, video: usable.video });
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
