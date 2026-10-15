/*
 * Extension loader: scans the bundled `extensions/` folder (and, for data-only types, the user's
 * folder), validates every manifest against the strict contracts, and builds the registry that the
 * renderer consumes.
 *
 * Node-side but deliberately imports NOTHING from Electron, so the same code powers the app,
 * `npm run validate`, and the unit tests.
 *
 * Rule: a broken extension never breaks the app. Problems are collected, the offending extension is
 * skipped, and everything else still loads. The problem list is shown in Settings > System.
 */

import fs from 'node:fs';
import path from 'node:path';
import { validate, formatErrors } from '../core/schema.js';
import {
  schemaFor, REQUIRED_THEME_TOKENS, CHIME_SET, LOCALE_META, LOCALE_STRINGS,
  CATEGORIES_FILE, PROGRESSION_BANK, GROOVE, CUSTOM_CATEGORY,
} from '../core/contracts/index.js';
import { isAudioFile } from './media-scan.js';
import { ID_PATTERN } from '../core/schema.js';
import { checkSvgSafety } from '../core/svg.js';

/** Which extension types each origin may provide. User-installed content is data-only in v1. */
const ORIGIN_RULES = {
  bundled: ['themes', 'music-sources', 'locales'],
  user: ['locales', 'stations', 'music-packs'], // data only: station JSON, translations, audio packs
};

const posix = (...parts) => path.posix.join(...parts);

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

function readJson(file) {
  return JSON.parse(readText(file));
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

function listFiles(dir, ext) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith(ext)).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

/** Compare a locale against the English base. Returns { missing, extra } key lists. */
export function compareLocales(base, other) {
  const b = new Set(Object.keys(base).filter((k) => k !== '_meta'));
  const o = new Set(Object.keys(other).filter((k) => k !== '_meta'));
  return {
    missing: [...b].filter((k) => !o.has(k)).sort(),
    extra: [...o].filter((k) => !b.has(k)).sort(),
  };
}

/**
 * @param {{bundledRoot: string, userRoot?: string|null}} opts
 * @returns {{registry: {themes: object[], musicSources: object[], locales: Record<string, object>}, problems: object[]}}
 */
