import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadExtensions } from '../src/main/extensions.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const genDir = path.join(root, 'extensions', 'music-sources', 'generated');
const importFile = (...parts) => import(pathToFileURL(path.join(...parts)).href);
const { planSong, createSongStream, introTypesFor, FORMS } = await importFile(genDir, 'compose', 'song.js');
const { scaleNotes, pitchClass } = await importFile(genDir, 'compose', 'theory.js');

const { registry } = loadExtensions({ bundledRoot: path.join(root, 'extensions') });
const gen = registry.generated;
const library = { progressionBanks: gen.progressionBanks, grooves: gen.grooves };
const songs = gen.stations.filter((s) => s.composer);
const eventsOf = (plan, role) => plan.voices.filter((v) => v.role === role).flatMap((v) => v.events);
const take = (stream, n) => Array.from({ length: n }, () => stream.next());

test('a song plan is deterministic, starts with an intro, and its B loop contrasts with A', () => {
  for (const st of songs) {
    const a = planSong({ composer: st.composer, library, seed: 'x' });
    assert.deepEqual(a, planSong({ composer: st.composer, library, seed: 'x' }), st.id);
    assert.equal(a.form[0], 'intro');
    assert.ok(FORMS.some((f) => f.join() === a.form.join()));
    assert.ok(introTypesFor(st.composer).includes(a.intro), `${st.id}: intro "${a.intro}" fits its instruments`);
    assert.ok(st.composer.keys.includes(a.key));
    const banks = st.composer.progressions.reduce((n, b) => n + gen.progressionBanks[b].progressions.length, 0);
    if (banks > 1) assert.notEqual(a.progA, a.progB, `${st.id}: B uses a different chord loop`);
  }
});

test('the stream plays a song form: half-length intro, A sections share their chord loop, breaks drop drums and bass', () => {
  for (const st of songs) {
    const phrases = take(createSongStream({ composer: st.composer, library, seed: `s:${st.id}`, overrides: {} }), 16);
    const first = phrases[0];
    assert.equal(first.section, 'intro', st.id);
    assert.equal(first.plan.bars, Math.max(4, Math.floor(st.composer.barsPerPhrase / 2)), `${st.id}: intro is half length`);
    const firstSong = phrases.filter((p) => p.song === 0);
    const aLoops = new Set(firstSong.filter((p) => p.section === 'A').map((p) => p.plan.progression));
    assert.equal(aLoops.size, 1, `${st.id}: every A section of a song uses the same chord loop`);
    for (const p of phrases.filter((x) => x.section === 'break')) {
      assert.equal(eventsOf(p.plan, 'drums').length + eventsOf(p.plan, 'bass').length, 0, `${st.id}: a break has no drums or bass`);
      assert.ok(eventsOf(p.plan, 'chords').length + eventsOf(p.plan, 'pad').length > 0, `${st.id}: a break still has harmony`);
    }
    for (const p of phrases) assert.ok(p.plan.voices.some((v) => v.events.length > 0), `${st.id}: no section is silent`);
  }
});

test('intros really differ: "keys" has no drums, "beat" has no chords', () => {
  const st = songs.find((s) => introTypesFor(s.composer).includes('beat') && introTypesFor(s.composer).includes('keys'));
  assert.ok(st, 'a station with both drums and chords exists');
  const byIntro = {};
  for (let i = 0; i < 40 && Object.keys(byIntro).length < 4; i += 1) {
    const p = createSongStream({ composer: st.composer, library, seed: `intro:${i}`, overrides: {} }).next();
    byIntro[p.intro] ??= p.plan;
  }
  assert.ok(Object.keys(byIntro).length >= 3, `intro styles seen: ${Object.keys(byIntro).join(', ')}`);
  if (byIntro.keys) assert.equal(eventsOf(byIntro.keys, 'drums').length, 0);
  if (byIntro.beat) assert.equal(eventsOf(byIntro.beat, 'chords').length, 0);
});

test('songs move: after the first song ends the key changes for at least one later song', () => {
  const st = songs.find((s) => s.composer.keys.length > 2);
  const phrases = take(createSongStream({ composer: st.composer, library, seed: 'keys', overrides: { key: st.composer.keys[0] } }), 40);
  assert.equal(phrases[0].plan.key.name, st.composer.keys[0], 'the first song keeps the session key');
  assert.ok(new Set(phrases.map((p) => p.plan.key.name)).size > 1, 'a later song is in another key');
  assert.ok(new Set(phrases.map((p) => p.song)).size >= 3, 'several songs in 40 phrases');
});

test('every note of every streamed phrase stays in its key\'s scale or chord tones (melody) and bars fill exactly', () => {
  for (const st of songs) {
    for (const { plan } of take(createSongStream({ composer: st.composer, library, seed: `inkey:${st.id}`, overrides: {} }), 10)) {
      assert.equal(plan.chords.reduce((n, c) => n + c.d, 0), plan.bars * plan.beatsPerBar, `${st.id}: chords fill the phrase`);
      const scale = new Set(scaleNotes(pitchClass(plan.key.name), plan.key.scale, 0, 127).map((n) => n % 12));
      for (const n of eventsOf(plan, 'melody').map((e) => e.n)) assert.ok(scale.has(n % 12), `${st.id}: melody note ${n} outside ${plan.key.name} ${plan.key.scale}`);
    }
  }
});

test('skipIntro starts a restarted station at its first A section', () => {
  const st = songs[0];
  const p = createSongStream({ composer: st.composer, library, seed: 'skip', overrides: {}, skipIntro: true }).next();
  assert.notEqual(p.section, 'intro');
});
