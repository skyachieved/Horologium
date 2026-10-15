/*
 * Helpers for building throwaway `extensions/` trees in the OS temp dir.
 * Lives outside test/ so `node --test` does not treat it as a test file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REQUIRED_THEME_TOKENS, CHIME_EVENTS } from '../src/core/contracts/index.js';

export const SAFE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle data-part="body" cx="50" cy="50" r="40"/></svg>';

export const TOKENS_CSS = `:root {\n${REQUIRED_THEME_TOKENS.map((t) => `  ${t}: 1;`).join('\n')}\n}\n`;

export const CHIMES = Object.fromEntries(
  CHIME_EVENTS.map((e) => [e, [{ at: 0, freq: 660, dur: 0.2, type: 'sine', gain: 0.4 }]]),
);

const json = (o) => `${JSON.stringify(o, null, 2)}\n`;

export function themeManifest(id, extra = {}) {
  return {
    type: 'theme', id, apiVersion: 1, name: { en: id, ko: id }, version: '1.0.0', license: 'MIT',
    mode: 'light', motion: 'bouncy', tokens: 'tokens.css', styles: 'theme.css', chimes: 'chimes.json',
    scenes: { pomodoro: 'scenes/pomodoro.svg', hydration: 'scenes/hydration.svg' },
    defaultCharacter: 'buddy', preview: { bg: '#ffffff', accent: '#ff6b5b' }, ...extra,
  };
}

export function characterManifest(id, extra = {}) {
  return { type: 'character', id, apiVersion: 1, name: { en: id, ko: id }, version: '1.0.0', license: 'MIT', svg: 'character.svg', accent: '#ff6b5b', ...extra };
}

export function webSourceManifest(id, extra = {}) {
  return {
    type: 'music-source', kind: 'web', id, apiVersion: 1, name: { en: id, ko: id }, version: '1.0.0', license: 'MIT',
    tab: { order: 2, icon: '▶' },
    capabilities: { volume: false, mute: true, seek: false, playlist: false },
    web: {
      sites: [{ id: 'main', name: { en: 'Main', ko: '메인' }, url: 'https://www.example.com/' }],
      navAllow: ['example.com', '*.example.com'],
      partition: `persist:${id}`, miniPlayer: 'none', size: { w: 960, h: 640 },
    },
    ...extra,
  };
}

export function musicPackManifest(id, tracks = [{ file: 'tracks/one.wav', title: 'One' }], extra = {}) {
  return { type: 'music-pack', id, apiVersion: 1, name: { en: id, ko: id }, version: '1.0.0', tracks, ...extra };
}

/** A complete, valid extensions tree as { relativePath: fileContents }. */
export function baseFiles() {
  return {
    'themes/test-theme/manifest.json': json(themeManifest('test-theme')),
    'themes/test-theme/tokens.css': TOKENS_CSS,
    'themes/test-theme/theme.css': '/* styles */\n',
    'themes/test-theme/chimes.json': json(CHIMES),
    'themes/test-theme/scenes/pomodoro.svg': SAFE_SVG,
    'themes/test-theme/scenes/hydration.svg': SAFE_SVG,
    'themes/test-theme/characters/buddy/manifest.json': json(characterManifest('buddy')),
    'themes/test-theme/characters/buddy/character.svg': SAFE_SVG,
    'music-sources/test-web/manifest.json': json(webSourceManifest('test-web')),
    'locales/en.json': json({ _meta: { code: 'en', name: 'English' }, 'app.title': 'Horologium', 'tab.pomodoro': 'Pomodoro' }),
    'locales/ko.json': json({ _meta: { code: 'ko', name: '한국어' }, 'app.title': '호롤로지움', 'tab.pomodoro': '뽀모도로' }),
  };
}

export { json };

/** Write a file map into a fresh temp dir and return its path. null values are skipped. */
export function writeTree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'horologium-ext-'));
  for (const [rel, content] of Object.entries(files)) {
    if (content == null) continue;
    const full = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

export function cleanup(...roots) {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
}
