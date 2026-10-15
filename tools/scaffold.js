/*
 * Scaffolding logic for `npm run new -- <type> <id>`. Importable so tests can prove the templates
 * stay valid (a template that no longer passes the loader is a bug).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ID_PATTERN } from '../src/core/schema.js';
import { CUSTOM_CATEGORY, VOICE_ROLES, NOISE_COLORS } from '../src/core/contracts/index.js';

export const TYPES = ['theme', 'character', 'web-source', 'locale', 'station', 'category', 'layer', 'instrument', 'progression', 'groove'];
/** The types that live inside extensions/music-sources/generated (the Stations source). */
const GENERATED = ['station', 'category', 'layer', 'instrument', 'progression', 'groove'];

/** One line, single spaces, no control characters: names end up inside JSON strings and code comments. */
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f\s]+/g, ' ').trim();

/** Fill __VAR__ placeholders. JSON files get JSON-escaped values; code files cannot be broken out of a comment. */
function fill(text, vars, file) {
  const isJson = file.endsWith('.json');
  let out = text;
  for (const [k, v] of Object.entries(vars)) {
    const safe = isJson ? JSON.stringify(String(v)).slice(1, -1) : String(v).replace(/\*\//g, '* /');
    out = out.split(`__${k}__`).join(safe);
  }
  return out;
}

function copyFile(src, dest, vars) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, fill(fs.readFileSync(src, 'utf8'), vars, dest));
}

function copyTemplate(srcDir, destDir, vars) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) copyTemplate(src, dest, vars);
    else copyFile(src, dest, vars);
  }
}

const refuseExisting = (target) => {
  if (fs.existsSync(target)) throw new Error(`${target} already exists.`);
};

/** Types that need Stations-specific options. Returns { created, hint }. */
function scaffoldGenerated({ type, id, vars, category, role, kind, color, user, extensionsRoot, userRoot, templatesRoot }) {
  const gen = path.join(extensionsRoot, 'music-sources', 'generated');
  if (!fs.existsSync(path.join(gen, 'manifest.json'))) throw new Error('The Stations music source (extensions/music-sources/generated) is not installed.');
  const tpl = (...parts) => path.join(templatesRoot, ...parts);
  const categoriesFile = path.join(gen, 'categories.json');
  const readCategories = () => JSON.parse(fs.readFileSync(categoriesFile, 'utf8'));

  if (type === 'category') {
    if (id === CUSTOM_CATEGORY) throw new Error(`"${CUSTOM_CATEGORY}" is built in (it is the My Stations genre).`);
    const list = readCategories();
    if (list.some((c) => c.id === id)) throw new Error(`Category "${id}" already exists in categories.json.`);
    const order = Math.min(99, Math.max(0, ...list.map((c) => c.order)) + 1);
    list.push({ id, name: { en: vars.NAME_EN, ko: vars.NAME_KO }, order });
    fs.writeFileSync(categoriesFile, `${JSON.stringify(list, null, 2)}\n`);
    return {
      created: categoriesFile,
      hint: `Added "${id}" at the end of the genre chips. A genre needs at least one station (\`npm test\` enforces it): \`npm run new -- station <id> --category ${id}\`.`,
    };
  }

  if (type === 'station') {
    const known = readCategories().map((c) => c.id);
    let chosen = category;
    if (user) chosen = CUSTOM_CATEGORY; // user stations are data only and always live under My Stations
    else if (!chosen) throw new Error(`A station needs --category <id>. Existing: ${[...known, CUSTOM_CATEGORY].join(', ')}.`);
    else if (chosen !== CUSTOM_CATEGORY && !known.includes(chosen)) {
      throw new Error(`Category "${chosen}" does not exist. Existing: ${[...known, CUSTOM_CATEGORY].join(', ')}. Create it first with \`npm run new -- category ${chosen}\`.`);
    }
    if (fs.existsSync(path.join(gen, 'stations', id))) throw new Error(`A bundled station "${id}" already exists; station ids are unique.`);
    if (user && !userRoot) throw new Error('No user extensions folder to write into.');
    const target = user ? path.join(userRoot, 'stations', id) : path.join(gen, 'stations', id);
    refuseExisting(target);
    copyTemplate(tpl('station'), target, { ...vars, CATEGORY: chosen });
    return {
      created: target,
      hint: user
        ? 'Edit manifest.json (it can only reference the bundled progressions, grooves, instruments and layers), then restart the app: it appears under My Stations.'
        : 'Edit manifest.json, run `npm run validate` and `npm test`, then `npm run test:audio -- --calibrate` and copy the suggested gainDb so it matches the other stations. Listen in the app.',
    };
  }

  if (type === 'layer') {
    const layerKind = kind ?? 'dsp';
    if (!['dsp', 'noise'].includes(layerKind)) throw new Error('--kind must be "dsp" (a code layer) or "noise" (white, pink or brown).');
    const noiseColor = color ?? 'pink';
    if (layerKind === 'noise' && !NOISE_COLORS.includes(noiseColor)) throw new Error(`--color must be one of: ${NOISE_COLORS.join(', ')}.`);
    const target = path.join(gen, 'layers', id);
    refuseExisting(target);
    copyTemplate(tpl(layerKind === 'dsp' ? 'layer-dsp' : 'layer-noise'), target, { ...vars, COLOR: noiseColor });
    return {
      created: target,
      hint: layerKind === 'dsp'
        ? 'Replace generate() in index.js with your sound (seamless loop, pure code), then `npm test` and `npm run test:audio -- --calibrate`. Reference it from a station\'s "layers".'
        : 'A noise layer needs no code. Reference it from a station\'s "layers".',
    };
  }

  if (type === 'instrument') {
    const voiceRole = role ?? 'chords';
    if (!VOICE_ROLES.includes(voiceRole)) throw new Error(`--role must be one of: ${VOICE_ROLES.join(', ')}.`);
    const target = path.join(gen, 'instruments', `${id}.js`);
    refuseExisting(target);
    copyFile(tpl('instrument', voiceRole === 'drums' ? 'kit.js' : 'melodic.js'), target, { ...vars, ROLE: voiceRole });
    return { created: target, hint: `Edit create() to shape the sound, then use it in a station voice: { "role": "${voiceRole}", "instrument": "${id}", "level": 1 }.` };
  }

  // progression bank or groove: one JSON file in library/, referenced by id from a station's composer
  const dir = type === 'progression' ? 'progressions' : 'grooves';
  const target = path.join(gen, 'library', dir, `${id}.json`);
  refuseExisting(target);
  copyFile(tpl('library', `${type}.json`), target, vars);
  return {
    created: target,
    hint: type === 'progression'
      ? `Edit the chords, then list "${id}" in a station's composer.progressions.`
      : `Edit the 16-step patterns (x = hit, o = ghost, - = rest), then set "${id}" as a station's composer.groove.`,
  };
}

