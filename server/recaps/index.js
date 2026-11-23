/**
 * Recap videos: a short video of each finished game (title, a per-game highlight, the results),
 * rendered on this server with HyperFrames and offered to everyone in the room to watch, save and
 * share. Spec: docs/specs/recap-videos-specs.md.
 *
 * Off unless RECAPS_ENABLED=true and the renderer is available (Node >= 22, the hyperframes
 * package, FFmpeg). Off means: no renders, no recap UI, and the app behaves exactly as before.
 * Recaps only observe a finished game. They never change scores, ratings, tokens or game state.
 *
 * Flow: ctx.recordGameResult (server.js) -> onGameResult -> buildRecapData (synchronous, while
 * the room still holds the game's state) -> queue -> renderer -> DATA_DIR/recaps/<id>.mp4, served
 * at /recaps/<id>.mp4 -> 'recapStatus' to the room.
 *
 * Room fields (persisted, see SHARED_SAVED_FIELDS in gameRegistry.js):
 *   room.recap     { id, status: 'rendering' | 'ready', gameType, at } or null
 *   room.recapsOff true when the host turned recaps off for the room
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildRecapData } = require('./data');
const { createQueue } = require('./queue');
const { sweep } = require('./cleanup');

const ID_RE = /^[0-9a-f]{32}$/;

function readConfig(env = process.env) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    enabled: env.RECAPS_ENABLED === 'true',
    quality: ['draft', 'looks', 'delivery'].includes(env.RECAP_QUALITY) ? env.RECAP_QUALITY : 'draft',
    workers: num(env.RECAP_WORKERS, 2),
    timeoutMs: num(env.RECAP_TIMEOUT_MS, 180000),
    maxQueue: num(env.RECAP_MAX_QUEUE, 5),
    ttlMs: num(env.RECAP_TTL_HOURS, 24) * 3600 * 1000,
    maxBytes: num(env.RECAP_MAX_DISK_MB, 500) * 1024 * 1024,
  };
}

/**
 * deps: { dataDir, roomEmit(code, event, payload), getGame(id), log(type, msg),
 *         renderer: { available(), render(opts) }, env?, newId? }
 */
function createRecaps(deps) {
  const config = readConfig(deps.env);
  const dir = path.join(deps.dataDir, 'recaps');
  const log = deps.log || (() => {});
  const newId = deps.newId || (() => crypto.randomBytes(16).toString('hex'));
  let active = false;

  const queue = createQueue({
    maxQueue: config.maxQueue,
    run: (job) =>
      deps.renderer.render({
        data: job.data,
        jobDir: path.join(dir, 'tmp', job.id),
        outFile: path.join(dir, 'tmp', job.id, 'out.mp4'),
        quality: config.quality,
        workers: config.workers,
        timeoutMs: config.timeoutMs,
      }),
    onDrop: (job, why) => job.onError(new Error(why === 'full' ? 'render queue full' : 'replaced by a newer game')),
  });

  /** Called once at boot. Decides whether the feature is on and clears what a restart lost. */
  function start(rooms) {
    if (!config.enabled) return false;
    const avail = deps.renderer.available();
    if (!avail.ok) {
      console.warn(`[recaps] RECAPS_ENABLED is set but recaps are off: ${avail.reason}`);
      return false;
    }
    active = true;
    fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
    for (const room of rooms.values()) {
      if (room.recap && room.recap.status !== 'ready') room.recap = null; // its job died with the old process
    }
    sweep({ dir, ttlMs: config.ttlMs, maxBytes: config.maxBytes, atBoot: true });
    setInterval(() => sweep({ dir, ttlMs: config.ttlMs, maxBytes: config.maxBytes }), 3600 * 1000).unref();
    console.log(`[recaps] on (quality ${config.quality}, ${config.workers} workers)`);
    return true;
  }

  const fileFor = (id) => path.join(dir, `${id}.mp4`);

  /** What a phone needs to show the recap chip and the host toggle. */
  function statusFor(room) {
    const base = { available: active, roomEnabled: !room.recapsOff };
    const r = room.recap;
    if (!active || !r) return { ...base, status: 'none' };
    if (r.status === 'ready' && !fs.existsSync(fileFor(r.id))) return { ...base, status: 'none' }; // expired
    return {
      ...base,
      status: r.status,
      id: r.id,
      gameType: r.gameType,
      url: r.status === 'ready' ? `/recaps/${r.id}.mp4` : null,
    };
  }

  const broadcast = (roomCode, room) => deps.roomEmit(roomCode, 'recapStatus', statusFor(room));

  /** Entry point from ctx.recordGameResult. Never throws. */
  function onGameResult({ room, roomCode, gameType, participants }) {
    try {
      if (!active || !roomCode || room.recapsOff || !participants || !participants.length) return;
      const data = buildRecapData({ room, gameType, participants, game: deps.getGame(gameType) });
      const id = newId();
      room.recap = { id, status: 'rendering', gameType, at: Date.now() };
      broadcast(roomCode, room);
      const current = () => room.recap && room.recap.id === id;
      queue.push({
        id,
        roomKey: roomCode,
        data,
        onDone: (result) => {
          fs.renameSync(path.join(dir, 'tmp', id, 'out.mp4'), fileFor(id));
          fs.rmSync(path.join(dir, 'tmp', id), { recursive: true, force: true });
          log('recap', `🎬 recap rendered (${data.title}, ${result.template}, ${Math.round(result.ms / 1000)}s)`);
          if (!current()) return;
          room.recap = { ...room.recap, status: 'ready', at: Date.now() };
          broadcast(roomCode, room);
        },
        onError: (err) => {
          fs.rmSync(path.join(dir, 'tmp', id), { recursive: true, force: true });
          console.error(`[recaps] ${gameType} recap failed:`, err.message);
          log('recap', `🎬 recap failed (${data.title}): ${String(err.message).slice(0, 120)}`);
          if (!current()) return;
          room.recap = null;
          broadcast(roomCode, room);
        },
      });
    } catch (err) {
      console.error('[recaps] onGameResult failed:', err.message);
    }
  }

  /** Socket handlers: any player can ask for the status; only the host can turn recaps on/off. */
  function registerHandlers(socket, { getRoom }) {
    socket.on('getRecapStatus', (callback) => {
      if (typeof callback !== 'function') return;
      const room = getRoom(socket);
      callback(room ? statusFor(room) : { available: false, status: 'none' });
    });
    socket.on('setRecapsEnabled', (on, callback) => {
      callback = typeof callback === 'function' ? callback : () => {};
      const room = getRoom(socket);
      if (!room) return callback({ ok: false, error: 'Not in a room' });
      if (!active) return callback({ ok: false, error: 'Recaps are not available' });
      if (socket.data.name !== room.hostName) return callback({ ok: false, error: 'Only the host can change this' });
      room.recapsOff = on !== true;
      callback({ ok: true });
      broadcast(socket.data.roomCode, room);
    });
  }

  /** Serves finished recaps. Ids are 128-bit random and only ever *.mp4 in the recaps folder. */
  function registerRoutes(app) {
    app.get('/recaps/:file', (req, res) => {
      const m = /^([0-9a-f]+)\.mp4$/.exec(req.params.file);
      if (!active || !m || !ID_RE.test(m[1]) || !fs.existsSync(fileFor(m[1]))) return res.sendStatus(404);
      res.set('Cache-Control', 'private, max-age=86400');
      res.sendFile(fileFor(m[1]));
    });
  }

  return { start, onGameResult, statusFor, registerHandlers, registerRoutes, config, isActive: () => active };
}

module.exports = { createRecaps, readConfig };
