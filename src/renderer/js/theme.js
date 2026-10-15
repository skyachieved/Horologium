/*
 * Applies a theme extension: design tokens + component CSS + bundled fonts, and loads the theme's
 * scene artwork, chime set, and character SVG. Everything is served from horologium://app/ext/...
 */

const extUrl = (entry, rel) => `ext/${entry.origin}/${entry.base}/${rel}`;

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** (Re)point a <link rel="stylesheet"> and resolve once the new sheet has loaded. */
function setStylesheet(id, href) {
  return new Promise((resolve) => {
    let link = document.getElementById(id);
    if (!link) {
      link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      document.head.append(link);
    }
    // Re-applying the same theme (language or character change) leaves href untouched, so no new
    // `load` event would ever fire; resolve right away instead of hanging the rebuild.
    if (link.getAttribute('href') === href && link.sheet) {
      resolve();
      return;
    }
    link.onload = () => resolve();
    link.onerror = () => resolve(); // a missing sheet must not hang the UI
    link.href = href;
  });
}

function setFonts(theme) {
  let style = document.getElementById('theme-fonts');
  if (!style) {
    style = document.createElement('style');
    style.id = 'theme-fonts';
    document.head.append(style);
  }
  style.textContent = (theme.fonts ?? [])
    .map((f) => `@font-face{font-family:"${f.family}";src:url("${extUrl(theme, f.file)}") format("woff2");font-weight:${f.weight ?? '400'};font-display:swap;}`)
    .join('\n');
}

/** @returns {Promise<{theme: object, scenes: {pomodoro: string, hydration: string}, chimes: object}>} */
export async function applyTheme(registry, themeId) {
  const theme = registry.themes.find((x) => x.id === themeId) ?? registry.themes[0];
  if (!theme) throw new Error('No valid theme is installed (see Settings > System > Extensions).');

  setFonts(theme);
  await Promise.all([
    setStylesheet('theme-tokens', extUrl(theme, theme.tokens)),
    setStylesheet('theme-styles', extUrl(theme, theme.styles)),
  ]);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.mode = theme.mode;
  root.dataset.motion = theme.motion;

  const [pomodoro, hydration, chimes] = await Promise.all([
    fetchText(extUrl(theme, theme.scenes.pomodoro)),
    fetchText(extUrl(theme, theme.scenes.hydration)),
    fetchText(extUrl(theme, theme.chimes)).then(JSON.parse),
  ]);
  return { theme, scenes: { pomodoro, hydration }, chimes };
}

export function characterOf(theme, characterId) {
  return theme.characters.find((c) => c.id === characterId) ?? theme.characters.find((c) => c.id === theme.defaultCharacter) ?? theme.characters[0];
}

/** Fetch a character's SVG markup (already vetted by the loader's safety check). */
export async function loadCharacterSvg(character) {
  return fetchText(extUrl(character, character.svg));
}

/** Optional per-character stylesheet. */
export async function applyCharacterCss(character) {
  if (!character.css) {
    document.getElementById('character-styles')?.remove();
    return;
  }
  await setStylesheet('character-styles', extUrl(character, character.css));
}
