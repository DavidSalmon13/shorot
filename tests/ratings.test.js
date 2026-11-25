'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeRatings } = require('../server/ratings');

// byGame entry from per-game placements, newest first.
const games = (...recent) => ({ played: recent.length, won: recent.filter((p) => p === 1).length, recent });
const repeat = (n, p) => Array(n).fill(p);

test('a new card sits at the 60 baseline, bronze', () => {
  const { stats, ovr, tier } = computeRatings({});
  assert.deepEqual(Object.values(stats), [60, 60, 60, 60, 60, 60]);
  assert.equal(ovr, 60);
  assert.equal(tier, 'bronze');
});

test('an average finish stays at the baseline', () => {
  const { stats, ovr } = computeRatings({ bluff: games(...repeat(20, 0.5)) });
  assert.equal(stats.NRV, 60);
  assert.equal(ovr, 60);
});

test('one lucky win is shrunk toward the baseline, not 99', () => {
  const { ovr } = computeRatings({ bluff: games(1) });
  assert.equal(ovr, 70);
});

test('a single game visibly moves an established card', () => {
  const base = repeat(30, 0.5);
  const before = computeRatings({ imposter: games(...base), codenames: games(...base) }).ovr;
  const win = computeRatings({ imposter: games(1, ...base), codenames: games(...base) }).ovr;
  const loss = computeRatings({ imposter: games(0, ...base), codenames: games(...base) }).ovr;
  assert.ok(win - before >= 2, `win moved ${before} -> ${win}`);
  assert.ok(before - loss >= 2, `loss moved ${before} -> ${loss}`);
});

test('recent games count more than old ones', () => {
  // Same 10 wins + 30 losses; only the order differs.
  const hot = computeRatings({ bluff: games(...repeat(10, 1), ...repeat(30, 0)) }).ovr;
  const cold = computeRatings({ bluff: games(...repeat(30, 0), ...repeat(10, 1)) }).ovr;
  assert.ok(hot - cold >= 20, `recent wins ${hot} vs old wins ${cold}`);
});

test('90 takes dominating, gold takes clearly beating the table', () => {
  assert.equal(computeRatings({ bluff: games(...repeat(30, 0.75)) }).tier, 'gold');
  assert.ok(computeRatings({ bluff: games(...repeat(30, 0.85)) }).ovr < 90);
  assert.ok(computeRatings({ bluff: games(...repeat(30, 0.95)) }).ovr >= 90);
});

test('unplayed stats do not drag the overall down', () => {
  const { stats, ovr } = computeRatings({ imposter: games(...repeat(20, 0.85)) });
  assert.equal(stats.SPD, 60);
  assert.equal(ovr, stats.DEC);
});

test('a one-off try of another game barely moves the overall', () => {
  const main = repeat(20, 0.85);
  const solo = computeRatings({ imposter: games(...main) }).ovr;
  const withTry = computeRatings({ imposter: games(...main), bluff: games(0) }).ovr;
  assert.ok(solo - withTry <= 1, `${solo} -> ${withTry}`);
});

test('without per-game rows, the lifetime average stands in', () => {
  const { stats } = computeRatings({ bluff: { played: 8, won: 8, points: 8, placement: null } });
  assert.equal(stats.NRV, 89);
});

// Bluff byGame entry with per-game opponent counts, newest first: [[placement, opponents], ...].
const sized = (...rows) => ({ ...games(...rows.map(([p]) => p)), recentOpponents: rows.map(([, o]) => o) });

test('bluff: winning an 8-player table moves the card more than winning a 3-player one', () => {
  const base = repeat(20, [0.5, 2]);
  const before = computeRatings({ bluff: sized(...base) }).ovr;
  const small = computeRatings({ bluff: sized([1, 2], ...base) }).ovr;
  const big = computeRatings({ bluff: sized([1, 7], ...base) }).ovr;
  assert.ok(small > before, `${before} -> ${small}`);
  assert.ok(big - before > 2 * (small - before), `3p win +${small - before}, 8p win +${big - before}`);
});

test('bluff: going out first at a big table costs more too', () => {
  const base = repeat(20, [0.5, 2]);
  const before = computeRatings({ bluff: sized(...base) }).ovr;
  const small = computeRatings({ bluff: sized([0, 2], ...base) }).ovr;
  const big = computeRatings({ bluff: sized([0, 7], ...base) }).ovr;
  assert.ok(before - big > 2 * (before - small), `3p loss -${before - small}, 8p loss -${before - big}`);
});

test('bluff: one 8-player win is shrunk less than one 3-player win', () => {
  assert.equal(computeRatings({ bluff: sized([1, 2]) }).ovr, 70);
  assert.ok(computeRatings({ bluff: sized([1, 7]) }).ovr > 70);
});

test('table size only weights bluff', () => {
  const plain = computeRatings({ imposter: games(1, ...repeat(20, 0.5)) }).ovr;
  const withOpps = computeRatings({
    imposter: { ...games(1, ...repeat(20, 0.5)), recentOpponents: [7, ...repeat(20, 2)] },
  }).ovr;
  assert.equal(withOpps, plain);
});
