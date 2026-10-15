/*
 * Small music-theory toolkit: pitch classes, scales, chord qualities, roman-numeral roots, and
 * voice-led chord voicings. PURE (no Web Audio), unit-tested in Node.
 */

const PITCH_CLASS = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};
export const KEY_NAMES = Object.freeze(Object.keys(PITCH_CLASS));

export const pitchClass = (name) => {
  if (!(name in PITCH_CLASS)) throw new Error(`unknown key "${name}"`);
  return PITCH_CLASS[name];
};

export const midiToFreq = (midi) => 440 * 2 ** ((midi - 69) / 12);

export const SCALES = Object.freeze({
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  'major-pent': [0, 2, 4, 7, 9],
  'minor-pent': [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
});

/** Intervals in semitones above the root. Extensions above an octave (9, 11, 13) are written as 14, 17, 21. */
export const CHORD_QUALITIES = Object.freeze({
  maj: [0, 4, 7],
  min: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  7: [0, 4, 7, 10],
  9: [0, 4, 7, 10, 14],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  69: [0, 4, 7, 9, 14],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  add9: [0, 4, 7, 14],
  m11: [0, 3, 7, 10, 14, 17],
  13: [0, 4, 10, 14, 21],
  '7#9': [0, 4, 7, 10, 15],
  '7b9': [0, 4, 7, 10, 13],
  'maj7#11': [0, 4, 7, 11, 18],
  mmaj7: [0, 3, 7, 11],
});

const ROMAN = { I: 0, II: 2, III: 4, IV: 5, V: 7, VI: 9, VII: 11 };
export const ROMAN_PATTERN = /^[b#]?(?:VII|VI|IV|V|III|II|I)$/i;

/** 'ii' -> 2, 'bVII' -> 10, '#iv' -> 6 (semitones above the tonic). */
export function romanToSemitones(token) {
  if (!ROMAN_PATTERN.test(token)) throw new Error(`bad roman numeral "${token}"`);
  const accidental = token[0] === 'b' ? -1 : token[0] === '#' ? 1 : 0;
  const numeral = token.slice(accidental === 0 ? 0 : 1).toUpperCase();
  return (ROMAN[numeral] + accidental + 12) % 12;
}

const mod12 = (n) => ((n % 12) + 12) % 12;

/** Sorted unique pitch classes (0-11) of a chord. */
export function chordPitchClasses(rootPc, quality) {
  const intervals = CHORD_QUALITIES[quality];
  if (!intervals) throw new Error(`unknown chord quality "${quality}"`);
  return [...new Set(intervals.map((i) => mod12(rootPc + i)))];
}

/** All MIDI notes with pitch class `pc` inside [lo, hi]. */
function notesInRange(pc, lo, hi) {
  const out = [];
  for (let n = lo; n <= hi; n += 1) if (mod12(n) === pc) out.push(n);
  return out;
}

/**
 * Choose a voicing (sorted MIDI notes) for a chord, minimizing movement from `previous` so
 * consecutive chords glide instead of jumping (voice leading). With no `previous`, aim for the
 * middle of the register.
 *   rootless  leave the root to the bass (typical for jazz/lofi Rhodes voicings)
 *   max       maximum number of notes
 */
export function voiceChord(rootPc, quality, previous, { lo = 54, hi = 76, rootless = true, max = 4 } = {}) {
  let pcs = chordPitchClasses(rootPc, quality);
  if (rootless && pcs.length > 3) pcs = pcs.filter((pc) => pc !== mod12(rootPc));
  // keep the colour tones: prefer 3rd, 7th, then extensions over the 5th
  const intervals = CHORD_QUALITIES[quality];
  const priority = (pc) => {
    const interval = intervals.find((i) => mod12(rootPc + i) === pc) ?? 0;
    return interval === 7 ? 3 : interval === 0 ? 4 : 1;
  };
  pcs = [...pcs].sort((a, b) => priority(a) - priority(b)).slice(0, max);

  const options = pcs.map((pc) => notesInRange(pc, lo, hi));
  if (options.some((o) => o.length === 0)) return pcs.map((pc) => lo + mod12(pc - lo));

  const target = previous?.length ? previous : null;
  const center = (lo + hi) / 2;
  let best = null;
  let bestCost = Infinity;
  const pick = [];
  (function search(i) {
    if (i === options.length) {
      const sorted = [...pick].sort((a, b) => a - b);
      if (sorted[sorted.length - 1] - sorted[0] > 14) return; // keep the hand compact
      let cost;
      if (target) {
        cost = 0;
        const len = Math.max(sorted.length, target.length);
        for (let k = 0; k < len; k += 1) cost += Math.abs((sorted[k] ?? sorted[sorted.length - 1]) - (target[k] ?? target[target.length - 1]));
      } else {
        cost = sorted.reduce((s, n) => s + Math.abs(n - center), 0);
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = sorted;
      }
      return;
    }
    for (const note of options[i]) {
      pick[i] = note;
      search(i + 1);
    }
  }(0));
  return best ?? options.map((o) => o[0]).sort((a, b) => a - b);
}

/** All MIDI notes of a scale (rooted at tonic pitch class) inside [lo, hi], ascending. */
export function scaleNotes(tonicPc, scaleName, lo, hi) {
  const degrees = SCALES[scaleName];
  if (!degrees) throw new Error(`unknown scale "${scaleName}"`);
  const set = new Set(degrees.map((d) => mod12(tonicPc + d)));
  const out = [];
  for (let n = lo; n <= hi; n += 1) if (set.has(mod12(n))) out.push(n);
  return out;
}

/** Nearest note in `candidates` to `target` (candidates sorted ascending, non-empty). */
export function nearest(candidates, target) {
  let best = candidates[0];
  for (const c of candidates) if (Math.abs(c - target) < Math.abs(best - target)) best = c;
  return best;
}

/** MIDI note for a pitch class in the octave band [lo, lo + 12). */
export function pcInBand(pc, lo) {
  return lo + mod12(pc - lo);
}

export { mod12 };
