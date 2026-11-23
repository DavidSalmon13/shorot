'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRecaps, readConfig } = require('../../server/recaps');

const ID = 'a'.repeat(32);

/** A recaps instance with a fake renderer that writes a tiny out.mp4 (or fails / hangs on request). */
function setup({ env = { RECAPS_ENABLED: 'true' }, available = { ok: true }, behaviour = 'ok' } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recaps-test-'));
  const emits = [];
  const logs = [];
  const renders = [];
  let ids = 0;
  const renderer = {
    available: () => available,
    render: async (opts) => {
      renders.push(opts);
      if (behaviour === 'fail') throw new Error('chrome crashed');
      fs.mkdirSync(opts.jobDir, { recursive: true });
      fs.writeFileSync(opts.outFile, 'mp4');
      return { ms: 1234, template: opts.data.template };
    },
  };
  const recaps = createRecaps({
    dataDir,
    env,
    renderer,
    roomEmit: (code, event, payload) => emits.push({ code, event, payload }),
    getGame: () => ({ recapData: () => ({ template: 'imposter', word: 'Pizza' }) }),
    log: (type, msg) => logs.push(msg),
    newId: () => String(++ids).padStart(32, '0'),
  });
  const rooms = new Map();
  const room = { hostName: 'Ann', players: new Map([['Ann', {}], ['Bob', {}]]) };
  rooms.set('MAIN', room);
  return { recaps, rooms, room, dataDir, emits, logs, renders };
}

const participants = [
  { name: 'Ann', points: 3, won: true },
  { name: 'Bob', points: 0, won: false },
];
const tick = () => new Promise((r) => setImmediate(r));

test('readConfig: off by default, sane defaults, bad values ignored', () => {
  const c = readConfig({});
  assert.equal(c.enabled, false);
  assert.equal(c.quality, 'draft');
  assert.equal(c.workers, 2);
  const d = readConfig({ RECAPS_ENABLED: 'true', RECAP_QUALITY: 'ultra', RECAP_WORKERS: '-3', RECAP_TTL_HOURS: '2' });
  assert.equal(d.enabled, true);
  assert.equal(d.quality, 'draft');
  assert.equal(d.workers, 2);
  assert.equal(d.ttlMs, 2 * 3600 * 1000);
});

test('feature off: start() is false and onGameResult does nothing', () => {
  const { recaps, rooms, room, emits, renders } = setup({ env: {} });
  assert.equal(recaps.start(rooms), false);
  recaps.onGameResult({ room, roomCode: 'MAIN', gameType: 'imposter', participants });
  assert.equal(room.recap, undefined);
  assert.equal(emits.length, 0);
  assert.equal(renders.length, 0);
  assert.equal(recaps.statusFor(room).available, false);
});

test('enabled but renderer unavailable: stays off', () => {
  const { recaps, rooms } = setup({ available: { ok: false, reason: 'ffmpeg is not installed' } });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(recaps.start(rooms), false);
  } finally {
    console.warn = warn;
  }
  assert.equal(recaps.isActive(), false);
});

test('happy path: rendering -> ready, file moved into place, statuses broadcast', async () => {
  const { recaps, rooms, room, dataDir, emits, renders, logs } = setup();
  recaps.start(rooms);
  recaps.onGameResult({ room, roomCode: 'MAIN', gameType: 'imposter', participants });
  assert.equal(emits[0].payload.status, 'rendering');
  assert.equal(renders[0].data.template, 'imposter', 'game highlight reaches the renderer');
  assert.equal(renders[0].data.highlight.word, 'Pizza');
  await tick();
  const id = '1'.padStart(32, '0');
  assert.equal(room.recap.status, 'ready');
  assert.ok(fs.existsSync(path.join(dataDir, 'recaps', `${id}.mp4`)));
  assert.ok(!fs.existsSync(path.join(dataDir, 'recaps', 'tmp', id)), 'job dir removed');
  const last = emits[emits.length - 1].payload;
  assert.deepEqual(
    { status: last.status, url: last.url, available: last.available, roomEnabled: last.roomEnabled },
    { status: 'ready', url: `/recaps/${id}.mp4`, available: true, roomEnabled: true }
  );
  assert.match(logs[0], /recap rendered/);
});

test('render failure clears the recap and tells the room', async () => {
  const { recaps, rooms, room, emits } = setup({ behaviour: 'fail' });
  recaps.start(rooms);
  const err = console.error;
  console.error = () => {};
  try {
    recaps.onGameResult({ room, roomCode: 'MAIN', gameType: 'imposter', participants });
    await tick();
  } finally {
    console.error = err;
  }
  assert.equal(room.recap, null);
  assert.equal(emits[emits.length - 1].payload.status, 'none');
});

test('room toggle off: no render; only the host can change it', async () => {
  const { recaps, rooms, room, renders } = setup();
  recaps.start(rooms);
  const handlers = {};
  const sock = (name) => ({ data: { roomCode: 'MAIN', name }, on: (e, h) => (handlers[`${name}:${e}`] = h) });
  recaps.registerHandlers(sock('Ann'), { getRoom: () => room });
  recaps.registerHandlers(sock('Bob'), { getRoom: () => room });
  const res = await new Promise((r) => handlers['Bob:setRecapsEnabled'](false, r));
  assert.equal(res.ok, false);
  assert.equal(room.recapsOff, undefined);
  assert.equal((await new Promise((r) => handlers['Ann:setRecapsEnabled'](false, r))).ok, true);
  assert.equal(room.recapsOff, true);
  recaps.onGameResult({ room, roomCode: 'MAIN', gameType: 'imposter', participants });
  assert.equal(renders.length, 0);
  const status = await new Promise((r) => handlers['Bob:getRecapStatus'](r));
  assert.equal(status.roomEnabled, false);
});

test('boot: a recap that was still rendering when the server stopped is cleared; a ready one is kept', () => {
  const { recaps, rooms, room, dataDir } = setup();
  const other = { players: new Map(), recap: { id: ID, status: 'ready', gameType: 'bluff' } };
  rooms.set('OTHER', other);
  room.recap = { id: 'b'.repeat(32), status: 'rendering', gameType: 'imposter' };
  fs.mkdirSync(path.join(dataDir, 'recaps'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'recaps', `${ID}.mp4`), 'x');
  recaps.start(rooms);
  assert.equal(room.recap, null);
  assert.equal(recaps.statusFor(other).status, 'ready');
  fs.unlinkSync(path.join(dataDir, 'recaps', `${ID}.mp4`));
  assert.equal(recaps.statusFor(other).status, 'none', 'an expired file reads as no recap');
});

test('route: serves only well-formed ids that exist', () => {
  const { recaps, rooms, dataDir } = setup();
  recaps.start(rooms);
  fs.writeFileSync(path.join(dataDir, 'recaps', `${ID}.mp4`), 'x');
  let route;
  recaps.registerRoutes({ get: (p, h) => (route = h) });
  const res = () => {
    const r = { status: null, file: null, headers: {} };
    r.sendStatus = (s) => (r.status = s);
    r.sendFile = (f) => (r.file = f);
    r.set = (k, v) => (r.headers[k] = v);
    return r;
  };
  const ok = res();
  route({ params: { file: `${ID}.mp4` } }, ok);
  assert.equal(ok.file, path.join(dataDir, 'recaps', `${ID}.mp4`));
  for (const bad of ['../rooms.json', `${'c'.repeat(32)}.mp4`, 'abc.mp4', `${ID}.json`]) {
    const r = res();
    route({ params: { file: bad } }, r);
    assert.equal(r.status, 404, bad);
  }
});
