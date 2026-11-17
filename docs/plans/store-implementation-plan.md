# Store — Implementation Plan

Status: **planned** (not yet built). Player-facing rules live in
[`docs/specs/store-specs.md`](../specs/store-specs.md); this document covers the why, the design, the
data model, and the build order. It mirrors [`betting-implementation-plan.md`](betting-implementation-plan.md),
which it sits directly alongside — the Store spends the same wallet betting fills.

---

## 1. Goal

Give the play-money token economy a **sink**. Betting fills wallets; nothing meaningful spends them (the
betting spec even lists "a cosmetic shop for tokens" as out of scope). The Store is that shop: signed-in
players spend tokens on **permanent cosmetics** (owned forever, equipped to show off) and **consumable
social actions** (charges spent per use, broadcast to the room as a ~1s visual gag, headlined by a 🥊
boxing glove). It reuses the betting wallet, the accounts identity/sticker plumbing, and the reactions/
theme machinery, and it holds the same guarantees: signed-in-only, never real money, nothing touches
gameplay, fail-open, flag-gated.

### Non-goals (for now)

- No real money in any form (purchase, cash-out, transfer, gifting, trading, resale).
- No item that changes a rule/timer/turn/score/outcome, and no animation that can obstruct input.
- No loot boxes, rarity tiers, or seasonal/limited items.
- No purchase/usage history beyond live balance + inventory; no admin-page economy view.
- No deep per-game hooks for the "effect" cosmetics in v1 (see D6).

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| **D1** | **Enablement = `STORE_ENABLED === 'true' && betting.isEnabled()`.** New env flag, AND-ed with the betting layer (which itself requires accounts). | The wallet, balance and grants live in `betting.js`; the Store has nothing to spend without them. A separate flag lets the Store ship dark and be flipped on independently of betting. |
| **D2** | **Equip storage = nullable `equipped_*` columns on `users`** (not a `user_equipped` table). | Identical in shape/lifecycle to the existing `users.sticker` column: one equipped choice per slot, part of identity, already read on every auth lookup (`userFromRequest`) and surfaced via `publicUser`/`selfUser`. A fixed, small slot set makes columns simpler (no join, rides the existing user SELECT). A table is more extensible but buys nothing today. |
| **D3** | **Catalog in code** (`server/store/catalog.js`), DB tracks ownership only. | Mirrors `server/badges.js`: a flat array keyed by stable, namespaced string ids (never renamed once shipped). Adding/repricing an item is a code edit, no migration. |
| **D4** | **Cooldowns enforced server-side, config in `catalog.js`, state in `room.state.store` (in-memory, ephemeral).** `ACTION_COOLDOWN_MS=10000`, `TARGET_THROTTLE_MS=30000` (longer than the per-actor brake so the anti-focus rule actually bites), `TARGET_INCOMING_MS=3000`. | Charges alone don't stop spam; cooldowns do. Room-scoped in-memory state mirrors `room.state.betting` — nothing persisted, clears with the room. |
| **D5** | **Punch-back**: `PUNCHBACK_WINDOW_MS=5000` free single retaliation at the attacker; bypasses per-actor cooldown, respects per-target incoming throttle. | "Free" (0 charges) is the cleanest reading of the brief's "discounted charge" without fractional charges. Kept tightly scoped (one shot, attacker only) so it can't chain. |
| **D6** | **The 3 "effect" cosmetics ship lightweight**: Winner's Podium, Grand Entrance, Table Skin as CSS/particle effects reusing `reactions.js` + the Afterglow theme layer. | Real per-game win/entrance hooks and a full per-game board theme are a large subproject; the catalog stays at 13 with v1-grade effects, richer ones deferred. |

---

## 3. Architecture

```
  phone (account page + lobby/game screens)
    │  GET/POST /api/store/*            socket: storeAction
    ▼                                       ▼
  server/accounts.js routes            server/lobby.js handler
    │  (buy / equip / read)               │  (consume + broadcast)
    └──────────────┬──────────────────────┘
                   ▼
            server/store.js  ──uses──▶  server/store/catalog.js  (items, prices, cooldowns)
                   │  isEnabled / buyItem / equip / consume / getInventory / getEquipped
                   ▼
            Postgres:  wallets (betting)  +  store_inventory  +  users.equipped_*
```

**Principles (carried from betting.js):**

- `store.js` only knows `userId`s. Translating a `userId` ↔ a room player name, and pushing socket
  toasts, is the caller's / `ctx.store`'s job — exactly as `ctx.betting` wraps `betting.js`.
- Every exported function **no-ops with a harmless default when disabled** and **never throws into a
  call site**: every DB call is `try/catch` → `console.error` → swallow; every rejection is a returned
  `{ ok, error }` value or `0`/`[]`/`null`.
