/* Small stroke icons (24x24, currentColor) used by the UI chrome. Themes can restyle them with CSS. */
import { h, fromMarkup } from './dom.js';

const P = {
  timer: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 3h5"/>',
  drop: '<path d="M12 3.2c3.6 4.3 6 7.4 6 10.6a6 6 0 0 1-12 0c0-3.2 2.4-6.3 6-10.6z"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  undo: '<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h8.5a5.5 5.5 0 0 1 0 11"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  pause: '<path d="M8 5.5v13M16 5.5v13"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4v4.5H9"/>',
  skip: '<path d="M6 5.5v13l8-6.5zM18 5.5v13"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  edit: '<path d="M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10zM14 7l3 3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.1"/>',
  pin: '<path d="M12 21s6.5-5.7 6.5-11a6.5 6.5 0 0 0-13 0c0 5.3 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  keyboard: '<rect x="3" y="6.5" width="18" height="11" rx="2.5"/><path d="M7 10.5h.1M10.5 10.5h.1M14 10.5h.1M17 10.5h.1M8 14h8"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2.2 2.2 0 0 0 4 0"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  forward: '<path d="M9 6l6 6-6 6"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  volume: '<path d="M4 10v4h4l5 4V6l-5 4zM16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 10v4h4l5 4V6l-5 4zM17 9.5l4 5M21 9.5l-4 5"/>',
};

/** icon('drop') -> <span class="icon"><svg>...</svg></span> */
export function icon(name, extraClass = '') {
  const body = P[name];
  if (!body) throw new Error(`unknown icon "${name}"`);
  const svg = fromMarkup(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`);
  return h('span', { class: `icon ${extraClass}`.trim() }, svg);
}
