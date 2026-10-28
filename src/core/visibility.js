/*
 * The widget's three visibility states, in order: menu (expanded) <-> icon (collapsed) <-> hidden. PURE.
 *
 * Owner's spec (notes 5): one hotkey moves LEFT (towards the menu), the other moves RIGHT (towards hidden).
 * Right wraps from hidden back to the menu; left stops at the menu so a stray press never hides the app.
 */
export const VIEW_STATES = Object.freeze(['menu', 'icon', 'hidden']);
export const DIRECTIONS = Object.freeze(['left', 'right']);

/** stepView('icon', 'left') -> 'menu'. Unknown states are treated as hidden (the safest place to start from). */
export function stepView(state, direction) {
  const i = VIEW_STATES.includes(state) ? VIEW_STATES.indexOf(state) : VIEW_STATES.length - 1;
  if (direction === 'left') return VIEW_STATES[Math.max(0, i - 1)];
  if (direction === 'right') return VIEW_STATES[(i + 1) % VIEW_STATES.length];
  throw new Error(`unknown direction "${direction}"`);
}

/** The state the main process sees: a hidden (or hiding) window is "hidden", otherwise the renderer's mode decides. */
export function currentView({ visible, hiding = false, expanded }) {
  if (!visible || hiding) return 'hidden';
  return expanded ? 'menu' : 'icon';
}
