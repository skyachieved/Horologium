/*
 * Layout numbers shared by CSS and the main process (which needs the window size).
 * JS is the single source of truth: these become CSS custom properties on :root.
 *
 *   collapsed: just the character (plus room for the hover chips)
 *   expanded:  the character with its menu bubbles around it, and below it a speech bubble that holds what the
 *              character says and the open tab. No card, no tab bar: the menu IS the character (owner's note 2).
 */
export const LAYOUT = {
  charCollapsed: 104,   // character height (px) at 100% size, collapsed
  charExpanded: 72,     // ... and expanded, in the middle of its menu bubbles
  expandedWidth: 440,
  edge: 10,        // transparent margin around everything so shadows are not clipped
  ringH: 118,      // the sprite plus the menu bubbles around it
  tail: 10,        // the speech bubble's tail pointing at the sprite
  speechPad: 12,
  lineH: 40,       // the character's line at the top of the speech bubble (up to two lines)
  gap: 8,
  panelH: 436,
  collapsedMarginX: 44,
  collapsedMarginY: 70,
};

export const charPx = (scale, mode) => Math.round((mode === 'expanded' ? LAYOUT.charExpanded : LAYOUT.charCollapsed) * scale);

/**
 * Window size for a mode. `wide` ({ w, h }) is a web music source's preferred size: the speech bubble grows to fit
 * a real web page, and `panelH` (returned for the CSS variable) grows with it.
 */
export function sizeFor(mode, scale, wide = null) {
  if (mode === 'expanded') {
    const ring = Math.max(LAYOUT.ringH, charPx(scale, 'expanded') + 46);
    const panelH = wide ? Math.min(820, Math.max(360, wide.h - 250)) : LAYOUT.panelH;
    return {
      width: wide ? wide.w : LAYOUT.expandedWidth,
      height: LAYOUT.edge * 2 + ring + LAYOUT.tail + LAYOUT.speechPad * 2 + LAYOUT.lineH + LAYOUT.gap + panelH,
      panelH,
      ringH: ring,
    };
  }
  const c = charPx(scale, 'collapsed');
  return { width: Math.max(150, c + LAYOUT.collapsedMarginX * 2), height: c + LAYOUT.collapsedMarginY };
}

/** Publish the numbers to CSS. */
export function applyLayoutVars(scale, wide = null) {
  const root = document.documentElement.style;
  const expanded = sizeFor('expanded', scale, wide);
  root.setProperty('--char-size-collapsed', `${charPx(scale, 'collapsed')}px`);
  root.setProperty('--char-size-expanded', `${charPx(scale, 'expanded')}px`);
  root.setProperty('--panel-h', `${expanded.panelH}px`);
  root.setProperty('--ring-h', `${expanded.ringH}px`);
  root.setProperty('--tail', `${LAYOUT.tail}px`);
  root.setProperty('--speech-pad', `${LAYOUT.speechPad}px`);
  root.setProperty('--line-h', `${LAYOUT.lineH}px`);
  root.setProperty('--edge', `${LAYOUT.edge}px`);
  root.setProperty('--gap', `${LAYOUT.gap}px`);
  root.setProperty('--expanded-w', `${expanded.width}px`);
}
