/*
 * The composer: (station.composer, library, seed, overrides) -> Plan.   PURE and deterministic.
 *
 * A Plan is plain data: tempo, key, the chord timeline, and one event list per voice. It contains no
 * audio. The synth renders it with the instruments named in each voice. That separation is the whole
 * point: music logic is testable without audio hardware, and a new genre is mostly JSON.
 *
 * Event: { t, d, n, v }
 *   t  start in BEATS from the phrase start (already swung and humanized)
 *   d  duration in beats
 *   n  MIDI note number for pitched voices, or a drum voice name ('kick', 'snare', 'hat', ...)
 *   v  velocity 0..1
 */
import { createRng } from './rng.js';
import {
  pitchClass, romanToSemitones, voiceChord, scaleNotes, nearest, mod12, pcInBand, chordPitchClasses,
} from './theory.js';

export const BEATS_PER_BAR = 4;
export const STEPS_PER_BAR = 16;
export const DRUM_VOICES = Object.freeze(['kick', 'snare', 'hat', 'ohat', 'rim', 'clap', 'snap', 'brush', 'ride', 'shaker']);
const NON_DRUM_PATTERNS = new Set(['bass', 'comp']);

/** "x--- o--- X--- x-o-" -> 16 velocities (x normal, X accent, o ghost, - . _ rest; spaces ignored). */
export function parsePattern(text) {
  const out = [];
  for (const ch of String(text)) {
    if (ch === ' ') continue;
    if (ch === 'x') out.push(0.7);
    else if (ch === 'X') out.push(1);
    else if (ch === 'o') out.push(0.35);
    else if (ch === '-' || ch === '.' || ch === '_') out.push(0);
    else throw new Error(`bad pattern character "${ch}" in "${text}"`);
  }
  if (out.length !== STEPS_PER_BAR) throw new Error(`pattern needs ${STEPS_PER_BAR} steps, got ${out.length}: "${text}"`);
  return out;
}

/**
 * Map a straight beat position to a swung one. swing 0.5 = straight, 0.667 = triplet feel.
 * Piecewise linear inside each beat: the "and" (0.5) lands at `swing`.
 */
export function swingBeat(position, swing) {
  const base = Math.floor(position);
  const frac = position - base;
  const mapped = frac < 0.5 ? frac * (swing / 0.5) : swing + (frac - 0.5) * ((1 - swing) / 0.5);
  return base + mapped;
}

const stepPosition = (step, swing) => swingBeat(step / 4, swing);

/** Apply numeric overrides (the station's params) on top of the authored composer config. */
export function resolveComposer(composer, overrides = {}) {
  const cfg = JSON.parse(JSON.stringify(composer));
  if (overrides.swing != null) cfg.swing = overrides.swing;
  cfg.fx = { ...cfg.fx };
  for (const key of ['lowpassHz', 'reverb', 'wobble', 'saturation']) if (overrides[key] != null) cfg.fx[key] = overrides[key];
  const scale = { drums: 'drumLevel', bass: 'bassLevel', chords: 'chordLevel', pad: 'chordLevel', melody: 'melodyLevel' };
  for (const voice of cfg.voices) {
    const key = scale[voice.role];
    if (key && overrides[key] != null) voice.level = overrides[key];
    if (voice.role === 'melody' && overrides.melodyDensity != null) voice.density = overrides.melodyDensity;
  }
  return cfg;
}

function buildProgression(cfg, library, rng) {
  const choices = [];
  for (const bankId of cfg.progressions) {
    const bank = library.progressionBanks[bankId];
    if (!bank) throw new Error(`unknown progression bank "${bankId}"`);
    for (const p of bank.progressions) choices.push(p);
  }
  if (choices.length === 0) throw new Error('no progressions available');
  return rng.pick(choices);
}