export function loadExtensions({ bundledRoot, userRoot = null }) {
  const registry = { themes: [], musicSources: [], locales: {}, generated: null, musicPacks: [] };
  const problems = [];

  const report = (origin, file, id, errors) => problems.push({ origin, file, id: id ?? null, errors });

  /** Read + validate one manifest; returns the manifest or null (problem recorded). */
  function loadManifest(origin, root, relDir, expectedId) {
    const rel = posix(relDir, 'manifest.json');
    let manifest;
    try {
      manifest = readJson(path.join(root, ...rel.split('/')));
    } catch (err) {
      report(origin, rel, expectedId, [`cannot read manifest.json: ${err.message}`]);
      return null;
    }
    const schema = schemaFor(manifest);
    if (!schema) {
      report(origin, rel, expectedId, [`unknown extension type "${manifest?.type}"${manifest?.kind ? ` (kind "${manifest.kind}")` : ''}`]);
      return null;
    }
    const errors = formatErrors(validate(schema, manifest));
    if (manifest.id !== expectedId) errors.push(`id "${manifest.id}" must equal its folder name "${expectedId}"`);
    if (errors.length) {
      report(origin, rel, manifest.id ?? expectedId, errors);
      return null;
    }
    return manifest;
  }

  const fileExists = (root, rel) => fs.existsSync(path.join(root, ...rel.split('/')));

  // ---------- themes (+ nested characters) ----------
  function loadThemes(origin, root) {
    const seen = new Set();
    for (const dir of listDirs(path.join(root, 'themes'))) {
      const base = posix('themes', dir);
      const manifest = loadManifest(origin, root, base, dir);
      if (!manifest) continue;
      const errors = [];
      if (seen.has(manifest.id)) errors.push('duplicate theme id');

      for (const key of ['tokens', 'styles', 'chimes']) {
        if (!fileExists(root, posix(base, manifest[key]))) errors.push(`${key} file "${manifest[key]}" does not exist`);
      }
      for (const font of manifest.fonts ?? []) {
        if (!fileExists(root, posix(base, font.file))) errors.push(`font file "${font.file}" does not exist`);
      }
      for (const [scene, rel] of Object.entries(manifest.scenes)) {
        if (!fileExists(root, posix(base, rel))) errors.push(`scenes.${scene} file "${rel}" does not exist`);
        else errors.push(...checkSvgSafety(readText(path.join(root, ...posix(base, rel).split('/')))).map((p) => `${rel}: ${p}`));
      }

      if (!errors.length) {
        const tokens = readText(path.join(root, ...posix(base, manifest.tokens).split('/')));
        const missing = REQUIRED_THEME_TOKENS.filter((t) => !new RegExp(`${t}\\s*:`).test(tokens));
        if (missing.length) errors.push(`${manifest.tokens} is missing required tokens: ${missing.join(', ')}`);
        try {
          const chimes = readJson(path.join(root, ...posix(base, manifest.chimes).split('/')));
          errors.push(...formatErrors(validate(CHIME_SET, chimes)).map((e) => `${manifest.chimes}: ${e}`));
        } catch (err) {
          errors.push(`${manifest.chimes}: ${err.message}`);
        }
      }

      const characters = [];
      const charIds = new Set();
      for (const cdir of listDirs(path.join(root, 'themes', dir, 'characters'))) {
        const cbase = posix(base, 'characters', cdir);
        const c = loadManifest(origin, root, cbase, cdir);
        if (!c) continue;
        const cerrors = [];
        if (charIds.has(c.id)) cerrors.push('duplicate character id in this theme');
        if (!fileExists(root, posix(cbase, c.svg))) cerrors.push(`svg file "${c.svg}" does not exist`);
        else cerrors.push(...checkSvgSafety(readText(path.join(root, ...posix(cbase, c.svg).split('/')))).map((p) => `${c.svg}: ${p}`));
        if (c.css && !fileExists(root, posix(cbase, c.css))) cerrors.push(`css file "${c.css}" does not exist`);
        if (cerrors.length) {
          report(origin, posix(cbase, 'manifest.json'), c.id, cerrors);
          continue;
        }
        charIds.add(c.id);
        characters.push({ ...c, origin, base: cbase, theme: manifest.id });
      }

      if (characters.length === 0) errors.push('a theme needs at least one valid character');
      else if (!charIds.has(manifest.defaultCharacter)) errors.push(`defaultCharacter "${manifest.defaultCharacter}" is not one of: ${[...charIds].join(', ')}`);

      if (errors.length) {
        report(origin, posix(base, 'manifest.json'), manifest.id, errors);
        continue;
      }
      seen.add(manifest.id);
      registry.themes.push({ ...manifest, origin, base, characters });
    }
  }

  // ---------- music sources ----------
  function loadMusicSources(origin, root) {
    const seen = new Set();
    for (const dir of listDirs(path.join(root, 'music-sources'))) {
      const base = posix('music-sources', dir);
      const manifest = loadManifest(origin, root, base, dir);
      if (!manifest) continue;
      const errors = [];
      if (seen.has(manifest.id)) errors.push('duplicate music-source id');
      if (manifest.kind !== 'web' && !fileExists(root, posix(base, manifest.entry))) errors.push(`entry file "${manifest.entry}" does not exist`);
      if (errors.length) {
        report(origin, posix(base, 'manifest.json'), manifest.id, errors);
        continue;
      }
      seen.add(manifest.id);
      registry.musicSources.push({ ...manifest, origin, base });
      if (manifest.kind === 'generated') loadGenerated(origin, root, base, manifest);
    }
    registry.musicSources.sort((a, b) => a.tab.order - b.tab.order || a.id.localeCompare(b.id));
  }

  // ---------- generated music (stations, layers, categories, instruments, library) ----------
  const abs = (root, rel) => path.join(root, ...rel.split('/'));

  /** Problems with a station's references and parameters, given the registry it must resolve against. */
  function checkStation(st, gen) {
    const errors = [];
    const categoryIds = new Set([...gen.categories.map((c) => c.id), CUSTOM_CATEGORY]);
    if (!categoryIds.has(st.category)) errors.push(`category "${st.category}" does not exist (see categories.json)`);
    const layerIds = new Set(gen.layers.map((l) => l.id));
    const checkLayers = (refs, where) => {
      for (const ref of refs ?? []) if (!layerIds.has(ref.id)) errors.push(`${where}: layer "${ref.id}" does not exist`);
    };
    checkLayers(st.layers, 'layers');
    if (!st.composer && (st.layers ?? []).length === 0) errors.push('a station without a composer needs at least one layer');
    if (st.composer) {
      const c = st.composer;
      if (c.tempo[0] > c.tempo[1]) errors.push('composer.tempo must be [slowest, fastest]');
      for (const bank of c.progressions) if (!gen.progressionBanks[bank]) errors.push(`composer.progressions: bank "${bank}" does not exist`);
      if (!gen.grooves[c.groove]) errors.push(`composer.groove: groove "${c.groove}" does not exist`);
      c.voices.forEach((v, i) => {
        if (!gen.instruments.includes(v.instrument)) errors.push(`composer.voices[${i}]: instrument "${v.instrument}" does not exist`);
      });
      const drums = c.voices.some((v) => v.role === 'drums');
      const groove = gen.grooves[c.groove];
      if (drums && groove && !Object.keys(groove.patterns).some((n) => !['bass', 'comp'].includes(n))) errors.push(`groove "${c.groove}" has no drum patterns`);
    }
    const params = st.params ?? [];
    const paramIds = new Set();
    for (const p of params) {
      if (paramIds.has(p.id)) errors.push(`params: duplicate id "${p.id}"`);
      paramIds.add(p.id);
      if (!(p.min < p.max)) errors.push(`params.${p.id}: min must be below max`);
      if (p.default < p.min || p.default > p.max) errors.push(`params.${p.id}: default is outside min..max`);
      if (!st.composer && !['lowpassHz', 'reverb'].includes(p.target)) errors.push(`params.${p.id}: target "${p.target}" needs a composer`);
    }
    const presetIds = new Set();
    for (const pr of st.presets ?? []) {
      if (presetIds.has(pr.id)) errors.push(`presets: duplicate id "${pr.id}"`);
      presetIds.add(pr.id);
      for (const [pid, value] of Object.entries(pr.params ?? {})) {
        const def = params.find((p) => p.id === pid);
        if (!def) errors.push(`presets.${pr.id}: sets undeclared param "${pid}"`);
        else if (value < def.min || value > def.max) errors.push(`presets.${pr.id}.${pid}: ${value} is outside ${def.min}..${def.max}`);
      }
      checkLayers(pr.layers, `presets.${pr.id}.layers`);
    }
    return errors;
  }

  function loadStationDir(origin, root, base, gen, { requireCustom }) {
    const stations = [];
    for (const dir of listDirs(abs(root, base))) {
      const rel = posix(base, dir);
      const st = loadManifest(origin, root, rel, dir);
      if (!st) continue;
      const errors = checkStation(st, gen);
      if (requireCustom && st.category !== CUSTOM_CATEGORY) errors.push(`user stations must use category "${CUSTOM_CATEGORY}" (My Stations)`);
      if (gen.stations.some((x) => x.id === st.id) || stations.some((x) => x.id === st.id)) errors.push('duplicate station id');
      if (errors.length) {
        report(origin, posix(rel, 'manifest.json'), st.id, errors);
        continue;
      }
      stations.push({ ...st, origin, base: rel });
    }
    return stations;
  }

  function loadGenerated(origin, root, base, source) {
    const gen = { sourceId: source.id, origin, base, categories: [], stations: [], layers: [], instruments: [], progressionBanks: {}, grooves: {} };

    // categories
    const catRel = posix(base, 'categories.json');
    try {
      const data = readJson(abs(root, catRel));
      const errors = formatErrors(validate(CATEGORIES_FILE, data));
      const ids = data.map((c) => c.id);
      if (new Set(ids).size !== ids.length) errors.push('duplicate category id');
      if (ids.includes(CUSTOM_CATEGORY)) errors.push(`"${CUSTOM_CATEGORY}" is built in; do not declare it`);
      if (errors.length) report(origin, catRel, 'categories', errors);
      else gen.categories = [...data].sort((a, b) => a.order - b.order);
    } catch (err) {
      report(origin, catRel, 'categories', [`cannot read categories.json: ${err.message}`]);
    }

    // layers
    for (const dir of listDirs(abs(root, posix(base, 'layers')))) {
      const rel = posix(base, 'layers', dir);
      const layer = loadManifest(origin, root, rel, dir);
      if (!layer) continue;
      const errors = [];
      if (layer.kind === 'noise' && !layer.noise) errors.push('kind "noise" needs a noise.color');
      if (layer.kind === 'dsp') {
        if (!layer.entry) errors.push('kind "dsp" needs an entry file');
        else if (!fileExists(root, posix(rel, layer.entry))) errors.push(`entry file "${layer.entry}" does not exist`);
      }
      if (errors.length) report(origin, posix(rel, 'manifest.json'), layer.id, errors);
      else gen.layers.push({ ...layer, origin, base: rel });
    }

    // instruments: one .js file each; the file name is the id
    for (const file of listFiles(abs(root, posix(base, 'instruments')), '.js')) {
      const id = file.replace(/\.js$/, '');
      if (!ID_PATTERN.test(id)) report(origin, posix(base, 'instruments', file), id, ['instrument file names must be lowercase kebab-case']);
      else gen.instruments.push(id);
    }

    // library: progression banks and grooves (JSON, id = file name)
    for (const [dirName, schema, target, label] of [['progressions', PROGRESSION_BANK, gen.progressionBanks, 'progression bank'], ['grooves', GROOVE, gen.grooves, 'groove']]) {
      for (const file of listFiles(abs(root, posix(base, 'library', dirName)), '.json')) {
        const rel = posix(base, 'library', dirName, file);
        const id = file.replace(/\.json$/, '');
        try {
          const data = readJson(abs(root, rel));
          const errors = formatErrors(validate(schema, data));
          if (data.id !== id) errors.push(`id "${data.id}" must equal the file name "${id}"`);
          if (errors.length) report(origin, rel, id, errors);
          else target[id] = data;
        } catch (err) {
          report(origin, rel, id, [`cannot read ${label}: ${err.message}`]);
        }
      }
    }

    gen.stations = loadStationDir(origin, root, posix(base, 'stations'), gen, { requireCustom: false });
    registry.generated = gen;
  }

  /** User stations: data-only JSON that reference bundled building blocks. */
  function loadUserStations(origin, root) {
    const gen = registry.generated;
    if (!gen) return;
    gen.stations.push(...loadStationDir(origin, root, 'stations', gen, { requireCustom: true }));
  }

  // ---------- music packs (user-supplied audio; license and provenance are advisory) ----------
  function loadMusicPacks(origin, root) {
    const MAX_BYTES = 400 * 1024 * 1024;
    for (const dir of listDirs(path.join(root, 'music-packs'))) {
      const base = posix('music-packs', dir);
      const pack = loadManifest(origin, root, base, dir);
      if (!pack) continue;
      const errors = [];
      if (registry.musicPacks.some((p) => p.id === pack.id)) errors.push('duplicate music-pack id');
      for (const track of pack.tracks) {
        const rel = posix(base, track.file);
        if (!isAudioFile(track.file)) errors.push(`${track.file}: not a supported audio type`);
        else if (!fileExists(root, rel)) errors.push(`${track.file}: file does not exist`);
        else if (fs.statSync(abs(root, rel)).size > MAX_BYTES) errors.push(`${track.file}: larger than 400 MB`);
      }
      if (errors.length) {
        report(origin, posix(base, 'manifest.json'), pack.id, errors);
        continue;
      }
      registry.musicPacks.push({ ...pack, origin, base, verified: Boolean(pack.license && pack.provenance) });
    }
  }

  // ---------- locales ----------
  function loadLocales(origin, root) {
    for (const file of listFiles(path.join(root, 'locales'), '.json')) {
      const rel = posix('locales', file);
      const code = file.replace(/\.json$/, '');
      let data;
      try {
        data = readJson(path.join(root, 'locales', file));
      } catch (err) {
        report(origin, rel, code, [`cannot read locale: ${err.message}`]);
        continue;
      }
      const { _meta: meta, ...strings } = data ?? {};
      const errors = [
        ...formatErrors(validate(LOCALE_META, meta ?? null, '_meta')),
        ...formatErrors(validate(LOCALE_STRINGS, strings)),
      ];
      if (meta?.code && meta.code !== code) errors.push(`_meta.code "${meta.code}" must equal the file name "${code}"`);
      if (errors.length) {
        report(origin, rel, code, errors);
        continue;
      }
      if (registry.locales[code]) {
        report(origin, rel, code, ['duplicate locale code']);
        continue;
      }
      registry.locales[code] = { meta, strings, origin };
    }
  }

  const loaders = { themes: loadThemes, 'music-sources': loadMusicSources, locales: loadLocales, stations: loadUserStations, 'music-packs': loadMusicPacks };
  const roots = [['bundled', bundledRoot], ['user', userRoot]];
  for (const [origin, root] of roots) {
    if (!root) continue;
    for (const type of ORIGIN_RULES[origin]) loaders[type](origin, root);
  }

  // A locale that drifts from English is reported (the unit tests make it a hard failure).
  const en = registry.locales.en;
  if (en) {
    for (const [code, loc] of Object.entries(registry.locales)) {
      if (code === 'en') continue;
      const { missing, extra } = compareLocales(en.strings, loc.strings);
      if (missing.length || extra.length) {
        report(loc.origin, posix('locales', `${code}.json`), code, [
          ...(missing.length ? [`missing ${missing.length} key(s) present in en: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}`] : []),
          ...(extra.length ? [`${extra.length} key(s) not in en: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ', ...' : ''}`] : []),
        ]);
      }
    }
  }

  return { registry, problems };
}
