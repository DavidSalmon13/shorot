// Shrinks the lobby game tiles' names, all by the same factor, just enough that the
// longest word fits its tile. Long single words ("Codenames") can't wrap, so on narrow
// phones or with a large system text size they spilled past the tile's edge. CSS alone
// can't account for Android's text scaling, so we measure instead. The grid is watched
// with a ResizeObserver, which also fires when the hidden lobby is first shown.
const MIN_SCALE = 0.6;

// The name's own grid column, e.g. "44px 77px" -> 77 (the theme's icon + text layout).
function columnWidth(tile) {
  const cols = getComputedStyle(tile).gridTemplateColumns.split(' ');
  return parseFloat(cols[cols.length - 1]) || 0;
}

function fitAll(grid) {
  const names = [...grid.querySelectorAll('.game-tile-name')];
  names.forEach(n => { n.style.fontSize = ''; });
  let scale = 1;
  for (const n of names) {
    const avail = columnWidth(n.closest('.game-tile'));
    // scrollWidth is at least the longest unbreakable word, since words wrap at spaces.
    if (avail > 0 && n.scrollWidth > avail) scale = Math.min(scale, avail / n.scrollWidth);
  }
  if (scale >= 1) return;
  scale = Math.max(MIN_SCALE, scale * 0.98);
  names.forEach(n => {
    n.style.fontSize = `${parseFloat(getComputedStyle(n).fontSize) * scale}px`;
  });
}

export function initFitTileNames() {
  const grid = document.querySelector('.game-grid');
  if (!grid) return;
  // Widths measured with the fallback font are wrong, so fit again once fonts load.
  if (document.fonts) {
    document.fonts.ready.then(() => fitAll(grid));
    document.fonts.addEventListener?.('loadingdone', () => fitAll(grid));
  }
  if (!('ResizeObserver' in window)) { fitAll(grid); return; }
  let lastWidth = 0;
  new ResizeObserver(([e]) => {
    const w = Math.round(e.contentRect.width);
    if (w > 0 && w !== lastWidth) { lastWidth = w; fitAll(grid); }
  }).observe(grid);
}