- A purchase is a **race-safe debit + an inventory upsert inside one `db.transaction`**, the same shape
  as `placeGlobalBet`.
- Ownership is the only thing in the DB; item definitions are code.

### Files

| File | Role | New? |
|---|---|---|
| `migrations/007_store.sql` | `store_inventory` table + `users.equipped_*` columns | new |
| `server/store/catalog.js` | `STORE_ITEMS` catalog, prices, cooldown config, `publicItem`, helpers | new |
| `server/store.js` | Economy module: `isEnabled`, `getInventory`, `getEquipped`, `buyItem`, `equip`, `consume`, cooldown checks | new |
| `server.js` | `ctx.store` wrapper block (mirrors `ctx.betting`); nothing else moves | edit |
| `server/accounts.js` | `/api/store` routes; extend `userFromRequest` SELECT + `publicUser`/`selfUser` with equipped cosmetics | edit |
| `server/lobby.js` | `storeAction` socket handler; resolve equipped cosmetics onto the room player record on join | edit |
| `public/account.html` + `public/js/account-page.js` | Store tab (new tab bar) + `renderStore()` | edit |
| `public/js/shared/storeActions.js` | Pick-target flow + action animations | new |
| `public/js/shared/` avatar helper | `decoratePlayerAvatar(el, {name, cosmetics})` shared by lobby + game seat renderers | new |
| `public/theme-afterglow.css` | Equipped-cosmetic + action-animation styling (zero-specificity `:where(...)`) | edit |
| `tests/store.test.js` | Server unit tests mirroring `tests/games/betting.test.js` | new |

---

## 4. Data model (`migrations/007_store.sql`)

New table only + additive columns; nothing existing is rewritten. Mirrors `004_betting.sql`
conventions (`REFERENCES users(id) ON DELETE CASCADE`, `CHECK` constraints, identity PKs where needed).

```sql
-- Store ownership. Item catalog lives in code (server/store/catalog.js); this only
-- records who owns what. One row per (user, item). Permanent items stay quantity 1
-- and can't be rebought; consumables increment on buy, decrement on use.
CREATE TABLE store_inventory (
  user_id      BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id      TEXT    NOT NULL,                       -- matches a catalog id
  quantity     INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

-- Equipped cosmetics: one choice per slot, mirroring users.sticker. NULL = nothing
-- equipped in that slot. Values are a catalog item id or a variant key, validated at
-- equip time as "the backing item is owned."
ALTER TABLE users ADD COLUMN equipped_frame       TEXT;
ALTER TABLE users ADD COLUMN equipped_name_color  TEXT;
ALTER TABLE users ADD COLUMN equipped_title       TEXT;
ALTER TABLE users ADD COLUMN equipped_podium      TEXT;
ALTER TABLE users ADD COLUMN equipped_board_skin  TEXT;
ALTER TABLE users ADD COLUMN equipped_entrance    TEXT;
```

Invariants: `quantity >= 0` (DB-enforced, so `consume` can never drive it negative even on a race);
`ON DELETE CASCADE` so deleting an account wipes its inventory; equipped slots are plain nullable
columns that ride along on the existing identity SELECT.

The **wallet is reused as-is** — `store.js` debits/credits the same `wallets` table with the same
race-safe pattern; no wallet schema change.

---

## 5. Module layout & API

### `server/store/catalog.js`

- `STORE_ITEMS`: flat array, each `{ id, type: 'cosmetic'|'consumable', slot?, variants?, name, icon,
  price, description }`. Stable namespaced ids (`frame.pack`, `glove`, …).
- Cooldown/window constants (D4/D5) exported for `store.js` and tests.
- `getItem(id)`, `isPermanent(id)`, `slotFor(id)`, `publicItem(item)` (client-safe view, no server-only
  fields) — the `badges.js` `publicBadge` pattern.

### `server/store.js`

Shaped like `betting.js`:

- `isEnabled()` → `STORE_ENABLED === 'true' && betting.isEnabled()`.
- `getInventory(userId)` → `[{ itemId, quantity }]` (or `[]` disabled/error).
- `getEquipped(userId)` → `{ frame, nameColor, title, podium, boardSkin, entrance }` (or empty).
- `buyItem(userId, itemId)` → `{ ok, error }`. Validate (enabled → item exists → permanent-not-owned →
  affordable), then in one `db.transaction`: race-safe debit
  `UPDATE wallets SET balance = balance - $2 WHERE user_id = $1 AND balance >= $2` (rowCount 0 ⇒
  insufficient) + inventory upsert (`ON CONFLICT (user_id,item_id) DO NOTHING` for permanent,
  `… DO UPDATE SET quantity = store_inventory.quantity + 1` for consumable).
