/**
 * The Store: spends the betting wallet on cosmetics and consumable actions. See
 * docs/specs/store-specs.md for the player-facing rules and
 * docs/plans/store-implementation-plan.md for the design.
 *
 * Shape mirrors server/betting.js deliberately: every function here is a no-op (or returns
 * a harmless default) when the store is disabled, and nothing here ever throws into a call
 * site - a purchase or action that can't be written is just one that didn't happen, never
 * something that blocks or desyncs the actual game.
 *
 * The store reuses betting's `wallets` table and its race-safe debit, so it depends on
 * betting being enabled (that's what funds and grants wallets); STORE_ENABLED gates it on
 * top so it can ship dark. Item definitions live in ./store/catalog.js; the database only
 * records ownership (store_inventory) and equipped slots (users.equipped_*). Consumable
 * cooldown state is in-memory and room-scoped (room.state.store), exactly like betting's
 * match state - nothing about it is persisted.
 */
const db = require('./db');
const betting = require('./betting');
const {
  EQUIP_SLOTS,
  COOLDOWNS,
  getItem,
  isPermanent,
  itemForSlot,
  columnForSlot,
  isValidEquip,
  publicCatalog,
} = require('./store/catalog');

const STORE_ENABLED = process.env.STORE_ENABLED === 'true';

/** Thrown inside buyItem's transaction to roll back a debit/insert and surface a reason. */
class StoreError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** Whether the store is live: its own flag, on top of betting (which funds the wallet). */
function isEnabled() {
  return STORE_ENABLED && betting.isEnabled();
}

/** { frame, nameColor, title, podium, boardSkin, entrance }, all null. */
function emptyEquipped() {
  const out = {};
  for (const slot of Object.keys(EQUIP_SLOTS)) out[slot] = null;
  return out;
}

/** Maps a users row's equipped_* columns to the { slot: value } shape clients use. */
function equippedFromRow(row) {
  const out = {};
  for (const [slot, cfg] of Object.entries(EQUIP_SLOTS)) out[slot] = (row && row[cfg.column]) || null;
  return out;
}

// Code-controlled column list, safe to interpolate into the equipped SELECT.
const EQUIPPED_COLUMNS = Object.values(EQUIP_SLOTS).map((c) => c.column).join(', ');

/** This user's owned items as [{ itemId, quantity }] (consumables with charges left). */
async function getInventory(userId) {
  if (!isEnabled() || !userId) return [];
  try {
    const { rows } = await db.query(
      'SELECT item_id, quantity FROM store_inventory WHERE user_id = $1 AND quantity > 0',
      [userId]
    );
    return rows.map((r) => ({ itemId: r.item_id, quantity: r.quantity }));
  } catch (err) {
    console.error('Store inventory read failed:', err.message);
    return [];
  }
}

/** This user's equipped cosmetics as { slot: value }, or all-null when disabled/missing. */
async function getEquipped(userId) {
  if (!isEnabled() || !userId) return emptyEquipped();
  try {
    const { rows } = await db.query(`SELECT ${EQUIPPED_COLUMNS} FROM users WHERE id = $1`, [userId]);
    return rows[0] ? equippedFromRow(rows[0]) : emptyEquipped();
  } catch (err) {
    console.error('Store equipped read failed:', err.message);
    return emptyEquipped();
  }
}

/**
 * Buys one unit of `itemId` for `userId`, after validating the store is on, the item
 * exists, a permanent item isn't already owned, and the wallet covers the price. The debit
 * is race-safe (balance guard in the WHERE) and the inventory write happens in the same
 * transaction, so a purchase either fully happens (tokens out, item in) or not at all.
 * Returns `{ ok: true }` or `{ ok: false, error }` - every rejection is a value the client
 * shows, never a thrown exception.
 */
async function buyItem(userId, itemId) {
  if (!isEnabled()) return { ok: false, error: 'The store is not available' };
  if (!userId) return { ok: false, error: 'Sign in to buy items' };
  const item = getItem(itemId);
  if (!item) return { ok: false, error: 'No such item' };
  const permanent = isPermanent(itemId);

  try {
    await db.transaction(async (client) => {
      if (permanent) {
        // Claim ownership first; if the row already existed, it's owned - bail before any
        // debit (throwing rolls back this harmless insert attempt too).
        const ins = await client.query(
          `INSERT INTO store_inventory (user_id, item_id, quantity) VALUES ($1, $2, 1)
           ON CONFLICT (user_id, item_id) DO NOTHING`,
          [userId, itemId]
        );
        if (ins.rowCount === 0) throw new StoreError('owned');
      }
      // Race-safe debit: only succeeds if the balance still covers the price.
      const debit = await client.query(
        `UPDATE wallets SET balance = balance - $2 WHERE user_id = $1 AND balance >= $2`,
        [userId, item.price]
      );
      // Throw (not return) so a failed debit rolls back a permanent item's ownership insert.
      if (debit.rowCount === 0) throw new StoreError('poor');
      if (!permanent) {
        await client.query(
          `INSERT INTO store_inventory (user_id, item_id, quantity) VALUES ($1, $2, 1)
           ON CONFLICT (user_id, item_id) DO UPDATE SET quantity = store_inventory.quantity + 1`,
          [userId, itemId]
        );
      }
    });
  } catch (err) {
    if (err instanceof StoreError) {
      if (err.code === 'owned') return { ok: false, error: 'You already own that' };
      if (err.code === 'poor') return { ok: false, error: 'Not enough tokens' };
    }
    console.error('Store purchase failed:', err.message);
    return { ok: false, error: 'Something went wrong buying that' };
  }
  return { ok: true };
}

