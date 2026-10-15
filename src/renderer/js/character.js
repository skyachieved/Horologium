/*
 * The character: inline SVG art + a state class (state-idle / wave / cheer / sleep) that the active
 * theme's CSS turns into motion. `base` is the resting state; `pulse` plays a temporary one.
 */
import { h, fromMarkup } from './dom.js';

export const STATES = ['idle', 'wave', 'cheer', 'sleep'];

export function createCharacter(svgMarkup, id) {
  const el = h('div', { class: 'char state-idle', role: 'img', dataset: { character: id } });
  el.append(fromMarkup(svgMarkup));

  let base = 'idle';
  let pulseState = null;
  let pulseTimer = null;

  const apply = () => {
    const name = pulseState ?? base;
    for (const s of STATES) el.classList.toggle(`state-${s}`, s === name);
  };

  return {
    el,
    /** Resting expression (e.g. 'sleep' during a break, 'wave' while a cup is due). */
    setBase(name) {
      if (base === name) return;
      base = name;
      apply();
    },
    /** Temporarily override, then fall back to the base state. */
    pulse(name, ms = 2000) {
      clearTimeout(pulseTimer);
      pulseState = name;
      apply();
      pulseTimer = setTimeout(() => {
        pulseState = null;
        apply();
      }, ms);
    },
  };
}
