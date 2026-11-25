/**
 * The six-stat rating card (FIFA Ultimate Team-style). A progression system: every
 * card starts at BASELINE and each recorded game adds or subtracts a fixed amount,
 * whatever the card currently reads - no pull back toward the middle. A win gains
 * more than a loss costs, so players who keep playing slowly climb. Pure function of
 * the player's game history - no DB, no HTTP. See docs/specs/account-page-specs.md
 * ("Rating formula").
 *
 * Cards weren't reset at the switch: games that ended before PROGRESSION_SINCE are
 * scored with the old formula (server/ratingsLegacy.js), and that card is the starting
 * point the fixed steps count on from.
 *
 * Music Timeline and Mind Meld deliberately contribute to nothing here, per the
 * original ask to ignore them for now.
 */

const legacy = require('./ratingsLegacy');

// When the fixed-step formula took over. Games ending before it only shape the
// starting card (old formula); games from then on move it by fixed steps.
const PROGRESSION_SINCE = Date.parse('2026-11-26T00:00:00Z');

const STATS = ['SPD', 'COM', 'STR', 'TAC', 'NRV', 'DEC'];

// game -> { STAT: weight }. Primary 1.0, secondary 0.6, tertiary 0.3. A stat moves by
// the game's change times its weight.
const GAME_STAT_WEIGHTS = {
  tenseconds: { SPD: 1.0, NRV: 0.6 },
  codenames: { COM: 1.0, STR: 0.6 },
  imposter: { DEC: 1.0, COM: 0.6 },
  menifot: { TAC: 1.0, STR: 0.6 },
  allinorfold: { STR: 1.0, NRV: 0.6 },
  bluff: { NRV: 1.0, TAC: 0.6, COM: 0.3 },
};

// Where every card (overall and each stat) starts.
const BASELINE = 60;
const MIN_RATING = 1;
const MAX_RATING = 99;

// Change for one game, by placement (share of opponents beaten, 0..1): a win gains
// WIN_GAIN, finishing last costs LOSS_COST, anything between is a straight line.
const WIN_GAIN = 1;
const LOSS_COST = 0.5;

// Game types where every opponent counts on its own: each one you beat gains
// GAIN_PER_OPPONENT, each one who beat you costs COST_PER_OPPONENT. At a 3-player
// table that's the same +1 / -0.5 as every other game; an 8-player win is +3.5.
const PER_OPPONENT = new Set(['bluff']);
const GAIN_PER_OPPONENT = WIN_GAIN / 2;
const COST_PER_OPPONENT = LOSS_COST / 2;

const clamp = (x) => Math.min(MAX_RATING, Math.max(MIN_RATING, x));

/** Rating change for one game: { gameType, placement (0..1), opponents }. */
function gameDelta({ gameType, placement, opponents }) {
  const p = Number.isFinite(placement) ? Math.min(1, Math.max(0, placement)) : 0.5;
  if (PER_OPPONENT.has(gameType) && opponents > 0) {
    return p * opponents * GAIN_PER_OPPONENT - (1 - p) * opponents * COST_PER_OPPONENT;
  }
  return p * WIN_GAIN - (1 - p) * LOSS_COST;
}

function tierFor(ovr) {
  if (ovr < 65) return 'bronze';
  if (ovr < 75) return 'silver';
  return 'gold';
}

const isLegacy = (game) => game.endedAt != null && new Date(game.endedAt).getTime() < PROGRESSION_SINCE;

/**
 * The card as the old formula had it at the switch, from the games before it (all 60s
 * when there are none). legacy.computeRatings wants { [type]: { played, won, placement,
 * recent } } with `recent` newest first.
 */
function startingCard(history) {
  const byGame = {};
  for (let i = history.length - 1; i >= 0; i--) {
    const { gameType, placement, won } = history[i];
    const g = byGame[gameType] || (byGame[gameType] = { played: 0, won: 0, placement: 0, recent: [] });
    g.played += 1;
    if (won) g.won += 1;
    g.placement += placement;
    if (g.recent.length < legacy.RECENT_GAMES) g.recent.push(placement);
  }
  for (const g of Object.values(byGame)) g.placement /= g.played;
  return legacy.computeRatings(byGame);
}

/**
 * history: the player's games, OLDEST FIRST, each { gameType, placement, opponents,
 * won, endedAt }. Games ended before PROGRESSION_SINCE set the starting card; the rest
 * (and any without endedAt) apply fixed steps. Types not in GAME_STAT_WEIGHTS are
 * ignored. Every value is clamped to [1, 99] after each game, so a card at 99 drops
 * straight away on a loss.
 * Returns { ovr, tier, stats: { SPD, COM, STR, TAC, NRV, DEC } }, integers in [1, 99].
 */
function computeRatings(history = []) {
  const start = startingCard(history.filter(isLegacy));
  let ovr = start.ovr;
  const stats = { ...start.stats };
  for (const game of history) {
    if (isLegacy(game)) continue;
    const weights = GAME_STAT_WEIGHTS[game.gameType];
    if (!weights) continue;
    const delta = gameDelta(game);
    ovr = clamp(ovr + delta);
    for (const [stat, w] of Object.entries(weights)) stats[stat] = clamp(stats[stat] + delta * w);
  }
  for (const s of STATS) stats[s] = Math.round(stats[s]);
  const rounded = Math.round(ovr);
  return { ovr: rounded, tier: tierFor(rounded), stats };
}

module.exports = { computeRatings, gameDelta, GAME_STAT_WEIGHTS, STATS, BASELINE, PROGRESSION_SINCE };
