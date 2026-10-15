/*
 * Window geometry for the floating widget. PURE (plain {x, y, width, height} objects), so the
 * "expand without falling off the screen" rules are unit-tested without Electron.
 *
 * Layout model: when expanded, the character box sits at the TOP of the window; if there is no room
 * below it, the window grows UPWARD instead (`flipped`) and the character box sits at the BOTTOM.
 * The collapsed window is just the character box.
 */

const round = Math.round;

/** Keep `b` inside `wa`, shrinking it if it is bigger than the work area. */
export function clampToWorkArea(b, wa) {
  const width = Math.min(b.width, wa.width);
  const height = Math.min(b.height, wa.height);
  const x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - width);
  const y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - height);
  return { x: round(x), y: round(y), width: round(width), height: round(height) };
}

function overlapArea(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The work area that overlaps `bounds` the most (falls back to the first one). */
export function pickWorkArea(bounds, workAreas) {
  let best = workAreas[0];
  let bestArea = -1;
  for (const wa of workAreas) {
    const area = overlapArea(bounds, wa);
    if (area > bestArea) {
      best = wa;
      bestArea = area;
    }
  }
  return best;
}

/** Where to put the collapsed widget on first run: bottom-right corner with a margin. */
export function defaultCollapsedBounds(size, wa, margin = 24) {
  return clampToWorkArea({ x: wa.x + wa.width - size.width - margin, y: wa.y + wa.height - size.height - margin, ...size }, wa);
}

/** Restore a saved position onto whichever display still exists; otherwise use the default spot. */
export function restoreBounds(saved, size, workAreas) {
  if (!saved || !Number.isFinite(saved.x) || !Number.isFinite(saved.y)) return defaultCollapsedBounds(size, workAreas[0]);
  const wanted = { x: saved.x, y: saved.y, ...size };
  const wa = pickWorkArea(wanted, workAreas);
  if (overlapArea(wanted, wa) === 0) return defaultCollapsedBounds(size, wa);
  return clampToWorkArea(wanted, wa);
}

/**
 * Grow from the collapsed box to `size`. Returns the new bounds, whether the layout is flipped
 * (grew upward), and a `session` to hand back to planCollapse so the character returns to the exact
 * spot it started from.
 */
export function planExpand(current, size, wa) {
  const fitsBelow = current.y + size.height <= wa.y + wa.height;
  const fitsAbove = current.y + current.height - size.height >= wa.y;
  const flipped = !fitsBelow && fitsAbove;

  const cx = current.x + current.width / 2;
  const y = flipped ? current.y + current.height - size.height : current.y;
  const bounds = clampToWorkArea({ x: cx - size.width / 2, y, width: size.width, height: size.height }, wa);
  return { bounds, flipped, session: { collapsed: { ...current }, expanded: { ...bounds }, flipped } };
}

/**
 * Shrink back to the collapsed box. If the user has not moved the window since expanding, restore
 * the original collapsed bounds exactly (no drift from edge clamping). If they dragged it, keep the
 * character where it now is.
 */
export function planCollapse(current, size, wa, session) {
  const unmoved = session && current.x === session.expanded.x && current.y === session.expanded.y;
  if (unmoved) return clampToWorkArea({ ...session.collapsed, width: size.width, height: size.height }, wa);

  const flipped = Boolean(session?.flipped);
  const cx = current.x + current.width / 2;
  const y = flipped ? current.y + current.height - size.height : current.y;
  return clampToWorkArea({ x: cx - size.width / 2, y, width: size.width, height: size.height }, wa);
}
