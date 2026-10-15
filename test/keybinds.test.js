import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAccelerator, normalizeAccelerator, validateAccelerator, describeAccelerator,
  acceleratorFromEvent, findConflicts,
} from '../src/core/keybinds.js';

test('parse splits modifiers from the key', () => {
  const p = parseAccelerator('CommandOrControl+Shift+1');
  assert.deepEqual(p.modifiers, ['CmdOrCtrl', 'Shift']);
  assert.deepEqual(p.keys, ['1']);
  assert.deepEqual(parseAccelerator('').empty, true);
});

test('the default hotkey is valid with no warnings on every platform', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const v = validateAccelerator('CommandOrControl+Shift+1', platform);
    assert.equal(v.ok, true, platform);
    assert.deepEqual(v.warnings, [], platform);
  }
});

test('syntax errors are refused', () => {
  assert.deepEqual(validateAccelerator('').errors, ['empty']);
  assert.ok(validateAccelerator('Ctrl+Shift').errors.includes('no-key'));
  assert.ok(validateAccelerator('Ctrl+A+B').errors.includes('multiple-keys'));
  assert.ok(validateAccelerator('Ctrl+Banana').errors.includes('unknown-key'));
  assert.ok(validateAccelerator('Ctrl+Control+A').errors.includes('duplicate-modifier'));
  assert.equal(validateAccelerator('Ctrl+Banana').ok, false);
});

test('plain tilde is allowed but warned: it steals the key system-wide', () => {
  const v = validateAccelerator('`');
  assert.equal(v.ok, true);
  assert.deepEqual(v.warnings, ['no-modifier']);
});

test('Shift/Alt-only combos are warned (macOS Sequoia rejects them)', () => {
  assert.deepEqual(validateAccelerator('Alt+Shift+H', 'darwin').warnings, ['weak-modifiers']);
  assert.deepEqual(validateAccelerator('Shift+F5').warnings, ['weak-modifiers']);
});

test('Space combos and OS-reserved combos are warned', () => {
  assert.ok(validateAccelerator('Control+Space').warnings.includes('uses-space'));
  assert.ok(validateAccelerator('Alt+F4', 'win32').warnings.includes('reserved'));
  assert.ok(validateAccelerator('Command+Q', 'darwin').warnings.includes('reserved'));
  assert.ok(validateAccelerator('CommandOrControl+C', 'win32').warnings.includes('reserved'));
  assert.ok(!validateAccelerator('Alt+F4', 'darwin').warnings.includes('reserved'));
});

test('normalization makes equivalent spellings equal', () => {
  assert.equal(normalizeAccelerator('Ctrl+Shift+a', 'win32'), normalizeAccelerator('CommandOrControl+Shift+A', 'win32'));
  assert.equal(normalizeAccelerator('Cmd+Shift+1', 'darwin'), normalizeAccelerator('CmdOrCtrl+Shift+1', 'darwin'));
  assert.notEqual(normalizeAccelerator('Ctrl+1', 'darwin'), normalizeAccelerator('CmdOrCtrl+1', 'darwin'));
  assert.equal(normalizeAccelerator('Shift+Control+Alt+X'), 'Control+Alt+Shift+X');
  assert.equal(normalizeAccelerator('Ctrl+Enter'), normalizeAccelerator('Control+Return'));
});

test('describe shows symbols on macOS and words elsewhere', () => {
  // Apple's modifier order is Control, Option, Shift, Command.
  assert.equal(describeAccelerator('CommandOrControl+Shift+1', 'darwin'), '⇧⌘1');
  assert.equal(describeAccelerator('CommandOrControl+Shift+1', 'win32'), 'Ctrl+Shift+1');
  assert.equal(describeAccelerator('Super+K', 'win32'), 'Win+K');
  assert.equal(describeAccelerator('Super+K', 'linux'), 'Super+K');
});

const ev = (code, mods = {}) => ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test('recorder converts physical keys and ignores modifier-only presses', () => {
  assert.equal(acceleratorFromEvent(ev('ControlLeft', { ctrlKey: true }), 'win32'), null);
  assert.equal(acceleratorFromEvent(ev('ShiftRight', { shiftKey: true }), 'win32'), null);
  assert.equal(acceleratorFromEvent(ev('Digit1', { ctrlKey: true, shiftKey: true }), 'win32'), 'CommandOrControl+Shift+1');
  assert.equal(acceleratorFromEvent(ev('Digit1', { metaKey: true, shiftKey: true }), 'darwin'), 'CommandOrControl+Shift+1');
  assert.equal(acceleratorFromEvent(ev('KeyH', { ctrlKey: true, altKey: true, shiftKey: true }), 'linux'), 'CommandOrControl+Alt+Shift+H');
  assert.equal(acceleratorFromEvent(ev('Backquote'), 'win32'), '`');
  assert.equal(acceleratorFromEvent(ev('ArrowUp', { altKey: true }), 'win32'), 'Alt+Up');
  assert.equal(acceleratorFromEvent(ev('F5', { shiftKey: true }), 'win32'), 'Shift+F5');
  assert.equal(acceleratorFromEvent(ev('Numpad5'), 'win32'), 'num5');
  assert.equal(acceleratorFromEvent(ev('Backslash'), 'win32'), null); // not registrable
});

test('on macOS a physical Control key is kept distinct from Command', () => {
  assert.equal(acceleratorFromEvent(ev('KeyK', { ctrlKey: true }), 'darwin'), 'Control+K');
  assert.equal(acceleratorFromEvent(ev('KeyK', { ctrlKey: true, metaKey: true }), 'darwin'), 'CommandOrControl+Control+K');
  assert.equal(acceleratorFromEvent(ev('KeyK', { metaKey: true }), 'win32'), 'Super+K');
});

test('every recorded accelerator is accepted by the validator', () => {
  const codes = ['KeyA', 'Digit9', 'F12', 'Space', 'Enter', 'Escape', 'Minus', 'Period', 'Quote', 'PageDown', 'NumpadAdd'];
  for (const code of codes) {
    const accel = acceleratorFromEvent(ev(code, { ctrlKey: true }), 'win32');
    assert.ok(accel, code);
    assert.equal(validateAccelerator(accel, 'win32').ok, true, `${code} -> ${accel}`);
  }
});

test('findConflicts groups actions that share a combo', () => {
  const groups = findConflicts({
    toggle: 'CommandOrControl+Shift+1',
    drink: 'Ctrl+Shift+1',
    pomodoro: 'CommandOrControl+Shift+2',
    unbound: '',
  }, 'win32');
  assert.deepEqual(groups, [['toggle', 'drink']]);
  assert.deepEqual(findConflicts({ a: 'Ctrl+1', b: 'Ctrl+2' }), []);
});
