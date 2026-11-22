/**
 * Realistic AI videos for store gags (🧽 Go Do the Dishes, 🍑 Spanking, 🍅 Tomato Throw). For each player photo
 * sticker, an image-to-video model on fal.ai (https://fal.ai, default Wan 2.6) films that person
 * in the gag's scene. Each video is generated once per sticker, in the background, downloaded and
 * cached on the persisted volume (DATA_DIR/<dir>/<sticker>/), and served at /<dir>/...; after
 * that every gag of that kind on that player plays the cache.
 *
 * createGagVideos({ kind, dir, prompt, version }) makes one independent cache + queue per gag
 * (server/dishVideos.js, server/spankVideos.js, server/tomatoVideos.js).
 *
 * Flow: a gag (server/lobby.js storeAction) attaches the target's cached video if it has one
 * (videoFor) and asks for it if not (ensureVideo). Until it's ready, clients play the drawn
 * animation. Generation runs one sticker at a time per gag (each takes a few minutes); a
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

const RETRY_MS = 10 * 60 * 1000; // wait after a failure before trying a sticker again
const TIMEOUT_MS = 10 * 60 * 1000;
const INPUT_TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

const apiKey = () => process.env.FAL_KEY;
const model = () => process.env.FAL_VIDEO_MODEL || 'wan/v2.6/image-to-video';
const frameModel = () => process.env.FAL_FRAME_MODEL || 'fal-ai/bytedance/seedream/v4/edit';

/** Can this sticker get a video (a still photo the video model takes)? */
function videoable(sticker) {
  if (!isValidSticker(sticker)) return false;
  return !!INPUT_TYPES[path.extname(sticker).slice(1).toLowerCase()];
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

/**
 * One gag's video cache. `kind` names the cached file (<kind>.v<version>.mp4), `dir` is both the
 * folder under DATA_DIR and the URL prefix, `prompt` is what fal films; bump `version` to
 * regenerate every video of this kind (e.g. after changing the prompt or model).
 * `frame` ({ prompt }, optional): first make the clip's opening frame from the sticker with an
 * image-edit model (FAL_FRAME_MODEL), then animate that frame. A face-only sticker animated
 * straight into a different pose loses the likeness; an image-edit model keeps the face.
 */
function createGagVideos({ kind, dir, prompt, version, frame = null }) {
  const VERSION = version;
  const VIDEOS_DIR = path.join(DATA_DIR, dir);
  const tag = `[${dir}]`;
  let pollMs = 5000; // how often to ask fal whether a job is done (tests shorten it)
  const manifests = new Map(); // sticker -> manifest (memo of DATA_DIR/<dir>/<sticker>/manifest.json)
  const queue = [];
  const queued = new Set();
  let running = false;
  const dropped = new Set(); // stickers whose video was removed while being made: discard it

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

  /** The cached video's URL for a sticker ('/<dir>/...'), or null if not ready. */
  function videoFor(sticker) {
    if (!sticker || !videoable(sticker)) return null;
    const m = readManifest(sticker);
    if (!m || m.status !== 'ready' || m.version !== VERSION || !m.file) return null;
    return `/${dir}/${encodeURIComponent(path.basename(dirFor(sticker)))}/${m.file}`;
  }

  /**
   * Queues generation for any of these stickers that has no ready video yet, and logs one line per
   * sticker saying what happened (so a gag that didn't start a video is never silent in the
   * server log). Never throws.
   */
  function ensureVideo(...stickers) {
    for (const sticker of stickers) {
      const why = skipReason(sticker);
      if (why) {
        console.log(`${tag} ${sticker || '(no sticker)'}: no new video - ${why}`);
        continue;
      }
      queued.add(sticker);
      queue.push(sticker);
    }
    pump();
  }

  /** Why a sticker won't be queued right now, or null if it should be. */
  function skipReason(sticker) {
    if (!apiKey()) return 'FAL_KEY is not set';
    if (!sticker) return 'the player has no sticker';
    if (!videoable(sticker)) return 'not a photo sticker (emoji, GIF or unknown)';
    if (videoFor(sticker)) return 'already has a video (playing it)';
    if (queued.has(sticker)) return 'already being made';
    const m = readManifest(sticker);
    if (m && m.version === VERSION && m.status === 'failed' && Date.now() - m.at < RETRY_MS) {
      const mins = Math.ceil((RETRY_MS - (Date.now() - m.at)) / 60000);
      return `the last try failed (${m.error || 'unknown error'}); retrying in ${mins} min`;
    }
    return null;
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
          console.error(`${tag} ${sticker} failed:`, err.message);
          if (!dropped.has(sticker)) {
            writeManifest(sticker, { version: VERSION, status: 'failed', error: String(err.message).slice(0, 300), at: Date.now() });
          }
        } finally {
          dropped.delete(sticker);
          queued.delete(sticker);
        }
      }
    } finally {
      running = false;
    }
  }

  async function generateVideo(sticker) {
    const source = stickerPath(sticker);
    if (!source || !fs.existsSync(source)) throw new Error('sticker file missing');
    const type = INPUT_TYPES[path.extname(source).slice(1).toLowerCase()];
    const imageUrl = `data:${type};base64,${fs.readFileSync(source).toString('base64')}`;
    console.log(`${tag} generating a video for ${sticker} with ${model()}`);

    let startUrl = imageUrl;
    if (frame) {
      const shot = await runJob(frameModel(), { prompt: frame.prompt, image_urls: [imageUrl], num_images: 1 });
      startUrl = shot && shot.images && shot.images[0] && shot.images[0].url;
      if (!startUrl) throw new Error(`fal returned no frame: ${JSON.stringify(shot).slice(0, 200)}`);
    }
    const out = await runJob(model(), { prompt, image_url: startUrl, duration: '5', resolution: '720p' });
    const url = out && out.video && out.video.url;
    if (!url) throw new Error(`fal returned no video: ${JSON.stringify(out).slice(0, 200)}`);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`video download failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (dropped.delete(sticker)) {
      console.log(`${tag} ${sticker}: video removed while it was being made - discarded`);
      return;
    }
    const file = `${kind}.v${VERSION}.mp4`;
    fs.mkdirSync(dirFor(sticker), { recursive: true });
    fs.writeFileSync(path.join(dirFor(sticker), file), buf);
    writeManifest(sticker, { version: VERSION, status: 'ready', file, at: Date.now() });
    console.log(`${tag} ${sticker} ready (${Math.round(buf.length / 1024)} KB)`);
  }

  /** Submits one fal queue job, waits for it and returns its result JSON. */
  async function runJob(endpoint, input) {
    const job = await falJson(`https://queue.fal.run/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
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
    return falJson(job.response_url);
  }

  /**
   * Deletes a sticker's cached video (and drops it from the queue, or discards it if it's being
   * made right now). Never throws.
   */
  function removeVideo(sticker) {
    if (!sticker) return;
    const i = queue.indexOf(sticker);
    if (i >= 0) {
      queue.splice(i, 1);
      queued.delete(sticker);
    } else if (queued.has(sticker)) {
      dropped.add(sticker);
    }
    try {
      fs.rmSync(dirFor(sticker), { recursive: true, force: true });
    } catch (err) {
      console.error(`${tag} removing ${sticker} failed:`, err.message);
    }
    manifests.delete(sticker);
  }

  /** Serves the cached videos (versioned names, so cacheable for long; express handles ranges). */
  function registerRoutes(app, express) {
    fs.mkdirSync(VIDEOS_DIR, { recursive: true });
    app.use(`/${dir}`, express.static(VIDEOS_DIR, { maxAge: '30d', immutable: true, index: false }));
  }

  /** Test hook: forget in-memory state (the disk cache stays). */
  function _reset() {
    manifests.clear();
    queue.length = 0;
    queued.clear();
    dropped.clear();
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

  return { videoFor, ensureVideo, removeVideo, registerRoutes, VIDEOS_DIR, VERSION, _reset, _idle, _setPollMs };
}

module.exports = { createGagVideos };
