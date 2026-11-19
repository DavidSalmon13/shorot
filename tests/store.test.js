'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// The store is gated on STORE_ENABLED on top of betting (BETTING_ENABLED). Both must be set
// before requiring, because each is read once at module load.
process.env.BETTING_ENABLED = 'true';
process.env.STORE_ENABLED = 'true';
const db = require('../server/db');
const store = require('../server/store');
const catalog = require('../server/store/catalog');

/** Fake pg client/pool: records every query call and returns canned results in order. */
function fakeQueryable(results = []) {
  const calls = [];
  let i = 0;
  return {
    calls,
    query: async (text, params) => {
      calls.push({ text, params });
      return results[i++] || { rows: [], rowCount: 0 };
    },
  };
}

/** Stands in for db.transaction: runs fn against a fake client sharing one call log. */
function mockTransaction(t, results = []) {
  const fake = fakeQueryable(results);
  t.mock.method(db, 'transaction', (fn) => fn(fake));
  return fake;
}

// --- isEnabled --------------------------------------------------------------------------

test('isEnabled: true when the flag is on and the database is up', (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  assert.equal(store.isEnabled(), true);
});

test('isEnabled: false when the database is down (so betting is off)', (t) => {
  t.mock.method(db, 'isEnabled', () => false);
  assert.equal(store.isEnabled(), false);
});

// --- getInventory / getEquipped ----------------------------------------------------------

test('getInventory: reads owned items with charges left', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  t.mock.method(db, 'query', async () => ({ rows: [{ item_id: 'glove', quantity: 3 }, { item_id: 'frame.pack', quantity: 1 }] }));
  assert.deepEqual(await store.getInventory(7), [
    { itemId: 'glove', quantity: 3 },
    { itemId: 'frame.pack', quantity: 1 },
  ]);
});

test('getInventory: [] without querying when the store is disabled', async (t) => {
  t.mock.method(db, 'isEnabled', () => false);
  const fake = fakeQueryable();
  t.mock.method(db, 'query', fake.query);
  assert.deepEqual(await store.getInventory(7), []);
  assert.equal(fake.calls.length, 0);
});

test('getInventory: [], never throws, when the read fails', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  t.mock.method(db, 'query', async () => {
    throw new Error('connection reset');
  });
  assert.deepEqual(await store.getInventory(7), []);
});

test('getEquipped: maps the equipped_* columns to slot keys', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  t.mock.method(db, 'query', async () => ({
    rows: [{
      equipped_frame: 'gold',
      equipped_name_color: null,
      equipped_title: 'bluffer',
      equipped_podium: null,
      equipped_board_skin: null,
      equipped_entrance: null,
    }],
  }));
  assert.deepEqual(await store.getEquipped(7), {
    frame: 'gold',
    nameColor: null,
    title: 'bluffer',
    podium: null,
    boardSkin: null,
    entrance: null,
  });
});

test('getEquipped: all-null without querying when disabled', async (t) => {
  t.mock.method(db, 'isEnabled', () => false);
  const fake = fakeQueryable();
  t.mock.method(db, 'query', fake.query);
  assert.deepEqual(await store.getEquipped(7), {
    frame: null, nameColor: null, title: null, podium: null, boardSkin: null, entrance: null,
  });
  assert.equal(fake.calls.length, 0);
});

// --- buyItem ----------------------------------------------------------------------------

test('buyItem: permanent item debits then records ownership, atomically', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = mockTransaction(t, [{ rowCount: 1 }, { rowCount: 1 }]);
  const res = await store.buyItem(42, 'frame.pack');
  assert.deepEqual(res, { ok: true });
  assert.equal(fake.calls.length, 2);
  // Ownership is claimed first (so a re-buy is caught before any debit)...
  assert.match(fake.calls[0].text, /INSERT INTO store_inventory/);
  assert.match(fake.calls[0].text, /ON CONFLICT \(user_id, item_id\) DO NOTHING/);
  // ...then the race-safe debit for the catalog price.
  assert.match(fake.calls[1].text, /UPDATE wallets SET balance = balance - \$2 WHERE user_id = \$1 AND balance >= \$2/);
  assert.deepEqual(fake.calls[1].params, [42, catalog.getItem('frame.pack').price]);
});

test('buyItem: permanent item already owned is refused, nothing charged', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = mockTransaction(t, [{ rowCount: 0 }]); // INSERT hits the conflict
  const res = await store.buyItem(42, 'frame.pack');
  assert.deepEqual(res, { ok: false, error: 'You already own that' });
  assert.equal(fake.calls.length, 1); // bailed before the debit
  assert.match(fake.calls[0].text, /INSERT INTO store_inventory/);
});

test('buyItem: too expensive is refused (debit matches no row)', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = mockTransaction(t, [{ rowCount: 1 }, { rowCount: 0 }]); // insert ok, debit fails
  const res = await store.buyItem(42, 'frame.pack');
  assert.deepEqual(res, { ok: false, error: 'Not enough tokens' });
  assert.equal(fake.calls.length, 2);
});

