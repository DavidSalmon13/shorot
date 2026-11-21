/**
 * The Store catalog, split in two:
 *
 * - **Behaviour, in code (this file):** which item ids the app knows how to run, and what
 *   each one does - cosmetic vs consumable, its equip slot and variants, who a consumable
 *   targets, plus the cooldown config. Adding a new item always needs code (its animation or
 *   effect), so this list is the gate on what can ever be sold.
 * - **Listing, in the database (`store_items`, migrations/009_store_items.sql):** name,
 *   description, icon, price, whether it's on sale, and its order in the shop. That table is
 *   the source of truth for anything a player sees or pays.
 *
 * The server keeps an in-memory copy of `store_items` (loaded on boot, refreshed every few
 * minutes and whenever a purchase finds it stale) and uses it only to *list* the shop. A
 * purchase never trusts this copy: server/store.js re-reads the price inside the purchase
 * transaction. Item `id`s and equip variant keys are stable and must NEVER be renamed once
 * shipped - they're the values stored in store_items.id, store_inventory.item_id and the
 * users.equipped_* columns.
 *
 * Nothing here touches gameplay: every item is cosmetic or a transient visual gag. See
 * docs/specs/store-specs.md for the player-facing catalog and
 * docs/plans/store-implementation-plan.md for the design.
 */
const db = require('../db');

// Anti-abuse timings for consumable actions, all in ms (see store-specs.md "Cooldowns"
// and "Punch-back"). Tunable live-service-style numbers.
const COOLDOWNS = {
  GAG_SLOT_MS: 6000, // how long one gag occupies its target (the longest show, ~5.6s); hits on a
  //                     busy player queue behind it and play one after another on every phone
  MAX_QUEUED_GAGS: 4, // at most this many gags playing + waiting on one player (caps pile-ons)
  PUNCHBACK_WINDOW_MS: 5000, // free retaliation window for a hit target
};

// Equip slots. `column` is the users.* column the choice is stored in; `item` is the
// catalog id that must be owned to use the slot; `variants` are the allowed equip values.
// For single-look cosmetics the item id is itself the only variant.
const EQUIP_SLOTS = {
  frame: { column: 'equipped_frame', item: 'frame.pack', variants: ['gold', 'neon', 'flames', 'crown'] },
  nameColor: { column: 'equipped_name_color', item: 'namecolor.pack', variants: ['lime', 'magenta', 'cyan', 'sunset', 'rainbow'] },
  title: { column: 'equipped_title', item: 'title.pack', variants: ['bluffer', 'high_roller', 'imposter', 'mastermind'] },
  podium: { column: 'equipped_podium', item: 'podium.confetti', variants: ['podium.confetti'] },
  boardSkin: { column: 'equipped_board_skin', item: 'boardskin.midnight', variants: ['boardskin.midnight'] },
  entrance: { column: 'equipped_entrance', item: 'entrance.grand', variants: ['entrance.grand'] },
};

// What each item does, by id. Display fields and prices live in the store_items table.
const ITEM_BEHAVIOUR = [
  // Permanent cosmetics - bought once, quantity stays 1, then equipped (equipping is free).
  { id: 'frame.pack', type: 'cosmetic', slot: 'frame' },
  { id: 'namecolor.pack', type: 'cosmetic', slot: 'nameColor' },
  { id: 'title.pack', type: 'cosmetic', slot: 'title' },
  { id: 'podium.confetti', type: 'cosmetic', slot: 'podium' },
  { id: 'entrance.grand', type: 'cosmetic', slot: 'entrance' },
  { id: 'boardskin.midnight', type: 'cosmetic', slot: 'boardSkin' },
  { id: 'stickerpack.premium', type: 'cosmetic' },

  // Consumable actions - charges, spent per use, broadcast to the room as a 3-5s gag
  // (public/js/shared/storeFx.js).
  { id: 'taunt', type: 'consumable', target: 'other' },
  { id: 'fanfare', type: 'consumable', target: 'other' },
  { id: 'confetti_bomb', type: 'consumable', target: 'self' },
  { id: 'water_balloon', type: 'consumable', target: 'other' },
  { id: 'tomato', type: 'consumable', target: 'other' },
  { id: 'pie', type: 'consumable', target: 'other' },
  { id: 'glove', type: 'consumable', target: 'other' },
  { id: 'crown', type: 'consumable', target: 'other' },
  { id: 'lightning', type: 'consumable', target: 'other' },
  { id: 'spank', type: 'consumable', target: 'other' },
];

const BEHAVIOUR_BY_ID = new Map(ITEM_BEHAVIOUR.map((i) => [i.id, i]));

