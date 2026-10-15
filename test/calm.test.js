import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalm, QUIET_MS, LIFE_EVERY_MS, LIFE_MS } from '../src/renderer/js/calm.js';

/** A manual clock + timer queue, so the logic runs without waiting. */
function fakeClock() {
  let t = 0;
  let id = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer: (fn, ms) => { id += 1; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer: (k) => { timers.delete(k); },
    pending: () => timers.size,
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        t = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
      }
      t = end;
    },
  };
}

function fakeRoot() {
  const classes = new Set();
  return { classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)), contains: (name) => classes.has(name) } };
}

function setup({ expanded = false, random = () => 0 } = {}) {
  const clock = fakeClock();
  const root = fakeRoot();
  const events = new EventTarget();
  const state = { expanded };
  const calm = createCalm({ root, isExpanded: () => state.expanded, events, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, random });
  return { clock, root, events, state, calm };
}

test('starts awake and goes calm after the quiet spell (short when collapsed)', () => {
  const { clock, calm } = setup();
  assert.equal(calm.isCalm(), false);
  clock.advance(QUIET_MS.collapsed - 1);
  assert.equal(calm.isCalm(), false);
  clock.advance(1);
  assert.equal(calm.isCalm(), true);
});

test('an expanded widget waits much longer before calming, and never shows life signs', () => {
  const { clock, calm } = setup({ expanded: true });
  clock.advance(QUIET_MS.collapsed + 1000);
  assert.equal(calm.isCalm(), false, 'someone may be reading the panel');
  clock.advance(QUIET_MS.expanded);
  assert.equal(calm.isCalm(), true);
  clock.advance(LIFE_EVERY_MS[1] * 3);
  assert.equal(calm.isCalm(), true, 'no periodic waking while expanded');
});

test('pointer, key and wheel activity wake it and restart the quiet spell', () => {
  for (const type of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focusin']) {
    const { clock, events, calm } = setup();
    clock.advance(QUIET_MS.collapsed + 10);
    assert.equal(calm.isCalm(), true, type);
    events.dispatchEvent(new Event(type));
    assert.equal(calm.isCalm(), false, `${type} wakes it`);
    clock.advance(QUIET_MS.collapsed - 1);
    assert.equal(calm.isCalm(), false, `${type} restarted the quiet spell`);
    clock.advance(1);
    assert.equal(calm.isCalm(), true);
  }
});

test('a stream of pointer moves keeps it awake, then it calms once they stop', () => {
  const { clock, events, calm } = setup();
  for (let i = 0; i < 100; i += 1) {
    clock.advance(50);
    events.dispatchEvent(new Event('pointermove'));
    assert.equal(calm.isCalm(), false);
  }
  clock.advance(QUIET_MS.collapsed + 1);
  assert.equal(calm.isCalm(), true);
});

test('a pointer storm does not pile up timers', () => {
  const { clock, events } = setup();
  for (let i = 0; i < 500; i += 1) events.dispatchEvent(new Event('pointermove')); // all in the same instant
  assert.ok(clock.pending() <= 2, `expected a couple of timers at most, got ${clock.pending()}`);
});

test('wake(ms) keeps animations running for at least that long (one-shot effects finish)', () => {
  const { clock, calm } = setup();
  clock.advance(QUIET_MS.collapsed + 10);
  assert.equal(calm.isCalm(), true);
  calm.wake(8000);
  assert.equal(calm.isCalm(), false);
  clock.advance(7999);
  assert.equal(calm.isCalm(), false, 'still inside the hold');
  clock.advance(1);
  assert.equal(calm.isCalm(), true);
});

test('a longer hold is not shortened by a later, shorter wake', () => {
  const { clock, calm } = setup();
  calm.wake(10000);
  clock.advance(1000);
  calm.wake(100);
  clock.advance(8000);
  assert.equal(calm.isCalm(), false);
  clock.advance(1100);
  assert.equal(calm.isCalm(), true);
});

