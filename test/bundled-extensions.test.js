import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadExtensions } from '../src/main/extensions.js';
import { defaultState } from '../src/core/defaults.js';
import { CHIME_EVENTS, DIALOGUE_SITUATIONS } from '../src/core/contracts/index.js';
import { SPRITE_STATES } from '../src/core/sprite.js';

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

test('every bundled theme has a voice: lines for every situation in English and Korean (note 10)', () => {
  for (const theme of registry.themes) {
    for (const situation of DIALOGUE_SITUATIONS) {
      const set = theme.dialogueData?.[situation];
      assert.ok(set?.en.length && set?.ko.length, `${theme.id}: no ${situation} lines`);
      assert.equal(set.en.length, set.ko.length, `${theme.id}.${situation}: every English line has a Korean one`);
    }
    for (const c of theme.characters) {
      for (const [situation, set] of Object.entries(c.dialogueData ?? {})) assert.equal(set.en.length, set.ko.length, `${theme.id}/${c.id}.${situation}`);
    }
  }
});

test('every bundled character is a pixel sprite with every state (note 10)', () => {
  for (const theme of registry.themes) {
    for (const c of theme.characters) {
      assert.ok(c.spriteData, `${theme.id}/${c.id} is not a sprite`);
      for (const state of SPRITE_STATES) assert.ok(c.spriteData.frames[state]?.length, `${theme.id}/${c.id} has no ${state} frames`);
    }
  }
});
