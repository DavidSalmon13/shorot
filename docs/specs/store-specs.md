# Store — Specs

A play-money spending layer for signed-in players: a Store where you spend the tokens you already
have on **cosmetics** (owned forever, equipped to show off) and **consumable social actions** (charges
spent per use, broadcast to the whole room as a quick visual gag — headlined by a 🥊 boxing glove that
punches another player's on-screen icon). **Never real money** — no purchases with cash, no cash-out,
no transfers of tokens between players. **Nothing in the Store changes how any game is played.**

Builds on [`betting-specs.md`](betting-specs.md) (the token wallet) and
[`accounts-specs.md`](accounts-specs.md) (Google sign-in, Player Card, stickers) — the Store spends the
same wallet betting fills, so it's invisible wherever tokens are invisible (guests, or no
database/sign-in configured).

Design, data model and rollout: [`docs/plans/store-implementation-plan.md`](../plans/store-implementation-plan.md).

## Relationship to existing games / shared app changes

- Needs accounts (`DATABASE_URL` + `GOOGLE_CLIENT_ID`), the token wallet (`BETTING_ENABLED`), **and**
  its own flag, `STORE_ENABLED` — see "Configurable constants." The wallet, balance and daily grants
  all live in the betting layer, so the Store has nothing to spend unless betting is on; `STORE_ENABLED`
  on top lets the Store ship dark and be turned on independently. Any one of the three off means no
  Store UI anywhere, the same "app behaves exactly as before" guarantee the rest of accounts gives.
- **Guests see nothing.** No Store tab, no balance, no item effects on their own screen — identical to
  how betting is invisible to guests. A guest can still be the **target** of someone else's consumable
  action (e.g. get punched) without having a wallet or ever seeing the Store.
- **Nothing affects gameplay.** Every item is cosmetic or a transient visual. No rule, timer, turn, or
  score in any game changes. A consumable's animation never covers a button, blocks a tap, or alters
  another player's turn — it plays over the top of the screen and self-resets within about a second.
  The Store is a sibling of betting, not a game: it observes nothing and decides nothing about any
  match.

## Configurable constants

| Constant | Value | Meaning |
|---|---|---|
| `STORE_ENABLED` | `'true'` to enable | Feature flag, on top of `BETTING_ENABLED` + accounts. Anything else = Store off everywhere |
| `ACTION_COOLDOWN_MS` | 10000 | One consumable action per actor per 10s (room-scoped), the main spam brake |
| `TARGET_THROTTLE_MS` | 30000 | Same actor can't hit the same target again inside 30s (anti-focus; longer than the per-actor brake so it actually bites) |
| `TARGET_INCOMING_MS` | 3000 | At most one action lands on a given target per 3s (caps pile-ons from many actors) |
| `PUNCHBACK_WINDOW_MS` | 5000 | After being hit, the target may retaliate once, free, within 5s (see "Punch-back") |

Prices live in code (`server/store/catalog.js`), on a ladder from cheap taunts to premium cosmetics —
see "The catalog." Prices, cooldowns and the item list are all live-service-style numbers, expected to
be tuned after watching real play.

## The two item types

### Permanent cosmetics

Bought once with tokens, **owned forever**, then **equipped** to show off. Buying debits tokens;
equipping is free and only allowed for an item you own. Changing nothing about gameplay, a cosmetic
decorates how **you** appear to everyone — your avatar, your name, a flourish when you arrive or win.
One item can be equipped per slot at a time (equipping a second frame replaces the first); un-equipping
is always allowed. A permanent item can't be re-bought — once owned it stays owned, even across
devices, because it hangs off your account.

### Consumable actions

Bought as **charges** (one purchase = one charge; a **Buy more** button repeats), **spent per use**.
Using one is a room-wide gag: it's broadcast to every phone in the room and plays a short animation on
the **target's** on-screen icon (wherever that player is rendered — lobby roster or in-game seat), then
resets. Charges are the economy's main **sink**: they're consumed, not a permanent unlock, so there's
always a reason to earn more tokens. Running out just means buying more; there's no cooldown on
*buying*, only on *using* (see "Cooldowns").

## The catalog

13 items in v1. Ids are stable and namespaced; prices are in tokens.

### Permanent cosmetics (7)