- `equip(userId, slot, value)` → `{ ok, error }`. Owned-only (and valid variant for pack slots);
  `UPDATE users SET equipped_<slot> = $2 WHERE id = $1`. `value = null` un-equips.
- `consume(userId, itemId)` → `{ ok }`. Race-safe `UPDATE store_inventory SET quantity = quantity - 1
  WHERE user_id = $1 AND item_id = $2 AND quantity >= 1` (rowCount 0 ⇒ no charge, nothing happens).
- Cooldown helpers operating on `room.state.store` timestamps (D4): `canAct(room, actor, target, now)`
  and a record-on-success step; pure, in-memory, testable without a DB.

### `ctx.store` (in `server.js`)

Thin wrappers mirroring `ctx.betting` (lines ~157-200): expose `isEnabled`, `getInventory`,
`getEquipped`, `buyItem`, `equip`, `consume`, and a `resolveEquippedFor(userId)` used when stamping the
room player record. Keeps `store.js` free of room/socket knowledge.

### Routes (in `server/accounts.js`, registered at `server.js:75`)

- `GET /api/store` → `{ enabled, items: [publicItem…], inventory, equipped, balance }` for the signed-in
  user (guest/disabled ⇒ `{ enabled: false }`).
- `POST /api/store/buy { itemId }` → `{ ok, error? , balance, inventory }`.
- `POST /api/store/equip { slot, value }` → `{ ok, error?, equipped }`.
- Extend `userFromRequest`'s SELECT to pull the `equipped_*` columns, and `publicUser`/`selfUser`
  (`accounts.js:536-543`) to carry them, so **equipped cosmetics are available wherever a player's
  identity is shown**. `/api/me` keeps returning `balance` unchanged.

### Socket (in `server/lobby.js`)

- `storeAction { itemId, targetName }`: validate feature on → actor signed in
  (`room.players.get(socket.data.name).userId`) → actor has a charge → target in room → cooldowns clear
  (D4/D5). On pass: `store.consume()` then `io.to(roomCode).emit('storeAction', { itemId, fromName,
  targetName })`. Cross-game and lobby-wide because it's shared plumbing, not a game module.
- On join, resolve `store.getEquipped(userId)` onto the in-room `player` record (like `player.sticker`)
  and include it in the lobby broadcast and game payloads.

---

## 6. Flows

**6.1 Buy** — client POSTs `/api/store/buy` → `store.buyItem` validates + atomic debit/upsert → response
carries new balance + inventory → client calls `setTokenBalance` + re-renders the Store grid +
`refreshCard`.

**6.2 Equip** — client POSTs `/api/store/equip` → `store.equip` (owned-only) → response carries new
`equipped` → client re-renders grid states and the player's own card; the change reaches other players
on the next identity broadcast.

**6.3 Render equipped** — equipped cosmetics ride on the room player record; `decoratePlayerAvatar`
toggles cosmetic classes on the per-player anchor (avatar el, name span) in both `renderLobby`
(`main.js`) and each game's seat renderer; the Afterglow theme layer styles those classes. Premium
stickers plug into the existing sticker-lock set.

**6.4 Consumable action + cooldown + punch-back** — owner taps item → pick-target mode → taps a player →
`storeAction` emitted → server validates + cooldowns + `consume` → room-wide broadcast → every client
plays the animation on the target's anchor via `storeActions.js` (reactions-layer model) → self-resets.
Target gets a 5s free-retaliation window (D5).

**6.5 Enablement / guests** — all routes and the handler return disabled/ignore when `store.isEnabled()`
is false or the caller is a guest; the Store tab and action triggers never render for guests; a guest
can still be a `targetName` and sees broadcast animations like anyone else.

---

## 7. Client

- **Store tab**: the account page is a single scroll today, so introduce a tab bar mirroring
  `admin.html`'s pattern (`data-tab` buttons, `#tab-*` panels, `.active`/`.hidden`, a `switchTab` with a
  per-tab render). `#tab-store` + `renderStore()` wired into `account-page.js`'s `render()`. Grid items
  show name/icon/price with **Buy / Owned / Equip / Equipped**; consumables show charge count + **Buy
  more**. Balance flows through the existing `setTokenBalance` + `refreshCard`.
- **Equipped rendering**: the shared `decoratePlayerAvatar` helper + theme-layer CSS; never fork
  `style.css`.
- **Action animations**: `public/js/shared/storeActions.js` (`initStore(socket)`, `playAction`,
  pick-target mode) modeled on `reactions.js` (`#reaction-float-layer`, `spawnFloat`) + `fx.js`
  `sfx`/`haptics`. One pipeline, per-item art/sound.
