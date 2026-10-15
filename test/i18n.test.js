import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const { _meta: _a, ...en } = readJson('extensions/locales/en.json');
const { _meta: _b, ...ko } = readJson('extensions/locales/ko.json');

function sourceFiles(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(rel);
    return e.name.endsWith('.js') ? [rel] : [];
  });
}
// extension code (e.g. the Stations UI) uses t() through the api object, so scan it too
const files = [...sourceFiles('src/renderer'), ...sourceFiles('extensions'), 'src/main/app.js'];
const source = files.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');

/** Keys that are built at runtime from a fixed set of values. A new dynamic family must be added here. */
const DYNAMIC = {
  'climate.': ['auto', 'temperate', 'warm', 'hot'],
  'intensity.': ['none', 'light', 'moderate', 'vigorous'],
  'intensity.hint.': ['none', 'light', 'moderate', 'vigorous'],
  'keys.warn.': ['no-modifier', 'weak-modifiers', 'uses-space', 'reserved'],
};

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('English and Korean have exactly the same keys, no empty strings, and the same placeholders', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ko).sort());
  for (const key of Object.keys(en)) {
    assert.ok(en[key].trim() && ko[key].trim(), `${key} is empty`);
    assert.deepEqual(placeholders(en[key]), placeholders(ko[key]), `${key}: placeholders differ`);
  }
});

test('every t()/tr() key used in code exists in the locale tables', () => {
  const used = new Set([...source.matchAll(/\b(?:t|tr)\(\s*'([^']+)'/g)].map((m) => m[1]));
  assert.ok(used.size > 50, 'scanner should find the keys in use');
  const missing = [...used].filter((k) => !(k in en));
  assert.deepEqual(missing, [], `keys missing from en.json: ${missing.join(', ')}`);
});

test('every tn() plural key has .one and .other forms', () => {
  const used = new Set([...source.matchAll(/\btn\(\s*'([^']+)'/g)].map((m) => m[1]));
  assert.ok(used.size > 0);
  for (const base of used) {
    assert.ok(`${base}.one` in en && `${base}.other` in en, `${base} needs .one and .other`);
  }
});

test('keys named in lookup tables (tabs, phases) exist', () => {
  const used = [...source.matchAll(/(?:label|focus|short|long):\s*'((?:tab|phase)\.[a-z]+)'/g)].map((m) => m[1]);
  assert.ok(used.length >= 7);
  for (const key of used) assert.ok(key in en, `${key} missing`);
});

test('dynamic key families are known and complete', () => {
  const prefixes = new Set([...source.matchAll(/\bt\(`([a-z.]+)\$\{/g)].map((m) => m[1]));
  for (const prefix of prefixes) assert.ok(prefix in DYNAMIC, `unknown dynamic family "${prefix}": add it to DYNAMIC in this test`);
  for (const [prefix, values] of Object.entries(DYNAMIC)) {
    for (const v of values) assert.ok(`${prefix}${v}` in en, `${prefix}${v} missing`);
  }
});

test('no dead keys: every key in the tables is referenced somewhere', () => {
  const dynamicKeys = new Set(Object.entries(DYNAMIC).flatMap(([p, vs]) => vs.map((v) => `${p}${v}`)));
  const unused = Object.keys(en).filter((key) => {
    if (dynamicKeys.has(key)) return false;
    const base = key.replace(/\.(one|other)$/, '');
    return !source.includes(`'${key}'`) && !source.includes(`'${base}'`);
  });
  assert.deepEqual(unused, [], `unused keys: ${unused.join(', ')}`);
});
