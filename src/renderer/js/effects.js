/*
 * Short-lived particle effects (splash, floating "+355 mL", confetti). They are plain DOM nodes
 * animated with transform/opacity only (compositor-friendly) and removed right after, so they cost
 * nothing when idle. Themes can restyle them through the @keyframes hz-bit / hz-float / hz-confetti.
 */
import { h } from './dom.js';

const reduced = () => document.documentElement.dataset.reduceMotion === 'true';
const rand = (min, max) => min + Math.random() * (max - min);

function burst(container, className, count, spread, lifeMs, colorVars) {
  if (reduced()) return;
  const bits = [];
  for (let i = 0; i < count; i += 1) {
    const angle = rand(-Math.PI * 0.95, -Math.PI * 0.05); // upward fan
    const dist = rand(spread * 0.5, spread);
    const bit = h('span', {
      class: className,
      style: {
        '--dx': `${Math.cos(angle) * dist}px`,
        '--dy': `${Math.sin(angle) * dist}px`,
        '--rot': `${rand(-240, 240)}deg`,
        '--delay': `${rand(0, 90)}ms`,
        '--c': colorVars ? `var(${colorVars[i % colorVars.length]})` : 'currentColor',
      },
    });
    bits.push(bit);
    container.append(bit);
  }
  setTimeout(() => bits.forEach((b) => b.remove()), lifeMs);
}

/** Little water droplets popping out of the glass. */
export function splash(container) {
  burst(container, 'fx-bit fx-drop', 9, 70, 900, ['--water', '--water-deep']);
}

/** Celebration for 25/50/75/100 % milestones. */
export function confetti(container) {
  burst(container, 'fx-bit fx-confetti', 30, 150, 1500, ['--accent', '--water', '--good', '--warn', '--break-long']);
}

/** "+355 mL" drifting upward. */
export function floatText(container, text) {
  if (reduced()) return;
  const el = h('span', { class: 'fx-float' }, text);
  container.append(el);
  setTimeout(() => el.remove(), 1200);
}