- Module style matches the app: shared modules export an `init*(…, socket)`; the Store grid follows the
  account page's existing `render*` idiom.

---

## 8. Configuration

| Variable | Effect |
|---|---|
| `STORE_ENABLED` | `'true'` turns the Store on (on top of `BETTING_ENABLED` + accounts). Anything else ⇒ Store off everywhere, app unchanged. |

No other config; prices and cooldowns are code constants in `catalog.js` (D3/D4).

---

## 9. The three build steps

Each is **one commit**, leaves the app working, is shippable behind the flag, and ends in a reviewable
pause.

**Step 1 — Backend / data layer (no UI).** `007_store.sql`, `catalog.js`, `store.js`, `ctx.store`,
`/api/store` routes + identity-SELECT extension, `tests/store.test.js`. Done when `npm test` is green.

**Step 2 — Store tab + permanent cosmetics.** Account-page tab bar + `renderStore()` (buy/own/equip);
`decoratePlayerAvatar` shared helper; equipped-cosmetic rendering across lobby + at least one game; the
3 lightweight effect cosmetics; premium sticker pack wired to the sticker-lock system; theme-layer CSS.

**Step 3 — Consumable actions + the glove.** `storeAction` handler in `lobby.js` (consume + broadcast +
cooldowns + punch-back); `storeActions.js` pick-target flow and animations for all six consumables,
landing consistently on the shared avatar anchor across lobby and in-game screens.

---

## 10. Testing plan

- **Server unit tests (`tests/store.test.js`, mirror `betting.test.js`)**: set
  `process.env.STORE_ENABLED='true'` before require; mock `db` with `t.mock.method` + a `fakeQueryable`.
  Cover: `buyItem` affordable / too-expensive / already-owned (permanent) / disabled; the atomic debit
  (balance-guard rowCount path); consumable upsert increments; `consume` can't go below zero; cooldown
  helper enforcement (per-actor, same-actor→target, per-target incoming) and the punch-back window;
  every function's **disabled = no query** and **write-fails = swallowed/harmless default** paths.
- **Not covered by the suite** (per repo convention): the client, the lobby socket glue, and
  persistence. Verify those manually in a browser (`/verify`): sign in → Store → buy a cosmetic → equip
  → see it in lobby and in a game → buy glove charges → punch another player → confirm the icon reacts
  **on every phone** + balance debits + pill updates → confirm a **guest** sees none of it but **can be
  punched** → one disconnect/reconnect mid-session with nothing desyncing → confirm punch-back lands in
  its window. Finally confirm **flag off** ⇒ no Store UI anywhere, app exactly as before.

---

## 11. Known limitations (accepted for v1)

- The "effect" cosmetics are lightweight (D6); no real per-game win/entrance hook or full board theme.
- No history/receipts beyond live balance + inventory; no admin economy view.
- Cooldown state is in-memory and room-scoped — a server restart resets it (same tradeoff as betting's
  in-memory match state).
- Minting/removal: buying removes tokens from circulation (a sink), reinforcing betting's intended slow
  downward drift; no tokens are minted by the Store.

---

## 12. Build checklist

**Step 1 — backend**
- [ ] `migrations/007_store.sql`: `store_inventory` + `users.equipped_*`
- [ ] `server/store/catalog.js`: `STORE_ITEMS` (13), prices, cooldown config, `publicItem`, helpers
- [ ] `server/store.js`: `isEnabled`, `getInventory`, `getEquipped`, `buyItem`, `equip`, `consume`, cooldown helpers
- [ ] `ctx.store` in `server.js`
- [ ] `/api/store`, `/api/store/buy`, `/api/store/equip`; extend identity SELECT + `publicUser`/`selfUser`
- [ ] `tests/store.test.js` green; `npm test` green

**Step 2 — store tab + cosmetics**
- [ ] Account-page tab bar + `#tab-store` + `renderStore()`
- [ ] Buy / Owned / Equip / Equipped states; consumable charge counts + Buy more
- [ ] `decoratePlayerAvatar` shared helper; equipped rendering in lobby + a game
- [ ] 3 lightweight effect cosmetics; premium sticker pack via sticker-lock
- [ ] Theme-layer CSS only (no `style.css` fork); balance via `setTokenBalance` + `refreshCard`

**Step 3 — consumables + glove**
- [ ] `storeAction` handler in `lobby.js`: consume + broadcast + cooldowns + punch-back
- [ ] `storeActions.js`: pick-target + animations for all 6 consumables across screens
- [ ] Manual `/verify` pass; flag-off check
