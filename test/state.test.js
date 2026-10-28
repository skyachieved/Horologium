import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultState, deepMerge, repairState, pruneDays, STATE_VERSION, DEFAULT_HOTKEYS } from '../src/core/defaults.js';
import { normalizeSettings } from '../src/core/pomodoro.js';
import { validateAccelerator } from '../src/core/keybinds.js';

test('defaults are sane and self-consistent', () => {
  const s = defaultState('ko');
  assert.equal(s.v, STATE_VERSION);
  assert.equal(s.settings.language, 'ko');
  assert.equal(validateAccelerator(s.settings.hotkeys.left).ok, true);
  assert.equal(validateAccelerator(s.settings.hotkeys.right).ok, true);
  assert.deepEqual(s.settings.hotkeys, { left: DEFAULT_HOTKEYS.left, right: DEFAULT_HOTKEYS.right });
  assert.notEqual(DEFAULT_HOTKEYS.left, DEFAULT_HOTKEYS.right);
  assert.deepEqual(normalizeSettings(s.settings.pomodoro), s.settings.pomodoro);
  assert.equal(s.hydration.profile, null);
});

test('defaultState returns independent copies', () => {
  const a = defaultState();
  a.settings.volume.master = 0.1;
  assert.equal(defaultState().settings.volume.master, 0.8);
});

test('deepMerge merges objects, replaces arrays, and deletes on null', () => {
  const t = { a: { b: 1, c: 2 }, list: [1, 2], keep: true };
  deepMerge(t, { a: { b: 9 }, list: [3], gone: null, fresh: { x: 1 } });
  assert.deepEqual(t, { a: { b: 9, c: 2 }, list: [3], keep: true, fresh: { x: 1 } });
  deepMerge(t, { a: { c: null } });
  assert.deepEqual(t.a, { b: 9 });
});

test('deepMerge does not alias the patch object', () => {
  const patch = { nested: { v: 1 } };
  const t = deepMerge({}, patch);
  patch.nested.v = 2;
  assert.equal(t.nested.v, 1);
});

test('repairState fills new settings, drops unknown keys, and survives garbage', () => {
  const saved = { v: 0, settings: { theme: 'pixel-lofi', volume: { master: 0.3 } }, junk: 1, hydration: { days: { '2026-01-01': { startedAt: 1, drinks: [] } } } };
  const r = repairState(saved);
  assert.equal(r.settings.theme, 'pixel-lofi');
  assert.equal(r.settings.volume.master, 0.3);
  assert.equal(r.settings.volume.chimes, 0.8, 'missing volume keys come from defaults');
  assert.equal(r.junk, undefined);
  assert.equal(r.v, STATE_VERSION);
  assert.ok(r.hydration.days['2026-01-01']);
  for (const bad of [null, undefined, 'x', 42, []]) assert.deepEqual(repairState(bad), defaultState());
});

test('pruneDays keeps the most recent days', () => {
  const days = Object.fromEntries(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'].map((k) => [k, { drinks: [] }]));
  assert.deepEqual(Object.keys(pruneDays(days, 2)), ['2026-01-03', '2026-01-04']);
  assert.equal(Object.keys(pruneDays(days, 14)).length, 4);
});

test('v1 settings migrate: the old show/hide key becomes the left key, right gets its default', () => {
  const v1 = { v: 1, settings: { hotkeys: { toggle: 'Alt+Shift+H' } } };
  const s = repairState(v1);
  assert.deepEqual(s.settings.hotkeys, { left: 'Alt+Shift+H', right: DEFAULT_HOTKEYS.right });
  assert.equal(s.v, STATE_VERSION);
  const untouched = repairState({ settings: { hotkeys: { left: 'Alt+1', right: 'Alt+2', bogus: 'x' } } });
  assert.deepEqual(untouched.settings.hotkeys, { left: 'Alt+1', right: 'Alt+2' }, 'unknown hotkey ids are dropped');
});
