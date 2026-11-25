'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeRatings, gameDelta } = require('../server/ratings');

// History, oldest first: n games of one type at one placement / table size.
const play = (n, gameType, placement, opponents = 2) =>
  Array.from({ length: n }, () => ({ gameType, placement, opponents }));
const ovrOf = (history) => computeRatings(history).ovr;

test('a new card sits at the 60 baseline, bronze', () => {
  const { stats, ovr, tier } = computeRatings([]);
  assert.deepEqual(Object.values(stats), [60, 60, 60, 60, 60, 60]);
  assert.equal(ovr, 60);
  assert.equal(tier, 'bronze');
});

test('a win gains +1, last place costs -0.5, in between is linear', () => {
  assert.equal(gameDelta({ gameType: 'imposter', placement: 1 }), 1);
  assert.equal(gameDelta({ gameType: 'imposter', placement: 0 }), -0.5);
  assert.equal(gameDelta({ gameType: 'imposter', placement: 0.5 }), 0.25);
});

test('a win gains the same whatever the current overall', () => {
  for (const start of [10, 40, 60, 80]) {
    const history = play(start, 'imposter', 1);
    const before = computeRatings(history);
    const after = computeRatings([...history, ...play(2, 'imposter', 1)]);
    // 10 wins from the baseline is the same +10 at every level (until 99).
    assert.equal(ovrOf([...history, ...play(10, 'imposter', 1)]) - before.ovr, Math.min(10, 99 - before.ovr));
    assert.equal(after.ovr - before.ovr, Math.min(2, 99 - before.ovr));
  }
});

test('a loss costs less than a win gains', () => {
  assert.equal(ovrOf(play(10, 'codenames', 1)), 70);
  assert.equal(ovrOf(play(10, 'codenames', 0)), 55);
  // Win one, lose one: still climbing.
  const mixed = [];
  for (let i = 0; i < 10; i++) mixed.push(...play(1, 'codenames', 1), ...play(1, 'codenames', 0));
  assert.equal(ovrOf(mixed), 65);
});

test('bluff: each opponent beaten +0.5, each who beat you -0.25', () => {
  assert.equal(gameDelta({ gameType: 'bluff', placement: 1, opponents: 2 }), 1);
  assert.equal(gameDelta({ gameType: 'bluff', placement: 1, opponents: 7 }), 3.5);
  assert.equal(gameDelta({ gameType: 'bluff', placement: 0, opponents: 7 }), -1.75);
  // 2nd of 8: beat 6, lost to 1.
  assert.equal(gameDelta({ gameType: 'bluff', placement: 6 / 7, opponents: 7 }), 2.75);
});

test('table size only matters for bluff', () => {
  assert.equal(gameDelta({ gameType: 'imposter', placement: 1, opponents: 7 }), 1);
});

test('capped at 99 and 1, and a loss at 99 drops straight away', () => {
  const maxed = play(100, 'menifot', 1);
  assert.equal(ovrOf(maxed), 99);
  assert.equal(computeRatings(maxed).tier, 'gold');
  assert.equal(ovrOf([...maxed, ...play(2, 'menifot', 0)]), 98);
  assert.equal(ovrOf(play(200, 'menifot', 0)), 1);
});

test('stats move by the game change times their weight', () => {
  const { stats, ovr } = computeRatings(play(10, 'bluff', 1));
  assert.equal(ovr, 70);
  assert.equal(stats.NRV, 70);
  assert.equal(stats.TAC, 66);
  assert.equal(stats.COM, 63);
  assert.equal(stats.SPD, 60);
});

test('music timeline and mind meld do not count', () => {
  assert.equal(ovrOf([...play(5, 'musictimeline', 1), ...play(5, 'mindmeld', 1)]), 60);
});

// --- Switch-over: cards keep the number the old formula gave them --------------------

const legacy = require('../server/ratingsLegacy');
const { PROGRESSION_SINCE } = require('../server/ratings');

const before = (n, gameType, placement) =>
  play(n, gameType, placement).map((g, i) => ({
    ...g,
    won: placement === 1,
    endedAt: new Date(PROGRESSION_SINCE - (n - i) * 60_000),
  }));
const after = (n, gameType, placement, opponents) =>
  play(n, gameType, placement, opponents).map((g, i) => ({
    ...g,
    endedAt: new Date(PROGRESSION_SINCE + (i + 1) * 60_000),
  }));

test('games before the switch keep exactly the old formula card', () => {
  const old = [...before(12, 'bluff', 1), ...before(8, 'imposter', 0.25)];
  // Old formula input: per type, placements newest first.
  const expected = legacy.computeRatings({
    bluff: { played: 12, won: 12, recent: Array(12).fill(1) },
    imposter: { played: 8, won: 0, recent: Array(8).fill(0.25) },
  });
  assert.deepEqual(computeRatings(old), expected);
});

test('after the switch, fixed steps count on from that number', () => {
  const old = before(12, 'bluff', 1);
  const start = computeRatings(old).ovr;
  assert.ok(start > 60, `old card ${start}`);
  assert.equal(ovrOf([...old, ...after(3, 'bluff', 1, 2)]), start + 3);
  assert.equal(ovrOf([...old, ...after(2, 'bluff', 0, 2)]), start - 1);
  assert.equal(ovrOf([...old, ...after(1, 'bluff', 1, 7)]), Math.round(start + 3.5));
});
