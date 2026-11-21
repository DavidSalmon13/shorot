// AI dishes video generation + cache for the Go Do the Dishes gag (server/dishVideos.js). fal.ai
// is mocked via global.fetch; the cache goes to a throwaway DATA_DIR.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shorot-dishvideos-'));
const dishVideos = require('../server/dishVideos');
const { stickerFiles } = require('../server/stickers');

const STICKER = stickerFiles().find((f) => f.endsWith('.webp'));
const GIF = stickerFiles().find((f) => f.endsWith('.gif'));

/** A fake fal queue: submit -> one IN_PROGRESS poll -> COMPLETED -> result -> mp4 download. */
function mockFal(t, { failSubmit = false, jobStatus = 'COMPLETED' } = {}) {
  const calls = [];
  let polls = 0;
  t.mock.method(global, 'fetch', async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', auth: opts.headers && opts.headers.Authorization, body: opts.body });
    const json = (data) => ({ ok: true, json: async () => data });
    if (url.startsWith('https://queue.fal.run/') && opts.method === 'POST') {
      if (failSubmit) return { ok: false, status: 403, text: async () => 'Exhausted balance' };
      return json({ status_url: 'https://queue.fal.run/job/status', response_url: 'https://queue.fal.run/job' });
    }
    if (url === 'https://queue.fal.run/job/status') return json({ status: polls++ ? jobStatus : 'IN_PROGRESS' });
    if (url === 'https://queue.fal.run/job') return json({ video: { url: 'https://v3b.fal.media/files/out.mp4' } });
    if (url === 'https://v3b.fal.media/files/out.mp4') return { ok: true, arrayBuffer: async () => Buffer.from('mp4-bytes') };
    throw new Error(`unexpected fetch ${url}`);
  });
  return calls;
}

test.beforeEach(() => {
  dishVideos._reset();
  dishVideos._setPollMs(1);
  fs.rmSync(dishVideos.VIDEOS_DIR, { recursive: true, force: true });
  process.env.FAL_KEY = 'test-key';
});

test('nothing is ready before generation, and nothing runs without FAL_KEY', async (t) => {
  delete process.env.FAL_KEY;
  const calls = mockFal(t);
  assert.equal(dishVideos.videoFor(STICKER), null);
  dishVideos.ensureVideo(STICKER);
  await dishVideos._idle();
  assert.equal(calls.length, 0);
});

test('submits the sticker to fal, waits for the job, downloads and caches the video', async (t) => {
  const calls = mockFal(t);
  dishVideos.ensureVideo(STICKER);
  await dishVideos._idle();

  const submit = calls[0];
  assert.equal(submit.method, 'POST');
  assert.match(submit.url, /^https:\/\/queue\.fal\.run\/wan\/v2\.6\/image-to-video$/);
  assert.equal(submit.auth, 'Key test-key');
  const body = JSON.parse(submit.body);
  assert.match(body.image_url, /^data:image\/webp;base64,/);
  assert.match(body.prompt, /dishes|plate/);

  const url = dishVideos.videoFor(STICKER);
  assert.match(url, /^\/dishvideos\/.+\/dishes\.v\d+\.mp4$/);
  const file = path.join(dishVideos.VIDEOS_DIR, decodeURIComponent(url.split('/')[2]), url.split('/')[3]);
  assert.equal(fs.readFileSync(file, 'utf8'), 'mp4-bytes');

  // Cached: asking again makes no new calls.
  const before = calls.length;
  dishVideos.ensureVideo(STICKER);
  await dishVideos._idle();
  assert.equal(calls.length, before);
});

test('a failed generation is recorded and not retried straight away', async (t) => {
  const calls = mockFal(t, { failSubmit: true });
  dishVideos.ensureVideo(STICKER);
  await dishVideos._idle();
  assert.equal(dishVideos.videoFor(STICKER), null);
  assert.equal(calls.length, 1);
  dishVideos.ensureVideo(STICKER);
  await dishVideos._idle();
  assert.equal(calls.length, 1);
});

test('a job that ends in an error state fails cleanly', async (t) => {
  mockFal(t, { jobStatus: 'FAILED' });
  dishVideos.ensureVideo(STICKER);
  await dishVideos._idle();
  assert.equal(dishVideos.videoFor(STICKER), null);
});

test('only still photo stickers are sent (no GIFs, no unknown ids)', async (t) => {
  const calls = mockFal(t);
  dishVideos.ensureVideo('not-a-sticker.webp', GIF, null);
  await dishVideos._idle();
  assert.equal(calls.length, 0);
});
