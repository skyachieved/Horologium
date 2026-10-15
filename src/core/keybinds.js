/*
 * Keybind helpers built around Electron "accelerator" strings (e.g. "CommandOrControl+Shift+1").
 * PURE: no Electron import, so it is unit-tested in Node and reused by the settings recorder.
 *
 * What this can and cannot know:
 *  - It validates syntax and flags *likely* problems (bare keys steal typing, Shift/Alt-only combos
 *    are rejected by macOS Sequoia, Space collides with IME switching, well-known OS shortcuts).
 *  - It cannot know whether another app already owns a combo. Electron's globalShortcut.register
 *    returns false in that case, and the main process reports that back to the UI.
 */

const MODIFIER_ALIASES = {
  command: 'Meta', cmd: 'Meta', super: 'Meta', meta: 'Meta',
  control: 'Control', ctrl: 'Control',
  commandorcontrol: 'CmdOrCtrl', cmdorctrl: 'CmdOrCtrl',
  alt: 'Alt', option: 'Alt', altgr: 'AltGr',
  shift: 'Shift',
};

const NAMED_KEYS = new Set([
  'SPACE', 'TAB', 'CAPSLOCK', 'NUMLOCK', 'SCROLLLOCK', 'BACKSPACE', 'DELETE', 'INSERT', 'RETURN', 'ENTER',
  'UP', 'DOWN', 'LEFT', 'RIGHT', 'HOME', 'END', 'PAGEUP', 'PAGEDOWN', 'ESCAPE', 'ESC', 'PLUS',
  'VOLUMEUP', 'VOLUMEDOWN', 'VOLUMEMUTE', 'MEDIANEXTTRACK', 'MEDIAPREVIOUSTRACK', 'MEDIASTOP', 'MEDIAPLAYPAUSE',
  'PRINTSCREEN',
  'NUM0', 'NUM1', 'NUM2', 'NUM3', 'NUM4', 'NUM5', 'NUM6', 'NUM7', 'NUM8', 'NUM9',
  'NUMDEC', 'NUMADD', 'NUMSUB', 'NUMMULT', 'NUMDIV',
]);

const PUNCTUATION = new Set(')!@#$%^&*(:;<,_->.?/~`{]|[}\'"=-'.split(''));

function isKeyToken(token) {
  const up = token.toUpperCase();
  if (/^[A-Z0-9]$/.test(up)) return true;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(up)) return true;
  if (NAMED_KEYS.has(up)) return true;
  return token.length === 1 && PUNCTUATION.has(token);
}

/** Split into modifiers and key tokens. Does not judge validity. */
export function parseAccelerator(accel) {
  const parts = String(accel ?? '').split('+').map((p) => p.trim()).filter((p) => p.length > 0);
  const modifiers = [];
  const keys = [];
  const unknown = [];
  for (const part of parts) {
    const mod = MODIFIER_ALIASES[part.toLowerCase()];
    if (mod) modifiers.push(mod);
    else if (isKeyToken(part)) keys.push(part);
    else unknown.push(part);
  }
  return { modifiers, keys, unknown, empty: parts.length === 0 };
}

const MOD_ORDER = ['Control', 'Alt', 'AltGr', 'Shift', 'Meta'];

/** Canonical form for comparing two accelerators on a platform ('darwin' | 'win32' | 'linux'). */
export function normalizeAccelerator(accel, platform = 'linux') {
  const { modifiers, keys } = parseAccelerator(accel);
  const mods = new Set(modifiers.map((m) => (m === 'CmdOrCtrl' ? (platform === 'darwin' ? 'Meta' : 'Control') : m)));
  const ordered = MOD_ORDER.filter((m) => mods.has(m));
  const key = keys[0] ? (keys[0].length === 1 ? keys[0].toUpperCase() : keys[0].toUpperCase()) : '';
  const canonicalKey = { ENTER: 'RETURN', ESC: 'ESCAPE' }[key] ?? key;
  return [...ordered, canonicalKey].filter(Boolean).join('+');
}

/** Combos that the OS or nearly every app already uses. Compared after normalization. */
const RESERVED = {
  common: ['Control+Alt+DELETE', 'Alt+TAB', 'Control+ESCAPE'],
  win32: ['Alt+F4', 'Control+Shift+ESCAPE', 'Meta+L', 'Meta+D', 'Meta+E', 'Meta+R', 'Meta+SPACE', 'Meta+TAB',
    'Control+C', 'Control+V', 'Control+X', 'Control+Z', 'Control+A', 'Control+S'],
  linux: ['Alt+F4', 'Control+C', 'Control+V', 'Control+X', 'Control+Z', 'Control+A', 'Control+S', 'Meta+L'],
  darwin: ['Meta+Q', 'Meta+SPACE', 'Meta+TAB', 'Meta+H', 'Meta+M', 'Meta+W', 'Meta+C', 'Meta+V', 'Meta+X',
    'Meta+Z', 'Meta+A', 'Meta+S', 'Control+Meta+Q', 'Meta+Alt+ESCAPE'],
};

