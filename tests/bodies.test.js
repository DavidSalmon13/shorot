// Realistic body generation + cache for the Spanking gag (server/bodies.js). OpenAI is
// mocked via global.fetch; the cache goes to a throwaway DATA_DIR.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'shorot-bodies-'));
const bodies = require('../server/bodies');
const { stickerFiles } = require('../server/stickers');

const STICKER = stickerFiles().find((f) => f.endsWith('.webp'));

function mockOpenAI(t, { fail = false } = {}) {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, opts) => {
    calls.push({ url, prompt: opts.body.get('prompt'), images: opts.body.getAll('image[]').length });
    if (fail) return { ok: false, status: 400, text: async () => 'nope' };
    return { ok: true, json: async () => ({ data: [{ b64_json: Buffer.from(`img-${calls.length}`).toString('base64') }] }) };
  });
  return calls;
}

test.beforeEach(() => {
  bodies._reset();
  fs.rmSync(bodies.BODIES_DIR, { recursive: true, force: true });
  process.env.OPENAI_API_KEY = 'test-key';
});

test('no set is ready before generation, and nothing runs without an API key', async (t) => {
  delete process.env.OPENAI_API_KEY;
  const calls = mockOpenAI(t);
  assert.equal(bodies.bodiesFor(STICKER), null);
  bodies.ensureBodies(STICKER);
  await bodies._idle();
  assert.equal(calls.length, 0);
});

test('generates every pose once (stand first, then the rest from sticker + stand), then serves the cache', async (t) => {
  const calls = mockOpenAI(t);
  bodies.ensureBodies(STICKER, STICKER); // duplicate ask is de-duplicated
  await bodies._idle();
  assert.equal(calls.length, bodies.POSE_NAMES.length);
  assert.ok(calls.every((c) => c.url === 'https://api.openai.com/v1/images/edits'));
  assert.equal(calls[0].images, 1); // stand: from the sticker alone
  assert.ok(calls.slice(1).every((c) => c.images === 2)); // others: sticker + the standing figure

  const set = bodies.bodiesFor(STICKER);
  assert.deepEqual(Object.keys(set).sort(), [...bodies.POSE_NAMES].sort());
  assert.ok(set.bent.startsWith('/bodies/'));
  const file = path.join(bodies.BODIES_DIR, decodeURIComponent(set.bent.split('/')[2]), set.bent.split('/')[3]);
  assert.ok(fs.existsSync(file));

  // Cached: asking again (even after a restart) makes no new calls.
  bodies._reset();
  bodies.ensureBodies(STICKER);
  await bodies._idle();
  assert.equal(calls.length, bodies.POSE_NAMES.length);
  assert.ok(bodies.bodiesFor(STICKER));
});

test('a failed generation is recorded and not retried right away', async (t) => {
  const calls = mockOpenAI(t, { fail: true });
  bodies.ensureBodies(STICKER);
  await bodies._idle();
  assert.equal(bodies.bodiesFor(STICKER), null);
  const before = calls.length;
  bodies.ensureBodies(STICKER);
  await bodies._idle();
  assert.equal(calls.length, before);
});

test('ignores players without a valid sticker', async (t) => {
  const calls = mockOpenAI(t);
  bodies.ensureBodies(null, undefined, 'not-a-sticker.webp', '../../etc/passwd');
  await bodies._idle();
  assert.equal(calls.length, 0);
  assert.equal(bodies.bodiesFor('not-a-sticker.webp'), null);
});
