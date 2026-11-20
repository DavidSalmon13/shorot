'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const imposter = require('../../server/games/imposter');
const {
  createTestCtx,
  createRoom,
  makeHandlerSocket,
  registerGame,
  call,
  emissionsFor,
  mockOpenAi,
  mockOpenAiFailure,
  flush,
} = require('../helpers/harness');

test('contract shape', () => {
  assert.equal(imposter.id, 'imposter');
  assert.equal(imposter.minPlayers, 3);
  const ns = imposter.namespaces.find((n) => n.id === 'imposter');
  assert.ok(Array.isArray(ns.savedFields));
});

test('vote: rejects wrong phase and invalid level, accepts a valid vote', async () => {
  const { ctx } = createTestCtx();
  const room = createRoom(ctx, 'AAAA', ['Ann', 'Bob', 'Cid'], { game: 'imposter', phase: 'playing' });
  const socket = registerGame(imposter, ctx, makeHandlerSocket('AAAA', 'Ann'));

  const wrongPhase = await call(socket, 'vote', 'easy');
  assert.equal(wrongPhase.ok, false);

  room.phase = 'voting';
  const badLevel = await call(socket, 'vote', 'nightmare');
  assert.equal(badLevel.ok, false);

  const good = await call(socket, 'vote', 'easy');
  assert.equal(good.ok, true);
  assert.equal(room.players.get('Ann').vote, 'easy');
});

test('full round: voting -> generated word/roles -> reporting -> scored results', async () => {
  const { ctx } = createTestCtx();
  const room = createRoom(ctx, 'AAAA', ['Ann', 'Bob', 'Cid'], { game: 'imposter', phase: 'lobby' });
  imposter.onChoose(ctx, 'AAAA', room);
  assert.equal(room.phase, 'voting');

  const annSocket = registerGame(imposter, ctx, makeHandlerSocket('AAAA', 'Ann'));
  const bobSocket = registerGame(imposter, ctx, makeHandlerSocket('AAAA', 'Bob'));
  const cidSocket = registerGame(imposter, ctx, makeHandlerSocket('AAAA', 'Cid'));

  const restoreOpenAi = mockOpenAi({ word: 'Guitar', hint: 'You strum it.' });
  try {
    await call(annSocket, 'vote', 'easy');
    await call(bobSocket, 'vote', 'easy');
    // The last vote fires finishVoting without awaiting it, so give that chain a tick to settle.
    await call(cidSocket, 'vote', 'easy');
    await flush();
  } finally {
    restoreOpenAi();
  }

  assert.equal(room.phase, 'playing');
  assert.equal(room.state.imposter.currentLevel, 'easy');

  const roles = ['Ann', 'Bob', 'Cid'].map((n) => room.players.get(n).role);
  const imposterCount = roles.filter((r) => r === 'imposter').length;
  assert.equal(imposterCount, 1, 'exactly one imposter with 3 players');
  assert.equal(roles.filter((r) => r === 'crew').length, 2);

  // Each connected player got their own private 'role' emit with the matching word/hint.
  for (const name of ['Ann', 'Bob', 'Cid']) {
    const p = room.players.get(name);
    const roleEmits = emissionsFor(ctx.io, room, name).filter((e) => e.event === 'role');
    assert.equal(roleEmits.length, 1);
    assert.equal(roleEmits[0].payload.role, p.role);
    if (p.role === 'imposter') {
      assert.equal(roleEmits[0].payload.word, null);
      assert.equal(roleEmits[0].payload.hint, 'You strum it.');
    } else {
      assert.equal(roleEmits[0].payload.word, 'Guitar');
      assert.equal(roleEmits[0].payload.hint, null);
    }
  }

  // Host ends the round -> reporting phase.
  const hostSocket = registerGame(imposter, ctx, makeHandlerSocket('AAAA', room.hostName));
  const endRes = await call(hostSocket, 'endImposterRound');
  assert.equal(endRes.ok, true);
  assert.equal(room.phase, 'reporting');

  // Everyone reports "not eliminated" -> imposter should score 3, crew should score 1 each.
  for (const name of ['Ann', 'Bob', 'Cid']) {
    const sock = registerGame(imposter, ctx, makeHandlerSocket('AAAA', name));
    const res = await call(sock, 'reportEliminated', false);
    assert.equal(res.ok, true);
  }

  assert.equal(room.phase, 'roundResults');
  for (const name of ['Ann', 'Bob', 'Cid']) {
    const p = room.players.get(name);
    const expected = p.role === 'imposter' ? 3 : 1;
    assert.equal(room.scoreboard[name], expected, `${name} (${p.role}) should score ${expected}`);
  }
});

