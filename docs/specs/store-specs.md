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
| `GAG_SLOT_MS` | 6000 | How long one gag occupies its target; hits on a busy player queue behind it |
| `MAX_QUEUED_GAGS` | 4 | At most 4 gags playing + waiting on one player; more are refused until the line shortens |
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

18 items (13 in v1, plus the Water Balloon, Pie, Lightning, Do the Dishes and Spanking gags). Ids are stable and namespaced; prices are in tokens.

### Permanent cosmetics (7)

| Item | Price | What it does |
|---|---|---|
| **Avatar Frame Pack** | 14400 | Unlocks four animated frames (shimmering gold, pulsing neon, flickering flames with a 🔥, a bobbing 👑 crown); equip one as a thick glowing ring around your avatar everywhere you appear |
| **Name Color & Glow** | 9600 | Unlocks a set of bold, strongly glowing name colors (rainbow flows); equip one to color your name |
| **Vanity Title** | 7200 | Unlocks a set of titles ("The Bluffer", "High Roller", …); the equipped one shows next to your name as a shining gold plaque |
| **Winner's Podium** | 18000 | When you win a game, every phone in the room gets a full-screen celebration: confetti rain, fireworks, "🏆 <name> wins!", and your row pulses gold. A ▶ Preview button on the Store card plays it locally |
| **Grand Entrance** | 10800 | When you join, every phone in the room gets a full-screen "✨ Grand Entrance ✨ <name> has arrived" moment (spotlight, sparkle burst, your name color + title), and your lobby row glows; at most once per 30 seconds per player. A ▶ Preview button on the Store card plays it locally |
| **Table Skin: Midnight** | 24000 | A deep night-sky backdrop with a star field behind the panels (personal: only the owner sees it) |
| **Premium Sticker Pack** | 12000 | Unlocks a set of premium stickers in the existing sticker chooser |

Frame / Name Color / Vanity Title are "packs": buying unlocks a small family of looks, and you pick
which one is equipped. Everything in the store is meant to be noticed across the room: Winner's Podium and
Grand Entrance are room-wide moments the server broadcasts as `cosmeticEffect` (`server.js`
recordGameResult, `server/lobby.js` announceEntrance) and `public/js/shared/cosmeticEffects.js`
plays on every phone; frames, name colors and titles are animated. Table Skin stays personal. The Premium Sticker Pack plugs into the existing
sticker-unlock system rather than adding a parallel one.

### Consumable actions (11)

| Item | Price / charge | Target | Show (self-resets) |
|---|---|---|---|
| 😂 **Taunt Burst** | 10 | another player | ~3s: a giant laughing face wobbles over their icon, laugh emojis fly out, a bouncing "HA HA HA!", a laugh sound; their icon shakes |
| 🎺 **Loser Fanfare** | 40 | another player | ~4s: a trumpet blows droopy notes at them, a rain cloud drips over their greyed-out, drooping icon, sad trombone |
| 💣 **Confetti Self-Bomb** | 50 | yourself | ~4s: a fizzing bomb lands on your icon, a flash + shockwave + 💥, 60 pieces of confetti burst across the screen; your icon glows |
| 🍅 **Tomato Throw** | 80 | another player | ~5s: a tomato is lobbed in an arc and splats, juice flies, a red splat with drips stays on their icon; their icon shakes |
| 🥊 **Boxing Glove** | 100 | another player | ~4.5s: a glove winds up and smashes in with an impact flash and a comic "POW!", then dizzy stars orbit their head and a 🩹 stays on; their icon wobbles |
| 👑 **Crown a Player** | 120 | another player | ~5s: a golden halo, a crown floats down and sits on their icon with sparkles, a royal fanfare; their icon glows |
| 💦 **Water Balloon** | 60 | another player | ~4.5s: a wobbly balloon is lobbed in and bursts in a splash ring and droplets; their icon turns blue and shivers, drips and a puddle stay |
| 🥧 **Pie in the Face** | 90 | another player | ~5s: a pie flies in and smacks flat; a blob of cream with a cherry slowly slides down their icon and drips off |
| ⚡ **Lightning Strike** | 150 | another player | ~4.5s: a storm cloud, the whole screen flashes, a bolt strikes with "ZAP!" and sparks; their icon is left charred and smoking, with thunder |
| 🧽 **Go Do the Dishes!** | 200 | another player | ~8.4s, the longest gag, in two acts with the **players' own photos**: the sender's photo pops out of their icon (or walks in from the edge if they're not on screen) and stomps over to the target, red-faced with a pulsing 💢 and steam, points 👉 and yells "GO DO THE DISHES!!!", then storms off. Then, under a dim spotlight, the target's photo pops up behind a sink, grows stick arms and scrubs a grimy plate with a sponge while bubbles rise; one plate a second goes from the dirty stack to the clean one with a ✨ and a clink |
| 🍑 **Spanking** | 300 | another player | ~5.6s, the priciest gag, played with the **players' own photos**: the sender's photo sticker (their emoji, big, if they have none) pops out of their icon and waddles across the screen to the target; the target's photo bends over, away from them; a hand swings down three times ("SMACK!", red handprints, the target's photo jolts, smack sounds + buzz), then the target's photo hops around ("OW!") while the sender's bounces. If the sender isn't on screen they walk in from the side. The gag waits up to 1.5s for both photos to load |

