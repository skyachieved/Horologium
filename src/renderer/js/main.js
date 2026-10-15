/*
 * Renderer bootstrap: fetch init data from the main process, apply language + theme + character,
 * build the widget, start the 1 Hz engine. Theme / character / language / size changes call back
 * into the actions below, which rebuild the widget in place (keeping it open on the same tab).
 */
import * as S from './app-state.js';
import * as I18N from './i18n.js';
import * as Theme from './theme.js';
import * as Audio from './audio.js';
import { applyLayoutVars } from './layout.js';
import { buildWidget } from './widget.js';
import { toast } from './toast.js';

const bridge = window.horologium;
let widget = null;

function applyMotion() {
  const reduce = S.getState().settings.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.documentElement.dataset.reduceMotion = String(Boolean(reduce));
}

async function load({ resume } = {}) {
  const state = S.getState();
  I18N.setLocale(state.settings.language, S.env.registry.locales);

  const themeData = await Theme.applyTheme(S.env.registry, state.settings.theme);
  if (themeData.theme.id !== state.settings.theme) S.setSetting('theme', themeData.theme.id);
  const character = Theme.characterOf(themeData.theme, state.settings.character);
  if (character.id !== state.settings.character) S.setSetting('character', character.id);
  const [characterSvg] = await Promise.all([Theme.loadCharacterSvg(character), Theme.applyCharacterCss(character)]);

  Audio.setChimes(themeData.chimes);
  Audio.setVolume(state.settings.volume);
  applyMotion();
  applyLayoutVars(state.settings.charScale);

  widget?.dispose();
  widget = buildWidget({ registry: S.env.registry, themeData, character, characterSvg, resume, actions });
  return widget;
}

const actions = {
  async setTheme(id) {
    const keep = { expanded: widget?.isExpanded() };
    S.setSetting('theme', id);
    const th = S.env.registry.themes.find((x) => x.id === id);
    if (th && !th.characters.some((c) => c.id === S.getState().settings.character)) S.setSetting('character', th.defaultCharacter);
    await load({ resume: keep });
    widget.setTab('settings');
  },
  async setCharacter(id) {
    const keep = { expanded: widget?.isExpanded() };
    S.setSetting('character', id);
    await load({ resume: keep });
    widget.setTab('settings');
  },
  async setLanguage(code) {
    const keep = { expanded: widget?.isExpanded() };
    S.setSetting('language', code);
    await load({ resume: keep });
    widget.setTab('settings');
  },
  applyScale: () => widget?.applyScale(),
  applyMotion,
};

async function start() {
  const init = await bridge.init();
  S.init(init);

  // First run: if the saved language was never chosen, follow the OS language once.
  if (!S.getState().ui.onboarded && init.systemLocale && init.registry.locales[init.systemLocale]) S.setSetting('language', init.systemLocale);

  await load();
  S.startEngine();

  bridge.onHotkeyStatus((status) => {
    S.env.hotkeyStatus = status;
    if (status && !status.ok) toast(I18N.t('keys.taken'), 'warn', 6000);
  });

  // First run: open straight to the hydration setup so the user is asked for their details.
  if (!S.getState().ui.onboarded) {
    S.patch({ ui: { onboarded: true } });
    if (!S.profile()) {
      await widget.setExpanded(true);
      widget.setTab('hydration');
    }
  }
}

start().catch((err) => {
  console.error(err);
  document.getElementById('app').textContent = `Horologium could not start: ${err.message}`;
});
