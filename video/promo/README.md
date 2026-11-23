# Shorot promo trailer

A 30-second portrait (1080×1920) trailer of Shorot for social media and the README, made with
[HyperFrames](https://github.com/heygen-com/hyperframes) (Apache-2.0, by HeyGen). It is Phase 1 of
[`docs/specs/recap-videos-specs.md`](../../docs/specs/recap-videos-specs.md).

**Dev-only.** Nothing here is deployed or imported by the app. This folder has its own
`package.json`, so the app's dependencies and its Node ≥ 18 minimum are untouched.

## Make the video

Needs Node ≥ 22 and FFmpeg. The app's own dependencies must be installed too (`npm install` at the
repo root), because the capture step boots the real server.

```bash
cd video/promo
npm install
npx playwright install chromium   # skip if a matching Chromium is already installed
npm run capture                   # ~1.5 min: boots Shorot, plays each game, saves assets/shots/*.png
npm run preview                   # optional: HyperFrames studio, scrub the timeline in a browser
npm run render                    # -> renders/shorot-promo.mp4 (render:draft for a fast preview)
```

Set `HYPERFRAMES_NO_TELEMETRY=1` to turn off HyperFrames' usage telemetry.

`assets/shots/` and `renders/` are git-ignored. Re-run `npm run capture` after UI changes and the
trailer shows the current app.

## How it works

- **`capture/capture.cjs`** starts a fresh Shorot server for each take (its own temp `DATA_DIR`).
  It joins four players from iPhone-sized Playwright browsers, plays into each game and saves a
  screenshot. `capture/openai-stub.cjs` is preloaded into that server and answers OpenAI calls
  with fixed words (Pizza / Italian, a fixed Codenames grid), so no key is needed and every take
  looks the same.
- **No real faces:** the built-in stickers are photos of real people, so capture players use the
  emoji fallback, and the reactions row (which shows those photos) is hidden.
- **`index.html`** is the HyperFrames composition. Each scene is a `.clip` with
  `data-start`/`data-duration`, and one paused GSAP timeline drives all the motion. Scenes: intro
  (0–3.2 s), join (3.2–6.4 s), seven 2.4 s game beats (6.4–23.2 s), outro (23.2–30 s).
- **Look:** the app's Afterglow theme colours and its Sora font (SIL OFL, bundled in
  `assets/fonts/` so renders work offline). Captions are kept clear of the TikTok/Reels/Shorts
  overlay areas. `npm run check` reports anything that drifts outside them.

## Changing it

- **Add or swap a game beat:** add a take to `TAKES` in `capture/capture.cjs`, then add a
  `.scene.beat` block in `index.html` and its id to the `beats` array in the script. Shift the
  later `data-start` values by 2.4 s, and the root `data-duration` too.
- **Wording:** the captions are plain text in `index.html`.
- `npm run check` lints the composition: layout, contrast, safe zones and fonts.
