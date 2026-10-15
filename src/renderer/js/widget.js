/*
 * The widget shell: character header, the tab bar the character "holds", and the panel with one view
 * per tab. Handles collapse/expand (and asks the main process to resize the window), dragging,
 * the pop-in / pop-out animations, keyboard shortcuts, and keeps the character's mood in sync.
 */
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { t, formatClock } from './i18n.js';
import * as S from './app-state.js';
import { createCharacter } from './character.js';
import { makeDraggable } from './drag.js';
import { sizeFor, applyLayoutVars } from './layout.js';
import { createCalm } from './calm.js';
import { createPomodoroView, formatDuration } from './views/pomodoro.js';
import { createHydrationView } from './views/hydration.js';
import { createSettingsView } from './views/settings.js';
import { createMusicView } from './views/music.js';
import * as Music from './music-manager.js';
import * as P from '../core/pomodoro.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

/**
 * @param {{registry: object, themeData: object, character: object, characterSvg: string,
 *          actions: object, resume?: {expanded: boolean}}} boot
 */
export function buildWidget(boot) {
  const { registry, themeData, character, characterSvg, actions } = boot;
  const bridge = window.horologium;
  const root = document.getElementById('app');
  const scale = () => S.getState().settings.charScale;
  const disposers = [];

  // ---------- tabs (data-driven; Music appears once a music source is installed) ----------
  const tabDefs = [
    { id: 'pomodoro', icon: 'timer', label: 'tab.pomodoro' },
    { id: 'hydration', icon: 'drop', label: 'tab.hydration' },
    ...(Music.musicSources(registry).length ? [{ id: 'music', icon: 'music', label: 'tab.music' }] : []),
    { id: 'settings', icon: 'gear', label: 'tab.settings' },
  ];
  let wide = null; // a web source's preferred { w, h }, while its tab is open
  const settingsCtx = { registry, theme: themeData.theme, character, actions: { ...actions, openProfileEditor: () => { setTab('hydration'); views.hydration.edit(); } } };
  const views = {
    pomodoro: createPomodoroView({ scenes: themeData.scenes }),
    hydration: createHydrationView({ scenes: themeData.scenes }),
    settings: createSettingsView(settingsCtx),
  };
  if (Music.musicSources(registry).length) views.music = createMusicView({ registry, wide: { set: (size) => setWide(size) } });

  let tab = tabDefs.some((d) => d.id === S.getState().ui.tab) ? S.getState().ui.tab : 'pomodoro';
  let expanded = false;

  // ---------- DOM ----------
  const char = createCharacter(characterSvg, character.id);
  const dueBadge = h('span', { class: 'due-badge', hidden: true }, icon('drop'));
  const chipTime = h('span', { class: 'chip-text' });
  const chipCups = h('span', { class: 'chip-text' });
  const chipSong = h('span', { class: 'chip-text' });
  const chipMusic = h('span', { class: 'chip', hidden: true }, icon('music'), chipSong);
  const chips = h('div', { class: 'chips', 'aria-hidden': 'true' },
    h('span', { class: 'chip' }, icon('timer'), chipTime),
    h('span', { class: 'chip' }, icon('drop'), chipCups),
    chipMusic);
  const charBtn = h('div', { class: 'char-btn', role: 'button', tabindex: '0', 'aria-label': t('app.toggle') }, char.el, dueBadge);
  const bubble = h('div', { class: 'bubble', 'aria-live': 'polite' });
  const closeBtn = h('button', { type: 'button', class: 'btn btn-round close-btn', 'data-no-drag': '1', title: t('app.collapse'), 'aria-label': t('app.collapse'), onclick: () => setExpanded(false) }, icon('close'));
  const head = h('header', { class: 'head' }, chips, charBtn, bubble, closeBtn);

  const tabButtons = tabDefs.map((d) => h('button', { type: 'button', class: 'tab', role: 'tab', id: `tab-${d.id}`, 'aria-controls': `view-${d.id}`, 'data-no-drag': '1', onclick: () => setTab(d.id) },
    icon(d.icon), h('span', { class: 'tab-label' }, t(d.label))));
  const tabs = h('nav', { class: 'tabs-held', role: 'tablist', 'aria-label': t('app.tabs') }, tabButtons);
  const panel = h('main', { class: 'panel' }, ...tabDefs.map((d) => { views[d.id].el.hidden = true; return views[d.id].el; }));
  const stage = h('div', { id: 'stage', class: 'stage' }, head, tabs, panel);

  clear(root);
  root.dataset.mode = 'collapsed';
  root.dataset.flip = 'down';
  root.append(stage);

  // An idle widget pauses its animations (see calm.js); anything that happens wakes it.
  const calm = createCalm({ root, isExpanded: () => expanded, events: document });
  disposers.push(calm.dispose);

  // ---------- tabs ----------
  function setTab(id) {
    if (!views[id]) return;
    if (tab !== id) views[tab]?.deactivate?.(); // e.g. leaving Music destroys any open web page
    tab = id;
    tabDefs.forEach((d, i) => {
      views[d.id].el.hidden = d.id !== id;
      tabButtons[i].classList.toggle('on', d.id === id);
      tabButtons[i].setAttribute('aria-selected', String(d.id === id));
    });
    if (S.getState().ui.tab !== id) S.patch({ ui: { tab: id } });
    panel.scrollTop = 0; // each tab starts at its top
    views[id].update(Date.now());
  }

  // ---------- expand / collapse ----------
  /** Widen (or restore) the expanded card for a web music source. */
  async function setWide(size) {
    const same = JSON.stringify(wide) === JSON.stringify(size);
    wide = size;
    applyLayoutVars(scale(), wide);
    if (expanded && !same) {
      const { flipped } = (await bridge.resize({ mode: 'expanded', ...sizeFor('expanded', scale(), wide) })) ?? {};
      root.dataset.flip = flipped ? 'up' : 'down';
    }
  }

  async function setExpanded(next) {
    if (next === expanded) return;
    calm.wake(800);
    if (!next) views[tab]?.deactivate?.(); // collapsing closes web pages (no background player)
    expanded = next;
    const size = sizeFor(next ? 'expanded' : 'collapsed', scale(), next ? wide : null);
    if (next) {
      const { flipped } = (await bridge.resize({ mode: 'expanded', ...size })) ?? {};
      root.dataset.flip = flipped ? 'up' : 'down';
      root.dataset.mode = 'expanded';
      views[tab].update(Date.now());
    } else {
      root.dataset.mode = 'collapsed';
      await sleep(160); // let the panel fold away before the window shrinks
      if (!expanded) {
        await bridge.resize({ mode: 'collapsed', ...size });
        root.dataset.flip = 'down';
      }
    }
  }

  async function applyScale() {
    applyLayoutVars(scale(), wide);
    await bridge.resize({ mode: expanded ? 'expanded' : 'collapsed', ...sizeFor(expanded ? 'expanded' : 'collapsed', scale(), expanded ? wide : null) });
  }

  // ---------- drag / click ----------
  makeDraggable(head, { onClick: (e) => { if (!expanded && e.target.closest('.char-btn')) setExpanded(true); else if (e.target.closest('.char-btn')) char.pulse('wave', 1400); } });
  charBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } });

  // ---------- pop-in / pop-out ----------
  const noMotion = () => document.documentElement.dataset.reduceMotion === 'true';
  function playOnce(cls) {
    return new Promise((resolve) => {
      if (noMotion()) { resolve(); return; }
      stage.classList.remove('is-entering', 'is-leaving');
      void stage.offsetWidth;
      stage.classList.add(cls);
      const done = (e) => {
        if (e && e.target !== stage) return;
        stage.removeEventListener('animationend', done);
        clearTimeout(fallback);
        resolve();
      };
      const fallback = setTimeout(done, 1100);
      stage.addEventListener('animationend', done);
    });
  }
  disposers.push(bridge.onShow(async () => {
    S.touchDay();
    calm.setHidden(false);
    calm.wake(2600);
    root.classList.remove('is-hidden');
    await playOnce('is-entering');
    stage.classList.remove('is-entering');
    char.pulse('wave', 1600);
  }));
  disposers.push(bridge.onHideRequest(async () => {
    calm.wake(1500); // a paused pop-out would never finish: the character would vanish instead of leaving
    views[tab]?.deactivate?.();
    await playOnce('is-leaving');
    bridge.hideNow();
    stage.classList.remove('is-leaving');
    calm.setHidden(true); // off screen: no animation, no sign of life
  }));
  disposers.push(bridge.onOpenTab(async (id) => { await setExpanded(true); setTab(id); }));
  const onVisibility = () => root.classList.toggle('paused', document.hidden); // stop animating while hidden
  document.addEventListener('visibilitychange', onVisibility);
  disposers.push(() => document.removeEventListener('visibilitychange', onVisibility));

  // ---------- music chip (shown on hover while something plays) ----------
  const syncMusicChip = () => {
    const title = Music.nowPlaying();
    chipMusic.hidden = !title;
    if (title) chipSong.textContent = title;
  };
  syncMusicChip();
  disposers.push(Music.onChange(syncMusicChip));

  // ---------- engine events ----------
  disposers.push(S.on('effect', (e) => {
    const pulse = (state, ms) => { calm.wake(ms + 800); char.pulse(state, ms); };
    if (e.type === 'drink') pulse('cheer', 1200);
    else if (e.type === 'milestone') pulse('cheer', 2600);
    else if (e.type === 'reminder') pulse('wave', 5000);
    else if (e.type === 'pomodoro-complete') pulse('cheer', 3200);
    else calm.wake(3000); // e.g. a phase change: let its one-shot animations finish
  }));

  let lastBase = null;
  disposers.push(S.on('tick', ({ now, info }) => {
    const st = S.pomo();
    const s = S.pomoSettings();
    const tg = S.target();
    const day = S.dayRecord(now);
    const done = day?.drinks.length ?? 0;
    const due = info.decision === 'notify' || info.decision === 'due';

    chipTime.textContent = formatDuration(P.remaining(st, now));
    chipCups.textContent = tg ? `${done}/${tg.cups}` : '–';
    dueBadge.hidden = !due;
    const base = due ? 'wave' : st.running && st.phase !== 'focus' ? 'sleep' : 'idle';
    if (base !== lastBase) { lastBase = base; calm.wake(2500); } // a mood change should be seen, not paused
    char.setBase(base);
    root.dataset.phase = st.phase;
    root.dataset.running = String(st.running);

    if (expanded) {
      bubble.textContent = bubbleText({ st, s, now, due, tg, done });
      views[tab].update(now);
    }
  }));

  function bubbleText({ st, now, due, tg, done }) {
    if (due) return t('bubble.drink');
    if (st.running && st.phase === 'focus') return t('bubble.focus', { time: formatDuration(P.remaining(st, now)) });
    if (st.running) return t('bubble.break');
    if (tg && done >= tg.cups) return t('bubble.goal');
    if (!tg) return t('bubble.setup');
    return t('bubble.hello', { time: formatClock(now) });
  }

  // ---------- keyboard ----------
  const onKeyDown = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') { if (expanded) setExpanded(false); else bridge.hideNow().catch(() => {}); return; }
    if (!expanded) return;
    const number = Number(key);
    if (number >= 1 && number <= tabDefs.length) { setTab(tabDefs[number - 1].id); return; }
    if (key === ' ' && tab === 'pomodoro' && e.target === document.body) { e.preventDefault(); S.togglePomodoro(); }
    else if (key === 'd' && S.profile()) S.logDrink();
    else if (key === 'z' && S.profile()) S.undoDrink();
  };
  document.addEventListener('keydown', onKeyDown);
  disposers.push(() => document.removeEventListener('keydown', onKeyDown));

  // Any interaction starts today's reminder window (see app-state.touchDay).
  const onPointer = () => S.touchDay();
  document.addEventListener('pointerdown', onPointer, true);
  disposers.push(() => document.removeEventListener('pointerdown', onPointer, true));

  // ---------- initial state ----------
  setTab(tab);
  applyLayoutVars(scale());
  bridge.resize({ mode: 'collapsed', ...sizeFor('collapsed', scale()) });
  if (boot.resume?.expanded) setExpanded(true);

  return {
    setTab,
    setExpanded,
    applyScale,
    isExpanded: () => expanded,
    currentTab: () => tab,
    dispose() {
      disposers.forEach((d) => d());
      Object.values(views).forEach((v) => v.dispose?.());
    },
  };
}
