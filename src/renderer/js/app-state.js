/*
 * Application state + actions + the 1 Hz engine. This is the glue between the pure, tested core
 * (src/core/*) and the outside world (persistence over IPC, sound, notifications, the UI).
 *
 * The renderer owns live state; every change is mirrored to the main process, which saves it.
 * Views never mutate state directly: they call the actions below and listen for events:
 *   'change'  state changed (re-render what depends on it)
 *   'tick'    once a second, with { now, info } (update clocks, countdowns, rings)
 *   'effect'  one-shot things worth animating: drink, undo, milestone, reminder, pomodoro-complete
 */
import * as P from '../core/pomodoro.js';
import * as H from '../core/hydration.js';
import { reminderDecision } from '../core/reminders.js';
import { isWeatherFresh } from '../core/weather.js';
import { deepMerge, pruneDays } from '../core/defaults.js';
import * as Audio from './audio.js';
import { t, tn } from './i18n.js';

const bridge = window.horologium;

const listeners = { change: new Set(), tick: new Set(), effect: new Set() };
export const on = (event, fn) => {
  listeners[event].add(fn);
  return () => listeners[event].delete(fn);
};
const emit = (event, payload) => {
  for (const fn of [...listeners[event]]) fn(payload);
};

let state = null;
export const env = { platform: 'linux', loginSupported: false, version: '0.0.0', hotkeyStatus: null, problems: [], registry: null, userExtDir: '' };

export function init(payload) {
  state = payload.state;
  Object.assign(env, {
    platform: payload.platform,
    loginSupported: payload.loginSupported,
    version: payload.version,
    hotkeyStatus: payload.hotkeyStatus,
    problems: payload.problems,
    registry: payload.registry,
    userExtDir: payload.userExtDir,
  });
}

export const getState = () => state;

/** Merge a partial state into local state and persist it. (`null` deletes a key; see core/defaults.js.) */
export function patch(partial) {
  deepMerge(state, partial);
  bridge.patchStore(partial);
  emit('change');
}

/** setSetting('volume.master', 0.5) */
export function setSetting(dotted, value) {
  const parts = dotted.split('.');
  const partial = {};
  let cursor = partial;
  parts.forEach((p, i) => {
    cursor[p] = i === parts.length - 1 ? value : {};
    cursor = cursor[p];
  });
  patch({ settings: partial });
}

// ---------- Pomodoro ----------

export const pomoSettings = () => P.normalizeSettings(state.settings.pomodoro);

export function pomo() {
  if (!state.pomo.state) state.pomo.state = P.initialState(pomoSettings());
  return state.pomo.state;
}

function setPomo(next) {
  const prev = state.pomo.state;
  state.pomo.state = next;
  if (!prev || prev.phase !== next.phase || prev.running !== next.running) {
    emit('effect', { type: 'pomo-phase', phase: next.phase, running: next.running });
  }
  bridge.patchStore({ pomo: { state: next } });
  emit('change');
}

export function startPomodoro() {
  touchDay();
  setPomo(P.start(pomo(), Date.now()));
}
export const pausePomodoro = () => setPomo(P.pause(pomo(), Date.now()));
export const togglePomodoro = () => (pomo().running ? pausePomodoro() : startPomodoro());
export const resetPomodoro = () => setPomo(P.reset(pomo(), pomoSettings()));
export const skipPomodoro = () => setPomo(P.skip(pomo(), Date.now(), pomoSettings()));

export function applyPomodoroSettings(next) {
  const normalized = P.normalizeSettings(next);
  patch({ settings: { pomodoro: normalized } });
  setPomo(P.applySettings(pomo(), normalized));
}

const PHASE_KEY = { focus: 'phase.focus', short: 'phase.short', long: 'phase.long' };
export const phaseLabel = (phase) => t(PHASE_KEY[phase]);

function onPomodoroComplete(phase, next) {
  const s = pomoSettings();
  Audio.play(phase === 'focus' ? 'focusEnd' : 'breakEnd');
  const nextMin = next.phase === 'focus' ? s.focusMin : next.phase === 'short' ? s.shortMin : s.longMin;
  const title = phase === 'focus' ? t('notify.focus.title') : t('notify.break.title');
  const body = phase === 'focus'
    ? t(next.running ? 'notify.focus.body' : 'notify.focus.bodyManual', { phase: phaseLabel(next.phase), min: nextMin })
    : t(next.running ? 'notify.break.body' : 'notify.break.bodyManual', { min: nextMin });
  bridge.notify({ title, body, tab: 'pomodoro' });
  emit('effect', { type: 'pomodoro-complete', phase, next });
}

// ---------- Hydration ----------

export const profile = () => state.hydration.profile ?? null;

/** What the target calculation should assume about the weather right now. */
export function weatherInput(h = state.hydration) {
  if (h.climateOverride) return { level: h.climateOverride };
  return h.weather ? { tempC: h.weather.tempC, humidityPct: h.weather.humidityPct } : null;
}

