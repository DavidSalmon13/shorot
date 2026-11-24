// The "?" button on each lobby game tile and the one-paragraph rules popup it opens.
// The button is a <span role="button"> inside the tile's <button> (a real button can't
// nest in another), and it stops its click so tapping it never chooses the game.

const RULES = {
  'choose-imposter-btn': {
    title: 'Imposter',
    text: 'Everyone gets the same secret word except the imposter (two imposters with 5 or more players), who only gets a vague hint. Take turns saying something about the word out loud: specific enough to prove you know it, but vague enough that the imposter can\'t work it out. Then discuss and vote on who you think the imposter is. If the imposter stays hidden they score 3 points; if they get caught, the crew wins.',
  },
  'choose-codenames-btn': {
    title: 'Codenames',
    text: 'Split into Red and Blue teams, each with one leader. Only the leaders can see which of the 25 words on the board belong to which team. On your turn, your leader says a one-word clue and a number out loud (like "fruit, 3"), and teammates tap the words they think it points to. Keep going while you guess right; a wrong word ends your turn, and tapping the black assassin word loses the game instantly. The first team to find all its words wins.',
  },
  'choose-tenseconds-btn': {
    title: '10 Seconds',
    text: 'After a 3-2-1 countdown, everyone\'s stopwatch starts at the same time. Tap Stop as close to exactly 10.000 seconds as you can. Each round, the player furthest from 10 seconds is knocked out, and the last player standing wins.',
  },
  'choose-menifot-btn': {
    title: 'Menifot',
    text: 'The deck is dealt out between the players and 2 or 3 shared boards, each with 3 face-up cards plus a hidden turn and river card. Secretly split your hand between the boards. Then the hidden cards are revealed, and on each board the best poker hand wins 1 point. A hand must use exactly 2 of your cards and 3 of the board\'s cards, like Omaha. The first player to reach 10 points wins.',
  },
  'choose-warfront-btn': {
    title: 'Warfront',
    text: 'A real-time strategy battle: play in two teams or free-for-all, with each player commanding their own army on a shared battlefield. Workers gather Supply at home and Minerals from contested veins, which you spend on new units. You only see what your units can see, so scout, protect your economy and outsmart the players sitting next to you. Destroy the enemy base to win.',
  },
  'choose-mindmeld-btn': {
    title: 'Mind Meld',
    text: 'Each round one player is the Subject and gets a quirky personal question with a number answer, like "how many minutes would you survive in a zombie movie?". The Subject answers secretly, and everyone else has 60 seconds to guess what the Subject will say. The closest guesses score the most points, and an exact match earns a bonus. Everyone takes a turn as the Subject twice.',
  },
  'choose-bluff-btn': {
    title: 'Bluff',
    text: 'Everyone is dealt secret cards to their phone. Going around the table, each player claims a poker hand that can be made from all the players\' cards put together, and each claim has to beat the last one. If you think a claim is a lie, call "Bluff!" and the host checks the called cards in the app. Whoever was wrong loses the round and drops a card. Run out of cards and you\'re out; the last player still holding cards wins.',
  },
  'choose-allinorfold-btn': {
    title: 'All-In or Fold',
    text: 'Poker with no betting rounds: on your turn you either push your whole stack all-in or fold. You get 6 hole cards, and your best hand uses exactly 2 of them plus 3 of the 5 community cards, like Omaha. Up to 6 players sit at the table, anyone can join an open seat mid-game, and rebuys are free. When the host ends the game, players are ranked by how much they won or lost.',
  },
};

let openDialog = null;

function showRules({ title, text }) {
  if (openDialog) openDialog();

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  const panel = document.createElement('div');
  panel.className = 'confirm-panel rules-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');

  const titleEl = document.createElement('h2');
  titleEl.className = 'confirm-title';
  titleEl.textContent = `How to play ${title}`;
  const textEl = document.createElement('p');
  textEl.className = 'confirm-message rules-text';
  textEl.textContent = text;
  const row = document.createElement('div');
  row.className = 'btn-row';
  const okBtn = document.createElement('button');
  okBtn.type = 'button';
  okBtn.textContent = 'Got it';
  row.appendChild(okBtn);
  panel.append(titleEl, textEl, row);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    if (openDialog !== close) return;
    openDialog = null;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  openDialog = close;
  okBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  okBtn.focus();
}

// The first time a player's phone enters each game, its rules open by themselves (the same
// popup the "?" shows). Seen games are remembered per phone in localStorage, so a new phone,
// a private window or cleared site data shows them once more - harmless.
const SEEN_KEY = 'shorotRulesSeen';

function readSeen() {
  try {
    const list = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

/** Opens `gameId`'s rules if this phone hasn't seen them yet (gameId as in 'gameChosen'). */
export function showRulesFirstTime(gameId) {
  const rules = RULES[`choose-${gameId}-btn`];
  if (!rules) return;
  const seen = readSeen();
  if (seen.includes(gameId)) return;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, gameId]));
  } catch (e) {
    // Storage blocked: still show the rules, they just may show again next time.
  }
  showRules(rules);
}

export function initGameRules() {
  for (const [id, rules] of Object.entries(RULES)) {
    const tile = document.getElementById(id);
    if (!tile) continue;
    const help = document.createElement('span');
    help.className = 'game-tile-help';
    help.setAttribute('role', 'button');
    help.setAttribute('tabindex', '0');
    help.setAttribute('aria-label', `How to play ${rules.title}`);
    help.textContent = '?';
    const open = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showRules(rules);
    };
    help.addEventListener('click', open);
    help.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') open(e);
    });
    // Keep the tile's own press animation and tap sound from firing under the "?".
    help.addEventListener('pointerdown', (e) => e.stopPropagation());
    tile.appendChild(help);
  }
}
