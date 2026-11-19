/**
 * Full-screen store-cosmetic moments, shown to EVERYONE in the room (not just the owner):
 *   - Grand Entrance: "✨ <name> has arrived" with a spotlight sweep and a sparkle burst,
 *     and the arriving player's lobby row glows for a few seconds.
 *   - Winner's Podium: confetti rain + fireworks + "🏆 <name> wins!" over the game-over screen.
 *
 * The server decides when these fire and broadcasts `cosmeticEffect` to the room
 * (server/lobby.js announceEntrance, server.js recordGameResult). This module only plays
 * them. Purely visual and pointer-events:none, so it can never block a tap. Styles live in
 * public/theme-afterglow.css ("Store: cosmetic moments"). See docs/specs/store-specs.md.
 */

import { sfx, haptics } from '../fx.js';
import { applyCosmetics } from './cosmetics.js';

const ENTRANCE_MS = 3200;
const PODIUM_MS = 4800;
const CONFETTI_COLORS = ['#ff6ad5', '#ffd84a', '#4ade80', '#39e0ff', '#b388ff', '#ff7a1a', '#c6ff4a'];

const reducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let layer = null;
// One moment at a time: a second one waits for the first instead of piling on top.
const queue = [];
let playing = false;

function getLayer() {
  if (layer && layer.isConnected) return layer;
  layer = document.createElement('div');
  layer.className = 'cfx-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  return layer;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

/** Sparkles flying out from the centre of `host`. */
function sparkleBurst(host, count, { glyphs = ['✨', '⭐', '💫'], distance = 180 } = {}) {
  if (reducedMotion) return;
  for (let i = 0; i < count; i++) {
    const s = el('span', 'cfx-sparkle', glyphs[i % glyphs.length]);
    const angle = (Math.PI * 2 * i) / count + rand(-0.2, 0.2);
    const dist = distance * rand(0.6, 1.15);
    s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    s.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    s.style.setProperty('--delay', `${rand(0, 0.25)}s`);
    s.style.fontSize = `${rand(0.9, 1.7)}rem`;
    host.appendChild(s);
  }
}

/** A firework: coloured dots bursting from (x%, y%) of the screen. */
function firework(host, x, y, delay) {
  if (reducedMotion) return;
  const burst = el('div', 'cfx-firework');
  burst.style.left = `${x}%`;
  burst.style.top = `${y}%`;
  const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
  const n = 22;
  for (let i = 0; i < n; i++) {
    const dot = el('span', 'cfx-spark');
    const angle = (Math.PI * 2 * i) / n;
    const dist = rand(70, 120);
    dot.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    dot.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    dot.style.setProperty('--delay', `${delay}s`);
    dot.style.background = color;
    dot.style.boxShadow = `0 0 8px ${color}`;
    burst.appendChild(dot);
  }
  host.appendChild(burst);
}

/** Confetti pieces raining from the top of the screen. */
function confettiRain(host, count) {
  if (reducedMotion) return;
  for (let i = 0; i < count; i++) {
    const c = el('span', 'cfx-confetti');
    c.style.left = `${rand(0, 100)}%`;
    c.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    c.style.setProperty('--delay', `${rand(0, 1.4)}s`);
    c.style.setProperty('--fall', `${rand(2.2, 3.4)}s`);
    c.style.setProperty('--drift', `${rand(-80, 80)}px`);
    c.style.setProperty('--spin', `${rand(360, 1080)}deg`);
    c.style.width = `${rand(6, 11)}px`;
    c.style.height = `${rand(10, 18)}px`;
    host.appendChild(c);
  }
}

/**
 * Shrinks a big announcement name until it fits on one line across the screen, so a long
 * name is never cut or broken mid-word. Call once it's in the DOM.
 */
function fitName(nameEl) {
  const max = Math.min(window.innerWidth, 480) - 32 - 56; // screen gutter + banner padding
  let size = parseFloat(getComputedStyle(nameEl).fontSize);
  while (nameEl.scrollWidth > max && size > 14) {
    size -= 1;
    nameEl.style.fontSize = `${size}px`;
  }
}

function playEntrance({ name, cosmetics }, done) {
  const host = getLayer();
  const stage = el('div', 'cfx-stage cfx-entrance');
  stage.appendChild(el('div', 'cfx-spotlight'));

  const banner = el('div', 'cfx-banner');
  banner.appendChild(el('div', 'cfx-kicker', '✨ Grand Entrance ✨'));
  const nameWrap = el('div', 'cfx-name-wrap');
  const nameEl = el('span', 'cfx-name', name);
  nameWrap.appendChild(nameEl);
  banner.appendChild(nameWrap);
  banner.appendChild(el('div', 'cfx-sub', 'has arrived'));
  // Their own name color + title ride along, so the moment is unmistakably theirs.
  applyCosmetics({ name: nameEl }, { nameColor: cosmetics && cosmetics.nameColor, title: cosmetics && cosmetics.title });
  stage.appendChild(banner);
  sparkleBurst(stage, 26);
  host.appendChild(stage);
  fitName(nameEl);

  // Their lobby row (if on screen) glows for a while after the banner fades.
  const anchor = document.querySelector(`[data-player="${cssEscape(name)}"]`);
  const row = anchor && (anchor.closest('li') || anchor);
  if (row) {
    row.classList.add('cfx-arrival-glow');
    setTimeout(() => row.classList.remove('cfx-arrival-glow'), ENTRANCE_MS + 2500);
  }

  sfx.fanfare();
  haptics.success();
  setTimeout(() => {
    stage.remove();
    done();
  }, ENTRANCE_MS);
}

function playPodium({ names }, done) {
  const host = getLayer();
  const stage = el('div', 'cfx-stage cfx-podium');
  confettiRain(stage, 90);
  firework(stage, 22, 26, 0.1);
  firework(stage, 78, 22, 0.55);
  firework(stage, 50, 14, 1.0);
  firework(stage, 30, 40, 1.5);
  firework(stage, 70, 38, 1.9);

  const banner = el('div', 'cfx-banner');
  banner.appendChild(el('div', 'cfx-trophy', '🏆'));
  // One line per winner, so a tie of long names still reads in full.
  const nameEls = names.map((n) => el('div', 'cfx-name', n));
  nameEls.forEach((n, i) => {
    if (i > 0) banner.appendChild(el('div', 'cfx-and', '&'));
    banner.appendChild(n);
  });
  banner.appendChild(el('div', 'cfx-sub', names.length > 1 ? 'win!' : 'wins!'));
  stage.appendChild(banner);
  host.appendChild(stage);
  nameEls.forEach(fitName);

  // Winners on screen get a gold pulse too.
  for (const n of names) {
    // Pulse the row/seat around the avatar, not the avatar itself, so an equipped frame's
    // own animation isn't replaced while it plays.
    const a = document.querySelector(`[data-player="${cssEscape(n)}"]`);
    const target = a && (a.closest('li') || a.parentElement || a);
    if (target) {
      target.classList.add('cfx-winner-pulse');
      setTimeout(() => target.classList.remove('cfx-winner-pulse'), PODIUM_MS);
    }
  }

  sfx.win();
  setTimeout(() => sfx.fanfare(), 500);
  haptics.success();
  setTimeout(() => {
    stage.remove();
    done();
  }, PODIUM_MS);
}

function next() {
  if (playing) return;
  const item = queue.shift();
  if (!item) return;
  playing = true;
  const done = () => {
    playing = false;
    next();
  };
  try {
    if (item.kind === 'entrance' && item.name) playEntrance(item, done);
    else if (item.kind === 'podium' && Array.isArray(item.names) && item.names.length) playPodium(item, done);
    else done();
  } catch (e) {
    done();
  }
}

function onEffect(payload) {
  if (!payload || typeof payload !== 'object') return;
  // Don't let a burst of events build an endless backlog.
  if (queue.length >= 4) return;
  queue.push(payload);
  next();
}

/**
 * Plays a moment on this screen only - the Store tab's "Preview" button, so a player can
 * see what Grand Entrance / Winner's Podium look like (and confirm their phone shows them).
 */
export function previewCosmeticEffect(payload) {
  onEffect(payload);
}

export function initCosmeticEffects(socket) {
  if (!socket) return;
  socket.on('cosmeticEffect', onEffect);
}
