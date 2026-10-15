/*
 * Pomodoro state machine. PURE and immutable: every function returns a new state.
 * Time is tracked with absolute timestamps (endsAt) so background throttling, laptop sleep
 * and app restarts never make the timer drift.
 *
 * state = { phase: 'focus'|'short'|'long', cycles, running, endsAt, remainingMs }
 *   cycles = focus sessions completed so far
 */

export const PHASES = Object.freeze(['focus', 'short', 'long']);

export const DEFAULT_SETTINGS = Object.freeze({
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4,
  autoStart: true,
});

export const SETTING_LIMITS = Object.freeze({
  focusMin: [1, 180],
  shortMin: [1, 60],
  longMin: [1, 120],
  longEvery: [2, 12],
});

/** Clamp/repair user-edited settings so the state machine never sees nonsense. */
export function normalizeSettings(s = {}) {
  const out = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(SETTING_LIMITS)) {
    const [lo, hi] = SETTING_LIMITS[key];
    const v = Math.round(Number(s[key]));
    out[key] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULT_SETTINGS[key];
  }
  out.autoStart = s.autoStart === undefined ? DEFAULT_SETTINGS.autoStart : Boolean(s.autoStart);
  return out;
}

export function durationMs(phase, s) {
  const min = phase === 'focus' ? s.focusMin : phase === 'short' ? s.shortMin : s.longMin;
  return Math.round(min * 60000);
}

export function initialState(s) {
  return { phase: 'focus', cycles: 0, running: false, endsAt: null, remainingMs: durationMs('focus', s) };
}

export function start(state, now) {
  if (state.running) return state;
  return { ...state, running: true, endsAt: now + state.remainingMs };
}

export function pause(state, now) {
  if (!state.running) return state;
  return { ...state, running: false, endsAt: null, remainingMs: Math.max(0, state.endsAt - now) };
}

export function reset(state, s) {
  return { ...state, running: false, endsAt: null, remainingMs: durationMs(state.phase, s) };
}

/** Phase that follows `state.phase`, with the updated completed-focus count. */
export function nextPhase(state, s) {
  if (state.phase !== 'focus') return { phase: 'focus', cycles: state.cycles };
  const cycles = state.cycles + 1;
  return { phase: cycles % s.longEvery === 0 ? 'long' : 'short', cycles };
}

function enterNext(state, now, s, run) {
  const { phase, cycles } = nextPhase(state, s);
  const remainingMs = durationMs(phase, s);
  return { phase, cycles, running: run, endsAt: run ? now + remainingMs : null, remainingMs };
}

/** Skip to the next phase without starting it. */
export function skip(state, now, s) {
  return enterNext(state, now, s, false);
}

/**
 * Advance the clock. Returns { state, completed } where `completed` is the phase that just
 * finished (or null). If the machine slept past the end, only one phase advances.
 */
export function tick(state, now, s) {
  if (!state.running || now < state.endsAt) return { state, completed: null };
  return { state: enterNext(state, now, s, s.autoStart), completed: state.phase };
}

export function remaining(state, now) {
  return state.running ? Math.max(0, state.endsAt - now) : state.remainingMs;
}

/** 0..1 progress through the current phase (for the ring). */
export function progress(state, now, s) {
  const total = durationMs(state.phase, s);
  return total === 0 ? 0 : Math.min(1, Math.max(0, 1 - remaining(state, now) / total));
}

/** Re-time an idle/paused phase after the user edits durations; a running phase is left alone. */
export function applySettings(state, s) {
  if (state.running) return state;
  const full = durationMs(state.phase, s);
  return { ...state, remainingMs: full };
}

/** How many seedlings (completed sessions in the current set of `longEvery`) to show as filled. */
export function setProgress(state, s) {
  if (state.phase === 'long') return s.longEvery;
  return state.cycles % s.longEvery;
}
