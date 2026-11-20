/**
 * Realistic full bodies for the 🍑 Spanking gag. For each player photo sticker, an OpenAI
 * image model draws that same person as a photorealistic full-body figure in a set of
 * side-view poses (POSES below). They're generated once per sticker, in the background, and
 * cached on the persisted volume (DATA_DIR/bodies/<sticker>/), served at /bodies/...; after
 * that every Spanking with that sticker uses the cache.
 *
 * Flow: a Spanking (server/lobby.js storeAction) attaches whatever bodies are already cached
 * for the two players (bodiesFor) and asks for the missing ones (ensureBodies). Until a
 * sticker's set is ready, clients play the plain photo version. Buying a Spanking also
 * starts the buyer's set. Generation is one sticker at a time, poses a few at a time; a
 * failed sticker is retried after RETRY_MS. No OPENAI_API_KEY = feature off.
 *
 * The first pose ("stand") is made from the sticker alone; the rest from the sticker plus
 * that standing figure, so face, outfit and build stay the same across poses.
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./persistence');
const { stickerPath, isValidSticker } = require('./stickers');

const BODIES_DIR = path.join(DATA_DIR, 'bodies');
// Bump to regenerate every set (e.g. after changing the prompts).
const VERSION = 1;
const RETRY_MS = 60 * 60 * 1000;
const PARALLEL_POSES = 3;
const INPUT_TYPES = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

const apiKey = () => process.env.OPENAI_API_KEY;
const imageModel = () => process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const quality = () => process.env.BODIES_QUALITY || 'medium';

const LOOK =
  'Photorealistic full-body photograph of the same person as in the input image. Keep their face, ' +
  'hair, skin tone, build and clothing exactly the same; if the photo does not show their legs or ' +
  'feet, give them plain trousers and shoes that match their outfit. The whole body must be visible ' +
  'from the top of the head to the feet, nothing cropped, centered with a little margin. Seen from ' +
  'the side in profile, facing to the right. Fully transparent background: no floor, no shadow, no ' +
  'scenery, no text, no other people. Realistic human proportions, natural soft studio lighting. ';

// Order matters: "stand" first (the reference for the rest).
const POSES = {
  stand: 'Pose: standing upright and relaxed, arms hanging at their sides.',
  walk1: 'Pose: mid-stride, walking to the right: left leg forward, right leg back, arms swinging naturally.',
  walk2: 'Pose: mid-stride, walking to the right: right leg forward, left leg back, arms swinging naturally.',
  bent: 'Pose: bending forward at the waist about ninety degrees with both hands resting on their knees, back flat, head up looking to the right; their seat points to the left.',
  raise: 'Pose: standing tall, right arm raised high above and slightly behind the head with the palm open, about to swing it down in front of them.',
  slap: 'Pose: standing and leaning a little forward, right arm swung down and forward to hip height in front of them with the palm open, like a low high-five.',
  cheer: 'Pose: standing triumphantly with both fists raised above the head and a big grin.',
  rub: 'Pose: slightly hunched, both hands pressed on the back of their hips, wincing, with one knee lifted as if hopping.',
};
const POSE_NAMES = Object.keys(POSES);

const manifests = new Map(); // sticker -> manifest (memo of DATA_DIR/bodies/<sticker>/manifest.json)
const queue = []; // stickers waiting to be generated
const queued = new Set();
let running = false;

function enabled() {
  return !!apiKey();
}

function dirFor(sticker) {
  return path.join(BODIES_DIR, sticker.replace(/[^\w.-]/g, '_'));
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

/** Can this sticker get a body (a still photo in a format the image API takes)? */
function bodyable(sticker) {
  if (!isValidSticker(sticker)) return false;
  const ext = path.extname(sticker).slice(1).toLowerCase();
  return !!INPUT_TYPES[ext];
}

