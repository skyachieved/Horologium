/* Reusable form controls. Plain elements; the active theme styles them through shared class names. */
import { h } from './dom.js';

/**
 * Radio-style button group. options: [{ value, label, sub? }]. Returns an element with .setValue(v).
 */
export function segmented(name, options, current, onPick) {
  const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': name });
  const buttons = options.map(({ value, label, sub }) => {
    const b = h('button', { type: 'button', class: 'seg', role: 'radio', 'aria-checked': 'false', onclick: () => onPick(value) },
      h('span', { class: 'seg-label' }, label), sub ? h('span', { class: 'seg-sub' }, sub) : null);
    b.dataset.value = value;
    return b;
  });
  group.append(...buttons);
  group.setValue = (v) => buttons.forEach((b) => {
    const on = b.dataset.value === String(v);
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  group.setValue(current);
  return group;
}

/** Range slider with a live value label. onInput fires continuously, onChange on release. */
export function slider({ min, max, step, value, label, format = (v) => String(v), onInput, onChange }) {
  const out = h('output', { class: 'slider-value' }, format(value));
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label });
  input.addEventListener('input', () => {
    out.textContent = format(Number(input.value));
    onInput?.(Number(input.value));
  });
  input.addEventListener('change', () => onChange?.(Number(input.value)));
  return h('div', { class: 'slider' }, input, out);
}

/** Switch. Returns an element with .setChecked(bool). */
export function toggle({ checked, label, onChange }) {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const el = h('label', { class: 'switch' }, input, h('span', { class: 'switch-track' }, h('span', { class: 'switch-thumb' })));
  el.setChecked = (v) => { input.checked = v; };
  return el;
}

/** A labelled settings row: text on the left, control on the right. */
export function row(label, control, hint, { stack = false } = {}) {
  return h('div', { class: stack ? 'row row-stack' : 'row' },
    h('div', { class: 'row-text' }, h('div', { class: 'row-label' }, label), hint ? h('div', { class: 'hint' }, hint) : null),
    h('div', { class: 'row-control' }, control));
}

export function section(title, ...rows) {
  return h('section', { class: 'settings-section' }, h('h3', {}, title), ...rows);
}