test('failed OpenAI call falls back to voting with an error broadcast', async () => {
  const { ctx } = createTestCtx();
  const room = createRoom(ctx, 'AAAA', ['Ann', 'Bob', 'Cid'], { game: 'imposter', phase: 'voting' });
  const sockets = ['Ann', 'Bob', 'Cid'].map((n) => registerGame(imposter, ctx, makeHandlerSocket('AAAA', n)));

  const restoreOpenAi = mockOpenAiFailure();
  try {
    await call(sockets[0], 'vote', 'easy');
    await call(sockets[1], 'vote', 'easy');
    await call(sockets[2], 'vote', 'easy');
    await flush();
  } finally {
    restoreOpenAi();
  }

  assert.equal(room.phase, 'voting');
  assert.equal(room.state.imposter.currentLevel, null);
});

test('non-host cannot end the round', async () => {
  const { ctx } = createTestCtx();
  const room = createRoom(ctx, 'AAAA', ['Ann', 'Bob', 'Cid'], { game: 'imposter', phase: 'playing' });
  const socket = registerGame(imposter, ctx, makeHandlerSocket('AAAA', 'Bob'));
  assert.notEqual(room.hostName, 'Bob');

  const res = await call(socket, 'endImposterRound');
  assert.equal(res.ok, false);
  assert.equal(room.phase, 'playing');
});

test('players who closed the app are not dealt in, so they are not scored as eliminated', async () => {
  const { ctx, recordedResults } = createTestCtx();
  const room = createRoom(ctx, 'AAAA', ['Ann', 'Bob', 'Cid', 'Gone'], { game: 'imposter', phase: 'lobby' });
  room.players.get('Gone').connected = false;
  imposter.onChoose(ctx, 'AAAA', room);

  const sockets = Object.fromEntries(
    ['Ann', 'Bob', 'Cid'].map((n) => [n, registerGame(imposter, ctx, makeHandlerSocket('AAAA', n))])
  );
  const restoreOpenAi = mockOpenAi({ word: 'Guitar', hint: 'You strum it.' });
  try {
    for (const n of ['Ann', 'Bob', 'Cid']) await call(sockets[n], 'vote', 'easy');
    await flush();
  } finally {
    restoreOpenAi();
  }
  assert.equal(room.phase, 'playing');
  assert.equal(room.players.get('Gone').role, null);

  await call(sockets.Ann, 'endImposterRound');
  for (const n of ['Ann', 'Bob', 'Cid']) await call(sockets[n], 'reportEliminated', false);

  assert.equal(room.phase, 'roundResults');
  assert.deepEqual(room.state.imposter.imposterRoundResults.map((r) => r.name).sort(), ['Ann', 'Bob', 'Cid']);
  assert.equal(room.scoreboard.Gone, undefined);
  assert.ok(!recordedResults[0].participants.some((p) => p.name === 'Gone'));
});

// ---------- Board mode ----------

const BOARD_WORDS = Array.from({ length: 25 }, (_, i) => `Word${i + 1}`);

/** Plays voting through to a dealt Board-mode round; returns { ctx, room, sockets, recordedResults }. */
async function startBoardRound(names = ['Ann', 'Bob', 'Cid', 'Dee']) {
  const { ctx, recordedResults } = createTestCtx();
  const room = createRoom(ctx, 'AAAA', names, { game: 'imposter', phase: 'lobby' });
  imposter.onChoose(ctx, 'AAAA', room);
  const sockets = Object.fromEntries(
    names.map((n) => [n, registerGame(imposter, ctx, makeHandlerSocket('AAAA', n))])
  );
  const restoreOpenAi = mockOpenAi({ words: BOARD_WORDS });
  try {
    for (const n of names) await call(sockets[n], 'vote', 'board');
    await flush();
  } finally {
    restoreOpenAi();
  }
  return { ctx, room, sockets, recordedResults };
}

test('board: winning vote deals a 25-word board, 5 highlighted cards for the crew only', async () => {
  const { ctx, room } = await startBoardRound();
  assert.equal(room.phase, 'playing');
  const st = room.state.imposter;
  assert.equal(st.board.length, 25);
  assert.deepEqual([...st.board].sort(), [...BOARD_WORDS].sort());
  assert.equal(st.highlighted.length, 5);
  assert.equal(new Set(st.highlighted).size, 5);
  assert.ok(st.highlighted.every((i) => Number.isInteger(i) && i >= 0 && i < 25));

  for (const name of ['Ann', 'Bob', 'Cid', 'Dee']) {
    const p = room.players.get(name);
    const [roleEmit] = emissionsFor(ctx.io, room, name).filter((e) => e.event === 'role');
    assert.equal(roleEmit.payload.mode, 'board');
    assert.deepEqual(roleEmit.payload.board, st.board);
    assert.equal(roleEmit.payload.word, null);
    assert.equal(roleEmit.payload.hint, null);
    if (p.role === 'imposter') assert.equal(roleEmit.payload.highlighted, null);
    else assert.deepEqual(roleEmit.payload.highlighted, st.highlighted);
  }

  // Reconnecting gets the same view back, still without highlights for the imposter.
  const imposterName = ['Ann', 'Bob', 'Cid', 'Dee'].find((n) => room.players.get(n).role === 'imposter');
  const rejoin = imposter.reconnectPayload(ctx, room, room.players.get(imposterName));
  assert.equal(rejoin.mode, 'board');
  assert.equal(rejoin.highlighted, null);
  assert.equal(rejoin.board.length, 25);
});

