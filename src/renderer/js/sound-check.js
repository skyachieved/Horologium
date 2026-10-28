/*
 * "Sound check" UI (owner's note 15: sound sometimes works and sometimes not; give me a way to validate it).
 * Runs music-manager's soundCheck(): engine running, clock moving, an output device present, volume above zero,
 * and two test notes measured after the volume. It cannot hear the speakers, so it ends by asking the person,
 * and only then offers the fixes that live outside the app (system volume, device, WSL) or a full restart.
 */
import { h } from './dom.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import * as S from './app-state.js';
import * as Music from './music-manager.js';
import { toast } from './toast.js';

const CHECK_LABEL = {
  engine: 'sound.c.engine',
  clock: 'sound.c.clock',
  device: 'sound.c.device',
  volume: 'sound.c.volume',
  signal: 'sound.c.signal',
};

/** @returns {{button: HTMLElement, results: HTMLElement}} place the button in a row and the results under it */
export function createSoundCheck() {
  const results = h('div', { class: 'sound-check', hidden: true, 'aria-live': 'polite' });
  const button = h('button', { type: 'button', class: 'btn btn-small', onclick: () => run() }, icon('volume'), h('span', {}, t('sound.run')));
  let busy = false;

  async function run() {
    if (busy) return;
    busy = true;
    button.disabled = true;
    results.hidden = false;
    results.replaceChildren(h('p', { class: 'hint' }, t('sound.running')));
    let report;
    try {
      report = await Music.soundCheck();
    } catch (err) {
      report = { ok: false, checks: [], info: {}, error: err.message };
    }
    busy = false;
    button.disabled = false;
    render(report);
  }

  function tips(report) {
    const noDevice = report?.checks?.some((c) => c.id === 'device' && c.ok === false);
    return h('div', { class: 'sound-tips' },
      noDevice && S.env.platform === 'linux' ? h('p', { class: 'warn-text' }, t(S.env.wsl ? 'sound.noDeviceWsl' : 'sound.noDevice')) : null,
      h('p', {}, t('sound.tips')),
      S.env.wsl ? h('p', { class: 'warn-text' }, t('sound.wsl')) : null,
      h('button', { type: 'button', class: 'btn btn-small', onclick: restart }, icon('reset'), h('span', {}, t('sound.restart'))));
  }

  async function restart() {
    await Music.resetAudio();
    toast(t('sound.restarted'));
    results.hidden = true;
  }

  function render(report) {
    const rows = report.checks.map((c) => {
      const state = c.ok === false ? 'bad' : c.ok === null ? 'unknown' : 'good';
      return h('li', { class: `sound-row ${state}` },
        icon(state === 'bad' ? 'close' : state === 'unknown' ? 'info' : 'check'),
        h('span', { class: 'sound-label' }, t(CHECK_LABEL[c.id])),
        h('span', { class: 'hint' }, c.detail));
    });
    const info = report.info?.sampleRate
      ? h('p', { class: 'hint' }, t('sound.info', { rate: report.info.sampleRate, ms: report.info.baseLatencyMs + report.info.outputLatencyMs }))
      : null;
    const parts = [h('ul', { class: 'sound-rows' }, rows), info];
    if (report.error) parts.push(h('p', { class: 'warn-text' }, report.error));
    if (!report.ok) {
      parts.push(tips(report));
    } else {
      const answer = h('div', { class: 'sound-answer' });
      const yes = h('button', { type: 'button', class: 'btn btn-small', onclick: () => answer.replaceChildren(h('p', { class: 'good-text' }, t('sound.allGood'))) }, t('sound.yes'));
      const no = h('button', { type: 'button', class: 'btn btn-small', onclick: () => answer.replaceChildren(tips(report)) }, t('sound.no'));
      parts.push(h('div', { class: 'sound-heard' }, h('span', {}, t('sound.heard')), yes, no), answer);
    }
    results.replaceChildren(...parts.filter(Boolean));
  }

  return { button, results, run };
}
