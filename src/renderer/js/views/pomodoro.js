/* Pomodoro tab: themed scene (ring + art driven by --progress), time, controls, session seedlings. */
import { h, fromMarkup, setText } from '../dom.js';
import { icon } from '../icons.js';
import { t, formatNumber } from '../i18n.js';
import * as S from '../app-state.js';
import * as P from '../../core/pomodoro.js';

const pad = (n) => String(n).padStart(2, '0');

export function formatDuration(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function createPomodoroView({ scenes }) {
  const scene = h('div', { class: 'scene scene-pomodoro' });
  scene.append(fromMarkup(scenes.pomodoro));
  const time = h('div', { class: 'time' });
  const label = h('div', { class: 'phase-label' });
  scene.append(h('div', { class: 'scene-overlay' }, time, label));

  const primaryIcon = h('span');
  const primaryText = h('span');
  const primary = h('button', { class: 'btn btn-primary btn-big', onclick: () => S.togglePomodoro() }, primaryIcon, primaryText);
  const reset = h('button', { class: 'btn btn-round', title: t('pomodoro.reset'), 'aria-label': t('pomodoro.reset'), onclick: () => S.resetPomodoro() }, icon('reset'));
  const skip = h('button', { class: 'btn btn-round', title: t('pomodoro.skip'), 'aria-label': t('pomodoro.skip'), onclick: () => S.skipPomodoro() }, icon('skip'));

  const seeds = h('div', { class: 'seedlings', role: 'img' });
  const next = h('div', { class: 'muted center' });
  const hint = h('div', { class: 'hint center' }, t('pomodoro.hint'));

  const el = h('section', { class: 'view view-pomodoro', id: 'view-pomodoro' },
    scene,
    h('div', { class: 'controls' }, reset, primary, skip),
    seeds,
    next,
    hint);

  let seedCount = 0;

  function update(now) {
    const st = S.pomo();
    const s = S.pomoSettings();
    const remainingMs = P.remaining(st, now);
    setText(time, formatDuration(remainingMs));
    setText(label, S.phaseLabel(st.phase));
    scene.style.setProperty('--progress', P.progress(st, now, s).toFixed(4));
    scene.dataset.phase = st.phase;
    scene.dataset.running = String(st.running);

    const fresh = !st.running && st.remainingMs === P.durationMs(st.phase, s);
    primaryIcon.replaceChildren(icon(st.running ? 'pause' : 'play'));
    setText(primaryText, t(st.running ? 'pomodoro.pause' : fresh ? 'pomodoro.start' : 'pomodoro.resume'));

    const filled = P.setProgress(st, s);
    if (seedCount !== s.longEvery) {
      seedCount = s.longEvery;
      seeds.replaceChildren(...Array.from({ length: s.longEvery }, () => h('span', { class: 'seed' })));
    }
    [...seeds.children].forEach((seed, i) => seed.classList.toggle('on', i < filled));
    seeds.setAttribute('aria-label', t('pomodoro.sessions', { done: filled, total: s.longEvery }));

    const upcoming = P.nextPhase(st, s).phase;
    const upMin = upcoming === 'focus' ? s.focusMin : upcoming === 'short' ? s.shortMin : s.longMin;
    setText(next, t('pomodoro.next', { phase: S.phaseLabel(upcoming), min: formatNumber(upMin) }));
  }

  update(Date.now());
  return { el, update, dispose() {} };
}
