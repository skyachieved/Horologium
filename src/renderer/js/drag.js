/*
 * Dragging the frameless window, with a click/drag threshold so a plain click still works.
 * The main process owns the actual window position; we only report pointer movement.
 */
const THRESHOLD = 5;

/**
 * @param {HTMLElement} handle  element that starts a drag (buttons inside it are ignored)
 * @param {{onClick?: (e: PointerEvent, pressed: Element) => void}} [opts]
 *   `pressed` is the element under the pointer when the button went DOWN. Use it, not e.target: the handle
 *   captures the pointer, so a real pointerup is retargeted to the handle itself. (Synthetic test events are
 *   not retargeted, which is how a dead click on the character once slipped through every test.)
 */
export function makeDraggable(handle, { onClick } = {}) {
  let start = null;
  let dragging = false;
  let pressed = null;

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('[data-no-drag]')) return;
    start = { x: e.screenX, y: e.screenY };
    pressed = e.target;
    dragging = false;
    try { handle.setPointerCapture(e.pointerId); } catch { /* pointer already gone: dragging still works without capture */ }
    window.horologium.dragStart({ screenX: e.screenX, screenY: e.screenY });
  });

  handle.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!dragging && Math.hypot(e.screenX - start.x, e.screenY - start.y) > THRESHOLD) {
      dragging = true;
      handle.classList.add('is-dragging');
    }
    if (dragging) window.horologium.dragMove({ screenX: e.screenX, screenY: e.screenY });
  });

  const finish = (e) => {
    if (!start) return;
    const wasDrag = dragging;
    start = null;
    dragging = false;
    handle.classList.remove('is-dragging');
    try { if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    window.horologium.dragEnd();
    const target = pressed;
    pressed = null;
    if (!wasDrag && e.type === 'pointerup' && target) onClick?.(e, target);
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
}
