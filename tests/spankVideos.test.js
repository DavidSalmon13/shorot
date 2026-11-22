// AI spanking video for the Spanking gag (server/spankVideos.js on server/gagVideos.js): first
// an opening frame from the sticker (image edit), then the video from that frame. fal.ai is
// mocked via global.fetch; the cache goes to a throwaway DATA_DIR.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shorot-spankvideos-'));
const spankVideos = require('../server/spankVideos');
const spankConsent = require('../server/spankConsent');
const { stickerFiles } = require('../server/stickers');

const STICKER = stickerFiles().find((f) => f.endsWith('.webp'));
const FRAME_URL = 'https://v3b.fal.media/files/frame.jpg';

/** A fake fal queue: each submit -> one IN_PROGRESS poll -> COMPLETED -> result; then the mp4. */
function mockFal(t, { failVideo = false, onVideoSubmit = null } = {}) {
  const calls = [];
  const polls = {};
  t.mock.method(global, 'fetch', async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body });
    const json = (data) => ({ ok: true, json: async () => data });
    const m = url.match(/^https:\/\/queue\.fal\.run\/(.+)$/);
    if (m && opts.method === 'POST') {
      const job = m[1].includes('edit') ? 'frame' : 'video';
      if (job === 'video' && onVideoSubmit) onVideoSubmit();
      if (job === 'video' && failVideo) return { ok: false, status: 422, text: async () => 'content_policy_violation' };
      return json({ status_url: `https://queue.fal.run/job/${job}/status`, response_url: `https://queue.fal.run/job/${job}` });
    }
    const st = url.match(/^https:\/\/queue\.fal\.run\/job\/(\w+)\/status$/);
    if (st) return json({ status: polls[st[1]]++ ? 'COMPLETED' : ((polls[st[1]] = 1), 'IN_PROGRESS') });
    if (url === 'https://queue.fal.run/job/frame') return json({ images: [{ url: FRAME_URL }] });
    if (url === 'https://queue.fal.run/job/video') return json({ video: { url: 'https://v3b.fal.media/files/out.mp4' } });
    if (url === 'https://v3b.fal.media/files/out.mp4') return { ok: true, arrayBuffer: async () => Buffer.from('mp4-bytes') };
    throw new Error(`unexpected fetch ${url}`);
  });
  return calls;
}

test.beforeEach(() => {
  spankVideos._reset();
  spankVideos._setPollMs(1);
  fs.rmSync(spankVideos.VIDEOS_DIR, { recursive: true, force: true });
  process.env.FAL_KEY = 'test-key';
});

test('makes an opening frame from the sticker, then animates that frame', async (t) => {
  const calls = mockFal(t);
  spankVideos.ensureVideo(STICKER);
  await spankVideos._idle();

  const submits = calls.filter((c) => c.method === 'POST');
  assert.equal(submits.length, 2);
  assert.match(submits[0].url, /seedream\/v4\/edit$/);
  const frame = JSON.parse(submits[0].body);
  assert.match(frame.image_urls[0], /^data:image\/webp;base64,/);
  assert.match(frame.prompt, /speedo/);
  assert.match(submits[1].url, /image-to-video$/);
  assert.equal(JSON.parse(submits[1].body).image_url, FRAME_URL);

  const url = spankVideos.videoFor(STICKER);
  assert.match(url, /^\/spankvideos\/.+\/spank\.v\d+\.mp4$/);
});

test('a refused video is recorded as failed, with no clip', async (t) => {
  mockFal(t, { failVideo: true });
  spankVideos.ensureVideo(STICKER);
  await spankVideos._idle();
  assert.equal(spankVideos.videoFor(STICKER), null);
});

test('removeVideo deletes a cached clip', async (t) => {
  mockFal(t);
  spankVideos.ensureVideo(STICKER);
  await spankVideos._idle();
  assert.ok(spankVideos.videoFor(STICKER));
  spankVideos.removeVideo(STICKER);
  assert.equal(spankVideos.videoFor(STICKER), null);
  assert.equal(fs.existsSync(path.join(spankVideos.VIDEOS_DIR, STICKER)), false);
});

test('a clip removed while it is being made is discarded, not saved', async (t) => {
  mockFal(t, { onVideoSubmit: () => spankVideos.removeVideo(STICKER) });
  spankVideos.ensureVideo(STICKER);
  await spankVideos._idle();
  assert.equal(spankVideos.videoFor(STICKER), null);
});

test('without a database nobody is opted in', async () => {
  assert.equal(await spankConsent.isAllowed(1, STICKER), false);
  assert.equal(await spankConsent.isAllowed(null, STICKER), false);
});
