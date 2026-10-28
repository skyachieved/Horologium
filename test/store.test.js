import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/main/store.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'horologium-store-')), 'settings.json');
const onDisk = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('a patch is written to disk after the batching delay', async () => {
  const file = tempFile();
  const store = createStore({ file, debounceMs: 50 });
  store.patch({ hydration: { profile: { sex: 'female', age: 30, heightCm: 165, weightKg: 58, exerciseIntensity: 'none', exerciseMin: 0, cupMl: 355 } } });
  assert.equal(fs.existsSync(file), false, 'not yet: writes are batched');
  await sleep(120);
  assert.equal(onDisk(file).hydration.profile.heightCm, 165);
  assert.equal(fs.existsSync(`${file}.tmp`), false, 'the temp file is renamed away');
});

test('a steady stream of patches cannot starve the write (regression: a feedback loop once lost a session)', async () => {
  const file = tempFile();
  const store = createStore({ file, debounceMs: 100 });
  for (let i = 0; i < 20; i += 1) { // a patch every 30 ms for 600 ms: a restarting debounce would never fire
    store.patch({ ui: { tab: `tab-${i}` } });
    await sleep(30);
  }
  assert.ok(fs.existsSync(file), 'written while patches were still arriving');
  await sleep(150);
  assert.equal(onDisk(file).ui.tab, 'tab-19', 'and the last change lands too');
});

test('flush writes immediately, and a saved profile survives a restart', () => {
  const file = tempFile();
  const a = createStore({ file, debounceMs: 10_000 });
  a.patch({ hydration: { profile: { sex: 'male', age: 41, heightCm: 180, weightKg: 80, exerciseIntensity: 'light', exerciseMin: 20, cupMl: 500 } } });
  a.flush();
  const b = createStore({ file });
  assert.equal(b.get().hydration.profile.age, 41);
});

test('a corrupt file is moved aside (never deleted) and the app starts from defaults', () => {
  const file = tempFile();
  fs.writeFileSync(file, '{ not json');
  const store = createStore({ file });
  assert.equal(store.get().hydration.profile, null);
  const aside = fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith('settings.json.corrupt-'));
  assert.equal(aside.length, 1);
});
