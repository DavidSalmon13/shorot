'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRecapData, rankPlayers, emojiForName, clip } = require('../../server/recaps/data');
const tenseconds = require('../../server/games/tenseconds');
const imposter = require('../../server/games/imposter');
const { createTestCtx, createRoom, makeHandlerSocket, registerGame, call } = require('../helpers/harness');

const roomWith = (stickers = {}) => ({
  players: new Map(Object.entries(stickers).map(([n, sticker]) => [n, { sticker }])),
});

test('clip trims, collapses whitespace and caps length', () => {
  assert.equal(clip('  a   b  '), 'a b');
  assert.equal(clip('x'.repeat(30), 10), `${'x'.repeat(9)}…`);
  assert.equal(clip({ evil: true }), '');
  assert.equal(clip(42), '42');
});

test('emojiForName matches the app fallback (same list and hash as playerEmoji.js)', () => {
  assert.equal(emojiForName('Dana'), emojiForName('Dana'));
  assert.ok(['🦊', '🐼', '🐸', '🐵', '🐯', '🐨', '🐷', '🐙', '🦁', '🐮', '🐰', '🐻', '🐔', '🦄', '🐢', '🦉', '🐝', '🐳', '🦋', '🐺'].includes(emojiForName('Ron')));
});

test('rankPlayers: points desc, winners first on ties, shared places, avatars', () => {
  const room = roomWith({ Ann: 'a.webp', Bob: 'b.gif', Cid: null, Dee: null });
  const rows = rankPlayers(room, [
    { name: 'Cid', points: 1, won: false },
    { name: 'Ann', points: 3, won: true },
    { name: 'Bob', points: 1, won: true },
    { name: 'Dee', points: 1, won: false },
  ]);
  assert.deepEqual(rows.map((r) => [r.name, r.place]), [['Ann', 1], ['Bob', 2], ['Cid', 3], ['Dee', 3]]);
  assert.equal(rows[0].avatar.kind, 'sticker');
  assert.equal(rows[0].avatar.sticker, 'a.webp');
  assert.equal(rows[1].avatar.kind, 'emoji', 'GIF stickers fall back to emoji');
});

test('rankPlayers caps the player count and name length', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ name: `Player number ${i} with a long name`, points: i }));
  const rows = rankPlayers(roomWith(), many);
  assert.equal(rows.length, 12);
  assert.ok(rows.every((r) => [...r.name].length <= 24));
});

test('buildRecapData: generic when the game has no recapData; title and date filled in', () => {
  const data = buildRecapData({
    room: roomWith(),
    gameType: 'bluff',
    participants: [{ name: 'Ann', points: 2, won: true }],
    game: {},
    now: new Date('2026-11-23T10:00:00Z'),
  });
  assert.equal(data.template, 'generic');
  assert.equal(data.title, 'Bluff');
  assert.equal(data.date, '2026-11-23');
  assert.equal(data.highlight, null);
});

test('buildRecapData: a throwing recapData falls back to generic instead of failing', () => {
  const data = buildRecapData({
    room: roomWith(),
    gameType: 'imposter',
    participants: [{ name: 'Ann', points: 0 }],
    game: { recapData: () => { throw new Error('boom'); } },
  });
  assert.equal(data.template, 'generic');
});

test('buildRecapData: highlight strings are clipped, functions dropped, template moved out', () => {
  const data = buildRecapData({
    room: roomWith(),
    gameType: 'imposter',
    participants: [{ name: 'Ann', points: 0 }],
    game: { recapData: () => ({ template: 'imposter', word: 'w'.repeat(200), fn: () => 1, list: ['a', 'b'] }) },
  });
  assert.equal(data.template, 'imposter');
  assert.equal(data.highlight.template, undefined);
  assert.equal(data.highlight.fn, undefined);
  assert.equal([...data.highlight.word].length, 80);
  assert.deepEqual(data.highlight.list, ['a', 'b']);
});

test('tenseconds.recapData after a real match: champion, final duel sorted by distance, knock-out order', async () => {
  const { ctx } = createTestCtx();
  const room = createRoom(ctx, 'AAAA', ['Ann', 'Bob', 'Cid'], { game: 'tenseconds', phase: 'lobby' });
  tenseconds.onChoose(ctx, 'AAAA', room);
  const s = Object.fromEntries(['Ann', 'Bob', 'Cid'].map((n) => [n, registerGame(tenseconds, ctx, makeHandlerSocket('AAAA', n))]));
  await call(s.Ann, 'startTensSeconds');
  room.state.tenseconds.roundStartAt = Date.now() - 1;
  await call(s.Ann, 'tsStop', 10000);
  await call(s.Bob, 'tsStop', 9000);
  await call(s.Cid, 'tsStop', 7000);
  await call(s.Ann, 'tsContinue');
  await call(s.Ann, 'startTensSeconds');
  room.state.tenseconds.roundStartAt = Date.now() - 1;
  await call(s.Ann, 'tsStop', 10020);
  await call(s.Bob, 'tsStop', 11000);
  await call(s.Ann, 'tsContinue');
  assert.equal(room.phase, 'gameover');

  const h = tenseconds.recapData(room);
  assert.equal(h.template, 'ten-seconds');
  assert.equal(h.champion, 'Ann');
  assert.deepEqual(h.finalRound, [
    { name: 'Ann', time: '10.020', off: '0.020' },
    { name: 'Bob', time: '11.000', off: '1.000' },
  ]);
  assert.deepEqual(h.out, ['Cid', 'Bob']);
});

test('imposter.recapData (word mode): imposter, caught flag, word and hint', () => {
  const { ctx } = createTestCtx();
  const room = createRoom(ctx, 'AAAA', ['Ann', 'Bob', 'Cid'], { game: 'imposter', phase: 'reporting' });
  room.players.get('Ann').role = 'crew';
  room.players.get('Ann').word = 'Pizza';
  room.players.get('Bob').role = 'crew';
  room.players.get('Bob').word = 'Pizza';
  room.players.get('Cid').role = 'imposter';
  room.players.get('Cid').hint = 'Italian';
  const participants = [
    { name: 'Ann', role: 'crew', won: true, points: 1, details: { eliminated: false } },
    { name: 'Bob', role: 'crew', won: false, points: 0, details: { eliminated: true } },
    { name: 'Cid', role: 'imposter', won: true, points: 3, details: { eliminated: false } },
  ];
  assert.deepEqual(imposter.recapData(room, participants), {
    template: 'imposter',
    mode: 'word',
    imposters: ['Cid'],
    caught: false,
    word: 'Pizza',
    hint: 'Italian',
  });
  participants[2].details.eliminated = true;
  assert.equal(imposter.recapData(room, participants).caught, true);
});
