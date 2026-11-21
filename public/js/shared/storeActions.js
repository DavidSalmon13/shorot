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
import { setTokenBalance } from './tokens.js';

const row = document.getElementById('store-action-row');
const layer = document.getElementById('store-fx-layer');

let socket = null;
let getMyName = () => null;
const catalog = new Map(); // itemId -> public catalog item (icon, name, target, ...)
const charges = new Map(); // itemId -> quantity owned (consumables with a charge left)
let picking = null; // itemId awaiting a target tap, or null when not in pick-target mode
let signedIn = false; // whether /api/store said this player can buy (signed in, store on)
let balance = 0; // token balance from /api/store (for the in-game shop's Buy buttons)
// In-game shop: a game (Bluff, while the table is up) can switch on a 🛒 button at the
// start of the tray that drops down the consumables, so players buy mid-game instead of
// leaving for the account page. Bought charges land straight in the tray to use.
let shopEnabled = false;
let shopOpen = false;
let buying = null; // itemId whose purchase is in flight

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
    signedIn = !!(data && data.enabled && data.signedIn);
    balance = (data && data.balance) || 0;
    if (signedIn) {
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
    signedIn = false;
  }
  renderTray();
}

function renderTray() {
  if (!row) return;
  // Cancel any in-flight pick whose item is now gone (e.g. last charge spent).
  if (picking && !charges.has(picking)) stopPicking();
  row.innerHTML = '';
  if (shopEnabled && signedIn) {
    row.appendChild(shopButton());
    if (shopOpen) row.appendChild(shopPanel());
  } else {
    shopOpen = false;
  }
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

function shopButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'store-action-btn store-shop-btn' + (shopOpen ? ' store-action-armed' : '');
  btn.title = 'Shop';
  btn.setAttribute('aria-label', 'Shop');
  btn.setAttribute('aria-expanded', String(shopOpen));
  btn.textContent = '🛒';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (picking) stopPicking();
    setShopOpen(!shopOpen);
  });
  return btn;
}

/** The drop-down list of consumables (icon, name, price, owned count, Buy). */
function shopPanel() {
  const panel = document.createElement('div');
  panel.className = 'store-shop-panel';
  panel.addEventListener('click', (e) => e.stopPropagation());

  const head = document.createElement('div');
  head.className = 'store-shop-head';
  const title = document.createElement('span');
  title.textContent = 'Shop';
  const bal = document.createElement('span');
  bal.className = 'store-shop-balance';
  bal.textContent = `🪙 ${balance.toLocaleString()}`;
  head.append(title, bal);
  panel.appendChild(head);

  const items = [...catalog.values()].filter((i) => i.type === 'consumable').sort((a, b) => b.price - a.price);
  for (const item of items) {
    const line = document.createElement('div');
    line.className = 'store-shop-item';

    const icon = document.createElement('span');
    icon.className = 'store-shop-icon';
    icon.textContent = item.icon;

    const info = document.createElement('div');
    info.className = 'store-shop-info';
    const name = document.createElement('div');
    name.className = 'store-shop-name';
    name.textContent = item.name;
    const owned = document.createElement('div');
    owned.className = 'store-shop-owned';
    const n = charges.get(item.id) || 0;
    owned.textContent = n ? `You have ${n}` : item.description;
    info.append(name, owned);

    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'store-shop-buy';
    buy.textContent = buying === item.id ? '…' : `🪙 ${item.price}`;
    buy.disabled = !!buying || balance < item.price;
    buy.addEventListener('click', () => buyItem(item.id));

    line.append(icon, info, buy);
    panel.appendChild(line);
  }
  return panel;
}

async function buyItem(itemId) {
  if (buying) return;
  buying = itemId;
  renderTray();
  try {
    const res = await fetch('/api/store/buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId }),
    });
    const data = await res.json();
    if (data && data.ok) {
      balance = data.balance;
      setTokenBalance(balance);
      const row = (data.inventory || []).find((r) => r.itemId === itemId);
      if (row && row.quantity > 0) charges.set(itemId, row.quantity);
      toast(`Bought ${catalog.get(itemId)?.name || 'it'} - tap its icon to use it`);
    } else {
      toast((data && data.error) || 'Could not buy that');
    }
  } catch (e) {
    toast('Could not buy that, check your connection');
  }
  buying = null;
  renderTray();
}

function setShopOpen(open) {
  shopOpen = open;
  if (open) document.addEventListener('click', onOutsideShopClick);
  else document.removeEventListener('click', onOutsideShopClick);
  renderTray();
}

function onOutsideShopClick(e) {
  if (!e.target.closest('.store-action-row')) setShopOpen(false);
}

function onItemTap(itemId) {
  if (shopOpen) setShopOpen(false);
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
function playAction({ itemId, fromName, targetName, bodies, video }) {
  playStoreFx(layer, { itemId, fromName, targetName, bodies, video, icon: iconFor(itemId) });
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

/** A game turns the in-game 🛒 shop on while its table is up (and off when it isn't). */
export function setInGameShop(on) {
  on = !!on;
  if (on === shopEnabled) return;
  shopEnabled = on;
  if (!on && shopOpen) setShopOpen(false);
  else renderTray();
}

/** Re-pull the tray (call after a (re)join, in case the account's inventory changed). */
export function refreshStore() {
  refresh();
}
