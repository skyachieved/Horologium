/*
 * Extension contracts: the strict manifest schema for every extension type.
 * PURE. This file is the single source of truth; docs/extension-api.md explains it for humans
 * and the templates/ folder holds a valid starting point for each type.
 *
 * Contracts for the generated-music pieces (station, category, layer, instrument, progression,
 * groove) are added in the "Stations" phase, when the composer defines what they need to say.
 */

import { ID_PATTERN, str, num, bool, arr, obj, rec, i18n, oneOf, opt } from '../schema.js';

export const API_VERSION = 1;

const VERSION = str({ pattern: /^\d+\.\d+\.\d+$/ });
const HEX = str({ pattern: /^#[0-9a-fA-F]{6}$/ });
const REL_PATH = str({ pattern: /^(?!\/)(?!.*\.\.)[\w./-]+$/, max: 120 });

/** Fields every manifest has. `type` is narrowed per contract. */
function common(type) {
  return {
    type: oneOf([type]),
    id: str({ pattern: ID_PATTERN, max: 40 }),
    apiVersion: num({ int: true, min: API_VERSION, max: API_VERSION }),
    name: i18n(),
    version: VERSION,
    license: str({ min: 2, max: 60 }),
    description: opt(i18n()),
  };
}

// ---------- theme ----------

/** CSS custom properties every theme's tokens.css must define (checked by the loader). */
export const REQUIRED_THEME_TOKENS = Object.freeze([
  '--bg', '--surface', '--surface-2', '--ink', '--ink-soft', '--line',
  '--accent', '--accent-ink', '--focus', '--break-short', '--break-long',
  '--water', '--water-deep', '--good', '--warn',
  '--radius', '--radius-sm', '--shadow',
  '--font-ui', '--font-display', '--font-mono',
  '--ease-pop', '--ease-soft', '--dur-fast', '--dur-med', '--dur-slow',
]);

export const MOTION_STYLES = Object.freeze(['bouncy', 'stepped', 'calm']);

export const THEME = obj({
  ...common('theme'),
  mode: oneOf(['light', 'dark']),
  motion: oneOf(MOTION_STYLES),
  tokens: REL_PATH,
  styles: REL_PATH,
  fonts: opt(arr(obj({ family: str({ min: 1, max: 60 }), file: REL_PATH, weight: opt(str({ max: 20 })) }), { max: 12 })),
  chimes: REL_PATH,
  // Artwork for the two main views. The shell sets CSS variables on the wrapper (--progress 0..1 for
  // the Pomodoro scene, --fill 0..1 for the hydration scene) and the theme's CSS reacts to them.
  scenes: obj({ pomodoro: REL_PATH, hydration: REL_PATH }),
  defaultCharacter: str({ pattern: ID_PATTERN }),
  preview: obj({ bg: HEX, accent: HEX }),
});

// ---------- chime set (theme/chimes.json) ----------

/** Sound events the app can play. A chime set must define every one. */
export const CHIME_EVENTS = Object.freeze(['focusEnd', 'breakEnd', 'drinkDue', 'drinkLogged', 'milestone', 'undo']);

const NOTE = obj({
  at: num({ min: 0, max: 5 }),
  freq: num({ min: 40, max: 4000 }),
  dur: num({ min: 0.02, max: 3 }),
  type: oneOf(['sine', 'triangle', 'square', 'sawtooth']),
  gain: num({ min: 0, max: 1 }),
});

export const CHIME_SET = obj(Object.fromEntries(CHIME_EVENTS.map((e) => [e, arr(NOTE, { min: 1, max: 12 })])));

// ---------- character ----------

export const CHARACTER = obj({
  ...common('character'),
  svg: REL_PATH,
  css: opt(REL_PATH),
  accent: HEX,
});

// ---------- music sources ----------

const TAB = obj({ order: num({ int: true, min: 0, max: 99 }), icon: str({ min: 1, max: 8 }) });
const CAPABILITIES = obj({ volume: bool(), mute: bool(), seek: bool(), playlist: bool() });
const HOST = str({ pattern: /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/, max: 80 });

export const MUSIC_SOURCE_KINDS = Object.freeze(['generated', 'files', 'web']);

/**
 * Web sources are DECLARATIVE ONLY. There is deliberately no field for script injection, request or
 * header rewriting, user-agent changes, or ad handling: the terms-of-service guardrails in AGENTS.md
 * are enforced structurally by this strict schema (unknown fields are rejected).
 */
export const MUSIC_SOURCE_WEB = obj({
  ...common('music-source'),
  kind: oneOf(['web']),
  tab: TAB,
  capabilities: CAPABILITIES,
  web: obj({
    sites: arr(obj({ id: str({ pattern: ID_PATTERN }), name: i18n(), url: str({ pattern: /^https:\/\/[^\s]+$/ }) }), { min: 1, max: 6 }),
    navAllow: arr(HOST, { min: 1, max: 40 }),
    partition: str({ pattern: /^persist:[a-z0-9-]+$/ }),
    miniPlayer: oneOf(['none', 'video-clip']),
    size: obj({ w: num({ int: true, min: 480, max: 1920 }), h: num({ int: true, min: 360, max: 1200 }) }),
    notice: opt(i18n()),
  }),
});

export const MUSIC_SOURCE_CODE = obj({
  ...common('music-source'),
  kind: oneOf(['generated', 'files']),
  tab: TAB,
  capabilities: CAPABILITIES,
  entry: REL_PATH,
});

// ---------- locale files ----------

export const LOCALE_META = obj({
  code: str({ pattern: /^[a-z]{2}(-[A-Z]{2})?$/ }),
  name: str({ min: 1, max: 40 }),
});
export const LOCALE_STRINGS = rec(str({ min: 1, max: 600 }));

// ---------- generated music: stations, layers, categories, library ----------
// The implementation of these (compose/, instruments/) lives in extensions/music-sources/generated;
// the contract lives here so the loader can validate without importing extension code. A test keeps
// the name lists below in sync with the implementation.

export const KEY_NAMES = Object.freeze(['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B']);
export const CHORD_QUALITY_NAMES = Object.freeze(['maj', 'min', 'maj7', 'm7', '7', '9', 'm9', 'maj9', '6', 'm6', '69', 'm7b5', 'dim7', 'sus4', '7sus4', 'add9', 'm11', '13', '7#9', '7b9', 'maj7#11', 'mmaj7']);
export const SCALE_NAMES = Object.freeze(['major', 'minor', 'dorian', 'mixolydian', 'lydian', 'phrygian', 'major-pent', 'minor-pent', 'blues']);
export const DRUM_VOICE_NAMES = Object.freeze(['kick', 'snare', 'hat', 'ohat', 'rim', 'clap', 'snap', 'brush', 'ride', 'shaker']);
export const VOICE_ROLES = Object.freeze(['chords', 'bass', 'drums', 'melody', 'pad']);
/** What a station `param` can drive. Each maps to a field the composer or mixer understands. */
export const PARAM_TARGETS = Object.freeze(['tempo', 'swing', 'lowpassHz', 'reverb', 'wobble', 'saturation', 'melodyDensity', 'drumLevel', 'bassLevel', 'chordLevel', 'melodyLevel']);
export const NOISE_COLORS = Object.freeze(['white', 'pink', 'brown']);
export const CUSTOM_CATEGORY = 'custom';

const ID = str({ pattern: ID_PATTERN, max: 40 });
const LEVEL = num({ min: 0, max: 1 });
const ROMAN = str({ pattern: /^[b#]?(?:VII|VI|IV|V|III|II|I)$/i });
const PATTERN = str({ pattern: /^(?:\s*[xXo._-]\s*){16}$/ }); // exactly 16 steps, spaces allowed anywhere

export const CATEGORY = obj({ id: ID, name: i18n(), order: num({ int: true, min: 0, max: 99 }) });
export const CATEGORIES_FILE = arr(CATEGORY, { min: 1, max: 24 });

export const LAYER_REF = obj({ id: ID, level: LEVEL });

const VOICE = obj({
  role: oneOf(VOICE_ROLES),
  instrument: ID,
  level: num({ min: 0, max: 1.5 }),
  style: opt(str({ max: 24 })),
  velocity: opt(LEVEL),
  strum: opt(num({ min: 0, max: 0.2 })),
  range: opt(arr(num({ int: true, min: 24, max: 108 }), { min: 2, max: 2 })),
  lo: opt(num({ int: true, min: 20, max: 60 })),
  rootless: opt(bool()),
  maxNotes: opt(num({ int: true, min: 2, max: 6 })),
  density: opt(LEVEL),
  scale: opt(oneOf(SCALE_NAMES)),
  pocket: opt(num({ min: 0, max: 0.05 })),
});

export const COMPOSER = obj({
  tempo: arr(num({ int: true, min: 40, max: 200 }), { min: 2, max: 2 }),
  swing: num({ min: 0.5, max: 0.75 }),
  barsPerPhrase: num({ int: true, min: 4, max: 16 }),
  keys: arr(oneOf(KEY_NAMES), { min: 1, max: 12 }),
  scales: opt(obj({ major: opt(oneOf(SCALE_NAMES)), minor: opt(oneOf(SCALE_NAMES)) })),
  progressions: arr(ID, { min: 1, max: 6 }),
  groove: ID,
  voices: arr(VOICE, { min: 1, max: 6 }),
  fx: obj({
    lowpassHz: num({ min: 500, max: 20000 }),
    reverb: LEVEL,
    wobble: LEVEL,
    saturation: LEVEL,
  }),
});

const PARAM = obj({
  id: ID,
  type: oneOf(['slider']),
  label: i18n(),
  min: num(),
  max: num(),
  step: num({ min: 0 }),
  default: num(),
  target: oneOf(PARAM_TARGETS),
});

export const STATION = obj({
  ...common('station'),
  category: ID,
  tags: opt(arr(str({ max: 20 }), { max: 6 })),
  gainDb: num({ min: -24, max: 6 }),
  composer: opt(COMPOSER),
  layers: arr(LAYER_REF, { max: 6 }),
  params: opt(arr(PARAM, { max: 8 })),
  presets: opt(arr(obj({ id: ID, name: i18n(), params: opt(rec(num())), layers: opt(arr(LAYER_REF, { max: 6 })) }), { max: 8 })),
});

export const LAYER = obj({
  ...common('layer'),
  kind: oneOf(['noise', 'dsp']),
  noise: opt(obj({ color: oneOf(NOISE_COLORS) })),
  entry: opt(REL_PATH),
  gainDb: num({ min: -24, max: 12 }),
});

export const PROGRESSION_BANK = obj({
  id: ID,
  type: oneOf(['progression-bank']),
  description: opt(str({ max: 200 })),
  progressions: arr(obj({
    name: str({ min: 1, max: 40 }),
    mode: oneOf(['major', 'minor']),
    chords: arr(obj({ r: ROMAN, q: oneOf(CHORD_QUALITY_NAMES), beats: opt(num({ int: true, min: 1, max: 16 })) }), { min: 1, max: 16 }),
  }), { min: 1, max: 24 }),
});

export const GROOVE = obj({
  id: ID,
  type: oneOf(['groove']),
  description: opt(str({ max: 200 })),
  patterns: rec(arr(PATTERN, { min: 1, max: 4 })),
  fills: opt(rec(arr(PATTERN, { min: 1, max: 2 }))),
});

// ---------- music packs (user-supplied audio, data only) ----------
// <userData>/extensions/music-packs/<id>/manifest.json plus audio files. v1 scans packs in the USER folder only (no
// redistributable audio ships with the repo). License and provenance are optional there: a pack without both still
// plays but is shown as "unverified". Track paths are relative, forward-slash, and cannot climb out of the pack.

export const MUSIC_PACK = obj({
  type: oneOf(['music-pack']),
  id: ID,
  apiVersion: num({ int: true, min: API_VERSION, max: API_VERSION }),
  name: i18n(),
  version: VERSION,
  license: opt(str({ min: 2, max: 80 })),
  provenance: opt(str({ min: 2, max: 240 })),
  tracks: arr(obj({ file: str({ pattern: /^(?!\/)(?![A-Za-z]:)(?!.*\.\.)(?!.*\\)[^\0]+\.[A-Za-z0-9]{2,5}$/, max: 200 }), title: opt(str({ min: 1, max: 120 })) }), { min: 1, max: 500 }),
});

// ---------- registry of contracts ----------

/** type -> schema (music-source is resolved by `kind`, see schemaFor). */
export const SCHEMAS = Object.freeze({
  theme: THEME,
  character: CHARACTER,
  station: STATION,
  layer: LAYER,
  'music-pack': MUSIC_PACK,
  'music-source:web': MUSIC_SOURCE_WEB,
  'music-source:generated': MUSIC_SOURCE_CODE,
  'music-source:files': MUSIC_SOURCE_CODE,
});

/** Pick the schema for a parsed manifest, or null if the type/kind is unknown. */
export function schemaFor(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  if (manifest.type === 'music-source') return SCHEMAS[`music-source:${manifest.kind}`] ?? null;
  return SCHEMAS[manifest.type] ?? null;
}
