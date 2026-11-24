// "Back to Lobby" ends the game for the whole room and any player can press it, so while a
// match is actually underway one stray tap (10 Seconds puts it right under STOP) would wipe
// everyone's game. Ask first then; on setup and game-over screens leaving is the normal next
// step, so it goes straight through.

import { confirmDialog } from './confirmDialog.js';

// Phases where nothing is lost by leaving: before a match starts, or after it has ended.
const SAFE_PHASES = new Set(['seating', 'teamSelect', 'gameover']);

export async function requestBackToLobby(socket, phase) {
  if (phase && !SAFE_PHASES.has(phase)) {
    const ok = await confirmDialog('This ends the game for everyone and returns the room to the lobby.', {
      title: 'End the game?',
      confirmLabel: 'End game',
      danger: true,
    });
    if (!ok) return;
  }
  socket.emit('backToLobby', () => {});
}
