/* A tiny transient message at the top of the widget ("Shortcut saved", "That shortcut is taken"). */
import { h } from './dom.js';

let timer = null;

export function toast(message, kind = 'info', ms = 2600) {
  const host = document.getElementById('app');
  if (!host) return;
  host.querySelector('.toast')?.remove();
  const el = h('div', { class: `toast toast-${kind}`, role: 'status' }, message);
  host.append(el);
  clearTimeout(timer);
  timer = setTimeout(() => el.remove(), ms);
}