| Item | Price | What it does |
|---|---|---|
| **Avatar Frame Pack** | 14400 | Unlocks four decorative frames (gold, neon, flames, crown); equip one as a ring around your avatar everywhere you appear |
| **Name Color & Glow** | 9600 | Unlocks a set of name colors/glows; equip one to tint your name |
| **Vanity Title** | 7200 | Unlocks a set of titles ("The Bluffer", "High Roller", …); the equipped one shows under your name |
| **Winner's Podium** | 18000 | A confetti/fireworks burst on your icon when you win a game |
| **Grand Entrance** | 10800 | An animated flourish when you appear in the lobby roster |
| **Table Skin: Midnight** | 24000 | A premium board/table skin, applied through the app's theme layer |
| **Premium Sticker Pack** | 12000 | Unlocks a set of premium stickers in the existing sticker chooser |

Frame / Name Color / Vanity Title are "packs": buying unlocks a small family of looks, and you pick
which one is equipped. The three "ambient effect" cosmetics (Winner's Podium, Grand Entrance, Table
Skin) are deliberately lightweight in v1 — short CSS/particle effects reusing the existing reactions
and theme machinery, not a per-game rework. The Premium Sticker Pack plugs into the existing
sticker-unlock system rather than adding a parallel one.

### Consumable actions (6)

| Item | Price / charge | Target | Visual (~1s, self-resets) |
|---|---|---|---|
| 😂 **Taunt Burst** | 10 | another player | A laugh-emoji burst pops over their icon |
| 🎺 **Loser Fanfare** | 40 | another player | A sad-trombone note (and sound) over their icon |
| 💣 **Confetti Self-Bomb** | 50 | yourself | Confetti rains on your own icon |
| 🍅 **Tomato Throw** | 80 | another player | A tomato splats on their icon, drips, fades |
| 🥊 **Boxing Glove** | 100 | another player | A glove flies in and connects; the icon recoils/shakes, "POW!" + a brief black-eye, then resets |
| 👑 **Crown a Player** | 120 | another player | A crown descends onto their icon (a positive gag) |

The 🥊 boxing glove is the headline item. All the targeted ones share one flow and one animation
pipeline; only the art and sound differ.

## Buying, owning, equipping

- **Buy**: from the Store tab, tap Buy on an item you can afford. The stake is debited atomically — a
  purchase either fully happens (tokens out, item in your inventory) or not at all. Your balance pill
  updates immediately.
- **Can't afford**: Buy is refused with a short message; nothing is debited.
- **Already own a permanent item**: it shows as **Owned** / **Equip**, never Buy — you can't spend
  tokens on it twice.
- **Equip**: free, instant, for an owned item only. The equipped look appears everywhere you're shown
  — your Player Card, the lobby roster, and in-game seats — to **everyone**, not just you. Equipping a
  different item in the same slot swaps it; you can always un-equip back to plain.
- **Consumables**: buying adds a charge (Buy more to stack them). The Store shows your current charge
  count per consumable.

## Consumable actions — the flow

A consumable action is a socket event, broadcast to the room, purely visual:

1. The owner taps the item's icon (e.g. 🥊), entering **"pick a target"** mode on whatever screen
   they're on.
2. They tap a player's icon or name.
3. The client sends the action to the server.
4. The server validates: the feature is on, the actor is signed in, the actor has a charge, the target
   is in the room, and no cooldown is active (see below). If all pass, it **consumes one charge** and
   broadcasts the action to the whole room.
5. Every phone plays the animation on the target's icon — wherever that player is rendered — for about
   a second, then it resets. It never covers a button or blocks input.

If validation fails (no charge, cooldown active, target gone), nothing is consumed and the actor gets a
short message; no animation plays on anyone's screen.

### Cooldowns (anti-abuse)

Charges alone aren't enough to stop a match turning into spam, so actions are rate-limited server-side:

- **Per actor**: one action every `ACTION_COOLDOWN_MS` (10s).
- **Same actor → same target**: additionally throttled to once per `TARGET_THROTTLE_MS` (30s), so one
  player can't single out another even while acting on others. (Deliberately longer than the per-actor
  cooldown, or it would never take effect.)
- **Per target (incoming)**: at most one action lands on a given player per `TARGET_INCOMING_MS` (3s),
  regardless of who sends it, so a whole room can't pile onto one person at once.

