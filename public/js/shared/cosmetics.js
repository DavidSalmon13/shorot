/**
 * Equipped-cosmetic rendering, shared by every screen a player appears on (the lobby
 * roster and in-game seats). Purely visual: it toggles CSS classes - styled in the
 * Afterglow theme layer (public/theme-afterglow.css) - and adds a small title chip. It
 * never changes ids, layout or behaviour, and is a no-op when a player has no cosmetics
 * (guests, or the store off). See docs/specs/store-specs.md.
 *
 * `cosmetics` is the per-player { frame, nameColor, title, podium, boardSkin, entrance }
 * object the server sends in playerCosmetics (lobby) / seat payloads (games), or null.
 */

export const TITLE_LABELS = {
  bluffer: 'The Bluffer',
  high_roller: 'High Roller',
  imposter: 'The Imposter',
  mastermind: 'Mastermind',
};

const BOARD_SKIN_CLASSES = ['boardskin-midnight'];

/**
 * Decorates one player's rendered avatar/name with their equipped cosmetics.
 *   els.avatar - avatar element (the frame ring attaches here)
 *   els.name   - name text element (color/glow here; the title chip is inserted after it)
 *   els.row    - optional row/container (the entrance animation attaches here)
 */
export function applyCosmetics(els, cosmetics, { title = true } = {}) {
  if (!cosmetics) return;
  const { avatar, name, row } = els;
  if (avatar && cosmetics.frame) {
    avatar.classList.add('cosmetic-frame', `cosmetic-frame-${cosmetics.frame}`);
  }
  if (name && cosmetics.nameColor) {
    name.classList.add('cosmetic-name', `cosmetic-name-${cosmetics.nameColor}`);
  }
  // The title chip is opt-out: tight spots (in-game seats) pass { title: false }.
  if (title && name && cosmetics.title && TITLE_LABELS[cosmetics.title]) {
    const chip = document.createElement('span');
    chip.className = 'cosmetic-title';
    chip.textContent = TITLE_LABELS[cosmetics.title];
    name.insertAdjacentElement('afterend', chip);
  }
  if (row && cosmetics.entrance) row.classList.add('cosmetic-entrance');
}

/**
 * Applies the viewer's OWN board skin to the page (a local table look for the owner), or
 * clears it. Board skins are personal: you see yours, nobody else's is forced on you.
 */
export function applyMyBoardSkin(cosmetics) {
  for (const cls of BOARD_SKIN_CLASSES) document.body.classList.remove(cls);
  if (cosmetics && cosmetics.boardSkin === 'boardskin.midnight') {
    document.body.classList.add('boardskin-midnight');
  }
}
