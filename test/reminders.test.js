import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reminderDecision, NAG_INTERVAL_MS, MAX_HOLD_MS } from '../src/core/reminders.js';

const MIN = 60 * 1000;
const base = {
  dueAt: 1_000_000, now: 1_000_000, lastNotifiedAt: null, remindersOn: true, syncBreaks: true,
  pomodoro: { running: false, phase: 'focus' },
};
const decide = (o) => reminderDecision({ ...base, ...o });

test('idle when off, nothing scheduled, or not yet due', () => {
  assert.equal(decide({ remindersOn: false }), 'idle');
  assert.equal(decide({ dueAt: null }), 'idle');
  assert.equal(decide({ now: base.dueAt - 1 }), 'idle');
});

test('notifies when due and no Pomodoro is running', () => {
  assert.equal(decide({}), 'notify');
});

test('holds during a running focus session, only within the hold window', () => {
  const focusing = { running: true, phase: 'focus' };
  assert.equal(decide({ pomodoro: focusing }), 'hold');
  assert.equal(decide({ pomodoro: focusing, now: base.dueAt + MAX_HOLD_MS - 1 }), 'hold');
  assert.equal(decide({ pomodoro: focusing, now: base.dueAt + MAX_HOLD_MS }), 'notify');
});

test('breaks, paused focus, and syncBreaks=false never hold', () => {
  assert.equal(decide({ pomodoro: { running: true, phase: 'short' } }), 'notify');
  assert.equal(decide({ pomodoro: { running: true, phase: 'long' } }), 'notify');
  assert.equal(decide({ pomodoro: { running: false, phase: 'focus' } }), 'notify');
  assert.equal(decide({ pomodoro: { running: true, phase: 'focus' }, syncBreaks: false }), 'notify');
});

test('after alerting: banner stays ("due"), then nags again after the interval', () => {
  const alertedAt = base.dueAt + 2 * MIN;
  assert.equal(decide({ now: alertedAt + MIN, lastNotifiedAt: alertedAt }), 'due');
  assert.equal(decide({ now: alertedAt + NAG_INTERVAL_MS, lastNotifiedAt: alertedAt }), 'notify');
});

test('an alert from before the current due time does not suppress the new one', () => {
  assert.equal(decide({ lastNotifiedAt: base.dueAt - 5 * MIN }), 'notify');
});