/** The cached pose URLs for a sticker ({ stand: '/bodies/...', ... }), or null if not ready. */
function bodiesFor(sticker) {
  if (!sticker || !bodyable(sticker)) return null;
  const m = readManifest(sticker);
  if (!m || m.status !== 'ready' || m.version !== VERSION) return null;
  const base = `/bodies/${encodeURIComponent(path.basename(dirFor(sticker)))}`;
  const out = {};
  for (const pose of POSE_NAMES) {
    if (!m.poses || !m.poses[pose]) return null;
    out[pose] = `${base}/${m.poses[pose]}`;
  }
  return out;
}

/** Queues generation for any of these stickers that has no ready set yet. Never throws. */
function ensureBodies(...stickers) {
  if (!enabled()) return;
  for (const sticker of stickers) {
    if (!sticker || !bodyable(sticker) || queued.has(sticker) || bodiesFor(sticker)) continue;
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
        await generateSet(sticker);
      } catch (err) {
        console.error(`[bodies] ${sticker} failed:`, err.message);
        writeManifest(sticker, { version: VERSION, status: 'failed', error: String(err.message).slice(0, 300), at: Date.now() });
      } finally {
        queued.delete(sticker);
      }
    }
  } finally {
    running = false;
  }
}

function fileBlob(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return new Blob([fs.readFileSync(file)], { type: INPUT_TYPES[ext] || 'image/png' });
}

/** One image-edit call: input images + prompt -> webp bytes with a transparent background. */
async function generatePose(inputs, prompt) {
  const form = new FormData();
  form.append('model', imageModel());
  form.append('prompt', prompt);
  form.append('size', '1024x1536');
  form.append('quality', quality());
  form.append('background', 'transparent');
  form.append('output_format', 'webp');
  form.append('output_compression', '85');
  form.append('input_fidelity', 'high');
  inputs.forEach((file, i) => form.append('image[]', fileBlob(file), `input${i}${path.extname(file)}`));
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey()}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenAI image request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const b64 = data && data.data && data.data[0] && data.data[0].b64_json;
  if (!b64) throw new Error('OpenAI returned no image');
  return Buffer.from(b64, 'base64');
}

async function generateSet(sticker) {
  const source = stickerPath(sticker);
  if (!source || !fs.existsSync(source)) throw new Error('sticker file missing');
  const dir = dirFor(sticker);
  fs.mkdirSync(dir, { recursive: true });
  console.log(`[bodies] generating ${POSE_NAMES.length} poses for ${sticker}`);
  const poses = {};
  const save = (pose, buf) => {
    const name = `${pose}.v${VERSION}.webp`;
    fs.writeFileSync(path.join(dir, name), buf);
    poses[pose] = name;
  };

  save('stand', await generatePose([source], LOOK + POSES.stand));
  const reference = path.join(dir, poses.stand);
  const rest = POSE_NAMES.filter((p) => p !== 'stand');
  const prompt = (pose) =>
    `${LOOK}The second input image shows this person's full body and outfit - match it exactly. ${POSES[pose]}`;
  for (let i = 0; i < rest.length; i += PARALLEL_POSES) {
    const batch = rest.slice(i, i + PARALLEL_POSES);
    const bufs = await Promise.all(batch.map((pose) => generatePose([source, reference], prompt(pose))));
    batch.forEach((pose, j) => save(pose, bufs[j]));
  }
  writeManifest(sticker, { version: VERSION, status: 'ready', poses, at: Date.now() });
  console.log(`[bodies] ${sticker} ready`);
}

/** Serves the cached images (immutable names, so cacheable for long). */
function registerBodiesRoutes(app, express) {
  fs.mkdirSync(BODIES_DIR, { recursive: true });
  app.use('/bodies', express.static(BODIES_DIR, { maxAge: '30d', immutable: true, index: false }));
}

/** Test hook: forget in-memory state (the disk cache stays). */
function _reset() {
  manifests.clear();
  queue.length = 0;
  queued.clear();
  running = false;
}

/** Test hook: resolves once the queue is drained. */
async function _idle() {
  while (running || queue.length) await new Promise((r) => setTimeout(r, 5));
}

module.exports = { bodiesFor, ensureBodies, registerBodiesRoutes, POSE_NAMES, BODIES_DIR, VERSION, _reset, _idle };