/**
 * Validate an accelerator.
 * errors   -> cannot be registered at all (shown in red, binding refused)
 * warnings -> allowed but probably a bad idea (shown in amber)
 * Codes are stable identifiers the UI maps to localized text.
 */
export function validateAccelerator(accel, platform = 'linux') {
  const errors = [];
  const warnings = [];
  const parsed = parseAccelerator(accel);

  if (parsed.empty) return { ok: false, errors: ['empty'], warnings };
  if (parsed.unknown.length) errors.push('unknown-key');
  if (parsed.keys.length === 0) errors.push('no-key');
  if (parsed.keys.length > 1) errors.push('multiple-keys');
  const rawMods = parseAccelerator(accel).modifiers;
  if (new Set(rawMods).size !== rawMods.length) errors.push('duplicate-modifier');
  if (errors.length) return { ok: false, errors, warnings };

  const mods = new Set(rawMods.map((m) => (m === 'CmdOrCtrl' ? (platform === 'darwin' ? 'Meta' : 'Control') : m)));
  const hasStrong = mods.has('Control') || mods.has('Meta');
  if (mods.size === 0) warnings.push('no-modifier');
  else if (!hasStrong) warnings.push('weak-modifiers');
  if (parsed.keys[0].toUpperCase() === 'SPACE') warnings.push('uses-space');

  const norm = normalizeAccelerator(accel, platform);
  const reserved = new Set([...RESERVED.common, ...(RESERVED[platform] ?? [])].map((a) => normalizeAccelerator(a, platform)));
  if (reserved.has(norm)) warnings.push('reserved');

  return { ok: true, errors, warnings };
}

/** Human-friendly label: macOS symbols vs Ctrl+Shift+1 text. */
export function describeAccelerator(accel, platform = 'linux') {
  const { modifiers, keys } = parseAccelerator(accel);
  const isMac = platform === 'darwin';
  const resolved = modifiers.map((m) => (m === 'CmdOrCtrl' ? (isMac ? 'Meta' : 'Control') : m));
  const ordered = MOD_ORDER.filter((m) => resolved.includes(m));
  const key = keys[0] ?? '';
  const keyLabel = key.length === 1 ? key.toUpperCase() : key;
  if (isMac) {
    const sym = { Control: '⌃', Alt: '⌥', AltGr: '⌥', Shift: '⇧', Meta: '⌘' };
    return ordered.map((m) => sym[m]).join('') + keyLabel;
  }
  const word = { Control: 'Ctrl', Alt: 'Alt', AltGr: 'AltGr', Shift: 'Shift', Meta: platform === 'win32' ? 'Win' : 'Super' };
  return [...ordered.map((m) => word[m]), keyLabel].join('+');
}

const CODE_TO_KEY = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Space: 'Space', Tab: 'Tab', Enter: 'Return', NumpadEnter: 'Return', Escape: 'Esc', Backspace: 'Backspace',
  Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  CapsLock: 'Capslock', PrintScreen: 'PrintScreen',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
};

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$|^AltGraph$/;

/**
 * Convert a KeyboardEvent-like object into an accelerator, using `code` (physical key) so the
 * result does not depend on the keyboard layout or on Shift changing the character.
 * Returns null while only modifiers are held or for keys Electron cannot register.
 */
export function acceleratorFromEvent(e, platform = 'linux') {
  const code = e.code ?? '';
  if (!code || MODIFIER_CODES.test(code)) return null;

  let key = null;
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) key = m[1];
  else if ((m = /^Digit([0-9])$/.exec(code))) key = m[1];
  else if ((m = /^F([0-9]{1,2})$/.exec(code))) key = `F${m[1]}`;
  else if ((m = /^Numpad([0-9])$/.exec(code))) key = `num${m[1]}`;
  else if (code in CODE_TO_KEY) key = CODE_TO_KEY[code];
  if (!key) return null;

  const isMac = platform === 'darwin';
  const mods = [];
  if (isMac ? e.metaKey : e.ctrlKey) mods.push('CommandOrControl');
  if (isMac && e.ctrlKey) mods.push('Control');
  if (!isMac && e.metaKey) mods.push('Super');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

/**
 * Find bindings that resolve to the same combo. `bindings` is { actionId: accelerator }.
 * Returns an array of action-id groups, each with 2+ ids.
 */
export function findConflicts(bindings, platform = 'linux') {
  const byCombo = new Map();
  for (const [id, accel] of Object.entries(bindings)) {
    if (!accel) continue;
    const norm = normalizeAccelerator(accel, platform);
    if (!norm) continue;
    byCombo.set(norm, [...(byCombo.get(norm) ?? []), id]);
  }
  return [...byCombo.values()].filter((ids) => ids.length > 1);
}
