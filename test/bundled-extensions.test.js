import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadExtensions } from '../src/main/extensions.js';
import { defaultState } from '../src/core/defaults.js';
import { CHIME_EVENTS } from '../src/core/contracts/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { registry, problems } = loadExtensions({ bundledRoot: path.join(root, 'extensions') });

test('every bundled extension loads with no problems', () => {
  assert.deepEqual(problems, [], problems.map((p) => `${p.file}: ${p.errors.join('; ')}`).join('\n'));
});

test('the default theme and character exist, so a fresh install always starts', () => {
  const defaults = defaultState().settings;
  const theme = registry.themes.find((t) => t.id === defaults.theme);
  assert.ok(theme, `default theme "${defaults.theme}" must be bundled`);
  assert.ok(theme.characters.some((c) => c.id === defaults.character), `default character "${defaults.character}" must be in the default theme`);
  assert.ok(theme.characters.some((c) => c.id === theme.defaultCharacter));
});

test('every theme ships at least three characters and a full chime set', () => {
  for (const theme of registry.themes) {
    assert.ok(theme.characters.length >= 3, `${theme.id} has ${theme.characters.length} characters`);
    assert.ok(CHIME_EVENTS.length >= 6);
  }
});

test('English and Korean are bundled', () => {
  assert.ok(registry.locales.en && registry.locales.ko);
});

test('theme and character names are readable in both languages', () => {
  for (const theme of registry.themes) {
    assert.ok(theme.name.en && theme.name.ko);
    for (const c of theme.characters) assert.ok(c.name.en && c.name.ko, `${theme.id}/${c.id}`);
  }
});
