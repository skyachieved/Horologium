import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadExtensions } from '../src/main/extensions.js';
import {
  KEY_NAMES, CHORD_QUALITY_NAMES, SCALE_NAMES, DRUM_VOICE_NAMES, VOICE_ROLES,
} from '../src/core/contracts/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const genDir = path.join(root, 'extensions', 'music-sources', 'generated');
// import() takes a URL: a bare Windows path (D:\...) is refused (found by the Windows CI run)
const importFile = (...parts) => import(pathToFileURL(path.join(...parts)).href);
const { createRng, hashSeed } = await importFile(genDir, 'compose', 'rng.js');
const theory = await importFile(genDir, 'compose', 'theory.js');
const { compose, parsePattern, swingBeat, STEPS_PER_BAR, DRUM_VOICES, BEATS_PER_BAR } = await importFile(genDir, 'compose', 'compose.js');

const { registry } = loadExtensions({ bundledRoot: path.join(root, 'extensions') });
const gen = registry.generated;
const library = { progressionBanks: gen.progressionBanks, grooves: gen.grooves };
const composed = gen.stations.filter((s) => s.composer);

// ---------------------------------------------------------------- rng

test('rng: same seed same stream, different seed different stream', () => {
  const a = createRng('study');
  const b = createRng('study');
  const c = createRng('rain');
  const seqA = Array.from({ length: 8 }, () => a.next());
  assert.deepEqual(seqA, Array.from({ length: 8 }, () => b.next()));
  assert.notDeepEqual(seqA, Array.from({ length: 8 }, () => c.next()));
  assert.ok(seqA.every((x) => x >= 0 && x < 1));
  assert.equal(hashSeed('x'), hashSeed('x'));
});

test('rng helpers stay in range and forks are independent', () => {
  const r = createRng(42);
  for (let i = 0; i < 200; i += 1) {
    const n = r.int(3, 7);
    assert.ok(n >= 3 && n <= 7 && Number.isInteger(n));
    assert.ok(Math.abs(r.jitter()) <= 1);
  }
  assert.deepEqual(createRng(7).shuffle([1, 2, 3, 4, 5]).sort(), [1, 2, 3, 4, 5]);
  const x = createRng('s').fork('bass').next();
  assert.equal(x, createRng('s').fork('bass').next());
  assert.notEqual(x, createRng('s').fork('drums').next());
  assert.equal(createRng(1).weighted([['only', 5]]), 'only');
});

// ---------------------------------------------------------------- theory

test('theory: roman numerals, chords, voicing', () => {
  assert.equal(theory.romanToSemitones('ii'), 2);
  assert.equal(theory.romanToSemitones('bVII'), 10);
  assert.equal(theory.romanToSemitones('#iv'), 6);
  assert.equal(theory.romanToSemitones('I'), 0);
  assert.throws(() => theory.romanToSemitones('viii'));
  assert.deepEqual(theory.chordPitchClasses(0, 'maj7'), [0, 4, 7, 11]);
  assert.deepEqual(theory.chordPitchClasses(2, 'm7'), [2, 5, 9, 0]);
  assert.equal(theory.pitchClass('Bb'), 10);
  assert.ok(Math.abs(theory.midiToFreq(69) - 440) < 1e-9);
});

test('theory: voice leading keeps consecutive chords close and in range', () => {
  const lo = 55;
  const hi = 76;
  let prev = null;
  let moved = 0;
  const steps = [[2, 'm7'], [7, '7'], [0, 'maj7'], [9, 'm7']]; // ii V I vi in C
  for (const [root, quality] of steps) {
    const v = theory.voiceChord(root, quality, prev, { lo, hi });
    assert.ok(v.length >= 3 && v.length <= 4);
    assert.ok(v.every((n) => n >= lo && n <= hi), `${root}${quality}: ${v}`);
    assert.deepEqual([...v].sort((a, b) => a - b), v);
    assert.ok(v[v.length - 1] - v[0] <= 14);
    if (prev) moved += v.reduce((s, n, i) => s + Math.abs(n - prev[i]), 0);
    prev = v;
  }
  assert.ok(moved / 3 < 14, `average total movement per chord was ${moved / 3}`);
});

test('theory: rootless voicings leave out the root so the bass owns it', () => {
  const v = theory.voiceChord(0, 'maj9', null, { rootless: true, max: 4 });
  assert.ok(!v.some((n) => n % 12 === 0));
  const withRoot = theory.voiceChord(0, 'maj7', null, { rootless: false, max: 4 });
  assert.ok(withRoot.some((n) => n % 12 === 0));
});

test('theory: scaleNotes only returns scale members', () => {
  const notes = theory.scaleNotes(9, 'minor-pent', 57, 81); // A minor pentatonic
  const allowed = new Set([9, 0, 2, 4, 7]);
  assert.ok(notes.length > 5);
  assert.ok(notes.every((n) => allowed.has(n % 12)));
});

