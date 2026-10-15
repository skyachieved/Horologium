/*
 * Layout numbers shared by CSS and the main process (which needs the window size).
 * JS is the single source of truth: these become CSS custom properties on :root.
 *
 *   collapsed: just the character (plus room for the hover chips)
 *   expanded:  [character header] [tab bar] [panel]
 */
export const LAYOUT = {
  charCollapsed: 104,   // character height (px) at 100% size, collapsed
  charExpanded: 78,     // ... and expanded
  expandedWidth: 440,
  edge: 10,        // transparent margin around the card so its shadow is not clipped
  pad: 12,
  gap: 8,
  tabsH: 50,
  panelH: 392,
  collapsedMarginX: 44,
  collapsedMarginY: 70,
};

export const charPx = (scale, mode) => Math.round((mode === 'expanded' ? LAYOUT.charExpanded : LAYOUT.charCollapsed) * scale);

/**
 * Window size for a mode. `wide` ({ w, h }) is a web music source's preferred size: the expanded card
 * grows to fit a real web page, and `panelH` (returned for the CSS variable) grows with it.
 */
export function sizeFor(mode, scale, wide = null) {
  if (mode === 'expanded') {
    const head = charPx(scale, 'expanded') + 12;
    const panelH = wide ? Math.min(820, Math.max(360, wide.h - 190)) : LAYOUT.panelH;
    return {
      width: wide ? wide.w : LAYOUT.expandedWidth,
      height: LAYOUT.edge * 2 + LAYOUT.pad * 2 + head + LAYOUT.gap + LAYOUT.tabsH + LAYOUT.gap + panelH,
      panelH,
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
  root.setProperty('--tabs-h', `${LAYOUT.tabsH}px`);
  root.setProperty('--edge', `${LAYOUT.edge}px`);
  root.setProperty('--pad', `${LAYOUT.pad}px`);
  root.setProperty('--gap', `${LAYOUT.gap}px`);
  root.setProperty('--expanded-w', `${expanded.width}px`);
}
