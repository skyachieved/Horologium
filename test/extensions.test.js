import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadExtensions, compareLocales } from '../src/main/extensions.js';
import {
  baseFiles, writeTree, cleanup, json, themeManifest, characterManifest, webSourceManifest, musicPackManifest,
  TOKENS_CSS, CHIMES, SAFE_SVG,
} from '../test-support/fixtures.js';

/** Build a tree from the valid base plus overrides, load it, clean up, return the result. */
function load(overrides = {}, { userFiles = null } = {}) {
  const files = { ...baseFiles(), ...overrides };
  const root = writeTree(files);
  const user = userFiles ? writeTree(userFiles) : null;
  try {
    return loadExtensions({ bundledRoot: root, userRoot: user });
  } finally {
    cleanup(root, ...(user ? [user] : []));
  }
}

const problemFor = (result, id) => result.problems.find((p) => p.id === id);

test('a valid tree loads with no problems', () => {
  const { registry, problems } = load();
  assert.deepEqual(problems, []);
  assert.equal(registry.themes.length, 1);
  assert.equal(registry.themes[0].characters.length, 1);
  assert.equal(registry.themes[0].characters[0].theme, 'test-theme');
  assert.equal(registry.musicSources.length, 1);
  assert.deepEqual(Object.keys(registry.locales).sort(), ['en', 'ko']);
});

test('registry entries carry relative bases, never absolute filesystem paths', () => {
  const { registry } = load();
  assert.equal(registry.themes[0].base, 'themes/test-theme');
  assert.equal(registry.themes[0].characters[0].base, 'themes/test-theme/characters/buddy');
  assert.equal(registry.themes[0].origin, 'bundled');
});

test('a broken extension is skipped with a reason while the rest still load', () => {
  const second = {
    'themes/ok-theme/manifest.json': json(themeManifest('ok-theme')),
    'themes/ok-theme/tokens.css': TOKENS_CSS,
    'themes/ok-theme/theme.css': '',
    'themes/ok-theme/chimes.json': json(CHIMES),
    'themes/ok-theme/scenes/pomodoro.svg': SAFE_SVG,
    'themes/ok-theme/scenes/hydration.svg': SAFE_SVG,
    'themes/ok-theme/characters/buddy/manifest.json': json(characterManifest('buddy')),
    'themes/ok-theme/characters/buddy/character.svg': SAFE_SVG,
  };
  const { registry, problems } = load({ ...second, 'themes/test-theme/tokens.css': ':root { --bg: 1; }' });
  assert.deepEqual(registry.themes.map((t) => t.id), ['ok-theme']);
  const p = problemFor({ problems }, 'test-theme');
  assert.ok(p, 'problem recorded');
  assert.match(p.errors.join('\n'), /missing required tokens/);
});

test('unparseable JSON and unknown types are reported, not thrown', () => {
  const { registry, problems } = load({
    'themes/test-theme/manifest.json': '{ not json',
    'music-sources/mystery/manifest.json': json({ type: 'teleporter', id: 'mystery' }),
  });
  assert.equal(registry.themes.length, 0);
  assert.match(problemFor({ problems }, 'test-theme').errors[0], /cannot read manifest\.json/);
  assert.match(problemFor({ problems }, 'mystery').errors[0], /unknown extension type/);
});

test('manifest id must equal its folder name', () => {
  const { problems } = load({ 'themes/test-theme/manifest.json': json(themeManifest('other-name')) });
  assert.match(problems[0].errors.join('\n'), /must equal its folder name/);
});

test('strict schema rejects unknown fields and bad values', () => {
  const { problems } = load({ 'themes/test-theme/manifest.json': json(themeManifest('test-theme', { surprise: true, mode: 'sepia' })) });
  const text = problems[0].errors.join('\n');
  assert.match(text, /surprise: unknown field/);
  assert.match(text, /mode:/);
});

test('every name needs both en and ko', () => {
  const { problems } = load({ 'themes/test-theme/manifest.json': json(themeManifest('test-theme', { name: { en: 'Only English' } })) });
  assert.match(problems[0].errors.join('\n'), /name\.ko/);
});

test('unsafe character artwork is rejected, and a theme with no valid character is rejected', () => {
  const evil = '<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script></svg>';
  const { registry, problems } = load({ 'themes/test-theme/characters/buddy/character.svg': evil });
  assert.equal(registry.themes.length, 0);
  assert.match(problemFor({ problems }, 'buddy').errors.join('\n'), /script|event-handler/);
  assert.match(problemFor({ problems }, 'test-theme').errors.join('\n'), /at least one valid character/);
});

test('defaultCharacter must exist', () => {
  const { problems } = load({ 'themes/test-theme/manifest.json': json(themeManifest('test-theme', { defaultCharacter: 'ghost' })) });
  assert.match(problems[0].errors.join('\n'), /defaultCharacter "ghost"/);
});

