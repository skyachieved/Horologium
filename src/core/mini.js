/*
 * Geometry and fade rules for the pinned mini player. PURE (no Electron), unit-tested.
 *
 * The mini player is a small always-on-top window holding the SAME web view that was in the widget,
 * with the page unmodified. We only change its zoom and where it sits inside the window, so that just the
 * <video> rectangle is visible and the rest of the page is clipped away by the window edge.
 */

export const MINI = Object.freeze({
  width: 320,        // default window width (px)
  minWidth: 240,
  maxWidth: 640,
  strip: 22,         // height of our own control/drag strip above the video
  margin: 24,        // distance from the screen edge
  lift: 200,         // keep clear of the collapsed widget in the bottom-right corner
  fadeAfterMs: 3000, // rest at full opacity this long after the pointer leaves
  dimOpacity: 0.35,  // never fully invisible: a visible mini player is not a hidden background player
  zoomMin: 0.15,
  zoomMax: 1.5,
});

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * How to show only the video.
 *   viewport  the page's CSS viewport size (what the view has now: keep it so the page does not reflow)
 *   video     the <video> rectangle in CSS px, relative to the viewport
 * Returns the zoom factor, the mini window size, and the view's bounds inside the window.
 */
export function cropLayout({ viewport, video, miniWidth = MINI.width, strip = MINI.strip }) {
  const width = clamp(miniWidth, MINI.minWidth, MINI.maxWidth);
  const zoom = clamp(width / video.width, MINI.zoomMin, MINI.zoomMax);
  const shownWidth = Math.round(video.width * zoom);
  const shownHeight = Math.round(video.height * zoom);
  return {
    zoom,
    window: { width: shownWidth, height: shownHeight + strip },
    view: {
      x: Math.round(-video.x * zoom) || 0, // `|| 0` turns -0 into 0
      y: Math.round(-video.y * zoom + strip) || 0,
      width: Math.round(viewport.width * zoom),
      height: Math.round(viewport.height * zoom),
    },
  };
}

/** Where a new mini window goes: bottom-right of the work area, lifted above the collapsed widget. */
export function defaultMiniPosition(size, workArea) {
  const x = workArea.x + workArea.width - size.width - MINI.margin;
  const y = workArea.y + workArea.height - size.height - MINI.margin - MINI.lift;
  return {
    x: clamp(x, workArea.x, workArea.x + workArea.width - size.width),
    y: clamp(y, workArea.y, workArea.y + workArea.height - size.height),
  };
}

/**
 * The opacity the mini player should be heading to.
 *   hovering        the pointer is over it
 *   lastActiveAt    ms of the last hover or user interaction
 */
export function fadeTarget({ hovering, lastActiveAt, now }) {
  if (hovering) return 1;
  return now - lastActiveAt >= MINI.fadeAfterMs ? MINI.dimOpacity : 1;
}

/** One animation step toward `target` (fast to brighten, slow to dim). */
export function stepOpacity(current, target) {
  if (Math.abs(current - target) < 0.005) return target;
  const rate = target > current ? 0.25 : 0.06;
  return current + (target - current) * rate;
}

/** Is the pointer inside a rectangle? */
export function pointInside(point, rect) {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}
