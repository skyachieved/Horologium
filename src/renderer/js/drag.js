/*
 * Dragging the frameless window, with a click/drag threshold so a plain click still works.
 * The main process owns the actual window position; we only report pointer movement.
 */
const THRESHOLD = 5;

/**
 * @param {HTMLElement} handle  element that starts a drag (buttons inside it are ignored)
 * @param {{onClick?: (e: PointerEvent) => void}} [opts]
 */
export function makeDraggable(handle, { onClick } = {}) {
  let start = null;
  let dragging = false;

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('[data-no-drag]')) return;
    start = { x: e.screenX, y: e.screenY };
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
    if (!wasDrag && e.type === 'pointerup') onClick?.(e);
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
}
