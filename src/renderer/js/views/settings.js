/*
 * Settings tab ("the Toolshed"): appearance, sound, Pomodoro, hydration, keybinds, system.
 * Every control writes through app-state so it is persisted, and calls a `ctx` action when the change
 * needs the widget to rebuild (theme, character, language) or resize (character size).
 */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { t, language } from '../i18n.js';
import * as S from '../app-state.js';
import * as Audio from '../audio.js';
import * as Music from '../music-manager.js';
import { loadCharacterSvg } from '../theme.js';
import { fromMarkup } from '../dom.js';
import { segmented, slider, toggle, row, section } from '../controls.js';
import { toast } from '../toast.js';
import { acceleratorFromEvent, validateAccelerator, describeAccelerator } from '../../core/keybinds.js';
import { DEFAULT_HOTKEY } from '../../core/defaults.js';

const localName = (name) => name?.[language()] ?? name?.en ?? '';

export function createSettingsView(ctx) {
  const el = h('section', { class: 'view view-settings', id: 'view-settings' });
  const settings = () => S.getState().settings;
  const pct = (v) => `${Math.round(v * 100)}%`;

  // ---------- appearance ----------
  const themeCards = h('div', { class: 'cards' }, ctx.registry.themes.map((th) =>
    h('button', { type: 'button', class: `card-pick${th.id === ctx.theme.id ? ' on' : ''}`, 'aria-pressed': String(th.id === ctx.theme.id), onclick: () => ctx.actions.setTheme(th.id) },
      h('span', { class: 'swatch', style: { background: th.preview.bg, borderColor: th.preview.accent } }, h('span', { class: 'swatch-dot', style: { background: th.preview.accent } })),
      h('span', { class: 'card-name' }, localName(th.name)))));

  const charCards = h('div', { class: 'cards' });
  ctx.theme.characters.forEach(async (c) => {
    const thumb = h('span', { class: 'thumb' });
    charCards.append(h('button', { type: 'button', class: `card-pick${c.id === ctx.character.id ? ' on' : ''}`, 'aria-pressed': String(c.id === ctx.character.id), onclick: () => ctx.actions.setCharacter(c.id) },
      thumb, h('span', { class: 'card-name' }, localName(c.name))));
    try { thumb.append(fromMarkup(await loadCharacterSvg(c))); } catch { /* thumbnail is cosmetic */ }
  });

  const appearance = section(t('settings.appearance'),
    row(t('settings.theme'), themeCards, null, { stack: true }),
    row(t('settings.character'), charCards, null, { stack: true }),
    row(t('settings.charSize'), slider({ min: 0.5, max: 1.5, step: 0.1, value: settings().charScale, label: t('settings.charSize'), format: pct, onChange: (v) => { S.setSetting('charScale', v); ctx.actions.applyScale(); } })),
    row(t('settings.reduceMotion'), toggle({ checked: settings().reduceMotion, label: t('settings.reduceMotion'), onChange: (v) => { S.setSetting('reduceMotion', v); ctx.actions.applyMotion(); } }), t('settings.reduceMotionHint')));

  // ---------- sound ----------
  const hasMusic = Music.codeSources(ctx.registry).length > 0;
  const vol = (key, label) => row(label, slider({
    min: 0, max: 1, step: 0.05, value: settings().volume[key], label, format: pct,
    onInput: (v) => { Audio.setVolume({ [key]: v }); Music.applyVolume({ [key]: v }); },
    onChange: (v) => { S.setSetting(`volume.${key}`, v); Music.applyVolume(); },
  }));
  const sound = section(t('settings.sound'),
    vol('master', t('settings.volume.master')),
    vol('chimes', t('settings.volume.chimes')),
    hasMusic ? vol('music', t('settings.volume.music')) : null,
    row(t('settings.mute'), toggle({ checked: settings().volume.muted, label: t('settings.mute'), onChange: (v) => { Audio.setVolume({ muted: v }); S.setSetting('volume.muted', v); Music.applyVolume(); } })),
    row(t('settings.testChime'), h('button', { type: 'button', class: 'btn btn-small', onclick: () => Audio.play('drinkDue') }, icon('bell'), h('span', {}, t('settings.play')))));

  // ---------- music ----------
  const music = hasMusic ? section(t('settings.music'),
    row(t('settings.followPomodoro'), toggle({ checked: settings().music.followPomodoro, label: t('settings.followPomodoro'), onChange: (v) => S.setSetting('music.followPomodoro', v) }), t('settings.followPomodoroHint')),
    row(t('settings.crossfade'), slider({ min: 0.5, max: 6, step: 0.5, value: settings().music.crossfadeSec, label: t('settings.crossfade'), format: (v) => `${v} s`, onChange: (v) => S.setSetting('music.crossfadeSec', v) }))) : null;

  // ---------- pomodoro ----------
  const pomo = S.pomoSettings();
  const num = (key, min, max, label) => {
    const input = h('input', { type: 'number', min, max, step: 1, value: pomo[key], 'aria-label': label });
    input.addEventListener('change', () => S.applyPomodoroSettings({ ...S.pomoSettings(), [key]: Number(input.value) }));
    return row(label, h('div', { class: 'pair' }, input, h('span', { class: 'unit' }, key === 'longEvery' ? '' : t('unit.min'))));
  };
  const pomodoro = section(t('settings.pomodoro'),
    num('focusMin', 1, 180, t('settings.focusMin')),
    num('shortMin', 1, 60, t('settings.shortMin')),
    num('longMin', 1, 120, t('settings.longMin')),
    num('longEvery', 2, 12, t('settings.longEvery')),
    row(t('settings.autoStart'), toggle({ checked: pomo.autoStart, label: t('settings.autoStart'), onChange: (v) => S.applyPomodoroSettings({ ...S.pomoSettings(), autoStart: v }) })));

  // ---------- hydration ----------
  const hydration = section(t('settings.hydration'),
    row(t('settings.reminders'), toggle({ checked: settings().hydration.remindersOn, label: t('settings.reminders'), onChange: (v) => S.setSetting('hydration.remindersOn', v) })),
    row(t('settings.syncBreaks'), toggle({ checked: settings().hydration.syncBreaks, label: t('settings.syncBreaks'), onChange: (v) => S.setSetting('hydration.syncBreaks', v) }), t('settings.syncBreaksHint')),
    row(t('settings.profile'), h('button', { type: 'button', class: 'btn btn-small', onclick: () => ctx.actions.openProfileEditor() }, icon('edit'), h('span', {}, t('hydration.edit')))));

  // ---------- keybinds ----------
  const kbd = h('kbd', { class: 'kbd' });
  const keyMsg = h('div', { class: 'hint' });
  const changeBtn = h('button', { type: 'button', class: 'btn btn-small' }, icon('keyboard'), h('span', {}, t('keys.change')));
  const resetBtn = h('button', { type: 'button', class: 'btn btn-small', onclick: () => applyHotkey(DEFAULT_HOTKEY) }, t('keys.reset'));
  let listening = false;

  const showCurrent = () => { kbd.textContent = describeAccelerator(settings().hotkeys.toggle, S.env.platform); };
  const warningText = (warnings) => warnings.map((w) => t(`keys.warn.${w}`)).join(' ');

  async function applyHotkey(accel) {
    const v = validateAccelerator(accel, S.env.platform);
    if (!v.ok) { keyMsg.textContent = t('keys.invalid'); return; }
    const res = await window.horologium.setHotkey({ accel });
    if (res?.ok) {
      S.patch({ settings: { hotkeys: { toggle: accel } } });
      showCurrent();
      keyMsg.textContent = [t('keys.saved'), warningText(res.warnings ?? [])].filter(Boolean).join(' ');
      toast(t('keys.saved'));
    } else {
      keyMsg.textContent = res?.error === 'taken' ? t('keys.taken') : t('keys.invalid');
    }
  }

  async function onKey(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { await stopListening(); keyMsg.textContent = ''; return; }
    const accel = acceleratorFromEvent(e, S.env.platform);
    if (!accel) return; // only modifiers so far
    await stopListening();
    await applyHotkey(accel);
  }

  async function startListening() {
    listening = true;
    await window.horologium.pauseHotkey(); // otherwise pressing the current combo would hide the widget
    kbd.textContent = t('keys.listening');
    keyMsg.textContent = t('keys.listeningHint');
    window.addEventListener('keydown', onKey, true);
  }
  async function stopListening() {
    if (!listening) return;
    listening = false;
    window.removeEventListener('keydown', onKey, true);
    await window.horologium.resumeHotkey();
    showCurrent();
  }
  changeBtn.addEventListener('click', () => (listening ? stopListening() : startListening()));
  showCurrent();
  if (S.env.hotkeyStatus && !S.env.hotkeyStatus.ok) keyMsg.textContent = t('keys.taken');

  const keys = section(t('settings.keys'),
    row(t('keys.toggle'), h('div', { class: 'stack-right' }, kbd, h('div', { class: 'btn-row' }, changeBtn, resetBtn)), t('keys.toggleHint')),
    keyMsg,
    h('div', { class: 'hint' }, t('keys.inWidget')));

  // ---------- system ----------
  const langs = Object.entries(ctx.registry.locales).map(([code, l]) => ({ value: code, label: l.meta.name }));
  const problems = S.env.problems;
  const problemList = h('details', { class: 'problems-details' },
    h('summary', {}, t(problems.length ? 'settings.extProblems' : 'settings.extOk', { n: problems.length })),
    h('ul', {}, problems.map((p) => h('li', {}, h('strong', {}, `${p.file} `), p.errors.join('; ')))));

  const system = section(t('settings.system'),
    row(t('settings.language'), segmented(t('settings.language'), langs, language(), (code) => ctx.actions.setLanguage(code))),
    S.env.loginSupported ? row(t('settings.login'), toggle({ checked: settings().launchAtLogin, label: t('settings.login'), onChange: (v) => window.horologium.setLaunchAtLogin({ enabled: v }) })) : null,
    h('div', { class: 'row' }, h('div', { class: 'row-text' }, h('div', { class: 'row-label' }, t('settings.extensions')), problemList)),
    row(t('settings.userExt'), h('code', { class: 'path' }, S.env.userExtDir), t('settings.userExtHint')));

  const about = section(t('settings.about'),
    h('p', {}, t('settings.aboutText', { version: S.env.version })),
    h('p', { class: 'hint' }, t('hydration.disclaimer')),
    h('p', { class: 'hint' }, t('settings.weatherCredit'), ' ',
      h('button', { type: 'button', class: 'link', onclick: () => window.horologium.openExternal({ url: 'https://open-meteo.com/' }) }, 'Open-Meteo.com')),
    h('div', { class: 'row-end' }, h('button', { type: 'button', class: 'btn btn-small btn-danger', onclick: () => window.horologium.quit() }, t('settings.quit'))));

  el.append(appearance, sound, ...(music ? [music] : []), pomodoro, hydration, keys, system, about);
  return { el, update() {}, dispose: stopListening };
}