// ---------------------------------------------------------------- patterns, swing

test('patterns parse to 16 velocities and reject bad input', () => {
  const p = parsePattern('X--- o--- x-x- ----');
  assert.equal(p.length, STEPS_PER_BAR);
  assert.deepEqual([p[0], p[4], p[8], p[1]], [1, 0.35, 0.7, 0]);
  assert.throws(() => parsePattern('x---'));
  assert.throws(() => parsePattern('x--- ---- ---- ---z'));
});

test('swing: straight is identity, triplet puts the "and" at 2/3, order is preserved', () => {
  for (let i = 0; i <= 8; i += 1) assert.ok(Math.abs(swingBeat(i / 2, 0.5) - i / 2) < 1e-12);
  assert.ok(Math.abs(swingBeat(0.5, 2 / 3) - 2 / 3) < 1e-12);
  assert.ok(Math.abs(swingBeat(1.5, 0.6) - 1.6) < 1e-12);
  let last = -1;
  for (let i = 0; i < 16; i += 1) {
    const t = swingBeat(i / 4, 0.62);
    assert.ok(t > last);
    last = t;
  }
});

// ---------------------------------------------------------------- composition

test('there is something to compose', () => {
  assert.ok(composed.length >= 7, `found ${composed.length} composed stations`);
});

test('compose is deterministic per seed and varies across seeds', () => {
  for (const station of composed) {
    const a = compose({ composer: station.composer, library, seed: 'same' });
    const b = compose({ composer: station.composer, library, seed: 'same' });
    assert.deepEqual(a, b, station.id);
    const c = compose({ composer: station.composer, library, seed: 'other' });
    assert.notDeepEqual(a.voices, c.voices, `${station.id}: different seeds should differ`);
  }
});

test('overrides (the sliders) change the plan in the expected way', () => {
  const st = gen.stations.find((s) => s.id === 'jazzy-study');
  const base = compose({ composer: st.composer, library, seed: 1, overrides: { tempo: 70 } });
  assert.equal(base.tempo, 70);
  assert.equal(compose({ composer: st.composer, library, seed: 1, overrides: { tempo: 999 } }).tempo, 200);
  assert.equal(compose({ composer: st.composer, library, seed: 1, overrides: { lowpassHz: 2000 } }).fx.lowpassHz, 2000);
  const quiet = compose({ composer: st.composer, library, seed: 1, overrides: { melodyDensity: 0 } });
  assert.equal(quiet.voices.find((v) => v.role === 'melody').events.length, 0);
  const busy = compose({ composer: st.composer, library, seed: 1, overrides: { melodyDensity: 1 } });
  assert.ok(busy.voices.find((v) => v.role === 'melody').events.length > 8);
  const keyed = compose({ composer: st.composer, library, seed: 1, overrides: { key: 'F' } });
  assert.equal(keyed.key.name, 'F');
});

test('every composed station yields musically sane plans across many seeds', () => {
  for (const station of composed) {
    const c = station.composer;
    for (let seed = 0; seed < 24; seed += 1) {
      const plan = compose({ composer: c, library, seed: `qa-${seed}` });
      const label = `${station.id} seed ${seed}`;

      assert.ok(plan.tempo >= c.tempo[0] && plan.tempo <= c.tempo[1], `${label}: tempo ${plan.tempo}`);
      assert.ok(c.keys.includes(plan.key.name), label);
      assert.equal(plan.beats, c.barsPerPhrase * BEATS_PER_BAR);
      assert.ok(Math.abs(plan.seconds - (plan.beats * 60) / plan.tempo) < 1e-9);
      assert.equal(plan.voices.length, c.voices.length);

      // chord timeline tiles the phrase exactly
      let t = 0;
      for (const chord of plan.chords) {
        assert.equal(chord.t, t, `${label}: gap in chord timeline`);
        t += chord.d;
      }
      assert.equal(t, plan.beats, label);

      const scalePcs = new Set(theory.SCALES[plan.key.scale].map((d) => (plan.key.pc + d) % 12));
      plan.voices.forEach((voice, vi) => {
        const spec = c.voices[vi];
        assert.equal(voice.role, spec.role);
        let last = -Infinity;
        for (const ev of voice.events) {
          assert.ok(Number.isFinite(ev.t) && Number.isFinite(ev.d) && Number.isFinite(ev.v), `${label}: NaN in ${voice.role}`);
          assert.ok(ev.t >= 0 && ev.t < plan.beats + 0.25, `${label}: ${voice.role} event at ${ev.t} outside the phrase`);
          assert.ok(ev.d > 0, `${label}: non-positive duration`);
          assert.ok(ev.v > 0 && ev.v <= 1.3, `${label}: velocity ${ev.v}`);
          assert.ok(ev.t >= last - 1e-9, `${label}: ${voice.role} events out of order`);
          last = ev.t;
          if (voice.role === 'drums') {
            assert.ok(DRUM_VOICES.includes(ev.n), `${label}: drum voice ${ev.n}`);
          } else {
            assert.ok(Number.isInteger(ev.n) && ev.n >= 24 && ev.n <= 108, `${label}: ${voice.role} note ${ev.n}`);
          }
          if (voice.role === 'melody') {
            const [lo, hi] = spec.range ?? [64, 81];
            assert.ok(ev.n >= lo && ev.n <= hi, `${label}: melody note ${ev.n} outside ${lo}-${hi}`);
            assert.ok(scalePcs.has(ev.n % 12), `${label}: melody note ${ev.n} is not in the ${plan.key.name} ${plan.key.scale} scale`);
          }
          if (voice.role === 'bass') {
            const lo = spec.lo ?? 31;
            assert.ok(ev.n >= lo - 1 && ev.n <= lo + 15, `${label}: bass note ${ev.n} outside ${lo - 1}-${lo + 15}`);
          }
          if (voice.role === 'chords' || voice.role === 'pad') {
            const [lo, hi] = spec.range ?? (voice.role === 'pad' ? [52, 72] : [55, 79]);
            assert.ok(ev.n >= lo && ev.n <= hi, `${label}: ${voice.role} note ${ev.n} outside ${lo}-${hi}`);
          }
        }
        // density: no voice should be a wall of notes
        const perBar = voice.events.length / plan.bars;
        const cap = voice.role === 'drums' ? 70 : voice.role === 'melody' ? 8 : 24;
        assert.ok(perBar <= cap, `${label}: ${voice.role} has ${perBar.toFixed(1)} events per bar (cap ${cap})`);
      });
    }
  }
});