// How often the in-memory copy of store_items is re-read, as a safety net for edits made
// straight in SQL. A purchase that finds the copy stale refreshes it immediately anyway.
const CATALOG_REFRESH_MS = 5 * 60 * 1000;

// id -> { id, name, description, icon, price, active, sortOrder } for every store_items row
// that has an implementation here. Empty until loadCatalog() first succeeds.
let listing = new Map();
let lastWarning = '';

/**
 * Replaces the in-memory listing with `rows` (store_items rows as pg returns them). Rows
 * with no implementation in ITEM_BEHAVIOUR are dropped, and implemented items with no row
 * are reported - both are logged once per distinct mismatch so the periodic refresh doesn't
 * spam the log. Pure apart from that log; exported for tests.
 */
function applyRows(rows) {
  const next = new Map();
  const unknown = [];
  for (const r of rows || []) {
    if (!BEHAVIOUR_BY_ID.has(r.id)) {
      unknown.push(r.id);
      continue;
    }
    next.set(r.id, {
      id: r.id,
      name: r.name,
      description: r.description || '',
      icon: r.icon || '',
      price: Number(r.price),
      active: r.active !== false,
      sortOrder: Number(r.sort_order) || 0,
    });
  }
  const unlisted = ITEM_BEHAVIOUR.filter((b) => !next.has(b.id)).map((b) => b.id);
  const warning = [
    unknown.length ? `store_items rows with no code behind them (hidden): ${unknown.join(', ')}` : '',
    unlisted.length ? `store items in code with no store_items row (not sold): ${unlisted.join(', ')}` : '',
  ].filter(Boolean).join('; ');
  if (warning && warning !== lastWarning) console.warn(`Store catalog: ${warning}`);
  lastWarning = warning;
  listing = next;
}

/**
 * Re-reads store_items into the in-memory listing. Never throws: on failure the previous
 * listing is kept (the shop shows what it showed before; purchases are unaffected because
 * they read the table themselves).
 */
async function loadCatalog() {
  if (!db.isEnabled()) return false;
  try {
    const { rows } = await db.query(
      'SELECT id, name, description, icon, price, active, sort_order FROM store_items'
    );
    applyRows(rows);
    return true;
  } catch (err) {
    console.error('Store catalog load failed:', err.message);
    return false;
  }
}

/**
 * An implemented item: its behaviour plus its current listing (name, price, ...) when the
 * listing has it. Returns behaviour alone if the listing hasn't loaded, so using an owned
 * item never depends on the cache. Null for ids the app can't run.
 */
function getItem(id) {
  const behaviour = BEHAVIOUR_BY_ID.get(id);
  if (!behaviour) return null;
  const listed = listing.get(id);
  return { ...behaviour, name: id, ...(listed || {}) };
}

/** True for a buy-once cosmetic; false for a consumable (and for unknown ids). */
function isPermanent(id) {
  const item = BEHAVIOUR_BY_ID.get(id);
  return !!item && item.type === 'cosmetic';
}

function slotConfig(slot) {
  return EQUIP_SLOTS[slot] || null;
}

/** The catalog item that must be owned to equip anything in `slot`, or null. */
function itemForSlot(slot) {
  const cfg = slotConfig(slot);
  return cfg ? cfg.item : null;
}

/** The users.* column backing `slot`, or null. Whitelist source for equip's SQL. */
function columnForSlot(slot) {
  const cfg = slotConfig(slot);
  return cfg ? cfg.column : null;
}

/** Whether `value` is an allowed equip choice for `slot`. */
function isValidEquip(slot, value) {
  const cfg = slotConfig(slot);
  return !!cfg && cfg.variants.includes(value);
}

/**
 * The shop as sent to clients, from the in-memory listing, in shop order. Items on sale are
 * always included; an item taken off sale is still included (with `onSale: false`) for a
 * player who owns it, so they can keep equipping/using it. Every field is safe to expose.
 */
function publicCatalog(ownedIds = []) {
  const owned = new Set(ownedIds);
  return [...listing.values()]
    .filter((l) => l.active || owned.has(l.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((l) => {
      const b = BEHAVIOUR_BY_ID.get(l.id);
      return {
        id: l.id,
        type: b.type,
        name: l.name,
        icon: l.icon,
        price: l.price,
        description: l.description,
        onSale: l.active,
        slot: b.slot || null,
        variants: b.slot ? EQUIP_SLOTS[b.slot].variants : null,
        target: b.target || null,
      };
    });
}

module.exports = {
  ITEM_BEHAVIOUR,
  CATALOG_REFRESH_MS,
  applyRows,
  loadCatalog,
  EQUIP_SLOTS,
  COOLDOWNS,
  getItem,
  isPermanent,
  slotConfig,
  itemForSlot,
  columnForSlot,
  isValidEquip,
  publicCatalog,
};