/** Expand a progression to fill `totalBeats`, looping it. */
function chordTimeline(progression, tonicPc, totalBeats) {
  const timeline = [];
  let t = 0;
  while (t < totalBeats) {
    for (const chord of progression.chords) {
      if (t >= totalBeats) break;
      const d = Math.min(chord.beats ?? 4, totalBeats - t);
      timeline.push({
        t,
        d,
        rootPc: mod12(tonicPc + romanToSemitones(chord.r)),
        quality: chord.q,
        roman: chord.r,
      });
      t += d;
    }
  }
  return timeline;
}

const chordAt = (timeline, t) => timeline.find((c) => t >= c.t && t < c.t + c.d) ?? timeline[timeline.length - 1];

function voicings(timeline, range, rootless, max) {
  let previous = null;
  return timeline.map((c) => {
    const notes = voiceChord(c.rootPc, c.quality, previous, { lo: range[0], hi: range[1], rootless, max });
    previous = notes;
    return notes;
  });
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const vel = (base, rng, amount = 0.12) => clamp(base * (1 + amount * rng.jitter()), 0.05, 1.25);

// ---------------------------------------------------------------- chord voices

function composeChords(voice, ctx) {
  const { timeline, rng, swing, bars, groove } = ctx;
  const range = voice.range ?? (voice.role === 'pad' ? [52, 72] : [55, 79]);
  const volumes = voicings(timeline, range, voice.rootless ?? true, voice.maxNotes ?? 4);
  const events = [];
  const strum = voice.strum ?? 0.025;
  const style = voice.style ?? 'pad';

  if (style === 'pad') {
    timeline.forEach((c, i) => {
      volumes[i].forEach((note, k) => {
        events.push({ t: c.t + k * strum, d: c.d * 0.97, n: note, v: vel(voice.velocity ?? 0.5, rng) });
      });
    });
  } else if (style === 'stab' || style === 'ballad') {
    const variants = (groove.patterns.comp ?? ['x--- ---- ---- ----']).map(parsePattern);
    for (let bar = 0; bar < bars; bar += 1) {
      const pattern = variants[bar % 4 === 3 && variants.length > 1 ? 1 : 0];
      const hits = pattern.map((v, step) => [step, v]).filter(([, v]) => v > 0);
      hits.forEach(([step, v], h) => {
        const t = bar * BEATS_PER_BAR + stepPosition(step, swing);
        const next = hits[h + 1] ? bar * BEATS_PER_BAR + stepPosition(hits[h + 1][0], swing) : (bar + 1) * BEATS_PER_BAR;
        const c = chordAt(timeline, t);
        const notes = volumes[timeline.indexOf(c)];
        const d = style === 'ballad' ? Math.min(next - t, 3.2) : Math.min(next - t, 1.6) * 0.9;
        notes.forEach((note, k) => {
          events.push({ t: t + k * strum, d, n: note, v: vel((voice.velocity ?? 0.5) * (0.6 + 0.4 * v), rng) });
        });
      });
    }
  } else if (style === 'arp') {
    for (let i = 0; i < timeline.length; i += 1) {
      const c = timeline[i];
      const notes = volumes[i];
      const order = [...notes, ...[...notes].reverse().slice(1, -1)];
      for (let k = 0; k * 0.5 < c.d; k += 1) {
        const pos = c.t + k * 0.5;
        events.push({ t: swingBeat(pos, swing), d: 1.1, n: order[k % order.length], v: vel((voice.velocity ?? 0.42) * (k % 2 === 0 ? 1 : 0.8), rng) });
      }
    }
  } else {
    throw new Error(`unknown chord style "${style}"`);
  }
  return events;
}

// ---------------------------------------------------------------- bass

function bassNote(rootPc, lo) {
  return pcInBand(rootPc, lo);
}

function composeBass(voice, ctx) {
  const { timeline, rng, swing, bars, groove } = ctx;
  const lo = voice.lo ?? 31;
  const style = voice.style ?? 'root-fifth';
  const events = [];

  if (style === 'walking') {
    for (let bar = 0; bar < bars; bar += 1) {
      for (let beat = 0; beat < BEATS_PER_BAR; beat += 1) {
        const t = bar * BEATS_PER_BAR + beat;
        const c = chordAt(timeline, t);
        const nextChord = chordAt(timeline, t + 1);
        const pcs = chordPitchClasses(c.rootPc, c.quality);
        const root = bassNote(c.rootPc, lo);
        let note;
        if (t === c.t) note = root;
        else if (t + 1 >= c.t + c.d && nextChord !== c) note = bassNote(nextChord.rootPc, lo) + (rng.chance(0.5) ? 1 : -1); // chromatic approach
        else if (beat === 2) note = bassNote(mod12(c.rootPc + 7), lo);
        else note = pcInBand(rng.pick(pcs), lo);
        events.push({ t: swingBeat(t, swing), d: 0.92, n: clamp(note, lo - 1, lo + 14), v: vel(voice.velocity ?? 0.7, rng, 0.1) });
      }
    }
    return events;
  }

  const variants = (groove.patterns.bass ?? groove.patterns.kick ?? ['x--- ---- ---- ----']).map(parsePattern);
  for (let bar = 0; bar < bars; bar += 1) {
    const pattern = variants[bar % 4 === 3 && variants.length > 1 ? 1 : 0];
    const hits = pattern.map((v, step) => [step, v]).filter(([, v]) => v > 0);
    hits.forEach(([step, v], h) => {
      const t = bar * BEATS_PER_BAR + stepPosition(step, swing);
      const next = hits[h + 1] ? bar * BEATS_PER_BAR + stepPosition(hits[h + 1][0], swing) : (bar + 1) * BEATS_PER_BAR;
      const c = chordAt(timeline, t);
      let pc = c.rootPc;
      if (style === 'root-fifth' && step >= 8 && rng.chance(0.28)) pc = mod12(c.rootPc + 7);
      const maxLen = style === 'sustain' ? 3.5 : 1.6;
      events.push({ t, d: Math.max(0.25, Math.min(next - t, maxLen) * 0.95), n: bassNote(pc, lo), v: vel((voice.velocity ?? 0.75) * (0.7 + 0.3 * v), rng, 0.08) });
    });
  }
  return events;
}

// ---------------------------------------------------------------- drums

function pickVariant(variants, fills, bar, bars) {
  if (fills && bar === bars - 1) return fills[0];
  if (variants.length > 1 && bar % 4 === 3) return variants[1 + (Math.floor(bar / 4) % (variants.length - 1))];
  return variants[0];
}

function composeDrums(voice, ctx) {
  const { rng, swing, bars, groove } = ctx;
  const pocket = voice.pocket ?? 0.012;
  const events = [];
  for (const name of Object.keys(groove.patterns)) {
    if (NON_DRUM_PATTERNS.has(name)) continue;
    if (!DRUM_VOICES.includes(name)) throw new Error(`unknown drum voice "${name}" in groove "${groove.id}"`);
    const variants = groove.patterns[name].map(parsePattern);
    const fills = groove.fills?.[name]?.map(parsePattern);
    for (let bar = 0; bar < bars; bar += 1) {
      const pattern = pickVariant(variants, fills, bar, bars);
      pattern.forEach((v, step) => {
        if (v <= 0) return;
        const backbeat = name === 'snare' || name === 'clap' || name === 'snap' || name === 'rim' ? pocket : 0;
        const t = bar * BEATS_PER_BAR + stepPosition(step, swing) + backbeat + rng.jitter() * 0.006;
        events.push({ t: Math.max(0, t), d: 0.25, n: name, v: vel(v, rng, 0.14) });
      });
    }
  }
  return events;
}

// ---------------------------------------------------------------- melody

const RHYTHMS = [
  [[0, 1.5], [1.5, 1], [3, 1]],
  [[0.5, 1], [2, 1.5], [3.5, 0.5]],
  [[1, 2], [3.5, 0.5]],
  [[0, 1], [2.5, 1.5]],
  [[1.5, 0.5], [2, 2]],
];

function composeMelody(voice, ctx) {
  const { timeline, rng, swing, bars, tonicPc, scaleName } = ctx;
  const [lo, hi] = voice.range ?? [64, 81];
  const density = voice.density ?? 0.35;
  const pool = scaleNotes(tonicPc, voice.scale ?? scaleName, lo, hi);
  if (pool.length === 0) return [];
  const events = [];
  let last = Math.round((lo + hi) / 2);
  const phraseRhythms = [rng.pick(RHYTHMS), rng.pick(RHYTHMS)];

  for (let bar = 0; bar < bars; bar += 1) {
    if (!rng.chance(density)) continue;
    const barStart = bar * BEATS_PER_BAR;
    const c = chordAt(timeline, barStart);
    const tonePcs = new Set(chordPitchClasses(c.rootPc, c.quality));
    const strong = pool.filter((n) => tonePcs.has(mod12(n)));
    const rhythm = phraseRhythms[bar % 2];
    rhythm.forEach(([start, length], i) => {
      const source = i === 0 && strong.length ? strong : pool;
      const near = source.filter((n) => Math.abs(n - last) <= 5 && n !== last);
      const note = near.length ? rng.pick(near) : nearest(source, last);
      last = note;
      events.push({ t: swingBeat(barStart + start, swing), d: length * 0.95, n: note, v: vel(voice.velocity ?? 0.4, rng, 0.2) });
    });
  }
  return events;
}

// ---------------------------------------------------------------- entry point

/**
 * @param {object} args
 * @param {object} args.composer   station.composer
 * @param {{progressionBanks: object, grooves: object}} args.library
 * @param {number|string} args.seed
 * @param {object} [args.overrides] numeric overrides from the station's params
 */
export function compose({ composer, library, seed, overrides = {} }) {
  const cfg = resolveComposer(composer, overrides);
  const rng = createRng(seed);
  const bars = cfg.barsPerPhrase;
  const totalBeats = bars * BEATS_PER_BAR;
  const swing = cfg.swing ?? 0.5;

  const tempo = clamp(Math.round(overrides.tempo ?? rng.range(cfg.tempo[0], cfg.tempo[1])), 40, 200);
  const pickedKey = rng.pick(cfg.keys); // always consume the draw so the stream stays stable
  const keyName = overrides.key && cfg.keys.includes(overrides.key) ? overrides.key : pickedKey;
  const tonicPc = pitchClass(keyName);
  const progression = buildProgression(cfg, library, rng);
  const mode = progression.mode ?? 'major';
  const scaleName = (cfg.scales?.[mode]) ?? (mode === 'minor' ? 'minor-pent' : 'major-pent');
  const timeline = chordTimeline(progression, tonicPc, totalBeats);

  const groove = library.grooves[cfg.groove];
  if (!groove) throw new Error(`unknown groove "${cfg.groove}"`);

  const base = { timeline, swing, bars, groove, tonicPc, scaleName };
  const voices = cfg.voices.map((voice, index) => {
    const ctx = { ...base, rng: rng.fork(`voice${index}:${voice.role}`) };
    let events;
    if (voice.role === 'chords' || voice.role === 'pad') events = composeChords(voice, ctx);
    else if (voice.role === 'bass') events = composeBass(voice, ctx);
    else if (voice.role === 'drums') events = composeDrums(voice, ctx);
    else if (voice.role === 'melody') events = composeMelody(voice, ctx);
    else throw new Error(`unknown voice role "${voice.role}"`);
    events.sort((a, b) => a.t - b.t || (typeof a.n === 'number' && typeof b.n === 'number' ? a.n - b.n : 0));
    return { role: voice.role, instrument: voice.instrument, level: voice.level ?? 1, params: voice.params ?? {}, events };
  });

  return {
    seed: String(seed),
    tempo,
    swing,
    key: { name: keyName, pc: tonicPc, mode, scale: scaleName },
    bars,
    beatsPerBar: BEATS_PER_BAR,
    beats: totalBeats,
    seconds: (totalBeats * 60) / tempo,
    progression: progression.name ?? 'untitled',
    chords: timeline.map(({ t, d, rootPc, quality, roman }) => ({ t, d, rootPc, quality, roman })),
    fx: cfg.fx,
    voices,
  };
}