Cooldowns are enforced on the server and are room-scoped; they reset when the room ends. They gate
*using* an action, never *buying* one.

### Punch-back

For `PUNCHBACK_WINDOW_MS` (5s) after being hit by a targeted action, the target may fire **one**
retaliation straight back at whoever hit them, **for free** (zero charges — the maximum "discount").
The retaliation bypasses the per-actor cooldown (so you can hit back even if you just acted) but still
respects the per-target incoming throttle. It's a single shot at the original attacker only; after the
window, any further action is a normal, charged action again.

## Who can see what

- **Signed-in players** see the Store tab, their balance, their inventory, and their own equipped
  cosmetics, and can buy/equip/use items.
- **Guests** see none of that — no Store, no balance, no sign that it exists. A guest **can** be the
  target of a consumable action (anyone in the room is targetable) and will see the animation play on
  everyone's screen like any other player; they just can't own, buy, or trigger anything themselves.
- **Equipped cosmetics are public**: an equipped frame/color/title/effect shows to everyone who can see
  that player, the same way a chosen sticker already does.

## Cross-cutting UX

- **Store tab**: lives on the account page as a new tab, alongside the existing rating card, stickers,
  history and badges. A grid of items showing name, icon and price, with per-item **Buy / Owned /
  Equip / Equipped** states; consumables show their owned charge count and a **Buy more** control.
- **Balance**: reflected through the existing token pill under the Shorot logo (the same readout betting
  uses); it bumps the moment a purchase debits tokens, and the Player Card refreshes with it.
- **Triggering an action**: the item's icon enters pick-a-target mode; tapping a player fires it. Works
  in the lobby and in every game, because a player's icon is rendered consistently across screens.
- **Animations**: reuse the app's existing floating-reaction layer and sound/haptic helpers, so a glove
  or tomato lands with the same polish as an emoji reaction and never interferes with gameplay chrome.

## Fail-open & enablement

- **Database down, or a write fails mid-purchase/mid-action**: fails open, the same philosophy as
  betting and game-result recording — a purchase or action that can't be written is just one that
  didn't happen. It never throws into a game, never blocks a tap, and never desyncs a match. A failed
  buy leaves tokens and inventory untouched; a failed consume plays no animation.
- **Flag off**: with `STORE_ENABLED` unset (or betting/accounts off), there is no Store tab, no action
  triggers, and no equipped-cosmetic rendering anywhere — the app behaves exactly as it did before the
  feature existed.

## Explicitly out of scope (v1)

- Any Store access, balance, or item effect for guests on their own screen (targeting them is fine).
- Real money: purchases with cash, cash value for tokens, withdrawing, or transferring tokens between
  players.
- Anything that touches gameplay: no item that changes a rule, timer, turn, score, or outcome in any
  game, and no consumable that can obstruct input.
- Gifting or trading items between players; a marketplace; refunds or selling items back for tokens.
- Item rarity tiers, randomised loot boxes, or timed/seasonal limited items.
- A purchase/usage history beyond what's visible live (current balance, inventory, charge counts).
- Admin-page visibility into the Store economy (items sold, tokens spent).
- Deep per-game plumbing for the "effect" cosmetics (real win/entrance hooks per game, a full board-
  skin theme per game) — v1 ships lightweight versions; richer ones are a candidate v2.

## Edge cases

- **Target leaves mid-action**: if the target is gone by the time the action is validated, it's
  refused and no charge is spent. If they leave during the ~1s animation, the animation simply finishes
  or is dropped on screens where they're no longer rendered — nothing to clean up.
- **Actor disconnects right after buying**: the purchase is already committed to their account (it's
  not room state), so the item is there when they reconnect, on any device.
- **Two buys race**: the debit is atomic and balance-guarded, so a player can never overspend by
  double-tapping Buy; the second either succeeds against the remaining balance or is refused.
- **Equipped item on a guest/unknown viewer**: cosmetics only render where the viewer can already see
  that player; a guest viewer sees everyone's equipped cosmetics the same as any other visible
  decoration, they just can't have their own.
- **Betting turned off later**: with the wallet gone the Store goes dark too (no balance to spend);
  owned items stay recorded and reappear if it's turned back on.