test('board: a tie with a word-mode level goes to the word-mode level', async () => {
  const { ctx } = createTestCtx();
  const room = createRoom(ctx, 'AAAA', ['Ann', 'Bob', 'Cid', 'Dee'], { game: 'imposter', phase: 'voting' });
  const sockets = ['Ann', 'Bob', 'Cid', 'Dee'].map((n) => registerGame(imposter, ctx, makeHandlerSocket('AAAA', n)));
  const restoreOpenAi = mockOpenAi({ word: 'Guitar', hint: 'You strum it.' });
  try {
    await call(sockets[0], 'vote', 'board');
    await call(sockets[1], 'vote', 'board');
    await call(sockets[2], 'vote', 'hard');
    await call(sockets[3], 'vote', 'hard');
    await flush();
  } finally {
    restoreOpenAi();
  }
  assert.equal(room.state.imposter.currentLevel, 'hard');
  assert.equal(room.state.imposter.board, null);
});

test('board: vote on imposter is host-only and Board-mode-only', async () => {
  const { room, sockets } = await startBoardRound();
  const nonHost = Object.keys(sockets).find((n) => n !== room.hostName);
  assert.equal((await call(sockets[nonHost], 'startImposterVote')).ok, false);
  assert.equal(room.phase, 'playing');

  // A word-mode round has no imposter vote.
  room.state.imposter.board = null;
  assert.equal((await call(sockets[room.hostName], 'startImposterVote')).ok, false);
});

test('board: most-voted imposter is caught and scored like word mode', async () => {
  const { room, sockets, recordedResults } = await startBoardRound();
  const names = Object.keys(sockets);
  const imp = names.find((n) => room.players.get(n).role === 'imposter');
  const crew = names.filter((n) => n !== imp);

  assert.equal((await call(sockets[room.hostName], 'startImposterVote')).ok, true);
  assert.equal(room.phase, 'accusing');

  assert.equal((await call(sockets[crew[0]], 'accuseImposter', crew[0])).ok, false, 'no self-votes');
  assert.equal((await call(sockets[crew[0]], 'accuseImposter', 'Nobody')).ok, false);

  for (const c of crew) await call(sockets[c], 'accuseImposter', imp);
  assert.equal(room.phase, 'accusing', 'waits for every connected player');
  await call(sockets[imp], 'accuseImposter', crew[0]);

  assert.equal(room.phase, 'roundResults');
  const results = room.state.imposter.imposterRoundResults;
  const impRow = results.find((r) => r.name === imp);
  assert.equal(impRow.eliminated, true);
  assert.equal(impRow.votes, 3);
  assert.equal(room.scoreboard[imp] || 0, 0);
  for (const c of crew) assert.equal(room.scoreboard[c], 1);
  assert.equal(recordedResults.length, 1);
});

test('board: a tie for most votes catches nobody', async () => {
  const { room, sockets } = await startBoardRound();
  const [a, b, c, d] = Object.keys(sockets);
  await call(sockets[room.hostName], 'startImposterVote');
  await call(sockets[a], 'accuseImposter', b);
  await call(sockets[b], 'accuseImposter', a);
  await call(sockets[c], 'accuseImposter', a);
  await call(sockets[d], 'accuseImposter', b);

  assert.equal(room.phase, 'roundResults');
  assert.ok(room.state.imposter.imposterRoundResults.every((r) => !r.eliminated));
});

test('board: a player who leaves during the vote does not hold it up', async () => {
  const { ctx, room, sockets } = await startBoardRound();
  const [a, b, c, d] = Object.keys(sockets);
  await call(sockets[room.hostName], 'startImposterVote');
  await call(sockets[a], 'accuseImposter', d);
  await call(sockets[b], 'accuseImposter', d);
  await call(sockets[c], 'accuseImposter', d);
  room.players.get(d).connected = false;
  imposter.onDisconnect(ctx, 'AAAA', room, d);

  assert.equal(room.phase, 'roundResults');
  assert.equal(room.state.imposter.imposterRoundResults.find((r) => r.name === d).eliminated, true);
});