/**
 * Equips `value` in `slot` for `userId` (or un-equips when `value` is null/empty). Only an
 * owned item backing the slot, with a valid variant, can be equipped; equipping is free.
 * Returns `{ ok, error }` and, on success, the full equipped set.
 */
async function equip(userId, slot, value) {
  if (!isEnabled()) return { ok: false, error: 'The store is not available' };
  if (!userId) return { ok: false, error: 'Sign in to equip items' };
  const column = columnForSlot(slot);
  if (!column) return { ok: false, error: 'No such slot' };
  const equipValue = value == null || value === '' ? null : String(value);

  try {
    if (equipValue !== null) {
      if (!isValidEquip(slot, equipValue)) return { ok: false, error: 'Invalid choice for that slot' };
      const owned = await db.query(
        'SELECT 1 FROM store_inventory WHERE user_id = $1 AND item_id = $2 AND quantity > 0',
        [userId, itemForSlot(slot)]
      );
      if (!owned.rows.length) return { ok: false, error: "You don't own that" };
    }
    // `column` comes from the EQUIP_SLOTS whitelist, never user input - safe to interpolate.
    await db.query(`UPDATE users SET ${column} = $2 WHERE id = $1`, [userId, equipValue]);
  } catch (err) {
    console.error('Store equip failed:', err.message);
    return { ok: false, error: 'Could not equip that' };
  }
  return { ok: true, equipped: await getEquipped(userId) };
}

/**
 * Spends one charge of consumable `itemId` for `userId`. Race-safe (the quantity guard is
 * in the WHERE, and the DB CHECK forbids going negative), so a charge can never drop below
 * zero even under concurrent uses. Returns `{ ok }` - false when disabled, not a consumable,
 * out of charges, or the write failed; never throws.
 */
async function consume(userId, itemId) {
  if (!isEnabled() || !userId) return { ok: false };
  const item = getItem(itemId);
  if (!item || item.type !== 'consumable') return { ok: false };
  try {
    const res = await db.query(
      `UPDATE store_inventory SET quantity = quantity - 1
        WHERE user_id = $1 AND item_id = $2 AND quantity >= 1`,
      [userId, itemId]
    );
    return { ok: res.rowCount === 1 };
  } catch (err) {
    console.error('Store consume failed:', err.message);
    return { ok: false };
  }
}

// --- Consumable-action cooldowns (in-memory, room-scoped; see store-specs.md) ---------------

/** The room's store namespace, lazily created so callers never touch undefined. */
function storeState(room) {
  if (!room.state) room.state = {};
  if (!room.state.store) {
    room.state.store = {
      lastActionAt: {}, // actor -> ts of their last action
      lastPairAt: {}, // "actor->target" -> ts
      lastTargetAt: {}, // target -> ts it was last hit by anyone
      punchback: {}, // target -> { from, until } a free retaliation it's owed
    };
  }
  return room.state.store;
}

/**
 * Whether `actor` may fire a consumable action at `target` right now, honoring the three
 * cooldowns (D4) and the punch-back exception (D5). `selfTarget` actions (e.g. a confetti
 * self-bomb) skip the per-target/per-pair checks and only respect the per-actor rate limit.
 * `now` is injectable for tests. Pure: does NOT record anything - call recordAction on a
 * landed action. Returns `{ ok, retaliating }` or `{ ok: false, error }`.
 */
function canAct(room, { actor, target, selfTarget = false, now = Date.now() }) {
  const s = storeState(room);

  // A target hit recently is owed one free shot back at whoever hit them, within the window.
  const owed = s.punchback[actor];
  const retaliating = !selfTarget && !!owed && owed.from === target && now <= owed.until;

  // `?? -Infinity` is the "never happened" sentinel: never-seen keys read as infinitely
  // long ago, so a first action is always clear (a plain `|| 0` would wrongly gate the
  // first ~10s of wall-clock epoch, and breaks small test timestamps).
  if (!retaliating) {
    const sinceAction = now - (s.lastActionAt[actor] ?? -Infinity);
    if (sinceAction < COOLDOWNS.ACTION_COOLDOWN_MS) {
      return { ok: false, error: 'Wait a moment before your next move' };
    }
  }
  if (!selfTarget) {
    const sinceTarget = now - (s.lastTargetAt[target] ?? -Infinity);
    if (sinceTarget < COOLDOWNS.TARGET_INCOMING_MS) {
      return { ok: false, error: `${target} was just hit - give them a second` };
    }
    if (!retaliating) {
      const sincePair = now - (s.lastPairAt[`${actor}->${target}`] ?? -Infinity);
      if (sincePair < COOLDOWNS.TARGET_THROTTLE_MS) {
        return { ok: false, error: `You just got ${target} - pick someone else` };
      }
    }
  }
  return { ok: true, retaliating };
}

/**
 * Records a landed action's timestamps and opens a punch-back window for the target. Call
 * exactly once, after canAct passed and the charge was consumed. A retaliation consumes the
 * actor's own owed window rather than being throttled.
 */
function recordAction(room, { actor, target, selfTarget = false, retaliating = false, now = Date.now() }) {
  const s = storeState(room);
  s.lastActionAt[actor] = now;
  if (!selfTarget) {
    s.lastTargetAt[target] = now;
    s.lastPairAt[`${actor}->${target}`] = now;
    // The target may now hit `actor` back for free within the window.
    s.punchback[target] = { from: actor, until: now + COOLDOWNS.PUNCHBACK_WINDOW_MS };
  }
  if (retaliating) delete s.punchback[actor];
}

module.exports = {
  isEnabled,
  getInventory,
  getEquipped,
  equippedFromRow,
  emptyEquipped,
  buyItem,
  equip,
  consume,
  canAct,
  recordAction,
  storeState,
  publicCatalog,
  COOLDOWNS,
};
