# Recap Videos (HyperFrames) — Specs

**Status:** Phase 1 (the promo trailer, `video/promo/`) is built. Phase 2a/2b (pipeline, generic +
Imposter + 10 Seconds templates, phone UI) is built behind `RECAPS_ENABLED`, off by default.

**Built differently from the draft below:**
- `RECAP_WORKERS` defaults to **2**: one worker rendered a 10 s recap in about 88 s, two in about
  45-60 s (4 vCPU test container).
- The recap chip is one floating chip shared by every game (`public/js/shared/recaps.js`) rather
  than markup inside each game-over screen, so no game's client code changes. Phones pull the
  status with `getRecapStatus` after a (re)join, so `lobby.js` and the reconnect payloads don't
  change either.
- The Dockerfile is opt-in at `deploy/recaps.Dockerfile` (Railway variable
  `RAILWAY_DOCKERFILE_PATH`), and `engines.node` stays `>=18`. A root `Dockerfile` would switch
  production's build the moment it merged; this way recaps just stay off until you opt in.
- Templates get their data as one JSON string variable (`recap`), validated with
  `--strict-variables`.

At the end of a game, Shorot renders a short **recap video** for the room: the game, the winner, the
scoreboard and one or two highlights of what happened ("Noa was the imposter, the word was *Pizza*").
Anyone in the room can watch it on their phone and save or share it. The videos are made by
[HyperFrames](https://github.com/heygen-com/hyperframes), HeyGen's open-source HTML-to-video
renderer, running on our own server. There is no paid service, API key or per-video cost.

The work is split into two phases:

- **Phase 1: promo video (dev-only).** A HyperFrames project in the repo that renders a 30-second
  trailer of Shorot for social media and the README. It never runs in production. Its job is to let
  us learn the tool at zero risk to the live app.
- **Phase 2: in-app recap videos.** The player-facing feature described in most of this spec.

## What HyperFrames is (verified 2026-11-23)

| | |
|---|---|
| Package | `hyperframes` on npm, v0.9.86 (pre-1.0 and fast-moving, so **pin the exact version**) |
| License | Apache-2.0, "Copyright 2026 HeyGen, Inc.". Commercial use is allowed, with no extra terms |
| How it works | A video is an HTML page with timing attributes (`data-start`, `data-duration`) and a paused GSAP/CSS timeline. The renderer opens it in headless Chrome, seeks it frame by frame, and encodes the frames with FFmpeg |
| Data in | `--variables-file vars.json`. The page reads the values with `window.__hyperframes.getVariables()`, and declares them in `data-composition-variables` on `<html>` |
| Output | MP4 (also WebM, GIF, HLS). Presets include `--resolution portrait` (1080×1920) |
| Needs | Node ≥ 22, FFmpeg, and Chrome (`hyperframes browser ensure` finds or downloads one) |
| Accounts | None for local rendering. HeyGen login is needed only for their `share`/`publish`/cloud commands, which we don't use |
| Telemetry | On by default. Turn it off with `HYPERFRAMES_NO_TELEMETRY=1` (or `DO_NOT_TRACK=1`). We always set it |

**Feasibility test (done in a cloud dev container, 4 vCPU and 15 GB RAM):** an 8-second portrait
composition showed a game name, the winner and 4 player rows, each driven by `--variables`. It
rendered at `-q draft` in **48 s wall time** and produced a **330 KB** MP4 at 1080×1920. Chrome fell
back to "screenshot mode" because that container's Chrome lacks the BeginFrame API, so a correctly
set-up Chrome should be faster. A winner name of `Dana <b>x</b>` rendered as literal text, because
the template uses `textContent`. Emoji rendered correctly.

## Phase 1: promo video

- New top-level folder `video/promo/` with its **own** `package.json`, which lists `hyperframes`
  (exact version) and `gsap` as dependencies. The app's root `package.json` doesn't change, so
  production installs and the app's Node ≥ 18 minimum are unaffected.
- Content: 30 s, portrait. It opens on the logo, shows how players join, then one 2.4 s beat for each of
  7 games, using real phone screenshots captured by `npm run capture` (Playwright plus an offline
  OpenAI stub), and ends on "imposter.shorots.com". A landscape cut is a possible follow-up.
- Commands: `cd video/promo && npm i && npm run preview` (opens the HyperFrames studio) and
  `npm run render`. Output goes to `video/promo/renders/`, which is git-ignored. The finished MP4 is
  committed only if it's small enough, or uploaded as a GitHub release asset.
- Done when the trailer renders from a clean checkout with the two commands above, and the README
  links to it.

## Phase 2: recap videos, player experience

1. A game ends and the usual game-over screen appears. A small chip under the results reads
   **"🎬 Making your recap…"** for every player in the room.
2. When the render finishes (target: under 60 s for a ~10 s recap), the chip turns into
   **"▶ Watch recap"**. Tapping it opens a full-screen player with the video playing, muted by default
   with an unmute button, plus **Save** and **Share**. Share uses the Web Share API with the MP4 file;
   where that isn't supported, Save is a plain download.
3. The latest recap stays available in the **lobby** as a "Last game" card until the next game's
   recap replaces it, or until it expires (see `RECAP_TTL_HOURS`).
4. If the render fails or times out, the chip disappears quietly. No error is shown to players, and
   the game, scoreboard and everything else work as before.
5. The host has a **Recap videos on/off** toggle in room settings, on by default. When it's off,
   nothing renders for that room.

Recaps **never** affect gameplay, scores, ratings, badges or tokens. They only observe a finished
game.

### What a recap shows

All recaps are portrait 1080×1920, **8–12 s**, and silent in v1. Each one has three parts:

1. **Title card** (about 1.5 s): game name and emoji, room code, date.
2. **Highlight** (about 4–6 s): different for each game (table below).
3. **Results** (about 3–4 s): winner(s) with sticker, crown and confetti, then the ranked rows with
   the points earned this game. The final frame holds the "Shorot" wordmark.

| Game | Highlight (v1) |
|---|---|
| Imposter | "The imposter was **Noa**", then the secret word and the imposter's hint revealed |
| 10 Seconds | Each round's best and worst stopwatch time, and the player eliminated each round |
| Mind Meld | The question, and the target's real answer next to the closest guess |
| Codenames | The final 5×5 board with team colours revealed, and the winning team |
| All other games | No highlight section. Title card, then Results (generic template) |

Phase 2 ships with the generic template plus **Imposter** and **10 Seconds**. The other games follow
one at a time. Each one is a new template and a `recapData` hook (see below), with no change to the
pipeline.

Players' **photo stickers** appear as their avatar. Emoji stickers are drawn as emoji. Players with no
sticker get their initial in a circle. Store gag media (dishes, tomato and spank bodies or videos)
**never** appears in a recap.

## Phase 2: architecture

```
game ends ─► ctx.recordGameResult(room, gameType, participants)
                 │  (server.js, existing)
                 ▼
            recaps.onGameResult(room, roomCode, gameType, participants)      server/recaps/index.js
                 │  1. skip if RECAPS_ENABLED off / room toggle off / renderer unavailable
                 │  2. data = buildRecapData(...)  ← game module's optional recapData(room, participants)
                 │  3. room.recap = { id, status: 'rendering', gameType }; roomEmit('recapStatus')
                 ▼
            render queue (1 job at a time)                                    server/recaps/queue.js
                 │  job dir: DATA_DIR/recaps/tmp/<id>/  (template copy + stickers + vars.json)
                 │  spawn('hyperframes', ['render', dir, '--variables-file', 'vars.json',
                 │        '-o', out, '-q', RECAP_QUALITY, '--workers', RECAP_WORKERS,
                 │        '--resolution', 'portrait', '--json', '--no-wait',
                 │        '--strict-variables', '--refuse-outside-files'],
                 │        { env: { HYPERFRAMES_NO_TELEMETRY: '1', … } })     server/recaps/renderer.js
                 ▼
            DATA_DIR/recaps/<id>.mp4   served at /recaps/<id>.mp4
                 │  room.recap = { id, status: 'ready', url, gameType, at }
                 ▼
            roomEmit('recapStatus', { status: 'ready', url, gameType })  ─► client chip / player
```

### Server modules (new)

| File | Responsibility |
|---|---|
| `server/recaps/index.js` | `onGameResult` entry point, feature/room gates, the `room.recap` state, emits, `reconnectPayload` for the recap chip |
| `server/recaps/data.js` | Pure. Builds the variables object: shared fields (game, date, players, winners, points) plus the game's `recapData`. Validates and truncates (names ≤ 24 chars, ≤ 12 players). Unit-tested |
| `server/recaps/queue.js` | FIFO with concurrency 1 and a max length (`RECAP_MAX_QUEUE`). If a newer job for the same room is queued, it replaces that room's older queued job |
| `server/recaps/renderer.js` | The only file that knows about HyperFrames. Runs `spawn` (never `exec` or a shell) with an args array, a timeout and `SIGKILL` on expiry. Parses the `--json` result. `available()` probes `hyperframes` and `ffmpeg` once at boot |
| `server/recaps/cleanup.js` | Deletes MP4s older than `RECAP_TTL_HOURS` and any `tmp/` job dirs. Runs on boot and hourly. Enforces `RECAP_MAX_DISK_MB` by deleting the oldest first |
| `recaps/templates/<template>/` | HyperFrames compositions (`generic/`, `imposter/`, `ten-seconds/` …) with **vendored** GSAP and fonts, so rendering needs no network |

`server.js` changes in two lines: call `recaps.onGameResult(...)` inside the existing
`ctx.recordGameResult`, and add `app.use('/recaps', express.static(...))`. `room.recap` joins
`SHARED_SAVED_FIELDS` in `server/gameRegistry.js`. On boot, a persisted `status: 'rendering'` is reset
to none, because the job was lost with the old process.

### Game contract addition (optional)

```js
// in a game module, next to reconnectPayload etc.
recapData(room, participants) {
  return { template: 'imposter', imposter: room.imposterName, word: room.word, hint: room.hint };
}
```

This is optional, like `repairOnLoad` and `clearState`. A game without it gets the generic template.
This follows the CLAUDE.md rule that adding a feature never forces every game file to change. It
must be pure: read-only, no I/O, and it must return plain JSON.

### Client (new)

- `public/js/shared/recapChip.js`: listens for `recapStatus` and renders the chip on the game-over
  screen and the "Last game" card in the lobby.
- `public/js/shared/recapPlayer.js`: the full-screen `<video playsinline muted>` overlay with
  Save and Share.
- Styles go in `public/theme-afterglow.css` (the Afterglow theme) using `:where(...)` selectors, as
  the theme rule requires.

### Runtime and deployment

- **Node:** HyperFrames needs Node ≥ 22. CI already runs Node 22. Production must run Node 22 too,
  so raise `engines.node` to `>=22` when Phase 2 lands.
- **Dependency:** add `hyperframes` (exact version) to the root `package.json`. Load it lazily
  (`spawn` the CLI from `node_modules/.bin`), so the app boots and runs normally if it's missing.
- **Chrome + FFmpeg on Railway:** the repo has no deploy config today (Railway auto-detects it).
  Phase 2 adds a `Dockerfile` based on `node:22-bookworm-slim`. It installs `ffmpeg`, `chromium` and
  the fonts recaps need: `fonts-noto-core` for Hebrew, `fonts-noto-color-emoji` for emoji. It sets
  `PUPPETEER_EXECUTABLE_PATH` or runs `hyperframes browser ensure` at build time. Expect the image to
  grow by roughly 400–600 MB.
- **Isolation:** rendering runs in **child processes** (the HyperFrames CLI, plus Chrome and FFmpeg
  under it), never in the app's Node process. The main event loop, including Warfront's 5×/s sim,
  isn't blocked. CPU contention is limited by `RECAP_WORKERS=1` (one Chrome, about 256 MB) and by
  launching through `nice -n 19`. **Exit criterion:** if production shows Warfront tick lag or socket
  latency during renders, move `renderer.js` to a separate Railway service with a tiny HTTP API
  (`POST /render`). That's a drop-in, because nothing outside `renderer.js` knows how rendering
  happens.

## Security and privacy

- **Untrusted text:** player names, Imposter words and hints, and Mind Meld answers are typed by
  users or generated by an LLM. Templates must insert them with `textContent` only, never
  `innerHTML`. This was verified in the feasibility test. Values reach the renderer through a JSON
  file, never through command-line string building or a shell.
- **No network at render time:** templates use only vendored assets. Rendering runs with
  `--refuse-outside-files`. A template lint test in `npm test` fails if a template references
  `http(s)://`.
- **Stickers:** only the stickers of that game's participants are copied into the job dir. Gag
  bodies and videos are never inputs.
- **URLs:** `id` is 128-bit random (`crypto.randomBytes(16)` as hex). Recaps aren't listed anywhere
  and are deleted after `RECAP_TTL_HOURS`. Anyone holding a URL can watch it until then, the same
  model as uploaded backgrounds.
- **Abuse limits:** one job per game result, the queue is capped, and each job has a timeout.
  Rapid-fire games in one room collapse to the latest.
- **Admin:** the `/admin` activity feed logs `recap rendered (Imposter, 41 s)` and `recap failed`
  lines through `server/activity.js`.

## Configurable constants

| Env var | Default | Meaning |
|---|---|---|
| `RECAPS_ENABLED` | unset (off) | `'true'` turns the feature on. Off means no chip, no renders and no route, so the app behaves exactly as before |
| `RECAP_QUALITY` | `draft` | HyperFrames `-q` preset (`draft` / `looks` / `delivery`) |
| `RECAP_WORKERS` | `1` | Chrome workers per render |
| `RECAP_TIMEOUT_MS` | `180000` | A render is killed after this long |
| `RECAP_MAX_QUEUE` | `5` | Queued jobs beyond this are dropped, and the room's chip clears |
| `RECAP_TTL_HOURS` | `24` | Recap MP4s are deleted after this |
| `RECAP_MAX_DISK_MB` | `500` | The oldest recaps are deleted first when over this |

If `RECAPS_ENABLED` is on but `renderer.available()` is false (no FFmpeg or Chrome), the server logs
one warning at boot and treats the feature as off.

## Licensing and attribution

- HyperFrames is Apache-2.0. We use it as an unmodified npm dependency. Add a "Recap videos made with
  HyperFrames by HeyGen (Apache-2.0)" line to the README credits. If we ever vendor or modify its
  source, keep its LICENSE and NOTICE files with it.
- GSAP is used inside the templates. Check its current license terms (since 2025 it has been free,
  including for commercial use, under GSAP's own standard license rather than an OSI license) before
  vendoring it. CSS animations are the fallback if the terms are unsuitable.
- No music in v1. Any later audio must be our own or royalty-free with a stored license.

## Testing

- **Unit (`npm test`):** `tests/recaps/data.test.js` covers building the variables object
  (truncation, missing stickers, generic fallback, each game's `recapData`). `queue.test.js` covers
  ordering, the cap, replacement of a room's older job, and the timeout with a fake renderer.
  `templates.test.js` checks that every template declares the variables it reads, contains no
  `http(s)://` and no `innerHTML`. No real rendering in the unit suite.
- **Render smoke test (optional CI job):** render the generic template with fixture data at
  `-q draft`, then `ffprobe` that it is 1080×1920 and 8–12 s long. It runs on PRs that touch
  `recaps/` or `server/recaps/`.
- **Manual (per CLAUDE.md):** create a room, play Imposter to the end, see the chip turn into "Watch
  recap", play it, save it, share it on iOS Safari and Android Chrome, then go back to the lobby and
  check the "Last game" card. Also: a disconnect and reconnect while the recap is rendering still
  shows the chip after reconnecting, and a server restart mid-render clears the chip without an
  error.
- **Load check:** play a Warfront match while 3 recaps render back-to-back, and confirm no visible
  stutter.

## Rollout

1. **Phase 1:** `video/promo/` trailer (dev-only).
2. **Phase 2a:** pipeline plus the generic template behind `RECAPS_ENABLED`, off in production, with
   the Dockerfile. Verify on a Railway preview environment, including render times and memory.
3. **Phase 2b:** Imposter and 10 Seconds templates. Turn it on in production and watch render times
   in the activity feed for a week.
4. **Phase 2c:** Mind Meld and Codenames, then the rest of the games one by one.

## Open questions

1. Should the room toggle default to **on** or **off**?
2. Portrait only, or also offer a square version for sharing?
3. Should recaps be kept longer than 24 h for signed-in players (for example, listed in their Player
   Card game history)? That needs a DB column and a longer retention policy.
4. Add sound later (a short sting on the winner reveal)?
5. Is a 30–60 s wait acceptable, or should we spend more on a faster renderer machine?
