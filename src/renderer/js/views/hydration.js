/*
 * Hydration tab. Shows the profile form until a profile exists, then the tracker:
 *   themed fill scene (driven by --fill), a big squishy drop button that logs one cup (cookie-clicker
 *   style: splash, floating "+355 mL", milestone confetti), undo for misclicks, a row of cups,
 *   the reminder status, and an honest "why this number" breakdown.
 */
import { h, fromMarkup, setText, clear } from '../dom.js';
import { icon } from '../icons.js';
import { t, tn, formatClock, formatNumber } from '../i18n.js';
import * as S from '../app-state.js';
import * as FX from '../effects.js';
import { createProfileForm } from './profile-form.js';

const DROP_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true"><path class="drop-body" d="M32 5c11.5 13.5 18.5 22.5 18.5 34a18.5 18.5 0 0 1-37 0C13.5 27.5 20.5 18.5 32 5z"/><ellipse class="drop-shine" cx="24" cy="39" rx="3.4" ry="6.5" transform="rotate(18 24 39)"/></svg>`;
const CUP_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path class="cup-body" d="M5.5 4.5h13l-1.6 14.3a2 2 0 0 1-2 1.7H9.1a2 2 0 0 1-2-1.7z"/></svg>`;

export function createHydrationView({ scenes }) {
  const el = h('section', { class: 'view view-hydration', id: 'view-hydration' });
  const disposers = [];
  let editing = false;
  let tracker = null;
  let form = null;

  function show() {
    disposers.splice(0).forEach((d) => d());
    clear(el);
    tracker = null;
    form = null;
    el.closest('.panel')?.scrollTo(0, 0);
    if (!S.profile() || editing) {
      form = createProfileForm({
        canCancel: Boolean(S.profile()),
        onCancel: () => { editing = false; show(); },
        onDone: () => { editing = false; show(); },
      });
      disposers.push(form.dispose);
      el.append(form.el);
    } else {
      tracker = buildTracker();
      disposers.push(tracker.dispose);
      el.append(tracker.el);
      tracker.update(Date.now(), S.reminderInfo());
    }
  }

  function buildTracker() {
    const scene = h('div', { class: 'scene scene-hydration' });
    scene.append(fromMarkup(scenes.hydration));
    const count = h('div', { class: 'count' });
    const countLabel = h('div', { class: 'count-label' });
    scene.append(h('div', { class: 'scene-overlay' }, count, countLabel));

    const mlLine = h('div', { class: 'ml-line' });
    const banner = h('div', { class: 'banner', hidden: true },
      icon('bell'), h('span', { class: 'banner-text' }),
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => S.logDrink() }, t('hydration.banner.drank')));
    const bannerText = banner.querySelector('.banner-text');

    const dropLabel = h('span', { class: 'drop-label' });
    const dropBtn = h('button', { type: 'button', class: 'drop-btn', 'aria-label': t('hydration.drink'), onclick: () => S.logDrink() },
      h('span', { class: 'drop-shape' }, fromMarkup(DROP_SVG)),
      h('span', { class: 'drop-text' }, h('strong', {}, t('hydration.drink')), dropLabel));
    const undoBtn = h('button', { type: 'button', class: 'btn btn-round', title: t('hydration.undo'), 'aria-label': t('hydration.undo'), onclick: () => S.undoDrink() }, icon('undo'));
    const editBtn = h('button', { type: 'button', class: 'btn btn-round', title: t('hydration.edit'), 'aria-label': t('hydration.edit'), onclick: () => { editing = true; show(); } }, icon('edit'));

    const cups = h('div', { class: 'cups', role: 'img' });
    const status = h('div', { class: 'status' });
    const caution = h('div', { class: 'hint caution', hidden: true }, t('hydration.tooMuch'));

    const whyBody = h('div', { class: 'why-body' });
    const why = h('details', { class: 'why' }, h('summary', {}, icon('info'), h('span', {}, t('hydration.why'))), whyBody);

    const el2 = h('div', { class: 'tracker' },
      banner,
      scene,
      mlLine,
      h('div', { class: 'drink-row' }, undoBtn, dropBtn, editBtn),
      cups, status, caution, why);

    let cupSlots = 0;
    let lastWhyKey = '';

    function update(now, info) {
      const tg = S.target();
      if (!tg) return;
      const day = S.dayRecord(now);
      const done = day?.drinks.length ?? 0;
      const fill = Math.min(1, done / tg.cups);
      scene.style.setProperty('--fill', fill.toFixed(3));
      scene.dataset.state = done === 0 ? 'empty' : done >= tg.cups ? 'full' : 'filling';
      scene.dataset.level = String(Math.min(10, Math.floor(fill * 10))); // 0-10, for themes with discrete growth stages

      setText(count, `${done} / ${tg.cups}`);
      setText(countLabel, t('hydration.cupsToday'));
      setText(mlLine, t('hydration.mlProgress', { done: formatNumber(done * tg.cupMl), goal: formatNumber(tg.cups * tg.cupMl) }));
      setText(dropLabel, `+${tg.cupMl} mL`);
      undoBtn.disabled = done === 0;
      caution.hidden = done <= Math.ceil(tg.cups * 1.5);

      if (cupSlots !== Math.min(tg.cups, 16)) {
        cupSlots = Math.min(tg.cups, 16);
        cups.replaceChildren(...Array.from({ length: cupSlots }, () => h('span', { class: 'cup' }, fromMarkup(CUP_SVG))));
      }
      [...cups.children].forEach((c, i) => c.classList.toggle('on', i < done));
      cups.setAttribute('aria-label', t('hydration.cupsAria', { done, goal: tg.cups }));
      cups.dataset.extra = done > tg.cups ? String(done - tg.cups) : '';

      // reminder banner + status line
      const due = info.decision === 'notify' || info.decision === 'due';
      banner.hidden = !due;
      if (due) setText(bannerText, t('hydration.banner.due', { left: tn('hydration.cups', Math.max(0, tg.cups - done)) }));
      setText(status, statusLine(info, now, done, tg));

      // "why this number" only needs rebuilding when inputs change
      const key = JSON.stringify([S.profile(), S.weatherInput(), tg.totalMl, S.getState().settings.language]);
      if (key !== lastWhyKey) {
        lastWhyKey = key;
        renderWhy(whyBody, tg);
      }
    }

    const offEffect = S.on('effect', (e) => {
      if (e.type === 'drink') {
        FX.splash(scene);
        FX.floatText(scene, `+${e.ml} mL`);
        dropBtn.classList.remove('squish');
        void dropBtn.offsetWidth; // restart the CSS animation
        dropBtn.classList.add('squish');
      } else if (e.type === 'milestone') {
        FX.confetti(scene);
        scene.classList.add('celebrate');
        setTimeout(() => scene.classList.remove('celebrate'), 1400);
      }
    });
    const offChange = S.on('change', () => { if (el.isConnected && tracker && !S.profile()) show(); });

    return { el: el2, update, dispose() { offEffect(); offChange(); } };
  }

  function statusLine(info, now, done, tg) {
    if (!S.getState().settings.hydration.remindersOn) return t('hydration.remindersOff');
    if (info.kind === 'goal' || done >= tg.cups) return t('hydration.goal');
    if (info.kind === 'closed') return t('hydration.closed');
    if (info.decision === 'hold') return t('hydration.held');
    if (info.decision === 'notify' || info.decision === 'due') return ''; // the banner already says it
    if (info.at == null) return '';
    const mins = Math.max(0, Math.round((info.at - now) / 60000));
    return t('hydration.next', { time: formatClock(info.at), rel: t('common.inMin', { n: formatNumber(mins) }) });
  }

  function renderWhy(container, tg) {
    const p = S.profile();
    const w = S.weatherInput();
    const lines = [t('hydration.why.base', { tbw: formatNumber(tg.tbwL, 1), ml: formatNumber(tg.baseMl) })];
    if (tg.exerciseMl > 0) lines.push(t('hydration.why.exercise', { ml: formatNumber(tg.exerciseMl), min: p.exerciseMin, level: t(`intensity.${p.exerciseIntensity}`).toLowerCase() }));
    if (tg.climateMl > 0) lines.push(w?.level ? t('hydration.why.climateManual', { ml: tg.climateMl, level: t(`climate.${w.level}`).toLowerCase() }) : t('hydration.why.weather', { ml: tg.climateMl, temp: formatNumber(w.tempC, 0) }));
    else lines.push(t(w ? 'hydration.why.weatherNone' : 'hydration.why.weatherUnknown'));
    if (tg.clamped) lines.push(t('hydration.why.clamped'));
    lines.push(t('hydration.why.total', { ml: formatNumber(tg.totalMl), cups: tn('hydration.cups', tg.cups), cup: tg.cupMl }));
    container.replaceChildren(...lines.map((l) => h('p', {}, l)), h('p', { class: 'hint' }, t('hydration.disclaimer')));
  }

  show();
  return {
    el,
    /** Called by the widget on every tick while this tab is visible (and when it is opened). */
    update(now) { tracker?.update(now, S.reminderInfo(now)); },
    dispose() { disposers.splice(0).forEach((d) => d()); },
    /** Open the profile form (Settings > Edit profile). */
    edit() { editing = true; show(); },
  };
}
