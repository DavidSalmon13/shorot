/**
 * Store consumable actions (the 🥊 glove and friends): the in-room side of the Store's
 * social gags, shared by every screen like reactions.js. A signed-in player who owns
 * consumables gets a small tray (#store-action-row); tapping an item enters pick-target
 * mode, tapping a player fires it. The server (server/lobby.js `storeAction`) validates,
 * spends a charge, and broadcasts `storeAction` to everyone, who each play the gag over the
 * target's avatar anchor (storeFx.js). Purely cosmetic, a few seconds long; never touches gameplay. See
 * docs/specs/store-specs.md.
 *
 * Avatar anchors are any element carrying `data-player="<name>"` (the lobby roster and the
 * game seats that opt in); if the target isn't on this screen the gag floats center-stage
 * instead, so an action always lands visibly for everyone.
 */

import { playStoreFx } from './storeFx.js';

const row = document.getElementById('store-action-row');
const layer = document.getElementById('store-fx-layer');

let socket = null;
let getMyName = () => null;
const catalog = new Map(); // itemId -> public catalog item (icon, name, target, ...)
const charges = new Map(); // itemId -> quantity owned (consumables with a charge left)
let picking = null; // itemId awaiting a target tap, or null when not in pick-target mode

function iconFor(itemId) {
  const item = catalog.get(itemId);
  return (item && item.icon) || '✨';
}

/** Loads the signed-in player's catalog + owned consumables and (re)renders the tray. */
async function refresh() {
  try {
    const res = await fetch('/api/store');
    const data = await res.json();
    catalog.clear();
    charges.clear();
    if (data && data.enabled && data.signedIn) {
      for (const item of data.items || []) catalog.set(item.id, item);
      for (const { itemId, quantity } of data.inventory || []) {
        const item = catalog.get(itemId);
        if (item && item.type === 'consumable' && quantity > 0) charges.set(itemId, quantity);
      }
    }
  } catch (e) {
    // Fail-open: no tray rather than a broken one.
    catalog.clear();
    charges.clear();
  }
  renderTray();
}

function renderTray() {
  if (!row) return;
  // Cancel any in-flight pick whose item is now gone (e.g. last charge spent).
  if (picking && !charges.has(picking)) stopPicking();
  row.innerHTML = '';
  // Highest-value (priciest) consumables first, so the glove leads.
  const owned = [...charges.keys()].sort((a, b) => (catalog.get(b)?.price || 0) - (catalog.get(a)?.price || 0));
  for (const itemId of owned) {
    const item = catalog.get(itemId);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'store-action-btn';
    btn.title = item.target === 'self' ? item.name : `${item.name} - tap, then tap a player`;
    if (itemId === picking) btn.classList.add('store-action-armed');
    btn.textContent = iconFor(itemId);

    const badge = document.createElement('span');
    badge.className = 'store-action-count';
    badge.textContent = charges.get(itemId);
    btn.appendChild(badge);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onItemTap(itemId);
    });
    row.appendChild(btn);
  }
}

function onItemTap(itemId) {
  const item = catalog.get(itemId);
  if (!item) return;
  // Self-target gags (confetti bomb) need no picking - fire on yourself right away.
  if (item.target === 'self') {
    if (picking) stopPicking();
    fire(itemId, getMyName());
    return;
  }
  // Tapping the armed item again cancels; tapping a different one re-arms.
  if (picking === itemId) stopPicking();
  else startPicking(itemId);
}

function startPicking(itemId) {
  picking = itemId;
  document.body.classList.add('store-picking');
  toast(`Tap a player to ${catalog.get(itemId)?.name || 'hit them'}`);
  renderTray();
  // Capture phase so a tap on a player anchor is caught before the anchor's own handlers
  // (e.g. the lobby's "view card" click) fire. One listener handles both target taps and
  // tap-elsewhere-to-cancel.
  document.addEventListener('click', onPickClick, true);
  document.addEventListener('keydown', onPickKey, true);
}

function stopPicking() {
  picking = null;
  document.body.classList.remove('store-picking');
  document.removeEventListener('click', onPickClick, true);
  document.removeEventListener('keydown', onPickKey, true);
  renderTray();
}

function onPickClick(e) {
  if (!picking) return;
  // A tap on the armed tray button is handled by its own listener (re-arm/cancel).
  if (e.target.closest('.store-action-row')) return;
  const anchor = e.target.closest('[data-player]');
  const targetName = anchor && anchor.getAttribute('data-player');
  if (!targetName) {
    // Tapped empty space - cancel.
    stopPicking();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  const itemId = picking;
  stopPicking();
  fire(itemId, targetName);
}

function onPickKey(e) {
  if (e.key === 'Escape') stopPicking();
}

/** Emits the action; optimistically decrements on success, resyncs from the server either way. */
function fire(itemId, targetName) {
  if (!socket || !charges.has(itemId)) return;
  socket.emit('storeAction', { itemId, targetName }, (res) => {
    if (res && res.ok) {
      const left = (charges.get(itemId) || 1) - 1;
      if (left > 0) charges.set(itemId, left);
      else charges.delete(itemId);
      renderTray();
    } else {
      toast((res && res.error) || 'Could not do that');
    }
    // Resync against the authoritative server count (handles errors + concurrent uses).
    refresh();
  });
}

/** Plays the gag over the target's avatar (see storeFx.js). */
function playAction({ itemId, fromName, targetName }) {
  playStoreFx(layer, { itemId, fromName, targetName, icon: iconFor(itemId) });
}

let toastTimer = null;
function toast(message) {
  let box = document.getElementById('store-toast');
  if (!box) {
    box = document.createElement('div');
    box.id = 'store-toast';
    box.className = 'store-toast';
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), 1800);
}

export function initStore(nextSocket, { getMyName: nameGetter } = {}) {
  socket = nextSocket;
  if (typeof nameGetter === 'function') getMyName = nameGetter;
  if (!socket) return;
  socket.on('storeAction', playAction);
  refresh();
}

/** Re-pull the tray (call after a (re)join, in case the account's inventory changed). */
export function refreshStore() {
  refresh();
}
