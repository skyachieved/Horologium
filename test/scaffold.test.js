import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scaffold } from '../tools/scaffold.js';
import { loadExtensions } from '../src/main/extensions.js';
import { baseFiles, writeTree, cleanup } from '../test-support/fixtures.js';

const templatesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');

/** Fresh valid tree + scaffolder bound to it. */
function setup() {
  const root = writeTree(baseFiles());
  const run = (args) => scaffold({ extensionsRoot: root, templatesRoot, ...args });
  return { root, run, load: () => loadExtensions({ bundledRoot: root }) };
}

test('every template produces an extension that passes the real loader', () => {
  const { root, run, load } = setup();
  try {
    run({ type: 'theme', id: 'fresh-theme', nameEn: 'Fresh', nameKo: '신선' });
    run({ type: 'character', id: 'newbie', theme: 'fresh-theme', nameEn: 'Newbie', nameKo: '뉴비' });
    run({ type: 'web-source', id: 'radio-x', nameEn: 'Radio X', nameKo: '라디오 X' });
    run({ type: 'locale', id: 'fr', nameEn: 'Français' });

    const { registry, problems } = load();
    assert.deepEqual(problems, []);
    const fresh = registry.themes.find((t) => t.id === 'fresh-theme');
    assert.deepEqual(fresh.characters.map((c) => c.id).sort(), ['buddy', 'newbie']);
    assert.equal(fresh.name.ko, '신선');
    assert.ok(registry.musicSources.some((s) => s.id === 'radio-x'));
    assert.equal(registry.locales.fr.meta.name, 'Français');
  } finally {
    cleanup(root);
  }
});

test('scaffolder rejects bad input with a helpful message', () => {
  const { root, run } = setup();
  try {
    assert.throws(() => run({ type: 'theme', id: 'Not Kebab' }), /kebab-case/);
    assert.throws(() => run({ type: 'locale', id: 'french' }), /language code/);
    assert.throws(() => run({ type: 'character', id: 'solo' }), /needs --theme/);
    assert.throws(() => run({ type: 'character', id: 'solo', theme: 'nope' }), /does not exist/);
    assert.throws(() => run({ type: 'spaceship', id: 'x' }), /Unknown type/);
    assert.throws(() => run({ type: 'theme', id: 'test-theme' }), /already exists/);
    assert.throws(() => run({ type: 'locale', id: 'ko' }), /already exists/);
  } finally {
    cleanup(root);
  }
});

test('the scaffolded web-source keeps the unofficial-service notice', () => {
  const { root, run } = setup();
  try {
    const { created } = run({ type: 'web-source', id: 'radio-y' });
    const manifest = JSON.parse(fs.readFileSync(path.join(created, 'manifest.json'), 'utf8'));
    assert.match(manifest.web.notice.en, /not affiliated/i);
  } finally {
    cleanup(root);
  }
});

// ---------- Stations: station, category, layer, instrument, progression, groove ----------

const realGenerated = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'extensions', 'music-sources', 'generated');

