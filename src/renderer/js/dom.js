/* Tiny DOM helpers. No framework: views build elements once and update them in place. */

/**
 * h('button', { class: 'btn', onclick: fn, dataset: { x: 1 } }, 'Label', childEl)
 * `false`/null/undefined props and children are skipped, arrays are flattened.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Set text only when it changed (avoids needless layout during the 1 Hz tick). */
export function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

/** Parse trusted markup (our own SVG strings or theme SVGs that passed checkSvgSafety). */
export function fromMarkup(markup) {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  return tpl.content.firstElementChild;
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
