/**
 * Imposter client module.
 */

import { renderScoreboard } from '../shared/scoreboard.js';
import { requestBackToLobby } from '../shared/backToLobby.js';

let ctx = null;

let levelButtons;
let voteCount;
let votingError;
let votingBackBtn;
let levelLabel;
let roleEl;
let gameScreen;
let boardEl;
let voteImposterBtn;
let accuseList;
let accuseCount;
let accuseError;
let endRoundBtn;
let playAgainBtn;
let playAgainWaiting;
let reportYesBtn;
let reportNoBtn;
let reportChoices;
let reportWaiting;
let reportCount;
let reportError;
let imposterResultsBody;
let imposterResultsScoreboard;
let imposterResultsBackBtn;

let myVote = null;
let pendingLevel = null;
let myAccuseVote = null;

function queryDom() {
  levelButtons = Array.from(
    document.querySelectorAll('.level-btn:not(.cn-timer-btn):not(.word-lang-btn):not(.recap-toggle-btn)')
  );
  voteCount = document.getElementById('vote-count');
  votingError = document.getElementById('voting-error');
  votingBackBtn = document.getElementById('voting-back-btn');
  levelLabel = document.getElementById('level-label');
  roleEl = document.getElementById('role-panel');
  gameScreen = document.getElementById('game-screen');
  boardEl = document.getElementById('imposter-board');
  voteImposterBtn = document.getElementById('vote-imposter-btn');
  accuseList = document.getElementById('accuse-list');
  accuseCount = document.getElementById('accuse-count');
  accuseError = document.getElementById('accuse-error');
  endRoundBtn = document.getElementById('end-round-btn');
  playAgainBtn = document.getElementById('play-again-btn');
  playAgainWaiting = document.getElementById('play-again-waiting');
  reportYesBtn = document.getElementById('report-yes-btn');
  reportNoBtn = document.getElementById('report-no-btn');
  reportChoices = document.getElementById('report-choices');
  reportWaiting = document.getElementById('report-waiting');
  reportCount = document.getElementById('report-count');
  reportError = document.getElementById('report-error');
  imposterResultsBody = document.getElementById('imposter-results-body');
  imposterResultsScoreboard = document.getElementById('imposter-results-scoreboard');
  imposterResultsBackBtn = document.getElementById('imposter-results-back-btn');
}

function renderVoting() {
  levelButtons.forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.level === myVote);
  });
}

function renderBoard(board, highlighted) {
  boardEl.innerHTML = '';
  const marked = new Set(highlighted || []);
  board.forEach((word, i) => {
    const card = document.createElement('div');
    card.className = 'cn-card';
    if (marked.has(i)) card.classList.add('imp-hl');
    if (word.length > 7) card.classList.add('cn-card-long');
    const label = document.createElement('span');
    label.textContent = word;
    card.appendChild(label);
    boardEl.appendChild(card);
  });
}

function renderGame(level, { role, word, hint, mode, board, highlighted }) {
  const boardMode = mode === 'board' && Array.isArray(board);
  // Swaps the host's End Round button for Vote on Imposter (see style.css).
  gameScreen.classList.toggle('imp-board-mode', boardMode);
  boardEl.classList.toggle('hidden', !boardMode);
  levelLabel.textContent = boardMode ? 'Board mode' : level ? `Difficulty: ${level}` : '';

  if (boardMode) renderBoard(board, role === 'crew' ? highlighted : null);

  if (role === 'imposter') {
    roleEl.className = 'role-panel imposter';
    roleEl.textContent = '';
    const title = document.createElement('div');
    title.textContent = 'YOU ARE THE IMPOSTER';
    const hintEl = document.createElement('div');
    hintEl.className = 'hint-text';
    hintEl.textContent = boardMode
      ? "The crew knows 5 secret cards. Listen to their words and work out which ones they are."
      : `Hint: ${hint}`;
    roleEl.appendChild(title);
    roleEl.appendChild(hintEl);
  } else if (role === 'crew') {
    roleEl.className = 'role-panel crew';
    if (boardMode) {
      roleEl.textContent = '';
      const title = document.createElement('div');
      title.textContent = 'You are crew';
      const hintEl = document.createElement('div');
      hintEl.className = 'hint-text';
      hintEl.textContent = 'Say a word linked to one or more of your 5 highlighted cards - without giving them away.';
      roleEl.appendChild(title);
      roleEl.appendChild(hintEl);
    } else {
      roleEl.textContent = `Your word: ${word}`;
    }
  } else {
    // Rejoined a round that was dealt while this player was away.
    roleEl.className = 'role-panel';
    roleEl.textContent = "You're sitting this round out - you'll be in the next one.";
  }
}

function renderAccusing(data) {
  ctx.setHost(data.host);
  myAccuseVote = data.myVote || null;
  accuseCount.textContent = `${data.voted || 0} of ${data.total || 0} voted`;
  accuseList.innerHTML = '';
  if (!data.canVote) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = "You weren't in this round - waiting for the vote to finish.";
    accuseList.appendChild(note);
    return;
  }
  const me = ctx.getMyName();
  (data.candidates || [])
    .filter((name) => name !== me)
    .forEach((name) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'level-btn';
      btn.textContent = name;
      btn.classList.toggle('selected', name === myAccuseVote);
      btn.addEventListener('click', () => {
        accuseError.textContent = '';
        const previous = myAccuseVote;
        myAccuseVote = name;
        accuseList.querySelectorAll('.level-btn').forEach((b) => b.classList.toggle('selected', b === btn));
        ctx.socket.emit('accuseImposter', name, (res) => {
          if (res && res.ok === false) {
            accuseError.textContent = res.error;
            myAccuseVote = previous;
            accuseList
              .querySelectorAll('.level-btn')
              .forEach((b) => b.classList.toggle('selected', b.textContent === previous));
          }
        });
      });
      accuseList.appendChild(btn);
    });
}

