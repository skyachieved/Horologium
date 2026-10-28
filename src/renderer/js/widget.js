/*
 * The widget shell: the character, its menu bubbles, and the speech bubble (what the character says, then one
 * view per tab). Handles collapse/expand (and asks the main process to resize the window), dragging,
 * the pop-in / pop-out animations, keyboard shortcuts, and keeps the character's mood and lines in sync.
 */
import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { t, formatClock, language } from './i18n.js';
import * as S from './app-state.js';
import { createCharacter } from './character.js';
import { makeDraggable } from './drag.js';
import { sizeFor, applyLayoutVars } from './layout.js';
import { createCalm } from './calm.js';
import { createPomodoroView, formatDuration } from './views/pomodoro.js';
import { createHydrationView } from './views/hydration.js';
import { createSettingsView } from './views/settings.js';
import { createMusicView } from './views/music.js';
import { createNewsView } from './views/news.js';
import * as U from './updates.js';
import * as Music from './music-manager.js';
import * as P from '../core/pomodoro.js';
import { mergeDialogue, pickLine } from '../core/dialogue.js';

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
    { id: 'news', icon: 'news', label: 'tab.news' },
  ];
  let wide = null; // a web source's preferred { w, h }, while its tab is open
  const settingsCtx = { registry, theme: themeData.theme, character, actions: { ...actions, openProfileEditor: () => { setTab('hydration'); views.hydration.edit(); } } };
  const views = {
    pomodoro: createPomodoroView({ scenes: themeData.scenes }),
    hydration: createHydrationView({ scenes: themeData.scenes }),
    settings: createSettingsView(settingsCtx),
    news: createNewsView(),
  };
  if (Music.musicSources(registry).length) views.music = createMusicView({ registry, wide: { set: (size) => setWide(size) } });

  let tab = tabDefs.some((d) => d.id === S.getState().ui.tab) ? S.getState().ui.tab : 'pomodoro';
  let expanded = false;
  // the character's voice: the theme's lines, with the character's own personality on top (core/dialogue.js)
  const dialogue = mergeDialogue(themeData.theme.dialogueData, character.dialogueData);
  let openedAt = 0;
  let cheerUntil = 0;
  let lastTick = null;

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

  // The menu IS the character (owner's notes 2 and 10): its tabs pop out as bubbles around the sprite, and the open
  // tab is a speech bubble below it that starts with what the character says. No card, no tab bar.
  const tabButtons = tabDefs.map((d, i) => h('button', { type: 'button', class: 'tab', role: 'tab', id: `tab-${d.id}`, 'aria-controls': `view-${d.id}`, 'data-no-drag': '1', dataset: { tab: d.id }, style: `--i: ${i}`, onclick: () => setTab(d.id) },
    icon(d.icon), h('span', { class: 'tab-label' }, t(d.label)), d.id === 'news' ? h('span', { class: 'tab-dot', hidden: true, 'aria-hidden': 'true' }) : null));
  const newsDot = tabButtons.find((b) => b.dataset.tab === 'news')?.querySelector('.tab-dot');
  const syncNewsDot = () => { if (newsDot) newsDot.hidden = !U.newsDot(); };
  const ring = h('nav', { class: 'ring', role: 'tablist', 'aria-label': t('app.tabs') }, tabButtons);
  const head = h('header', { class: 'head' }, chips, ring, charBtn);
  const line = h('p', { class: 'speech-line', 'aria-live': 'polite' });
  const closeBtn = h('button', { type: 'button', class: 'btn btn-round close-btn', 'data-no-drag': '1', title: t('app.collapse'), 'aria-label': t('app.collapse'), onclick: () => setExpanded(false) }, icon('close'));
  const panel = h('main', { class: 'panel' }, ...tabDefs.map((d) => { views[d.id].el.hidden = true; return views[d.id].el; }));
  const speech = h('section', { class: 'speech' }, h('div', { class: 'speech-top' }, line, closeBtn), panel);
  const stage = h('div', { id: 'stage', class: 'stage' }, head, speech);

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
    syncNewsDot();
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
      openedAt = Date.now();
      renderLine(openedAt);
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
  makeDraggable(head, {
    onClick: (_e, pressed) => {
      if (!pressed.closest('.char-btn')) return;
      if (!expanded) setExpanded(true); // clicking the icon opens the menu (owner's notes 6 and 7)
      else char.pulse('wave', 1400);
    },
  });
  // Keyboard users: Enter toggles. Space is deliberately not bound here: it is the Pomodoro start/pause key.
  charBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setExpanded(!expanded); } });

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
  disposers.push(bridge.onShow(async (payload) => {
    S.touchDay();
    calm.setHidden(false);
    calm.wake(2600);
    root.classList.remove('is-hidden');
    if (payload?.mode) await setExpanded(payload.mode === 'expanded');
    await playOnce('is-entering');
    stage.classList.remove('is-entering');
    char.pulse('wave', 1600);
  }));
  // menu <-> icon requested by a hotkey or the tray while the widget is on screen
  disposers.push(bridge.onSetMode((mode) => setExpanded(mode === 'expanded')));
  disposers.push(bridge.onCommand((cmd) => {
    if (cmd === 'pomodoro-toggle') S.togglePomodoro();
    else if (cmd === 'drink' && S.profile()) S.logDrink();
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
  disposers.push(U.onUpdate(syncNewsDot));

  // ---------- engine events ----------
  disposers.push(S.on('effect', (e) => {
    const pulse = (state, ms) => { calm.wake(ms + 800); char.pulse(state, ms); };
    if (e.type === 'drink') { pulse('cheer', 1200); cheerUntil = Date.now() + 8000; renderLine(Date.now()); }
    else if (e.type === 'milestone') pulse('cheer', 2600);
    else if (e.type === 'reminder') pulse('wave', 5000);
    else if (e.type === 'pomodoro-complete') pulse('cheer', 3200);
    else calm.wake(3000); // e.g. a phase change: let its one-shot animations finish
  }));

  // One line for the tray tooltip (Windows: the hidden icons area). Minutes, not seconds, so it rarely changes.
  let lastStatus = null;
  const PHASE_KEY = { focus: 'phase.focus', short: 'phase.short', long: 'phase.long' };
  function reportStatus({ st, now, tg, done, due }) {
    const parts = [];
    if (st.running) parts.push(t('status.timer', { phase: t(PHASE_KEY[st.phase]), min: Math.max(1, Math.ceil(P.remaining(st, now) / 60000)) }));
    else parts.push(t('status.timerPaused', { phase: t(PHASE_KEY[st.phase]) }));
    if (tg) parts.push(t(due ? 'status.waterDue' : 'status.water', { done, total: tg.cups }));
    const song = Music.nowPlaying();
    if (song) parts.push(`♪ ${song}`);
    const text = parts.join(' · ');
    if (text === lastStatus) return;
    lastStatus = text;
    bridge.setStatus({ text }).catch(() => {});
  }

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
    reportStatus({ st, now, tg, done, due });

    lastTick = { st, tg, done, due };
    if (expanded) {
      renderLine(now);
      views[tab].update(now);
    }
  }));

  // Shell text for a theme without lines for a situation (user themes may have no dialogue.json).
  const FALLBACK = { hello: 'bubble.hello', focus: 'bubble.focus', break: 'bubble.break', drink: 'bubble.drink', goal: 'bubble.goal', setup: 'bubble.setup', cheer: 'bubble.goal', idle: 'bubble.hello' };
  function renderLine(now) {
    if (!lastTick) return;
    const { st, tg, done, due } = lastTick;
    let situation;
    if (now < cheerUntil && tg) situation = 'cheer';
    else if (due) situation = 'drink';
    else if (st.running) situation = st.phase === 'focus' ? 'focus' : 'break';
    else if (!tg) situation = 'setup';
    else if (done >= tg.cups) situation = 'goal';
    else situation = now - openedAt < 30000 ? 'hello' : 'idle';
    const vars = { time: situation === 'hello' || situation === 'idle' ? formatClock(now) : formatDuration(P.remaining(st, now)), done, total: tg?.cups ?? 0 };
    // A line holds for 45 s so the bubble does not flicker; each drink gets its own cheer.
    const slot = situation === 'cheer' ? done : Math.floor(now / 45000);
    line.textContent = pickLine(dialogue, situation, language(), { slot, vars }) ?? t(FALLBACK[situation], vars);
  }

  // ---------- keyboard ----------
  const onKeyDown = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') { bridge.moveView({ direction: 'right' }).catch(() => {}); return; } // menu -> icon -> hidden
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