**Realistic AI video for the 🧽 Go Do the Dishes** (`server/dishVideos.js`): with `FAL_KEY` set, an
image-to-video model on fal.ai (default Wan 2.6) films each player's photo sticker as a real person
grumpily washing dishes at a kitchen sink (~5s, with sound). Each clip is generated **once, in the
background**, the first time that player is targeted (a few minutes), downloaded and cached on the
volume (`DATA_DIR/dishvideos/<sticker>/`, served at `/dishvideos/`); fal's own file links are never
sent to clients. Once a player's clip is ready, act 2 of the gag dims the screen and plays it in a 4:5
card (with sound unless the app is muted or the phone blocks autoplay sound) instead of the
stick-arms sink. Players without a ready clip (or without a photo sticker, or a GIF one) get the
stick-arms version; so does a phone where the clip doesn't load within 2.5s.

**Realistic bodies for the 🍑 Spanking** (`server/bodies.js`): for each player photo sticker, the
OpenAI image API draws that same person as a photorealistic full body in 8 side-view poses (stand,
two walking steps, bent over, arm raised, arm swung through, cheering, hopping while rubbing their
backside). The standing pose is made from the sticker; the other 7 from the sticker + that standing
figure, so face, outfit and build match. Each set is generated **once, in the background**, cached on
the volume (`DATA_DIR/bodies/<sticker>/`, served at `/bodies/`) and reused by every later Spanking.
A Spanking sends the cached sets for both players; a player whose set isn't ready yet (or who has no
photo sticker, or a GIF one) plays as their photo as above, and their set starts generating then.
Buying a Spanking also starts the buyer's set. With bodies, the poses are swapped on the same
timeline (walk frames, bend over, wind-up / swing-through on each smack, cheer / rub) and the ✋ isn't
needed. Cost is about 8 image calls per sticker, once; a failed set is retried after an hour.

Every gag also shows a caption at the top of the screen ("🥊 Dana punched Yossi!") and plays a
stronger vibration pattern. Things that fly in come from whichever side of the target has more room.
Code: `public/js/shared/storeFx.js` (parts + timings), sounds in `public/js/fx.js`, styles in
`public/style.css` ("Store gags"). With reduced motion on, only the item's icon fades in and out.

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
- **In-game shop (Bluff)**: while a Bluff hand is on the table, a signed-in player's gag tray gets a
  🛒 button first. Tapping it drops down a list of the consumables only (icon, name, price, how many
  you own) with a Buy button each, plus your balance; tapping outside closes it. A bought charge lands
  in the tray right away, ready to tap and fire. It's the same purchase as the Store tab
  (`POST /api/store/buy`); guests don't see the 🛒. Wired by `setInGameShop()` in
  `public/js/shared/storeActions.js`, switched on from `public/js/games/bluff.js`.

## Consumable actions — the flow

A consumable action is a socket event, broadcast to the room, purely visual:

1. The owner taps the item's icon (e.g. 🥊), entering **"pick a target"** mode on whatever screen
   they're on.
2. They tap a player's icon or name.
3. The client sends the action to the server.
4. The server validates: the feature is on, the actor is signed in, the actor has a charge, the target
   is in the room, and no cooldown is active (see below). If all pass, it **consumes one charge** and
   broadcasts the action to the whole room.
5. Every phone plays the show on the target's icon — wherever that player is rendered, following it if
   the screen re-renders — for 3-5 seconds (see the table above), then it resets. It never covers a button or blocks input.

If validation fails (no charge, cooldown active, target gone), nothing is consumed and the actor gets a
short message; no animation plays on anyone's screen.

### Cooldowns (anti-abuse)

There is deliberately **no per-player cooldown**: a player can fire as often as they have charges, and
can hit the same person again and again (each use costs a charge). The one limit left is:

- **Per target, a queue (not a refusal)**: if a player is already being gagged, a new hit on them
  **lines up** and plays right after the current one finishes, on every phone (every phone gets the
  broadcasts in the same order, so the queue plays out the same everywhere - `storeFx.js`). Two players
  hitting the same person at the same moment therefore both land, one after the other. The line is
  capped at `MAX_QUEUED_GAGS` (4) per player; past that the sender gets "<name> already has a line of
  hits waiting - try again in a moment" and **keeps their charge**. Hits on *different* people (and
  self-targeted gags like the confetti bomb, which never wait) play at the same time.
- **Captions stack**: each playing gag's "Dana punched Yossi!" caption sits in a column at the top of
  the screen, newest at the bottom, so simultaneous gags never cover each other's captions.

Cooldowns are enforced on the server and are room-scoped; they reset when the room ends. They gate
*using* an action, never *buying* one.

### Punch-back

For `PUNCHBACK_WINDOW_MS` (5s) after being hit by a targeted action, the target may fire **one**
retaliation straight back at whoever hit them, **for free** (zero charges — the maximum "discount").
It still respects the per-target queue cap. It's a single shot at the original attacker only; after the
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
