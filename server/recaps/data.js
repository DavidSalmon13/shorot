/**
 * Builds the data a recap video is rendered from (docs/specs/recap-videos-specs.md). Pure: reads
 * the room, never changes it, and returns plain JSON. Everything here ends up as text in the
 * video, so it is size-limited here and the templates insert it with textContent only.
 *
 * Shape: { template, game, title, date, players: [{ name, points, won, place, avatar }], highlight }
 *   avatar: { kind: 'sticker', sticker, fallback } (a photo sticker the renderer copies in) or
 *           { kind: 'emoji', emoji } (the same fallback animal as the app's playerEmoji.js).
 */
const MAX_PLAYERS = 12;
const MAX_NAME = 24;
const MAX_TEXT = 80;

const GAME_TITLES = {
  imposter: 'Imposter',
  codenames: 'Codenames',
  tenseconds: '10 Seconds',
  menifot: 'Menifot',
  musictimeline: 'Music Timeline',
  allinorfold: 'All-In or Fold',
  mindmeld: 'Mind Meld',
  bluff: 'Bluff',
  warfront: 'Warfront',
};

// Same list and hash as public/js/shared/playerEmoji.js, so a player's recap avatar matches the app.
const PLAYER_EMOJIS = ['🦊', '🐼', '🐸', '🐵', '🐯', '🐨', '🐷', '🐙', '🦁', '🐮', '🐰', '🐻', '🐔', '🦄', '🐢', '🦉', '🐝', '🐳', '🦋', '🐺'];
function emojiForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return PLAYER_EMOJIS[hash % PLAYER_EMOJIS.length];
}

/** Trims and caps a value for display; non-strings become ''. */
function clip(value, max = MAX_TEXT) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const s = String(value).replace(/\s+/g, ' ').trim();
  return [...s].length > max ? `${[...s].slice(0, max - 1).join('')}…` : s;
}

/** Only photo stickers become images in the video; GIFs and anything unknown fall back to emoji. */
function avatarFor(name, sticker) {
  if (typeof sticker === 'string' && /\.(webp|png|jpe?g)$/i.test(sticker)) {
    return { kind: 'sticker', sticker, fallback: emojiForName(name) };
  }
  return { kind: 'emoji', emoji: emojiForName(name) };
}

/**
 * Ranks participants: points descending, winners before losers on a tie, then the order the game
 * listed them (stable). Players who share points and won-state share a place.
 */
function rankPlayers(room, participants) {
  const rows = participants.slice(0, MAX_PLAYERS).map((p, i) => ({
    name: clip(p.name, MAX_NAME),
    points: Number(p.points) || 0,
    won: p.won === true,
    order: i,
    avatar: avatarFor(String(p.name || ''), room.players.get(p.name)?.sticker),
  }));
  rows.sort((a, b) => b.points - a.points || Number(b.won) - Number(a.won) || a.order - b.order);
  let place = 0;
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    if (!prev || prev.points !== r.points || prev.won !== r.won) place = i + 1;
    r.place = place;
    delete r.order;
  });
  return rows;
}

/** Recursively applies clip() to every string in a game's highlight; drops functions/undefined. */
function cleanHighlight(value, depth = 0) {
  if (depth > 4) return null;
  if (typeof value === 'string' || typeof value === 'number') return clip(value);
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, MAX_PLAYERS).map((v) => cleanHighlight(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined && typeof v !== 'function') out[k] = cleanHighlight(v, depth + 1);
    }
    return out;
  }
  return null;
}

/**
 * The full recap data for one finished game. `game` is the game module (may be null), whose
 * optional recapData(room, participants) returns { template, ...highlight } or null.
 */
function buildRecapData({ room, gameType, participants, game, now = new Date() }) {
  let extra = null;
  if (game && typeof game.recapData === 'function') {
    try {
      extra = game.recapData(room, participants);
    } catch (err) {
      console.error(`[recaps] ${gameType} recapData failed:`, err.message);
      extra = null;
    }
  }
  const template = extra && typeof extra.template === 'string' ? extra.template : 'generic';
  const highlight = extra ? cleanHighlight({ ...extra, template: undefined }) : null;
  return {
    template,
    game: gameType,
    title: GAME_TITLES[gameType] || clip(gameType, 30),
    date: now.toISOString().slice(0, 10),
    players: rankPlayers(room, participants || []),
    highlight,
  };
}

module.exports = { buildRecapData, rankPlayers, emojiForName, clip, GAME_TITLES, MAX_PLAYERS, MAX_NAME };
