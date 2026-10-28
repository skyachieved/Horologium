/*
 * Default persisted state + helpers to merge/repair it. PURE.
 * The renderer owns live state; the main process persists it as JSON in the user-data folder.
 */

import { DEFAULT_SETTINGS as POMODORO_DEFAULTS } from './pomodoro.js';

export const STATE_VERSION = 2;
/** left = towards the menu (menu <- icon <- hidden), right = towards hidden (wraps to the menu). See visibility.js. */
export const DEFAULT_HOTKEYS = Object.freeze({ left: 'CommandOrControl+Shift+1', right: 'CommandOrControl+Shift+2' });
/** @deprecated v1 had one show/hide key; kept so older imports keep working. */
export const DEFAULT_HOTKEY = DEFAULT_HOTKEYS.left;

export function defaultState(language = 'en') {
  return {
    v: STATE_VERSION,
    settings: {
      language,
      theme: 'sprout-garden',
      character: 'tomo',
      charScale: 1,
      reduceMotion: false,
      volume: { master: 0.8, chimes: 0.8, music: 0.7, muted: false },
      hotkeys: { ...DEFAULT_HOTKEYS },
      launchAtLogin: false,
      pomodoro: { ...POMODORO_DEFAULTS },
      hydration: { remindersOn: true, syncBreaks: true, units: 'metric' },
      music: { followPomodoro: false, crossfadeSec: 2 },
      updates: { check: true }, // ask GitHub for new releases (Settings > System; hard rule 5)
    },
    pomo: { state: null },
    hydration: {
      profile: null,        // { sex, age, heightCm, weightKg, exerciseIntensity, exerciseMin, cupMl }
      profileDraft: null,   // what was typed into the form but not saved yet (remembered across restarts)
      location: null,       // { name, latitude, longitude }
      climateOverride: null, // null (automatic) | 'temperate' | 'warm' | 'hot'
      weather: null,        // { tempC, humidityPct, fetchedAt }
      days: {},             // 'YYYY-MM-DD' -> { startedAt, drinks: [ms...] }
      lastNotifiedAt: null,
    },
    music: {
      source: 'generated', // the music sub-tab last used
      station: null,
      category: null,
      seed: null,
      playing: false,
      perStation: {},      // stationId -> { preset, params: {id: value}, layers: {id: level} }
      folders: {},         // My music: folderId -> { path, name } (chosen with the folder picker)
      files: { source: null, track: null, shuffle: false }, // My music: current folder/pack id and track
    },
    window: { x: null, y: null, mini: { x: null, y: null } },
    updates: { notifiedVersion: null }, // the OS notification is shown once per version
    ui: { tab: 'pomodoro', onboarded: false, newsSeen: null }, // newsSeen: the version News was last opened on
  };
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Deep-merge `patch` into `target` (mutating and returning target). Plain objects merge, arrays and
 * primitives replace, and `null` deletes a key (that is how old days get pruned).
 */
export function deepMerge(target, patch) {
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) delete target[key];
    else if (isPlainObject(value) && isPlainObject(target[key])) deepMerge(target[key], value);
    else target[key] = isPlainObject(value) ? deepMerge({}, value) : value;
  }
  return target;
}

/**
 * Overlay whatever was saved on top of fresh defaults so new settings appear after an upgrade and a
 * corrupt or partial file never crashes startup. Unknown top-level keys are dropped.
 */
export function repairState(saved, language = 'en') {
  const base = defaultState(language);
  if (!isPlainObject(saved)) return base;
  const copy = JSON.parse(JSON.stringify(saved));
  // v1 -> v2: the single show/hide key becomes the "left" key (towards the menu); "right" gets its default.
  const oldKeys = copy.settings?.hotkeys;
  if (oldKeys && typeof oldKeys.toggle === 'string') {
    if (typeof oldKeys.left !== 'string') oldKeys.left = oldKeys.toggle;
    delete oldKeys.toggle;
  }
  const merged = deepMerge(base, copy);
  for (const key of Object.keys(merged)) if (!(key in defaultState(language))) delete merged[key];
  for (const key of Object.keys(merged.settings.hotkeys)) if (!(key in DEFAULT_HOTKEYS)) delete merged.settings.hotkeys[key];
  merged.v = STATE_VERSION;
  return merged;
}

/** Keep only the most recent `keep` day records so the file does not grow forever. */
export function pruneDays(days, keep = 14) {
  const keys = Object.keys(days).sort();
  return Object.fromEntries(keys.slice(-keep).map((k) => [k, days[k]]));
}