test('buyItem: consumable debits then increments the charge count', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = mockTransaction(t, [{ rowCount: 1 }, { rowCount: 1 }]);
  const res = await store.buyItem(42, 'glove');
  assert.deepEqual(res, { ok: true });
  assert.equal(fake.calls.length, 2);
  assert.match(fake.calls[0].text, /UPDATE wallets SET balance = balance - \$2/);
  assert.deepEqual(fake.calls[0].params, [42, catalog.getItem('glove').price]);
  assert.match(fake.calls[1].text, /INSERT INTO store_inventory/);
  assert.match(fake.calls[1].text, /DO UPDATE SET quantity = store_inventory\.quantity \+ 1/);
});

test('buyItem: too-poor consumable is refused before any inventory write', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = mockTransaction(t, [{ rowCount: 0 }]); // debit fails
  const res = await store.buyItem(42, 'glove');
  assert.deepEqual(res, { ok: false, error: 'Not enough tokens' });
  assert.equal(fake.calls.length, 1);
});

test('buyItem: unknown item is refused without touching the database', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = mockTransaction(t);
  const res = await store.buyItem(42, 'no.such.item');
  assert.deepEqual(res, { ok: false, error: 'No such item' });
  assert.equal(fake.calls.length, 0);
});

test('buyItem: no-op refusal when the store is disabled', async (t) => {
  t.mock.method(db, 'isEnabled', () => false);
  let transacted = false;
  t.mock.method(db, 'transaction', async () => {
    transacted = true;
  });
  const res = await store.buyItem(42, 'frame.pack');
  assert.deepEqual(res, { ok: false, error: 'The store is not available' });
  assert.equal(transacted, false);
});

test('buyItem: a failed transaction is swallowed into an error value, never thrown', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  t.mock.method(db, 'transaction', async () => {
    throw new Error('connection reset');
  });
  const res = await store.buyItem(42, 'frame.pack');
  assert.deepEqual(res, { ok: false, error: 'Something went wrong buying that' });
});

// --- equip ------------------------------------------------------------------------------

test('equip: an owned, valid choice is written to its slot column', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = fakeQueryable([
    { rows: [{ '?column?': 1 }] }, // owned SELECT
    { rowCount: 1 }, // UPDATE users
    { rows: [{ equipped_frame: 'gold' }] }, // getEquipped SELECT
  ]);
  t.mock.method(db, 'query', fake.query);
  const res = await store.equip(7, 'frame', 'gold');
  assert.equal(res.ok, true);
  assert.equal(res.equipped.frame, 'gold');
  assert.match(fake.calls[0].text, /SELECT 1 FROM store_inventory/);
  assert.deepEqual(fake.calls[0].params, [7, 'frame.pack']); // the pack backing the slot
  assert.match(fake.calls[1].text, /UPDATE users SET equipped_frame = \$2 WHERE id = \$1/);
  assert.deepEqual(fake.calls[1].params, [7, 'gold']);
});

test('equip: refused when the backing item is not owned', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = fakeQueryable([{ rows: [] }]); // owned SELECT finds nothing
  t.mock.method(db, 'query', fake.query);
  const res = await store.equip(7, 'frame', 'gold');
  assert.deepEqual(res, { ok: false, error: "You don't own that" });
  assert.equal(fake.calls.length, 1); // never reached the UPDATE
});

test('equip: unknown slot is refused without a query', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = fakeQueryable();
  t.mock.method(db, 'query', fake.query);
  const res = await store.equip(7, 'hat', 'gold');
  assert.deepEqual(res, { ok: false, error: 'No such slot' });
  assert.equal(fake.calls.length, 0);
});

test('equip: an invalid variant for a real slot is refused without a query', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = fakeQueryable();
  t.mock.method(db, 'query', fake.query);
  const res = await store.equip(7, 'frame', 'purple');
  assert.deepEqual(res, { ok: false, error: 'Invalid choice for that slot' });
  assert.equal(fake.calls.length, 0);
});

test('equip: a null value un-equips the slot without an ownership check', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = fakeQueryable([
    { rowCount: 1 }, // UPDATE users
    { rows: [{ equipped_frame: null }] }, // getEquipped SELECT
  ]);
  t.mock.method(db, 'query', fake.query);
  const res = await store.equip(7, 'frame', null);
  assert.equal(res.ok, true);
  assert.match(fake.calls[0].text, /UPDATE users SET equipped_frame = \$2/);
  assert.deepEqual(fake.calls[0].params, [7, null]);
});

// --- consume ----------------------------------------------------------------------------

test('consume: spends one charge, race-safe and floored at zero', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = fakeQueryable([{ rowCount: 1 }]);
  t.mock.method(db, 'query', fake.query);
  const res = await store.consume(7, 'glove');
  assert.deepEqual(res, { ok: true });
  assert.match(fake.calls[0].text, /SET quantity = quantity - 1/);
  assert.match(fake.calls[0].text, /quantity >= 1/); // can't go below zero
  assert.deepEqual(fake.calls[0].params, [7, 'glove']);
});