test('while collapsed and calm the character shows a brief sign of life, repeatedly', () => {
  const { clock, calm } = setup({ random: () => 0 });
  clock.advance(QUIET_MS.collapsed); // calm starts exactly here, and the first sign of life is scheduled from this instant
  assert.equal(calm.isCalm(), true);
  for (let round = 0; round < 3; round += 1) {
    clock.advance(LIFE_EVERY_MS[0] - 1);
    assert.equal(calm.isCalm(), true, `round ${round}: still calm just before the sign of life`);
    clock.advance(1);
    assert.equal(calm.isCalm(), false, `round ${round}: awake for the sign of life`);
    clock.advance(LIFE_MS - 1);
    assert.equal(calm.isCalm(), false);
    clock.advance(1);
    assert.equal(calm.isCalm(), true, `round ${round}: calm again`);
  }
});

test('the sign of life is spread randomly between the configured bounds', () => {
  const { clock, calm } = setup({ random: () => 1 });
  clock.advance(QUIET_MS.collapsed);
  clock.advance(LIFE_EVERY_MS[1] - 1);
  assert.equal(calm.isCalm(), true);
  clock.advance(1);
  assert.equal(calm.isCalm(), false);
});

test('activity during a sign of life cancels the cycle and restarts the quiet spell', () => {
  const { clock, events, calm } = setup();
  clock.advance(QUIET_MS.collapsed + LIFE_EVERY_MS[0] + 1);
  assert.equal(calm.isCalm(), false, 'mid sign-of-life');
  events.dispatchEvent(new Event('pointerdown'));
  clock.advance(LIFE_MS + 100);
  assert.equal(calm.isCalm(), false, 'the old life-sign timer must not calm it early');
  clock.advance(QUIET_MS.collapsed);
  assert.equal(calm.isCalm(), true);
});

test('expanding while calm wakes it, and collapsing again uses the short quiet spell', () => {
  const { clock, state, calm } = setup();
  clock.advance(QUIET_MS.collapsed + 1);
  state.expanded = true;
  calm.wake(800);
  assert.equal(calm.isCalm(), false);
  clock.advance(QUIET_MS.collapsed + 1000);
  assert.equal(calm.isCalm(), false, 'expanded uses the long spell');
  state.expanded = false;
  calm.wake(800);
  clock.advance(QUIET_MS.collapsed);
  assert.equal(calm.isCalm(), true);
});

test('dispose stops everything and leaves the widget animating', () => {
  const { clock, events, calm, root } = setup();
  clock.advance(QUIET_MS.collapsed + 1);
  assert.equal(root.classList.contains('calm'), true);
  calm.dispose();
  assert.equal(root.classList.contains('calm'), false);
  assert.equal(clock.pending(), 0, 'no timers left');
  events.dispatchEvent(new Event('pointermove'));
  calm.wake(5000);
  clock.advance(60000);
  assert.equal(root.classList.contains('calm'), false, 'a disposed controller never changes the page again');
});

test('while hidden it stays calm with no signs of life, ignores activity, and wakes when shown again', () => {
  const { clock, events, calm, root } = setup();
  calm.setHidden(true);
  assert.equal(calm.isCalm(), true);
  clock.advance(LIFE_EVERY_MS[1] * 4);
  assert.equal(calm.isCalm(), true, 'no sign of life while off screen');
  events.dispatchEvent(new Event('pointermove'));
  calm.wake(5000);
  assert.equal(calm.isCalm(), true, 'nothing wakes a hidden widget except showing it');
  assert.equal(clock.pending(), 0, 'no timers run while hidden');

  calm.setHidden(false);
  assert.equal(calm.isCalm(), false, 'shown again');
  clock.advance(QUIET_MS.collapsed);
  assert.equal(root.classList.contains('calm'), true, 'and calm again after the quiet spell');
});
