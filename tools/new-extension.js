#!/usr/bin/env node
/*
 * `npm run new -- <type> <id> [options]`
 *
 *   theme <id>                              a theme with a starter character
 *   character <id> --theme <theme-id>       a character inside an existing theme
 *   web-source <id>                         a website tab for the Music tab (read AGENTS.md > guardrails first)
 *   locale <code>                           a translation, pre-filled with the English strings
 *   station <id> --category <genre-id>      a Stations station (JSON only); add --user to make a personal
 *                                           station in your own extensions folder instead (My Stations)
 *   category <id>                           a new genre chip for Stations
 *   layer <id> [--kind dsp|noise] [--color white|pink|brown]
 *   instrument <id> [--role chords|bass|drums|melody|pad]
 *   progression <id>                        a bank of chord loops
 *   groove <id>                             a drum/bass rhythm grid
 *
 * Options for any type: --name "English name" --ko "한국어 이름"
 */
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffold, TYPES } from './scaffold.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOLEAN_FLAGS = new Set(['user']);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) positional.push(argv[i]);
    else if (BOOLEAN_FLAGS.has(argv[i].slice(2))) flags[argv[i].slice(2)] = true;
    else flags[argv[i].slice(2)] = argv[++i];
  }
  return { positional, flags };
}

/** Where the app keeps user-installed extensions (Electron's userData for the app named "Horologium"). */
function defaultUserRoot() {
  if (process.env.HOROLOGIUM_USER_EXTENSIONS) return process.env.HOROLOGIUM_USER_EXTENSIONS;
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Horologium', 'extensions');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Horologium', 'extensions');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'Horologium', 'extensions');
}

const { positional: [type, id], flags } = parseArgs(process.argv.slice(2));

if (!type || !id) {
  console.log(`Usage: npm run new -- <type> <id> [--theme <theme-id>] [--category <genre-id>] [--user] [--kind dsp|noise] [--color <noise>] [--role <role>] [--name "English name"] [--ko "한국어 이름"]\nTypes: ${TYPES.join(', ')}`);
  process.exit(type || id ? 1 : 0);
}

try {
  const { created, hint } = scaffold({
    type,
    id,
    theme: flags.theme,
    category: flags.category,
    role: flags.role,
    kind: flags.kind,
    color: flags.color,
    user: Boolean(flags.user),
    nameEn: flags.name,
    nameKo: flags.ko,
    extensionsRoot: path.join(root, 'extensions'),
    userRoot: defaultUserRoot(),
    templatesRoot: path.join(root, 'templates'),
  });
  const shown = path.relative(root, created);
  console.log(`Created ${shown.startsWith('..') ? created : shown}\n${hint}`);
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
