/**
 * Suggestion box: the 💡 button at the top right of the header, on every screen. Opens a
 * small popup where anyone (guest or signed in) can send an idea for the app; it POSTs to
 * /api/suggestions (server/suggestions.js) and lands in /admin's Messages tab.
 */

const btn = document.getElementById('suggest-btn');
const box = document.getElementById('suggest-box');
const text = document.getElementById('suggest-text');
const status = document.getElementById('suggest-status');
const send = document.getElementById('suggest-send');
const closeBtn = document.getElementById('suggest-close');

function setStatus(message, isError) {
  status.textContent = message || '';
  status.classList.toggle('error', !!isError);
}

function open() {
  box.classList.remove('hidden');
  btn.setAttribute('aria-expanded', 'true');
  setStatus('');
  text.focus();
}

function close() {
  box.classList.add('hidden');
  btn.setAttribute('aria-expanded', 'false');
}

function isOpen() {
  return !box.classList.contains('hidden');
}

async function submit(e) {
  e.preventDefault();
  const message = text.value.trim();
  if (!message) {
    setStatus('Write something first', true);
    return;
  }
  send.disabled = true;
  setStatus('Sending…');
  try {
    const res = await fetch('/api/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        message,
        name: localStorage.getItem('imposterName') || '',
        room: localStorage.getItem('imposterRoom') || '',
        clientId: localStorage.getItem('imposterClientId') || '',
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      setStatus(data.error || 'Could not send - try again', true);
      return;
    }
    text.value = '';
    setStatus('Thanks! Your suggestion was sent.');
    setTimeout(() => {
      if (isOpen() && !text.value) close();
    }, 1800);
  } catch {
    setStatus('Could not reach the server', true);
  } finally {
    send.disabled = false;
  }
}

export function initSuggestionBox() {
  if (!btn || !box) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen()) close();
    else open();
  });
  closeBtn.addEventListener('click', close);
  box.addEventListener('submit', submit);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });
  // Tap outside closes it (a draft in the textarea survives).
  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !box.contains(e.target) && !btn.contains(e.target)) close();
  });
}