test('consume: out of charges returns not-ok (no row matched)', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  t.mock.method(db, 'query', async () => ({ rowCount: 0 }));
  assert.deepEqual(await store.consume(7, 'glove'), { ok: false });
});

test('consume: a cosmetic (non-consumable) is never consumable, no query', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = fakeQueryable();
  t.mock.method(db, 'query', fake.query);
  assert.deepEqual(await store.consume(7, 'frame.pack'), { ok: false });
  assert.equal(fake.calls.length, 0);
});

test('consume: no-op when disabled', async (t) => {
  t.mock.method(db, 'isEnabled', () => false);
  const fake = fakeQueryable();
  t.mock.method(db, 'query', fake.query);
  assert.deepEqual(await store.consume(7, 'glove'), { ok: false });
  assert.equal(fake.calls.length, 0);
});

test('consume: a failed write is swallowed into { ok: false }', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  t.mock.method(db, 'query', async () => {
    throw new Error('connection reset');
  });
  assert.deepEqual(await store.consume(7, 'glove'), { ok: false });
});

// --- cooldowns (pure, in-memory) --------------------------------------------------------

const { GAG_SLOT_MS, MAX_QUEUED_GAGS, PUNCHBACK_WINDOW_MS } = catalog.COOLDOWNS;

test('canAct: a fresh actor may act', () => {
  const room = {};
  assert.deepEqual(store.canAct(room, { actor: 'Ann', target: 'Bo', now: 1000 }), { ok: true, retaliating: false });
});

test('canAct: no per-actor cooldown - an actor may fire again right away at someone else', () => {
  const room = {};
  store.recordAction(room, { actor: 'Ann', target: 'Bo', now: 1000 });
  assert.equal(store.canAct(room, { actor: 'Ann', target: 'Cy', now: 1001 }).ok, true);
});

test('canAct: hits on a busy player queue up instead of being refused', () => {
  const room = {};
  store.recordAction(room, { actor: 'Ann', target: 'Bo', now: 1000 });
  // Same actor and another actor can both hit Bo straight away - they line up.
  assert.equal(store.canAct(room, { actor: 'Ann', target: 'Bo', now: 1001 }).ok, true);
  assert.equal(store.canAct(room, { actor: 'Cy', target: 'Bo', now: 1001 }).ok, true);
});

test('canAct: the queue on one player is capped, then reopens as gags finish', () => {
  const room = {};
  for (let i = 0; i < MAX_QUEUED_GAGS; i++) store.recordAction(room, { actor: 'Ann', target: 'Bo', now: 1000 });
  const full = store.canAct(room, { actor: 'Cy', target: 'Bo', now: 1000 });
  assert.equal(full.ok, false);
  assert.match(full.error, /line of hits/);
  // Other players are unaffected.
  assert.equal(store.canAct(room, { actor: 'Cy', target: 'Dot', now: 1000 }).ok, true);
  // Once the first gag has played, a slot frees up.
  assert.equal(store.canAct(room, { actor: 'Cy', target: 'Bo', now: 1000 + GAG_SLOT_MS + 1 }).ok, true);
});

test('punch-back: the hit target may retaliate at once, bypassing their own cooldown', () => {
  const room = {};
  store.recordAction(room, { actor: 'Ann', target: 'Bo', now: 1000 });
  // Bo just acted too (so is normally on cooldown), yet may hit Ann back inside the window.
  store.recordAction(room, { actor: 'Bo', target: 'Dot', now: 1500 });
  const res = store.canAct(room, { actor: 'Bo', target: 'Ann', now: 2000 });
  assert.equal(res.ok, true);
  assert.equal(res.retaliating, true);
});

test('punch-back: the free window only applies to the original attacker, and expires', () => {
  const room = {};
  store.recordAction(room, { actor: 'Ann', target: 'Bo', now: 1000 });
  // Not the attacker: Bo hitting Cy is a normal action, still on Bo's cooldown is n/a here
  // (Bo hasn't acted), but it is NOT a retaliation.
  assert.equal(store.canAct(room, { actor: 'Bo', target: 'Cy', now: 1000 }).retaliating, false);
  // After the window, hitting Ann back is a normal action again (and Bo hasn't acted, so ok
  // on cooldown, but it is not flagged as retaliation).
  const late = store.canAct(room, { actor: 'Bo', target: 'Ann', now: 1000 + PUNCHBACK_WINDOW_MS + 1 });
  assert.equal(late.retaliating, false);
});

test('canAct: a self-target action is never limited by the queue', () => {
  const room = {};
  // Ann's queue is full...
  for (let i = 0; i < MAX_QUEUED_GAGS; i++) store.recordAction(room, { actor: 'Bo', target: 'Ann', now: 1000 });
  // ...but Ann confetti-bombing herself ignores target/pair checks.
  const res = store.canAct(room, { actor: 'Ann', target: 'Ann', selfTarget: true, now: 1200 });
  assert.equal(res.ok, true);
});
