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

// The store_items row a purchase reads first, inside its transaction.
const listed = (price, active = true) => ({ rows: [{ price, active }], rowCount: 1 });

test('buyItem: reads the price from store_items, then debits and records ownership, atomically', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = mockTransaction(t, [listed(14400), { rowCount: 1 }, { rowCount: 1 }]);
  const res = await store.buyItem(42, 'frame.pack', 14400);
  assert.deepEqual(res, { ok: true });
  assert.equal(fake.calls.length, 3);
  // The real price comes from the table (locked until commit), never the in-memory listing...
  assert.match(fake.calls[0].text, /SELECT price, active FROM store_items WHERE id = \$1 FOR SHARE/);
  assert.deepEqual(fake.calls[0].params, ['frame.pack']);
  // ...then ownership is claimed (so a re-buy is caught before any debit)...
  assert.match(fake.calls[1].text, /INSERT INTO store_inventory/);
  assert.match(fake.calls[1].text, /ON CONFLICT \(user_id, item_id\) DO NOTHING/);
  // ...then the race-safe debit for the table's price.
  assert.match(fake.calls[2].text, /UPDATE wallets SET balance = balance - \$2 WHERE user_id = \$1 AND balance >= \$2/);
  assert.deepEqual(fake.calls[2].params, [42, 14400]);
});

test('buyItem: a price that changed since the player saw it is refused, nothing charged', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = mockTransaction(t, [listed(120)]);
  // The refusal refreshes the in-memory listing so the caller can send the real price back.
  const refresh = t.mock.method(db, 'query', async () => ({ rows: [] }));
  t.mock.method(console, 'warn', () => {});
  const res = await store.buyItem(42, 'glove', 100);
  assert.deepEqual(res, {
    ok: false,
    error: 'The price changed - check the new price and try again',
    catalogChanged: true,
  });
  assert.equal(fake.calls.length, 1); // bailed before any inventory write or debit
  assert.equal(refresh.mock.callCount(), 1);
  assert.match(refresh.mock.calls[0].arguments[0], /FROM store_items/);
});

test('buyItem: a missing expected price counts as a mismatch', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = mockTransaction(t, [listed(100)]);
  t.mock.method(db, 'query', async () => ({ rows: [] }));
  t.mock.method(console, 'warn', () => {});
  const res = await store.buyItem(42, 'glove');
  assert.equal(res.ok, false);
  assert.equal(res.catalogChanged, true);
  assert.equal(fake.calls.length, 1);
});

test('buyItem: an item taken off sale (or with no row) is refused, nothing charged', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  t.mock.method(db, 'query', async () => ({ rows: [] }));
  t.mock.method(console, 'warn', () => {});
  for (const row of [listed(100, false), { rows: [], rowCount: 0 }]) {
    const fake = mockTransaction(t, [row]);
    const res = await store.buyItem(42, 'glove', 100);
    assert.deepEqual(res, { ok: false, error: "That item isn't for sale right now", catalogChanged: true });
    assert.equal(fake.calls.length, 1);
  }
});

test('buyItem: permanent item already owned is refused, nothing charged', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = mockTransaction(t, [listed(14400), { rowCount: 0 }]); // INSERT hits the conflict
  const res = await store.buyItem(42, 'frame.pack', 14400);
  assert.deepEqual(res, { ok: false, error: 'You already own that' });
  assert.equal(fake.calls.length, 2); // bailed before the debit
  assert.match(fake.calls[1].text, /INSERT INTO store_inventory/);
});

test('buyItem: too expensive is refused (debit matches no row)', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = mockTransaction(t, [listed(14400), { rowCount: 1 }, { rowCount: 0 }]); // insert ok, debit fails
  const res = await store.buyItem(42, 'frame.pack', 14400);
  assert.deepEqual(res, { ok: false, error: 'Not enough tokens' });
  assert.equal(fake.calls.length, 3);
});

test('buyItem: consumable debits then increments the charge count', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = mockTransaction(t, [listed(100), { rowCount: 1 }, { rowCount: 1 }]);
  const res = await store.buyItem(42, 'glove', 100);
  assert.deepEqual(res, { ok: true });
  assert.equal(fake.calls.length, 3);
  assert.match(fake.calls[1].text, /UPDATE wallets SET balance = balance - \$2/);
  assert.deepEqual(fake.calls[1].params, [42, 100]);
  assert.match(fake.calls[2].text, /INSERT INTO store_inventory/);
  assert.match(fake.calls[2].text, /DO UPDATE SET quantity = store_inventory\.quantity \+ 1/);
});

