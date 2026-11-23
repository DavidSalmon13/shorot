/**
 * Recap videos (docs/specs/recap-videos-specs.md): a floating chip that reads "Making your recap…"
 * while the server renders the last game's video and "Watch recap" once it's ready, a full-screen
 * player with Save and Share, and the host's On/Off toggle in the lobby.
 *
 * Everything stays hidden unless the server reports recaps as available (RECAPS_ENABLED and a
 * working renderer), so with the feature off the app looks exactly as before.
 *
 * Server events: 'recapStatus' { available, roomEnabled, status: 'none'|'rendering'|'ready', id, url }
 * pushed to the room on every change; 'getRecapStatus' pulls it after a (re)join.
 */
let socket = null;
let getIsHost = () => false;
let status = { available: false, status: 'none' };
const dismissed = new Set(); // recap ids this phone closed the chip for

let chip;
let chipLabel;
let chipClose;
let player;
let video;
let shareBtn;
let section;
let toggleBtns;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function buildDom() {
  chip = el('div', 'recap-chip hidden');
  chip.setAttribute('role', 'status');
  chipLabel = el('button', 'recap-chip-label');
  chipLabel.type = 'button';
  chipClose = el('button', 'recap-chip-close', '×');
  chipClose.type = 'button';
  chipClose.setAttribute('aria-label', 'Hide');
  chip.append(chipLabel, chipClose);
  document.body.appendChild(chip);

  player = el('div', 'recap-player hidden');
  const box = el('div', 'recap-player-box');
  video = el('video', 'recap-video');
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.controls = true;
  video.loop = true;
  const actions = el('div', 'recap-player-actions');
  const saveBtn = el('a', 'recap-btn', 'Save');
  saveBtn.setAttribute('download', 'shorot-recap.mp4');
  shareBtn = el('button', 'recap-btn recap-btn-primary', 'Share');
  shareBtn.type = 'button';
  const closeBtn = el('button', 'recap-btn', 'Close');
  closeBtn.type = 'button';
  actions.append(saveBtn, shareBtn, closeBtn);
  box.append(video, actions);
  player.appendChild(box);
  document.body.appendChild(player);

  chipLabel.addEventListener('click', () => {
    if (status.status === 'ready' && status.url) openPlayer(status.url, saveBtn);
  });
  chipClose.addEventListener('click', () => {
    if (status.id) dismissed.add(status.id);
    render();
  });
  closeBtn.addEventListener('click', closePlayer);
  player.addEventListener('click', (e) => {
    if (e.target === player) closePlayer();
  });
  shareBtn.addEventListener('click', share);

  section = document.getElementById('recap-section');
  toggleBtns = section ? Array.from(section.querySelectorAll('.recap-toggle-btn')) : [];
  toggleBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!getIsHost()) return;
      socket.emit('setRecapsEnabled', btn.dataset.on === 'true', () => {});
    });
  });
}

function openPlayer(url, saveBtn) {
  saveBtn.href = url;
  video.src = url;
  player.classList.remove('hidden');
  video.play().catch(() => {});
}

function closePlayer() {
  video.pause();
  video.removeAttribute('src');
  video.load();
  player.classList.add('hidden');
}

async function share() {
  const url = status.url;
  if (!url) return;
  try {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], 'shorot-recap.mp4', { type: 'video/mp4' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Shorot recap' });
      return;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return; // the player closed the share sheet
  }
  // No file sharing here (most desktop browsers): fall back to a download.
  const a = el('a');
  a.href = url;
  a.download = 'shorot-recap.mp4';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function render() {
  const s = status;
  const show = s.available && (s.status === 'rendering' || s.status === 'ready') && !dismissed.has(s.id);
  chip.classList.toggle('hidden', !show);
  chip.classList.toggle('ready', s.status === 'ready');
  chipLabel.disabled = s.status !== 'ready';
  chipLabel.textContent = s.status === 'ready' ? '▶ Watch recap' : '🎬 Making your recap…';
  if (section) {
    section.classList.toggle('hidden', !s.available);
    toggleBtns.forEach((b) => b.classList.toggle('selected', (b.dataset.on === 'true') === (s.roomEnabled !== false)));
  }
}

function applyStatus(next) {
  if (!next || typeof next !== 'object') return;
  status = next;
  render();
}

/** Re-sync after a (re)join: the socket only gets room broadcasts once it's in the room. */
export function refreshRecapStatus() {
  if (socket) socket.emit('getRecapStatus', applyStatus);
}

export function initRecaps(sock, opts = {}) {
  socket = sock;
  if (opts.getIsHost) getIsHost = opts.getIsHost;
  buildDom();
  socket.on('recapStatus', applyStatus);
  render();
}