test('stations with drums really have a backbeat, and walking bass really walks', () => {
  const plan = compose({ composer: gen.stations.find((s) => s.id === 'dusty-boom-bap').composer, library, seed: 5 });
  const drums = plan.voices.find((v) => v.role === 'drums').events;
  const snares = drums.filter((e) => e.n === 'snare').map((e) => Math.round((e.t % 4) * 4) / 4);
  assert.ok(snares.length >= plan.bars * 2 - 2);
  assert.ok(snares.filter((b) => b === 1 || b === 3).length >= snares.length * 0.8, `snare beats: ${snares.slice(0, 8)}`);

  const trio = compose({ composer: gen.stations.find((s) => s.id === 'late-night-trio').composer, library, seed: 5 });
  const bass = trio.voices.find((v) => v.role === 'bass').events;
  assert.equal(bass.length, trio.bars * 4, 'one bass note per beat');
  assert.ok(bass.some((e, i) => i > 0 && e.n !== bass[i - 1].n), 'the line moves');
});

// ---------------------------------------------------------------- contract sync

test('the contract name lists match the implementation', () => {
  assert.deepEqual([...Object.keys(theory.CHORD_QUALITIES)].sort(), [...CHORD_QUALITY_NAMES].sort());
  assert.deepEqual([...Object.keys(theory.SCALES)].sort(), [...SCALE_NAMES].sort());
  assert.deepEqual([...DRUM_VOICES].sort(), [...DRUM_VOICE_NAMES].sort());
  assert.deepEqual([...theory.KEY_NAMES].sort(), [...KEY_NAMES].sort());
  assert.ok(VOICE_ROLES.includes('melody'));
});

test('every instrument file exports meta.id equal to its file name and a create function', async () => {
  const dir = path.join(genDir, 'instruments');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 9);
  for (const file of files) {
    const mod = await importFile(dir, file);
    assert.equal(mod.meta.id, file.replace(/\.js$/, ''), file);
    assert.equal(typeof mod.create, 'function', file);
    assert.ok(Array.isArray(mod.meta.roles) && mod.meta.roles.every((r) => VOICE_ROLES.includes(r)), file);
  }
});

test('every voice in every station uses an instrument that supports its role', async () => {
  const roles = {};
  for (const id of gen.instruments) roles[id] = (await importFile(genDir, 'instruments', `${id}.js`)).meta.roles;
  for (const st of composed) {
    for (const v of st.composer.voices) assert.ok(roles[v.instrument].includes(v.role), `${st.id}: ${v.instrument} cannot play ${v.role}`);
  }
});

test('every genre has at least one station, and every station is reachable', () => {
  const used = new Set(gen.stations.map((s) => s.category));
  for (const c of gen.categories) assert.ok(used.has(c.id), `category ${c.id} has no stations`);
  for (const s of gen.stations) assert.ok(gen.categories.some((c) => c.id === s.category), `${s.id}: unknown category`);
  assert.ok(gen.stations.length >= 11);
});