export const target = (p = profile()) => (p ? H.calculateDailyTarget(p, weatherInput()) : null);

export const dayRecord = (now = Date.now()) => state.hydration.days[H.dayKey(now)] ?? null;

/**
 * Start today's day record on first interaction (launch, opening the widget, starting a Pomodoro...).
 * Until it exists there are no reminders, so a widget left running overnight never nags at 00:00.
 */
export function touchDay(now = Date.now()) {
  const key = H.dayKey(now);
  if (state.hydration.days[key]) return;
  const record = { startedAt: now, drinks: [] };
  const partial = { [key]: record };
  const kept = pruneDays({ ...state.hydration.days, [key]: record }, 14);
  for (const old of Object.keys(state.hydration.days)) if (!(old in kept)) partial[old] = null;
  patch({ hydration: { days: partial } });
}

export function logDrink(now = Date.now()) {
  const tg = target();
  if (!tg) return;
  touchDay(now);
  const key = H.dayKey(now);
  const before = state.hydration.days[key].drinks;
  const drinks = [...before, now];
  patch({ hydration: { days: { [key]: { drinks } } } });
  const milestone = H.milestoneCrossed(before.length, drinks.length, tg.cups);
  Audio.play(milestone ? 'milestone' : 'drinkLogged');
  emit('effect', { type: 'drink', cups: drinks.length, ml: tg.cupMl, targetCups: tg.cups, milestone });
  if (milestone) emit('effect', { type: 'milestone', percent: milestone });
  tick(); // refresh the next-reminder line immediately
}

export function undoDrink(now = Date.now()) {
  const rec = dayRecord(now);
  if (!rec || rec.drinks.length === 0) return;
  patch({ hydration: { days: { [H.dayKey(now)]: { drinks: rec.drinks.slice(0, -1) } } } });
  Audio.play('undo');
  emit('effect', { type: 'undo', cups: rec.drinks.length - 1 });
  tick();
}

export function saveProfile(p) {
  patch({ hydration: { profile: p } });
  touchDay();
  tick();
}

export function setLocation(loc) {
  patch({ hydration: { location: loc, weather: null } });
  refreshWeather(true);
}

export function setClimateOverride(level) {
  patch({ hydration: { climateOverride: level } }); // null clears the override (automatic)
  if (!level) refreshWeather(true);
}

export function reminderInfo(now = Date.now()) {
  const tg = target();
  const day = dayRecord(now);
  if (!tg || !day) return { kind: 'none', at: null, gapMs: 0, decision: 'idle' };
  const next = H.nextReminder({ now, dayStartMs: day.startedAt, drinks: day.drinks, targetCups: tg.cups });
  const st = pomo();
  const decision = reminderDecision({
    dueAt: next.at,
    now,
    lastNotifiedAt: state.hydration.lastNotifiedAt ?? null,
    remindersOn: state.settings.hydration.remindersOn,
    syncBreaks: state.settings.hydration.syncBreaks,
    pomodoro: { running: st.running, phase: st.phase },
  });
  return { ...next, decision };
}

function fireReminder(now) {
  state.hydration.lastNotifiedAt = now;
  bridge.patchStore({ hydration: { lastNotifiedAt: now } });
  const tg = target();
  const day = dayRecord(now);
  const left = Math.max(0, tg.cups - (day?.drinks.length ?? 0));
  Audio.play('drinkDue');
  bridge.notify({
    title: t('notify.drink.title'),
    body: t('notify.drink.body', { left: tn('hydration.cups', left), cup: tg.cupMl }),
    tab: 'hydration',
  });
  emit('effect', { type: 'reminder' });
}

let weatherBusy = false;
let lastWeatherAttempt = 0;

export async function refreshWeather(force = false) {
  const loc = state.hydration.location;
  if (!loc || state.hydration.climateOverride) return;
  const now = Date.now();
  if (weatherBusy) return;
  if (!force && (isWeatherFresh(state.hydration.weather, now) || now - lastWeatherAttempt < 10 * 60 * 1000)) return;
  weatherBusy = true;
  lastWeatherAttempt = now;
  try {
    const res = await bridge.fetchWeather({ latitude: loc.latitude, longitude: loc.longitude });
    if (res?.ok) patch({ hydration: { weather: res.weather } });
  } finally {
    weatherBusy = false;
  }
}

// ---------- engine ----------

function tick() {
  const now = Date.now();
  const res = P.tick(pomo(), now, pomoSettings());
  if (res.completed) {
    setPomo(res.state);
    onPomodoroComplete(res.completed, res.state);
  }
  const info = reminderInfo(now);
  if (info.decision === 'notify') fireReminder(now);
  refreshWeather();
  emit('tick', { now, info });
}

let timer = null;
export function startEngine() {
  touchDay();
  clearInterval(timer);
  timer = setInterval(tick, 1000);
  tick();
}
