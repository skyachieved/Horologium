/*
 * Songs, not an endless run of unrelated 8-bar phrases. PURE.
 *
 * Owner's note 13: "the music is monotone, it all starts in similar ways". Every phrase used to pick a fresh
 * random progression with the full band on beat one, so nothing ever had a hook, a build or a breather. Now the
 * stream is a sequence of songs. Each song has a form (intro, A, B, break...), one chord loop for its A sections
 * and another for B, a melody motif (rhythm) shared by its sections, and an intro style that suits the station's
 * instruments. Each new song picks a new form, intro, loops and key, so a long session keeps moving while every
 * song still sounds like a song. Everything is generated: nothing to license.
 */
import { compose, progressionChoices, INTRO_TYPES } from './compose.js';
import { createRng } from './rng.js';

/** Song forms. Each starts with an intro; 'break' drops drums and bass. */
export const FORMS = Object.freeze([
  Object.freeze(['intro', 'A', 'A', 'B', 'A', 'break', 'B', 'A']),
  Object.freeze(['intro', 'A', 'B', 'A', 'break', 'A', 'B']),
  Object.freeze(['intro', 'A', 'A', 'break', 'B', 'A', 'A']),
  Object.freeze(['intro', 'A', 'B', 'B', 'A', 'break', 'A']),
]);

/** Intro styles this station can actually play: no "beat" intro without drums, and so on. */
export function introTypesFor(composer) {
  const roles = new Set(composer.voices.map((v) => v.role));
  const harmony = roles.has('chords') || roles.has('pad');
  return INTRO_TYPES.filter((type) => {
    if (type === 'keys') return harmony;
    if (type === 'beat') return roles.has('drums');
    if (type === 'melody') return harmony && roles.has('melody');
    return true; // 'thin'
  });
}

/**
 * @param {{composer: object, library: object, seed: string, key?: string|null}} args
 * @returns {{form: string[], intro: string, progA: number, progB: number, key: string}}
 */
export function planSong({ composer, library, seed, key = null }) {
  const rng = createRng(String(seed));
  const form = rng.pick(FORMS);
  const intro = rng.pick(introTypesFor(composer));
  const count = progressionChoices(composer, library).length;
  const progA = rng.int(0, count - 1);
  let progB = rng.int(0, count - 1);
  if (count > 1 && progB === progA) progB = (progA + 1 + rng.int(0, count - 2)) % count; // B always contrasts
  const songKey = key && composer.keys.includes(key) ? key : rng.pick(composer.keys);
  return { form: [...form], intro, progA, progB, key: songKey };
}

/**
 * An endless, deterministic stream of phrases for one station and seed. `next()` returns the next Plan plus where
 * it sits ({ song, section }). The first song keeps `overrides.key` (the session's key); later songs choose their
 * own. `skipIntro` starts the first song at its first A section (used when a slider change restarts a station).
 */
export function createSongStream({ composer, library, seed, overrides = {}, skipIntro = false }) {
  let songNo = -1;
  let song = null;
  let pos = 0;
  let phrase = 0;
  return {
    next() {
      if (!song || pos >= song.form.length) {
        songNo += 1;
        song = planSong({ composer, library, seed: `${seed}:song${songNo}`, key: songNo === 0 ? overrides.key ?? null : null });
        pos = skipIntro && songNo === 0 && song.form[0] === 'intro' ? 1 : 0;
      }
      const section = song.form[pos];
      pos += 1;
      const plan = compose({
        composer,
        library,
        seed: `${seed}:${phrase}`,
        overrides: { ...overrides, key: song.key },
        arrangement: { section, intro: song.intro, progression: section === 'B' ? song.progB : song.progA, motifSeed: `${seed}:song${songNo}` },
      });
      phrase += 1;
      return { plan, song: songNo, section, intro: song.intro };
    },
  };
}
