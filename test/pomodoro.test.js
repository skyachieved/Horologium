import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/core/pomodoro.js';

const S = { ...P.DEFAULT_SETTINGS };
const MIN = 60 * 1000;

/** Run a phase to completion and return the state after it. */
function finish(state, now, s = S) {
  const started = P.start(state, now);
  const { state: next, completed } = P.tick(started, started.endsAt, s);
  return { next, completed, endedAt: started.endsAt };
}

test('initial state is an idle full focus session', () => {
  const st = P.initialState(S);
  assert.deepEqual([st.phase, st.cycles, st.running, st.remainingMs], ['focus', 0, false, 25 * MIN]);
});

test('every 4th focus session is followed by a long break', () => {
  let st = P.initialState({ ...S, autoStart: false });
  const s = { ...S, autoStart: false };
  const seen = [];
  let t = 0;
  for (let i = 0; i < 8; i += 1) {
    const r = finish(st, t, s);
    seen.push(`${r.completed}->${r.next.phase}`);
    t = r.endedAt;
    st = r.next;
  }
  assert.deepEqual(seen, [
    'focus->short', 'short->focus',
    'focus->short', 'short->focus',
    'focus->short', 'short->focus',
    'focus->long', 'long->focus',
  ]);
  assert.equal(st.cycles, 4);
});

test('autoStart runs the next phase; otherwise it waits', () => {
  const auto = finish(P.initialState(S), 0, S).next;
  assert.equal(auto.running, true);
  assert.equal(auto.endsAt, 25 * MIN + 5 * MIN);
  const manual = finish(P.initialState({ ...S, autoStart: false }), 0, { ...S, autoStart: false }).next;
  assert.equal(manual.running, false);
  assert.equal(manual.remainingMs, 5 * MIN);
});

test('pause keeps the remaining time and resume continues from it', () => {
  let st = P.start(P.initialState(S), 1000);
  st = P.pause(st, 1000 + 10 * MIN);
  assert.equal(st.running, false);
  assert.equal(st.remainingMs, 15 * MIN);
  st = P.start(st, 50 * MIN);
  assert.equal(st.endsAt, 50 * MIN + 15 * MIN);
  assert.equal(P.remaining(st, 55 * MIN), 10 * MIN);
});

test('start/pause are idempotent', () => {
  const running = P.start(P.initialState(S), 0);
  assert.equal(P.start(running, 5), running);
  const idle = P.initialState(S);
  assert.equal(P.pause(idle, 5), idle);
});

test('tick before the end does nothing; tick long after the end advances exactly one phase', () => {
  const running = P.start(P.initialState(S), 0);
  assert.equal(P.tick(running, 25 * MIN - 1, S).completed, null);
  const slept = P.tick(running, 6 * 60 * MIN, S); // laptop slept for 6 hours
  assert.equal(slept.completed, 'focus');
  assert.equal(slept.state.phase, 'short');
  assert.equal(slept.state.cycles, 1);
  assert.equal(slept.state.endsAt, 6 * 60 * MIN + 5 * MIN); // new phase starts from "now"
});

test('skip moves on without running; reset restores the full phase', () => {
  const st = P.skip(P.start(P.initialState(S), 0), 3 * MIN, S);
  assert.deepEqual([st.phase, st.running, st.remainingMs, st.cycles], ['short', false, 5 * MIN, 1]);
  const paused = P.pause(P.start(st, 0), 2 * MIN);
  assert.equal(P.reset(paused, S).remainingMs, 5 * MIN);
});

test('progress runs from 0 to 1 across a phase', () => {
  const st = P.start(P.initialState(S), 0);
  assert.equal(P.progress(st, 0, S), 0);
  assert.equal(P.progress(st, 12.5 * MIN, S), 0.5);
  assert.equal(P.progress(st, 25 * MIN, S), 1);
  assert.equal(P.progress(st, 99 * MIN, S), 1);
});

test('applySettings re-times an idle phase but never a running one', () => {
  const idle = P.initialState(S);
  assert.equal(P.applySettings(idle, { ...S, focusMin: 50 }).remainingMs, 50 * MIN);
  const running = P.start(idle, 0);
  assert.equal(P.applySettings(running, { ...S, focusMin: 50 }), running);
});

test('normalizeSettings repairs bad input and keeps good input', () => {
  assert.deepEqual(P.normalizeSettings({}), S);
  const n = P.normalizeSettings({ focusMin: 9999, shortMin: -3, longMin: 'x', longEvery: 1.4, autoStart: 0 });
  assert.equal(n.focusMin, 180);
  assert.equal(n.shortMin, 1);
  assert.equal(n.longMin, S.longMin);
  assert.equal(n.longEvery, 2);
  assert.equal(n.autoStart, false);
  assert.equal(P.normalizeSettings({ focusMin: 40 }).focusMin, 40);
});

test('setProgress counts completed sessions in the current set', () => {
  const s = P.DEFAULT_SETTINGS;
  assert.equal(P.setProgress({ phase: 'focus', cycles: 0 }, s), 0);
  assert.equal(P.setProgress({ phase: 'short', cycles: 2 }, s), 2);
  assert.equal(P.setProgress({ phase: 'long', cycles: 4 }, s), 4);
  assert.equal(P.setProgress({ phase: 'focus', cycles: 4 }, s), 0);
});