test('buyItem: too-poor consumable is refused before any inventory write', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = mockTransaction(t, [listed(100), { rowCount: 0 }]); // debit fails
  const res = await store.buyItem(42, 'glove', 100);
  assert.deepEqual(res, { ok: false, error: 'Not enough tokens' });
  assert.equal(fake.calls.length, 2);
});

test('buyItem: an id the app has no code for is refused without touching the database', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  const fake = mockTransaction(t);
  const res = await store.buyItem(42, 'no.such.item', 10);
  assert.deepEqual(res, { ok: false, error: 'No such item' });
  assert.equal(fake.calls.length, 0);
});

test('buyItem: no-op refusal when the store is disabled', async (t) => {
  t.mock.method(db, 'isEnabled', () => false);
  let transacted = false;
  t.mock.method(db, 'transaction', async () => {
    transacted = true;
  });
  const res = await store.buyItem(42, 'frame.pack', 14400);
  assert.deepEqual(res, { ok: false, error: 'The store is not available' });
  assert.equal(transacted, false);
});

test('buyItem: a failed transaction is swallowed into an error value, never thrown', async (t) => {
  t.mock.method(db, 'isEnabled', () => true);
  t.mock.method(db, 'transaction', async () => {
    throw new Error('connection reset');
  });
  const res = await store.buyItem(42, 'frame.pack', 14400);
  assert.deepEqual(res, { ok: false, error: 'Something went wrong buying that' });
});

// --- catalog listing (in-memory copy of store_items) -------------------------------------

const row = (id, price, extra = {}) => ({ id, name: `N ${id}`, description: 'd', icon: 'i', price, active: true, sort_order: 0, ...extra });

test('catalog: listing joins store_items rows with the behaviour in code, in shop order', (t) => {
  t.mock.method(console, 'warn', () => {});
  catalog.applyRows([row('glove', 100, { sort_order: 20 }), row('frame.pack', 14400, { sort_order: 10 })]);
  const items = catalog.publicCatalog();
  assert.deepEqual(items.map((i) => i.id), ['frame.pack', 'glove']);
  const glove = items[1];
  assert.equal(glove.price, 100);
  assert.equal(glove.name, 'N glove');
  assert.equal(glove.type, 'consumable'); // from code
  assert.equal(glove.target, 'other'); // from code
  assert.equal(glove.onSale, true);
  assert.deepEqual(items[0].variants, catalog.EQUIP_SLOTS.frame.variants);
});

test('catalog: a row with no code behind it is hidden; code with no row is not sold; both logged', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  catalog.applyRows([row('glove', 100), row('mystery.box', 5)]);
  assert.deepEqual(catalog.publicCatalog().map((i) => i.id), ['glove']);
  assert.equal(catalog.getItem('mystery.box'), null);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /mystery\.box/);
  assert.match(warn.mock.calls[0].arguments[0], /frame\.pack/);
  // The same mismatch on the next refresh isn't logged again.
  catalog.applyRows([row('glove', 100), row('mystery.box', 5)]);
  assert.equal(warn.mock.callCount(), 1);
});

test('catalog: an item off sale is listed only for players who own it', (t) => {
  t.mock.method(console, 'warn', () => {});
  catalog.applyRows([row('glove', 100, { active: false }), row('pie', 90)]);
  assert.deepEqual(catalog.publicCatalog().map((i) => i.id), ['pie']);
  const mine = catalog.publicCatalog(['glove']);
  assert.deepEqual(mine.map((i) => i.id), ['glove', 'pie']);
  assert.equal(mine[0].onSale, false);
});

test('catalog: owned items stay usable before the listing ever loads', (t) => {
  t.mock.method(console, 'warn', () => {});
  catalog.applyRows([]);
  const glove = catalog.getItem('glove');
  assert.equal(glove.type, 'consumable');
  assert.equal(glove.name, 'glove'); // falls back to the id until the listing loads
});

test('catalog: loadCatalog keeps the previous listing when the read fails', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(db, 'isEnabled', () => true);
  catalog.applyRows([row('glove', 100)]);
  t.mock.method(db, 'query', async () => {
    throw new Error('connection reset');
  });
  assert.equal(await catalog.loadCatalog(), false);
  assert.equal(catalog.getItem('glove').price, 100);
});

test('catalog: the seed migration lists every item the code implements, once', () => {
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'migrations', '009_store_items.sql'), 'utf8');
  const seeded = [...sql.matchAll(/^\s+\('([^']+)',/gm)].map((m) => m[1]);
  assert.deepEqual([...seeded].sort(), catalog.ITEM_BEHAVIOUR.map((b) => b.id).sort());
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
