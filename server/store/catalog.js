/**
 * The Store catalog: every buyable item, its price, the equip slots, and the cooldown
 * config for consumable actions. Definitions live here in code (the server/badges.js
 * pattern); the database only records who owns what (store_inventory) and what's equipped
 * (users.equipped_*). Item `id`s and equip variant keys are stable and must NEVER be
 * renamed once shipped - they're the values stored in store_inventory.item_id and the
 * equipped_* columns.
 *
 * Nothing here touches gameplay: every item is cosmetic or a transient visual gag. See
 * docs/specs/store-specs.md for the player-facing catalog and
 * docs/plans/store-implementation-plan.md for the design.
 */

// Anti-abuse timings for consumable actions, all in ms (see store-specs.md "Cooldowns"
// and "Punch-back"). Tunable live-service-style numbers.
const COOLDOWNS = {
  GAG_SLOT_MS: 5000, // how long one gag occupies its target (the longest show, ~5s); hits on a
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

const STORE_ITEMS = [
  // Permanent cosmetics - bought once, quantity stays 1, then equipped (equipping is free).
  { id: 'frame.pack', type: 'cosmetic', slot: 'frame', price: 14400, icon: '🖼️', name: 'Avatar Frame Pack', description: 'Four frames - gold, neon, flames, crown - to ring your avatar everywhere you appear.' },
  { id: 'namecolor.pack', type: 'cosmetic', slot: 'nameColor', price: 9600, icon: '🎨', name: 'Name Color & Glow', description: 'Tint and glow your name in a color of your choice.' },
  { id: 'title.pack', type: 'cosmetic', slot: 'title', price: 7200, icon: '🏷️', name: 'Vanity Title', description: 'Wear a title under your name, like "The Bluffer" or "High Roller".' },
  { id: 'podium.confetti', type: 'cosmetic', slot: 'podium', price: 18000, icon: '🎆', name: "Winner's Podium", description: 'Confetti and fireworks burst over you when you win a game.' },
  { id: 'entrance.grand', type: 'cosmetic', slot: 'entrance', price: 10800, icon: '✨', name: 'Grand Entrance', description: 'Make an animated entrance when you appear in the lobby.' },
  { id: 'boardskin.midnight', type: 'cosmetic', slot: 'boardSkin', price: 24000, icon: '🌃', name: 'Table Skin: Midnight', description: 'A premium midnight skin for the table.' },
  { id: 'stickerpack.premium', type: 'cosmetic', price: 12000, icon: '🌟', name: 'Premium Sticker Pack', description: 'Unlock a set of premium stickers in the sticker chooser.' },

  // Consumable actions - charges, spent per use, broadcast to the room as a ~1s gag.
  { id: 'taunt', type: 'consumable', target: 'other', price: 10, icon: '😂', name: 'Taunt Burst', description: "Pop a laughing burst over another player's icon." },
  { id: 'fanfare', type: 'consumable', target: 'other', price: 40, icon: '🎺', name: 'Loser Fanfare', description: 'Play a sad-trombone over another player.' },
  { id: 'confetti_bomb', type: 'consumable', target: 'self', price: 50, icon: '💣', name: 'Confetti Self-Bomb', description: 'Rain confetti on your own icon.' },
  { id: 'tomato', type: 'consumable', target: 'other', price: 80, icon: '🍅', name: 'Tomato Throw', description: "Splat a tomato on another player's icon." },
  { id: 'glove', type: 'consumable', target: 'other', price: 100, icon: '🥊', name: 'Boxing Glove', description: "Punch another player's icon. POW!" },
  { id: 'crown', type: 'consumable', target: 'other', price: 120, icon: '👑', name: 'Crown a Player', description: 'Drop a crown on another player - a nice one.' },
];

const BY_ID = new Map(STORE_ITEMS.map((i) => [i.id, i]));

function getItem(id) {
  return BY_ID.get(id) || null;
}

/** True for a buy-once cosmetic; false for a consumable (and for unknown ids). */
function isPermanent(id) {
  const item = getItem(id);
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

/** The catalog as sent to clients - every field here is already safe to expose. */
function publicCatalog() {
  return STORE_ITEMS.map((i) => ({
    id: i.id,
    type: i.type,
    name: i.name,
    icon: i.icon,
    price: i.price,
    description: i.description,
    slot: i.slot || null,
    variants: i.slot ? EQUIP_SLOTS[i.slot].variants : null,
    target: i.target || null,
  }));
}

module.exports = {
  STORE_ITEMS,
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
