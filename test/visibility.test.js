import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepView, currentView, VIEW_STATES } from '../src/core/visibility.js';

test('left moves towards the menu and stops there', () => {
  assert.equal(stepView('hidden', 'left'), 'icon');
  assert.equal(stepView('icon', 'left'), 'menu');
  assert.equal(stepView('menu', 'left'), 'menu', 'a stray press on the menu never hides the app');
});

test('right moves towards hidden and wraps back to the menu', () => {
  assert.equal(stepView('menu', 'right'), 'icon');
  assert.equal(stepView('icon', 'right'), 'hidden');
  assert.equal(stepView('hidden', 'right'), 'menu');
});

test('three presses of right is a full cycle from any state', () => {
  for (const s of VIEW_STATES) assert.equal(stepView(stepView(stepView(s, 'right'), 'right'), 'right'), s);
});

test('an unknown state counts as hidden; an unknown direction is an error', () => {
  assert.equal(stepView(undefined, 'left'), 'icon');
  assert.equal(stepView('bogus', 'right'), 'menu');
  assert.throws(() => stepView('menu', 'up'), /unknown direction/);
});

test('currentView maps window facts to a state', () => {
  assert.equal(currentView({ visible: false, expanded: true }), 'hidden');
  assert.equal(currentView({ visible: true, hiding: true, expanded: true }), 'hidden', 'mid pop-out already counts as hidden');
  assert.equal(currentView({ visible: true, expanded: true }), 'menu');
  assert.equal(currentView({ visible: true, expanded: false }), 'icon');
});