function renderImposterReporting(data) {
  ctx.setHost(data.host);
  reportError.textContent = '';
  reportCount.textContent = `${data.answered || 0} of ${data.total || 0} answered`;
  const answered = data.myAnswer !== null && data.myAnswer !== undefined;
  reportChoices.classList.toggle('hidden', answered);
  reportWaiting.classList.toggle('hidden', !answered);
}

function renderImposterResults(data) {
  ctx.setHost(data.host);
  imposterResultsBody.innerHTML = '';
  (data.results || []).forEach((row) => {
    const tr = document.createElement('tr');
    const ptsClass =
      row.points > 0 ? 'pts-positive' : row.points < 0 ? 'pts-negative' : '';
    const ptsText = row.points > 0 ? `+${row.points}` : String(row.points);
    // Board mode rows carry how many accusation votes each player got.
    const votesText =
      typeof row.votes === 'number' ? ` (${row.votes} vote${row.votes === 1 ? '' : 's'})` : '';
    const outcome = `${row.eliminated ? 'Eliminated' : 'Survived'}${votesText}`;
    const cells = [row.name, row.role === 'imposter' ? 'Imposter' : 'Crew', outcome, ptsText];
    cells.forEach((text, i) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (i === 3 && ptsClass) td.className = ptsClass;
      tr.appendChild(td);
    });
    imposterResultsBody.appendChild(tr);
  });
  renderScoreboard(imposterResultsScoreboard, data.scoreboard || []);
}

function bindButtons() {
  levelButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const level = btn.dataset.level;
      const previousVote = myVote;
      // Highlight immediately; roll back if the server rejects the vote.
      myVote = level;
      renderVoting();
      ctx.socket.emit('vote', level, (res) => {
        if (res && res.ok === false) {
          myVote = previousVote;
          renderVoting();
        }
      });
    });
  });

  endRoundBtn.addEventListener('click', () => {
    ctx.socket.emit('endImposterRound', (res) => {
      if (res && !res.ok) {
        // Stay on game screen; host can retry.
      }
    });
  });

  voteImposterBtn.addEventListener('click', () => {
    ctx.socket.emit('startImposterVote', () => {});
  });

  reportYesBtn.addEventListener('click', () => {
    reportError.textContent = '';
    ctx.socket.emit('reportEliminated', true, (res) => {
      if (res && !res.ok) reportError.textContent = res.error;
    });
  });

  reportNoBtn.addEventListener('click', () => {
    reportError.textContent = '';
    ctx.socket.emit('reportEliminated', false, (res) => {
      if (res && !res.ok) reportError.textContent = res.error;
    });
  });

  // The game screen's Back to Lobby is only shown while a round is in play.
  playAgainBtn.addEventListener('click', () => requestBackToLobby(ctx.socket, 'playing'));

  votingBackBtn.addEventListener('click', () => {
    ctx.socket.emit('backToLobby', () => {});
  });

  imposterResultsBackBtn.addEventListener('click', () => {
    ctx.socket.emit('backToLobby', () => {});
  });
}

function bindSocket() {
  const { socket, showScreen, setHost } = ctx;

  socket.on('votingStarted', ({ host }) => {
    setHost(host);
    myVote = null;
    votingError.textContent = '';
    renderVoting();
    showScreen('voting');
  });

  socket.on('votingUpdate', ({ total, voted, host }) => {
    setHost(host);
    voteCount.textContent = `${voted} of ${total} voted`;
  });

  socket.on('gameStarted', ({ level }) => {
    pendingLevel = level;
  });

  socket.on('role', (payload) => {
    renderGame(pendingLevel, payload);
    showScreen('game');
  });

  socket.on('imposterAccusing', (data) => {
    renderAccusing(data);
    showScreen('imposterAccusing');
  });

  socket.on('imposterReporting', (data) => {
    renderImposterReporting(data);
    showScreen('imposterReporting');
  });

  socket.on('imposterResults', (data) => {
    renderImposterResults(data);
    showScreen('imposterResults');
  });

  socket.on('startFailed', ({ error }) => {
    votingError.textContent = error;
    showScreen('voting');
  });
}

export const Imposter = {
  init(gameCtx) {
    ctx = gameCtx;
    queryDom();
    bindButtons();
    bindSocket();
  },

  applyJoin(res) {
    if (res.phase === 'playing') {
      renderGame(res.level, res);
      ctx.showScreen('game');
    } else if (res.phase === 'accusing') {
      renderAccusing(res);
      ctx.showScreen('imposterAccusing');
    } else if (res.phase === 'reporting') {
      renderImposterReporting(res);
      ctx.showScreen('imposterReporting');
    } else if (res.phase === 'roundResults') {
      renderImposterResults(res);
      ctx.showScreen('imposterResults');
    } else if (res.phase === 'generating') {
      ctx.showGenerating(res.boardMode ? 'imposterBoard' : 'imposter');
    } else if (res.phase === 'voting') {
      myVote = res.vote || null;
      renderVoting();
      ctx.showScreen('voting');
    }
  },

  stop() {
    myVote = null;
    pendingLevel = null;
    myAccuseVote = null;
    if (reportError) reportError.textContent = '';
    if (accuseError) accuseError.textContent = '';
    if (gameScreen) gameScreen.classList.remove('imp-board-mode');
  },
};