test('missing referenced files are reported', () => {
  const { problems } = load({ 'themes/test-theme/theme.css': null });
  assert.match(problems[0].errors.join('\n'), /styles file "theme\.css" does not exist/);
});

test('theme scenes must exist and pass the SVG safety check', () => {
  const missing = load({ 'themes/test-theme/scenes/hydration.svg': null });
  assert.match(missing.problems[0].errors.join('\n'), /scenes\.hydration file "scenes\/hydration\.svg" does not exist/);
  const unsafe = load({ 'themes/test-theme/scenes/pomodoro.svg': '<svg viewBox="0 0 1 1"><script>x()</script></svg>' });
  assert.match(unsafe.problems[0].errors.join('\n'), /scenes\/pomodoro\.svg: <script> is not allowed/);
});

test('a chime set must define every sound event', () => {
  const partial = { ...CHIMES };
  delete partial.milestone;
  const { problems } = load({ 'themes/test-theme/chimes.json': json(partial) });
  assert.match(problems[0].errors.join('\n'), /milestone/);
});

test('web music sources: https only, and there is no field that could inject scripts', () => {
  const http = webSourceManifest('test-web');
  http.web.sites[0].url = 'http://www.example.com/';
  assert.match(load({ 'music-sources/test-web/manifest.json': json(http) }).problems[0].errors.join('\n'), /url/);

  for (const forbidden of ['injectScript', 'userAgent', 'headers', 'blockAds', 'preload']) {
    const m = webSourceManifest('test-web');
    m.web[forbidden] = 'x';
    const { problems } = load({ 'music-sources/test-web/manifest.json': json(m) });
    assert.match(problems[0].errors.join('\n'), new RegExp(`web\\.${forbidden}: unknown field`), forbidden);
  }
  const topLevel = webSourceManifest('test-web', { entry: 'index.js' });
  assert.match(load({ 'music-sources/test-web/manifest.json': json(topLevel) }).problems[0].errors.join('\n'), /entry: unknown field/);
});

test('code music sources need an existing entry file', () => {
  const gen = {
    type: 'music-source', kind: 'generated', id: 'gen', apiVersion: 1, name: { en: 'Gen', ko: '생성' }, version: '1.0.0', license: 'MIT',
    tab: { order: 1, icon: 'x' }, capabilities: { volume: true, mute: true, seek: false, playlist: false }, entry: 'index.js',
  };
  const missing = load({ 'music-sources/gen/manifest.json': json(gen) });
  assert.match(problemFor(missing, 'gen').errors.join('\n'), /entry file "index\.js" does not exist/);
  const ok = load({ 'music-sources/gen/manifest.json': json(gen), 'music-sources/gen/index.js': 'export default {};' });
  assert.deepEqual(ok.registry.musicSources.map((s) => s.id), ['gen', 'test-web']); // sorted by tab.order
});

test('locale drift from English is reported but the locale still loads', () => {
  const { registry, problems } = load({
    'locales/ko.json': json({ _meta: { code: 'ko', name: '한국어' }, 'app.title': '호롤로지움', 'tab.extra': '여분' }),
  });
  assert.ok(registry.locales.ko);
  const text = problemFor({ problems }, 'ko').errors.join('\n');
  assert.match(text, /missing 1 key/);
  assert.match(text, /1 key\(s\) not in en/);
});

test('locale _meta.code must match the file name', () => {
  const { registry, problems } = load({ 'locales/ko.json': json({ _meta: { code: 'jp', name: 'x' }, 'app.title': 'x', 'tab.pomodoro': 'x' }) });
  assert.equal(registry.locales.ko, undefined);
  assert.match(problemFor({ problems }, 'ko').errors.join('\n'), /must equal the file name/);
});

test('user folder is data-only: locales load, themes and music sources are never scanned', () => {
  const user = {
    'locales/fr.json': json({ _meta: { code: 'fr', name: 'Français' }, 'app.title': 'Horologium', 'tab.pomodoro': 'Pomodoro' }),
    'themes/sneaky/manifest.json': json(themeManifest('sneaky')),
    'music-sources/sneaky/manifest.json': json(webSourceManifest('sneaky')),
  };
  const { registry } = load({}, { userFiles: user });
  assert.ok(registry.locales.fr);
  assert.equal(registry.locales.fr.origin, 'user');
  assert.deepEqual(registry.themes.map((t) => t.id), ['test-theme']);
  assert.deepEqual(registry.musicSources.map((s) => s.id), ['test-web']);
});

test('a user locale cannot silently replace a bundled one', () => {
  const user = { 'locales/en.json': json({ _meta: { code: 'en', name: 'Hacked' }, 'app.title': 'x', 'tab.pomodoro': 'x' }) };
  const { registry, problems } = load({}, { userFiles: user });
  assert.equal(registry.locales.en.meta.name, 'English');
  assert.match(problemFor({ problems }, 'en').errors.join('\n'), /duplicate locale code/);
});