/**
 * @returns {{created: string, hint: string}}
 * Throws Error with a helpful message on bad input or if the target already exists.
 */
export function scaffold({ type, id, theme, nameEn, nameKo, category, role, kind, color, user = false, extensionsRoot, userRoot, templatesRoot }) {
  if (!TYPES.includes(type)) throw new Error(`Unknown type "${type}". Types: ${TYPES.join(', ')}`);
  if (type === 'locale') {
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(id ?? '')) throw new Error('A locale id must be a language code like "fr" or "pt-BR".');
  } else if (!ID_PATTERN.test(id ?? '')) {
    throw new Error('An id must be lowercase kebab-case, e.g. "rainy-night".');
  }

  const vars = {
    ID: id,
    NAME_EN: cleanName(nameEn) || id,
    NAME_KO: cleanName(nameKo) || cleanName(nameEn) || id,
    THEME: theme || '',
  };

  if (GENERATED.includes(type)) {
    return scaffoldGenerated({ type, id, vars, category, role, kind, color, user, extensionsRoot, userRoot, templatesRoot });
  }

  if (type === 'locale') {
    const target = path.join(extensionsRoot, 'locales', `${id}.json`);
    if (fs.existsSync(target)) throw new Error(`${target} already exists.`);
    const en = JSON.parse(fs.readFileSync(path.join(extensionsRoot, 'locales', 'en.json'), 'utf8'));
    const { _meta: _ignored, ...strings } = en;
    const out = { _meta: { code: id, name: vars.NAME_EN }, ...strings };
    fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
    return { created: target, hint: 'Translate the values (keep the keys), then run `npm run validate`.' };
  }

  let target;
  if (type === 'theme') target = path.join(extensionsRoot, 'themes', id);
  else if (type === 'web-source') target = path.join(extensionsRoot, 'music-sources', id);
  else {
    if (!theme) throw new Error('A character needs --theme <theme-id> (the theme whose art style it belongs to).');
    if (!fs.existsSync(path.join(extensionsRoot, 'themes', theme, 'manifest.json'))) throw new Error(`Theme "${theme}" does not exist.`);
    target = path.join(extensionsRoot, 'themes', theme, 'characters', id);
  }
  refuseExisting(target);

  copyTemplate(path.join(templatesRoot, type), target, vars);
  const hints = {
    theme: 'Edit tokens.css / theme.css, draw the starter character, then run `npm run validate`.',
    character: 'Replace character.svg with your art (keep the viewBox and data-part names), then run `npm run validate`.',
    'web-source': 'Read the terms of service for the site first (see AGENTS.md guardrails), set url and navAllow, then run `npm run validate`.',
  };
  return { created: target, hint: hints[type] };
}
