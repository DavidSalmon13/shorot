/**
 * Realistic AI videos for the 🧽 Go Do the Dishes gag. For each player photo sticker, an
 * image-to-video model on fal.ai (https://fal.ai, default Wan 2.6) films that person grumpily
 * washing dishes at a kitchen sink. Each video is generated once per sticker, in the
 * background, downloaded and cached on the persisted volume (DATA_DIR/dishvideos/<sticker>/),
 * and served at /dishvideos/...; after that every Dishes gag on that player plays the cache.
 *
 * Flow: a Dishes gag (server/lobby.js storeAction) attaches the target's cached video if it
 * has one (videoFor) and asks for it if not (ensureVideo). Until it's ready, clients play the
 * stick-arms animation. Generation runs one sticker at a time (each takes a few minutes); a
 * failed sticker is retried after RETRY_MS. No FAL_KEY = feature off.
 *
 * fal's queue API: POST queue.fal.run/<model> -> { status_url, response_url }; poll status
 * until COMPLETED, then the response has { video: { url } }, which we download (fal's file
 * links are public to anyone holding them, so they're never handed to clients).
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./persistence');
const { stickerPath, isValidSticker } = require('./stickers');

const VIDEOS_DIR = path.join(DATA_DIR, 'dishvideos');
// Bump to regenerate every video (e.g. after changing the prompt or model).
const VERSION = 1;
const RETRY_MS = 60 * 60 * 1000;
let pollMs = 5000; // how often to ask fal whether a job is done (tests shorten it)
const TIMEOUT_MS = 10 * 60 * 1000;
const INPUT_TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

const apiKey = () => process.env.FAL_KEY;
const model = () => process.env.FAL_VIDEO_MODEL || 'wan/v2.6/image-to-video';

const PROMPT =
  'Photorealistic phone video. The person from the photo is standing at a kitchen sink ' +
  'in a real home kitchen, grumpily scrubbing a dirty plate with a yellow sponge, soap suds, ' +
  'running tap. They sigh, roll their eyes and keep scrubbing. Keep their face exactly the same. ' +
  'Natural light, slight handheld camera, filmed from across the counter.';

const manifests = new Map(); // sticker -> manifest (memo of DATA_DIR/dishvideos/<sticker>/manifest.json)
const queue = [];
const queued = new Set();
let running = false;

function enabled() {
  return !!apiKey();
}

function dirFor(sticker) {
  return path.join(VIDEOS_DIR, sticker.replace(/[^\w.-]/g, '_'));
}

function readManifest(sticker) {
  if (manifests.has(sticker)) return manifests.get(sticker);
  let m = null;
  try {
    m = JSON.parse(fs.readFileSync(path.join(dirFor(sticker), 'manifest.json'), 'utf8'));
  } catch {
    m = null;
  }
  manifests.set(sticker, m);
  return m;
}

function writeManifest(sticker, m) {
  fs.mkdirSync(dirFor(sticker), { recursive: true });
  const file = path.join(dirFor(sticker), 'manifest.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(m));
  fs.renameSync(`${file}.tmp`, file);
  manifests.set(sticker, m);
}

/** Can this sticker get a video (a still photo the video model takes)? */
function videoable(sticker) {
  if (!isValidSticker(sticker)) return false;
  return !!INPUT_TYPES[path.extname(sticker).slice(1).toLowerCase()];
}

/** The cached video's URL for a sticker ('/dishvideos/...'), or null if not ready. */
function videoFor(sticker) {
  if (!sticker || !videoable(sticker)) return null;
  const m = readManifest(sticker);
  if (!m || m.status !== 'ready' || m.version !== VERSION || !m.file) return null;
  return `/dishvideos/${encodeURIComponent(path.basename(dirFor(sticker)))}/${m.file}`;
}

/** Queues generation for any of these stickers that has no ready video yet. Never throws. */
function ensureVideo(...stickers) {
  if (!enabled()) return;
  for (const sticker of stickers) {
    if (!sticker || !videoable(sticker) || queued.has(sticker) || videoFor(sticker)) continue;
    const m = readManifest(sticker);
    if (m && m.version === VERSION && m.status === 'failed' && Date.now() - m.at < RETRY_MS) continue;
    queued.add(sticker);
    queue.push(sticker);
  }
  pump();
}

async function pump() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const sticker = queue.shift();
      try {
        await generateVideo(sticker);
      } catch (err) {
        console.error(`[dishvideos] ${sticker} failed:`, err.message);
        writeManifest(sticker, { version: VERSION, status: 'failed', error: String(err.message).slice(0, 300), at: Date.now() });
      } finally {
        queued.delete(sticker);
      }
    }
  } finally {
    running = false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function falJson(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { Authorization: `Key ${apiKey()}`, ...(opts.headers || {}) } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`fal request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function generateVideo(sticker) {
  const source = stickerPath(sticker);
  if (!source || !fs.existsSync(source)) throw new Error('sticker file missing');
  const type = INPUT_TYPES[path.extname(source).slice(1).toLowerCase()];
  const imageUrl = `data:${type};base64,${fs.readFileSync(source).toString('base64')}`;
  console.log(`[dishvideos] generating a video for ${sticker} with ${model()}`);

  const job = await falJson(`https://queue.fal.run/${model()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: PROMPT, image_url: imageUrl, duration: '5', resolution: '720p' }),
  });
  if (!job.status_url || !job.response_url) throw new Error('fal returned no job');

  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) throw new Error('timed out waiting for fal');
    await sleep(pollMs);
    const st = await falJson(job.status_url);
    if (st.status === 'COMPLETED') break;
    if (st.status !== 'IN_QUEUE' && st.status !== 'IN_PROGRESS') throw new Error(`fal job ${st.status}`);
  }
  const out = await falJson(job.response_url);
  const url = out && out.video && out.video.url;
  if (!url) throw new Error(`fal returned no video: ${JSON.stringify(out).slice(0, 200)}`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`video download failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const file = `dishes.v${VERSION}.mp4`;
  fs.mkdirSync(dirFor(sticker), { recursive: true });
  fs.writeFileSync(path.join(dirFor(sticker), file), buf);
  writeManifest(sticker, { version: VERSION, status: 'ready', file, at: Date.now() });
  console.log(`[dishvideos] ${sticker} ready (${Math.round(buf.length / 1024)} KB)`);
}

/** Serves the cached videos (versioned names, so cacheable for long; express handles ranges). */
function registerDishVideoRoutes(app, express) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
  app.use('/dishvideos', express.static(VIDEOS_DIR, { maxAge: '30d', immutable: true, index: false }));
}

/** Test hook: forget in-memory state (the disk cache stays). */
function _reset() {
  manifests.clear();
  queue.length = 0;
  queued.clear();
  running = false;
}

/** Test hook: poll fal faster. */
function _setPollMs(ms) {
  pollMs = ms;
}

/** Test hook: resolves once the queue is drained. */
async function _idle() {
  while (running || queue.length) await sleep(5);
}

module.exports = { videoFor, ensureVideo, registerDishVideoRoutes, VIDEOS_DIR, VERSION, _reset, _idle, _setPollMs };