test('compareLocales lists missing and extra keys', () => {
  const r = compareLocales({ _meta: {}, a: '1', b: '2' }, { _meta: {}, b: 'x', c: 'y' });
  assert.deepEqual(r, { missing: ['a'], extra: ['c'] });
});

// ---------- music packs (user-supplied audio, data only) ----------

const packTree = (id, manifest, audio = { 'tracks/one.wav': 'RIFF' }) => ({
  [`music-packs/${id}/manifest.json`]: json(manifest),
  ...Object.fromEntries(Object.entries(audio).map(([file, bytes]) => [`music-packs/${id}/${file}`, bytes])),
});

test('a music pack with a license and provenance loads as verified', () => {
  const user = packTree('good', musicPackManifest('good', [{ file: 'tracks/one.wav', title: 'One' }], { license: 'CC0-1.0', provenance: 'Made with ACE-Step on my own machine' }));
  const { registry, problems } = load({}, { userFiles: user });
  assert.deepEqual(problems, []);
  assert.equal(registry.musicPacks.length, 1);
  const [pack] = registry.musicPacks;
  assert.equal(pack.id, 'good');
  assert.equal(pack.verified, true);
  assert.equal(pack.origin, 'user');
  assert.equal(pack.base, 'music-packs/good', 'relative base, never an absolute path');
});

test('a pack without license or provenance still plays but is marked unverified', () => {
  const none = load({}, { userFiles: packTree('plain', musicPackManifest('plain')) });
  assert.equal(none.registry.musicPacks[0].verified, false);
  const half = load({}, { userFiles: packTree('half', musicPackManifest('half', undefined, { license: 'CC0-1.0' })) });
  assert.equal(half.registry.musicPacks[0].verified, false, 'both fields are needed');
});

test('a pack whose audio file is missing is skipped with a reason, other packs still load', () => {
  const user = {
    ...packTree('broken', musicPackManifest('broken', [{ file: 'tracks/one.wav' }, { file: 'tracks/gone.wav' }]), { 'tracks/one.wav': 'RIFF' }),
    ...packTree('fine', musicPackManifest('fine')),
  };
  const { registry, problems } = load({}, { userFiles: user });
  assert.deepEqual(registry.musicPacks.map((p) => p.id), ['fine']);
  assert.match(problemFor({ problems }, 'broken').errors.join('\n'), /tracks\/gone\.wav: file does not exist/);
});

test('only audio files can be listed in a pack', () => {
  const user = packTree('sneaky', musicPackManifest('sneaky', [{ file: 'notes.txt' }, { file: 'run.exe' }]), { 'notes.txt': 'hi', 'run.exe': 'MZ' });
  const { registry, problems } = load({}, { userFiles: user });
  assert.equal(registry.musicPacks.length, 0);
  const text = problemFor({ problems }, 'sneaky').errors.join('\n');
  assert.match(text, /notes\.txt: not a supported audio type/);
  assert.match(text, /run\.exe: not a supported audio type/);
});

test('track paths cannot climb out of the pack, be absolute, or use backslashes', () => {
  for (const file of ['../../secret.wav', 'tracks/../../secret.wav', '/etc/passwd.mp3', 'C:/Windows/x.wav', 'tracks\\one.wav', '..\\one.wav']) {
    const { registry, problems } = load({}, { userFiles: packTree('evil', musicPackManifest('evil', [{ file }]), {}) });
    assert.equal(registry.musicPacks.length, 0, file);
    assert.match(problemFor({ problems }, 'evil').errors.join('\n'), /tracks\[0\]\.file/, file);
  }
});

test('pack id must match its folder, unknown fields are rejected, and there must be at least one track', () => {
  const wrongId = load({}, { userFiles: packTree('folder-name', musicPackManifest('other-id')) });
  assert.match(wrongId.problems[0].errors.join('\n'), /must equal its folder name/);
  const extra = load({}, { userFiles: packTree('extra', musicPackManifest('extra', undefined, { entry: 'index.js' })) });
  assert.match(extra.problems[0].errors.join('\n'), /entry: unknown field/, 'a pack is data only: no code entry point');
  const empty = load({}, { userFiles: packTree('empty', musicPackManifest('empty', [])) });
  assert.match(empty.problems[0].errors.join('\n'), /tracks/);
});

test('packs are only scanned in the user folder', () => {
  const bundledPack = packTree('shipped', musicPackManifest('shipped'));
  const { registry } = load(bundledPack);
  assert.deepEqual(registry.musicPacks, [], 'the bundled folder never provides packs in v1');
});

test('audio extensions are matched case-insensitively', () => {
  const user = packTree('loud', musicPackManifest('loud', [{ file: 'tracks/LOUD.MP3' }]), { 'tracks/LOUD.MP3': 'ID3' });
  assert.equal(load({}, { userFiles: user }).registry.musicPacks.length, 1);
});
