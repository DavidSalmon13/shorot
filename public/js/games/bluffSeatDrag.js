/**
 * Host-only drag-to-swap for Bluff's round-table seats: press a seat, drag it onto
 * another and let go, and the two players trade places (the server's bfSwapSeats), so
 * the table on screen can match how people are really sitting.
 *
 * A press that doesn't move past DRAG_THRESHOLD_PX stays an ordinary tap (the host's
 * "mark this player as the round's loser"); the click that follows a real drag is
 * swallowed so a drag never also marks a loser.
 */

const DRAG_THRESHOLD_PX = 8;

let drag = null; // { seatEl, name, pointerId, startX, startY, moved, target }
let swallowClickUntil = 0;
let onDragEnd = null;

/** A drag is in progress - re-rendering the seats now would yank the seat from under it. */
export function isSeatDragActive() {
  return !!(drag && drag.moved);
}

/** Called once after every drag ends (or is cancelled), e.g. to flush a deferred render. */
export function setSeatDragEndHandler(fn) {
  onDragEnd = fn;
}

/** The seat under the finger, looking past the dragged seat itself (it's under it too). */
function seatUnder(x, y, container) {
  for (const el of document.elementsFromPoint(x, y)) {
    const seat = el.closest('.bf-seat');
    if (seat && seat !== drag.seatEl && container.contains(seat)) return seat;
  }
  return null;
}

function setTarget(seat) {
  if (drag.target === seat) return;
  if (drag.target) drag.target.classList.remove('bf-seat-drop-target');
  drag.target = seat;
  if (seat) seat.classList.add('bf-seat-drop-target');
}

function finish(swap) {
  const d = drag;
  drag = null;
  if (!d) return;
  if (d.target) d.target.classList.remove('bf-seat-drop-target');
  d.seatEl.classList.remove('bf-seat-dragging');
  d.seatEl.style.transform = '';
  if (d.moved) swallowClickUntil = Date.now() + 400;
  if (d.moved && swap && d.target) swap(d.name, d.target.dataset.seatName);
  if (d.moved && onDragEnd) onDragEnd();
}

/**
 * Makes one rendered seat draggable. `container` holds every seat (drop targets);
 * `swap(a, b)` is called with the two player names when a drag lands on another seat.
 */
export function makeSeatDraggable(seatEl, name, container, swap) {
  seatEl.dataset.seatName = name;
  seatEl.classList.add('bf-seat-draggable');

  seatEl.addEventListener('pointerdown', (e) => {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { seatEl, name, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false, target: null };
  });

  seatEl.addEventListener('pointermove', (e) => {
    if (!drag || drag.seatEl !== seatEl || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      seatEl.classList.add('bf-seat-dragging');
      try {
        seatEl.setPointerCapture(e.pointerId);
      } catch {
        // Capture is a nicety (keeps moves coming if the finger outruns the seat).
      }
    }
    e.preventDefault();
    seatEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    setTarget(seatUnder(e.clientX, e.clientY, container));
  });

  seatEl.addEventListener('pointerup', (e) => {
    if (drag && drag.seatEl === seatEl && e.pointerId === drag.pointerId) finish(swap);
  });
  seatEl.addEventListener('pointercancel', () => {
    if (drag && drag.seatEl === seatEl) finish(null);
  });

  // Capture phase, so the avatar button's "mark loser" never sees a drag's click.
  seatEl.addEventListener(
    'click',
    (e) => {
      if (Date.now() < swallowClickUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );
}