/** A valid tree that also contains a copy of the real Stations source (so scaffolded pieces resolve against real blocks). */
function setupGenerated() {
  const files = baseFiles();
  files['package.json'] = '{ "type": "module" }\n'; // lets Node import the scaffolded .js files from the temp dir
  const root = writeTree(files);
  fs.cpSync(realGenerated, path.join(root, 'music-sources', 'generated'), { recursive: true });
  const userRoot = writeTree({});
  const run = (args) => scaffold({ extensionsRoot: root, userRoot, templatesRoot, ...args });
  return { root, userRoot, run, load: () => loadExtensions({ bundledRoot: root, userRoot }), gen: path.join(root, 'music-sources', 'generated') };
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('every Stations template produces pieces that pass the real loader, and they can reference each other', () => {
  const { root, userRoot, run, load, gen } = setupGenerated();
  try {
    assert.deepEqual(load().problems, [], 'the copied real source starts clean');

    run({ type: 'category', id: 'bossa', nameEn: 'Bossa Nova', nameKo: '보사노바' });
    run({ type: 'progression', id: 'bossa-chords' });
    run({ type: 'groove', id: 'bossa-groove' });
    run({ type: 'instrument', id: 'nylon-guitar', role: 'chords' });
    run({ type: 'instrument', id: 'bossa-kit', role: 'drums' });
    run({ type: 'layer', id: 'cafe-hush' });
    run({ type: 'layer', id: 'warm-brown', kind: 'noise', color: 'brown' });
    const { created } = run({ type: 'station', id: 'sunday-bossa', category: 'bossa', nameEn: 'Sunday Bossa', nameKo: '일요일 보사' });

    // wire the new station to the new blocks: proves the loader's cross-reference checks accept scaffolded files
    const manifestFile = path.join(created, 'manifest.json');
    const station = readJson(manifestFile);
    station.composer.progressions = ['bossa-chords'];
    station.composer.groove = 'bossa-groove';
    station.composer.voices[0].instrument = 'nylon-guitar';
    station.composer.voices[2].instrument = 'bossa-kit';
    station.layers = [{ id: 'cafe-hush', level: 0.3 }, { id: 'warm-brown', level: 0.2 }];
    fs.writeFileSync(manifestFile, JSON.stringify(station, null, 2));

    const { registry, problems } = load();
    assert.deepEqual(problems, []);
    const g = registry.generated;
    assert.ok(g.categories.some((c) => c.id === 'bossa' && c.name.ko === '보사노바'));
    assert.ok(g.stations.some((s) => s.id === 'sunday-bossa' && s.category === 'bossa' && s.name.ko === '일요일 보사'));
    assert.ok(g.progressionBanks['bossa-chords']);
    assert.ok(g.grooves['bossa-groove']);
    assert.ok(g.instruments.includes('nylon-guitar') && g.instruments.includes('bossa-kit'));
    assert.deepEqual(g.layers.filter((l) => ['cafe-hush', 'warm-brown'].includes(l.id)).map((l) => l.kind).sort(), ['dsp', 'noise']);
    assert.equal(g.layers.find((l) => l.id === 'warm-brown').noise.color, 'brown');
    assert.ok(fs.existsSync(path.join(gen, 'layers', 'cafe-hush', 'index.js')));
  } finally {
    cleanup(root, userRoot);
  }
});

test('a scaffolded station works as shipped (no edits needed) in every category and in My Stations', () => {
  const { root, userRoot, run, load } = setupGenerated();
  try {
    run({ type: 'station', id: 'plain-lofi', category: 'lofi' });
    run({ type: 'station', id: 'plain-custom', category: 'custom' });
    const { registry, problems } = load();
    assert.deepEqual(problems, []);
    assert.deepEqual(registry.generated.stations.filter((s) => s.id.startsWith('plain-')).map((s) => s.category).sort(), ['custom', 'lofi']);
  } finally {
    cleanup(root, userRoot);
  }
});

test('--user writes a data-only station into the user folder under My Stations', () => {
  const { root, userRoot, run, load } = setupGenerated();
  try {
    const { created } = run({ type: 'station', id: 'my-vibe', category: 'lofi', user: true, nameEn: 'My Vibe' });
    assert.equal(created, path.join(userRoot, 'stations', 'my-vibe'), 'the category flag is ignored: user stations are always custom');
    const { registry, problems } = load();
    assert.deepEqual(problems, []);
    const mine = registry.generated.stations.find((s) => s.id === 'my-vibe');
    assert.equal(mine.origin, 'user');
    assert.equal(mine.category, 'custom');
    assert.throws(() => run({ type: 'station', id: 'my-vibe', user: true }), /already exists/);
    assert.throws(() => run({ type: 'station', id: 'jazzy-study', user: true }), /bundled station "jazzy-study" already exists/);
  } finally {
    cleanup(root, userRoot);
  }
});

test('the scaffolded DSP layer generates a finite, normalized, seamless stereo loop in plain Node', async () => {
  const { root, userRoot, run } = setupGenerated();
  try {
    const { created } = run({ type: 'layer', id: 'soft-hush' });
    const mod = await import(pathToFileURL(path.join(created, 'index.js')).href);
    const sampleRate = 22050;
    const channels = mod.generate({ sampleRate, seconds: 2 });
    assert.equal(channels.length, 2);
    assert.equal(channels[0].length, sampleRate * 2);
    assert.notDeepEqual(Array.from(channels[0].slice(0, 64)), Array.from(channels[1].slice(0, 64)), 'left and right differ');
    for (const data of channels) {
      assert.ok(data.every(Number.isFinite), 'no NaN or Infinity');
      let sum = 0;
      let peak = 0;
      for (const x of data) { sum += x * x; peak = Math.max(peak, Math.abs(x)); }
      const rms = Math.sqrt(sum / data.length);
      assert.ok(Math.abs(rms - 0.1) < 0.02, `rms ${rms} should be near the shared -20 dBFS target`);
      assert.ok(peak < 1, 'no clipping');
      assert.ok(Math.abs(data[0] - data[data.length - 1]) < 0.15, 'loop seam is continuous');
    }
  } finally {
    cleanup(root, userRoot);
  }
});

test('scaffolded instruments are importable modules with a matching meta and a create() function', async () => {
  const { root, userRoot, run } = setupGenerated();
  try {
    for (const [id, role] of [['glass-keys', 'chords'], ['round-bass', 'bass'], ['whisper-pad', 'pad'], ['tiny-lead', 'melody'], ['felt-kit', 'drums']]) {
      const { created } = run({ type: 'instrument', id, role });
      const mod = await import(pathToFileURL(created).href);
      assert.equal(mod.meta.id, id);
      assert.deepEqual(mod.meta.roles, [role]);
      assert.equal(typeof mod.create, 'function');
    }
  } finally {
    cleanup(root, userRoot);
  }
});

test('names with quotes, comment terminators and newlines cannot break the generated files', async () => {
  const { root, userRoot, run, load } = setupGenerated();
  try {
    const nasty = 'Say "hi" */ \\ \n {oops}';
    run({ type: 'category', id: 'quoted', nameEn: nasty, nameKo: nasty });
    run({ type: 'station', id: 'quoted-station', category: 'quoted', nameEn: nasty });
    const layer = run({ type: 'layer', id: 'quoted-layer', nameEn: nasty });
    const instrument = run({ type: 'instrument', id: 'quoted-inst', nameEn: nasty });
    const { registry, problems } = load();
    assert.deepEqual(problems, []);
    assert.equal(registry.generated.stations.find((s) => s.id === 'quoted-station').name.en, 'Say "hi" */ \\ {oops}');
    await import(pathToFileURL(path.join(layer.created, 'index.js')).href);
    await import(pathToFileURL(instrument.created).href);
  } finally {
    cleanup(root, userRoot);
  }
});

test('category numbers itself after the last genre and keeps categories.json valid', () => {
  const { root, userRoot, run, gen } = setupGenerated();
  try {
    const before = readJson(path.join(gen, 'categories.json'));
    const top = Math.max(...before.map((c) => c.order));
    run({ type: 'category', id: 'late-addition' });
    const after = readJson(path.join(gen, 'categories.json'));
    assert.equal(after.length, before.length + 1);
    assert.equal(after.at(-1).order, top + 1);
    assert.deepEqual(after.at(-1).name, { en: 'late-addition', ko: 'late-addition' });
  } finally {
    cleanup(root, userRoot);
  }
});

test('Stations scaffolding rejects bad input with a helpful message', () => {
  const { root, userRoot, run } = setupGenerated();
  try {
    assert.throws(() => run({ type: 'station', id: 'no-genre' }), /needs --category <id>\. Existing: .*lofi.*custom/);
    assert.throws(() => run({ type: 'station', id: 'lost', category: 'polka' }), /Category "polka" does not exist.*npm run new -- category polka/);
    assert.throws(() => run({ type: 'station', id: 'jazzy-study', category: 'lofi' }), /already exists/);
    assert.throws(() => run({ type: 'category', id: 'custom' }), /built in/);
    assert.throws(() => run({ type: 'category', id: 'lofi' }), /already exists/);
    assert.throws(() => run({ type: 'layer', id: 'rain' }), /already exists/);
    assert.throws(() => run({ type: 'layer', id: 'odd', kind: 'magic' }), /--kind/);
    assert.throws(() => run({ type: 'layer', id: 'odd', kind: 'noise', color: 'blue' }), /--color/);
    assert.throws(() => run({ type: 'instrument', id: 'epiano' }), /already exists/);
    assert.throws(() => run({ type: 'instrument', id: 'odd', role: 'vocals' }), /--role must be one of/);
    assert.throws(() => run({ type: 'progression', id: 'lofi-jazzy' }), /already exists/);
    assert.throws(() => run({ type: 'groove', id: 'lofi-soft' }), /already exists/);
    assert.throws(() => run({ type: 'groove', id: 'Not Kebab' }), /kebab-case/);
    assert.throws(() => scaffold({ type: 'station', id: 'x', category: 'lofi', extensionsRoot: userRoot, templatesRoot }), /not installed/);
  } finally {
    cleanup(root, userRoot);
  }
});
