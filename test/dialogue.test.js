import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDialogue, mergeDialogue, pickLine } from '../src/core/dialogue.js';

const theme = {
  hello: { en: ['Hi! It is {time}.', 'Hello there.'], ko: ['안녕! 지금 {time}이야.'] },
  focus: { en: ['{time} to go.'], ko: ['{time} 남았어.'] },
  drink: { en: ['Water! {done}/{total}'], ko: ['물! {done}/{total}'] },
};

test('placeholders must be ones the situation provides', () => {
  assert.deepEqual(checkDialogue(theme), []);
  const bad = { setup: { en: ['Hi {name}'], ko: ['안녕'] }, goal: { en: ['{total} cups'], ko: ['{time} 컵'] } };
  const text = checkDialogue(bad).join('\n');
  assert.match(text, /setup\.en: "\{name\}" is not available here \(allowed: none\)/);
  assert.match(text, /goal\.ko: "\{time\}" is not available here \(allowed: \{total\}\)/);
});

test('a character overrides only the situations it defines', () => {
  const merged = mergeDialogue(theme, { focus: { en: ['Tomato power! {time}'], ko: ['토마토 파워! {time}'] } });
  assert.deepEqual(merged.focus.en, ['Tomato power! {time}']);
  assert.deepEqual(merged.hello, theme.hello);
  assert.deepEqual(mergeDialogue(null, null), {});
});

test('a line is stable within a slot, fills placeholders, and falls back to English', () => {
  const a = pickLine(theme, 'hello', 'en', { slot: 7, vars: { time: '3:15 PM' } });
  assert.equal(a, pickLine(theme, 'hello', 'en', { slot: 7, vars: { time: '3:15 PM' } }));
  assert.ok(['Hi! It is 3:15 PM.', 'Hello there.'].includes(a));
  const seen = new Set(Array.from({ length: 20 }, (_, slot) => pickLine(theme, 'hello', 'en', { slot, vars: { time: 'x' } })));
  assert.equal(seen.size, 2, 'different slots rotate through the lines');
  assert.equal(pickLine(theme, 'drink', 'ko', { vars: { done: 3, total: 8 } }), '물! 3/8');
  assert.equal(pickLine({ idle: { en: ['Only English'], ko: [] } }, 'idle', 'ko'), 'Only English');
  assert.equal(pickLine(theme, 'goal', 'en'), null, 'no lines: the caller uses its generic text');
  assert.equal(pickLine(theme, 'focus', 'en', { vars: {} }), '{time} to go.', 'a missing value leaves the placeholder visible rather than crashing');
});
