/*
 * Hydration profile form: asks only for the inputs that change how much water a person needs.
 *   body:      sex, age, height, weight   (-> Watson total body water)
 *   activity:  exercise intensity + minutes per day
 *   weather:   a city (or manual climate), fetched from Open-Meteo
 *   cup:       small / medium / large / custom (the daily target is expressed in these)
 * The preview recalculates on every keystroke using the same tested core as the tracker.
 */
import { h, setText, append } from '../dom.js';
import { icon } from '../icons.js';
import { t, tn, formatNumber } from '../i18n.js';
import * as S from '../app-state.js';
import * as H from '../../core/hydration.js';
import { segmented } from '../controls.js';

const DEFAULT_DRAFT = { sex: null, age: 25, heightCm: 170, weightKg: 65, exerciseIntensity: 'light', exerciseMin: 30, cupMl: H.CUP_SIZES.medium };

const field = (label, control, note) => h('div', { class: 'field' },
  h('label', { class: 'field-label' }, label), control, note ? h('div', { class: 'hint' }, note) : null);

const numberInput = (attrs, onInput) => {
  const input = h('input', { type: 'number', inputmode: 'decimal', ...attrs, oninput: () => onInput(input.value === '' ? Number.NaN : Number(input.value)) });
  return input;
};

export function createProfileForm({ onDone, onCancel, canCancel }) {
  const saved = S.profile();
  const draft = { ...DEFAULT_DRAFT, ...(saved ?? {}) };
  let units = S.getState().settings.hydration.units;

  const el = h('div', { class: 'profile-form' });
  const body = h('div', { class: 'form-body' });
  const previewMl = h('div', { class: 'preview-ml' });
  const previewCups = h('div', { class: 'preview-cups' });
  const problems = h('ul', { class: 'problems' });
  const saveBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, icon('check'), h('span', {}, t('profile.save')));
  const cancelBtn = canCancel ? h('button', { type: 'button', class: 'btn', onclick: onCancel }, t('profile.cancel')) : null;

  // ----- live preview + validation -----
  function refresh() {
    const found = H.validateProfile(draft);
    problems.replaceChildren(...found.map((p) => h('li', {}, problemText(p))));
    saveBtn.disabled = found.length > 0;
    const target = found.length === 0 ? S.target(draft) : null;
    if (target) {
      setText(previewMl, `${formatNumber(target.totalMl)} mL`);
      setText(previewCups, `${tn('hydration.cups', target.cups)} · ${t('profile.perCup', { ml: draft.cupMl })}`);
    } else {
      setText(previewMl, '—');
      setText(previewCups, t('profile.previewWaiting'));
    }
    estimate.textContent = draft.exerciseIntensity === 'none'
      ? ''
      : t('profile.exerciseEstimate', { ml: Math.round(Math.min(H.EXERCISE_CAP_ML, (draft.exerciseMin / 60) * H.SWEAT_ML_PER_HOUR[draft.exerciseIntensity])) });
  }

  const fieldNames = { sex: 'field.sex', age: 'field.age', heightCm: 'field.height', weightKg: 'field.weight', exerciseIntensity: 'field.exercise', exerciseMin: 'field.minutes', cupMl: 'field.cup' };
  function problemText(p) {
    const name = t(fieldNames[p.field] ?? 'field.sex');
    if (p.code === 'range') return t('error.range', { field: name, min: p.min, max: p.max });
    return t(p.code === 'choice' ? 'error.choice' : 'error.missing', { field: name });
  }

  function save() {
    if (H.validateProfile(draft).length) return;
    S.saveProfile({ ...draft, age: Math.round(draft.age), heightCm: Math.round(draft.heightCm), weightKg: Math.round(draft.weightKg * 10) / 10, exerciseMin: Math.round(draft.exerciseMin), cupMl: Math.round(draft.cupMl) });
    onDone();
  }

  // ----- unit-aware inputs -----
  const estimate = h('div', { class: 'hint' });

  function buildBodyFields() {
    const imperial = units === 'imperial';
    const sexPick = segmented(t('field.sex'),
      [{ value: 'female', label: t('sex.female') }, { value: 'male', label: t('sex.male') }, { value: 'other', label: t('sex.other') }],
      draft.sex, (v) => { draft.sex = v; sexPick.setValue(v); refresh(); });

    const age = numberInput({ min: 12, max: 110, step: 1, value: draft.age, 'aria-label': t('field.age') }, (v) => { draft.age = v; refresh(); });

    let height;
    if (imperial) {
      const totalIn = H.inchesFromCm(draft.heightCm);
      const ft = numberInput({ min: 3, max: 7, step: 1, value: Math.floor(totalIn / 12), 'aria-label': t('unit.ft') }, () => sync());
      const inch = numberInput({ min: 0, max: 11, step: 1, value: Math.round(totalIn % 12) % 12, 'aria-label': t('unit.in') }, () => sync());
      const sync = () => { draft.heightCm = H.cmFromInches(Number(ft.value) * 12 + Number(inch.value || 0)); refresh(); };
      height = h('div', { class: 'pair' }, ft, h('span', { class: 'unit' }, t('unit.ft')), inch, h('span', { class: 'unit' }, t('unit.in')));
    } else {
      height = h('div', { class: 'pair' }, numberInput({ min: 100, max: 230, step: 1, value: Math.round(draft.heightCm), 'aria-label': t('field.height') }, (v) => { draft.heightCm = v; refresh(); }), h('span', { class: 'unit' }, t('unit.cm')));
    }

    const weight = imperial
      ? h('div', { class: 'pair' }, numberInput({ min: 66, max: 551, step: 1, value: Math.round(H.lbFromKg(draft.weightKg)), 'aria-label': t('field.weight') }, (v) => { draft.weightKg = H.kgFromLb(v); refresh(); }), h('span', { class: 'unit' }, t('unit.lb')))
      : h('div', { class: 'pair' }, numberInput({ min: 30, max: 250, step: 0.5, value: Math.round(draft.weightKg * 10) / 10, 'aria-label': t('field.weight') }, (v) => { draft.weightKg = v; refresh(); }), h('span', { class: 'unit' }, t('unit.kg')));

    const intensityPick = segmented(t('field.exercise'),
      ['none', 'light', 'moderate', 'vigorous'].map((v) => ({ value: v, label: t(`intensity.${v}`) })),
      draft.exerciseIntensity, (v) => { draft.exerciseIntensity = v; if (v === 'none') draft.exerciseMin = 0; else if (draft.exerciseMin === 0) draft.exerciseMin = 30; intensityPick.setValue(v); minutes.value = draft.exerciseMin; intensityHint.textContent = t(`intensity.hint.${v}`); refresh(); });
    const intensityHint = h('div', { class: 'hint' }, t(`intensity.hint.${draft.exerciseIntensity}`));
    const minutes = numberInput({ min: 0, max: 300, step: 5, value: draft.exerciseMin, 'aria-label': t('field.minutes') }, (v) => { draft.exerciseMin = v; refresh(); });

    const cupPick = segmented(t('field.cup'),
      [
        { value: H.CUP_SIZES.small, label: t('cup.small'), sub: cupLabel(H.CUP_SIZES.small) },
        { value: H.CUP_SIZES.medium, label: t('cup.medium'), sub: cupLabel(H.CUP_SIZES.medium) },
        { value: H.CUP_SIZES.large, label: t('cup.large'), sub: cupLabel(H.CUP_SIZES.large) },
        { value: 'custom', label: t('cup.custom') },
      ],
      cupChoice(), (v) => {
        if (v === 'custom') { customRow.hidden = false; cupPick.setValue('custom'); customInput.focus(); return; }
        customRow.hidden = true; draft.cupMl = v; cupPick.setValue(v); refresh();
      });
    const customInput = imperial
      ? numberInput({ min: 2, max: 34, step: 0.5, value: Math.round(H.flozFromMl(draft.cupMl) * 2) / 2, 'aria-label': t('cup.custom') }, (v) => { draft.cupMl = H.mlFromFloz(v); refresh(); })
      : numberInput({ min: 60, max: 1000, step: 10, value: Math.round(draft.cupMl), 'aria-label': t('cup.custom') }, (v) => { draft.cupMl = v; refresh(); });
    const customRow = h('div', { class: 'pair', hidden: cupChoice() !== 'custom' }, customInput, h('span', { class: 'unit' }, t(imperial ? 'unit.floz' : 'unit.ml')));

    return [
      field(t('field.sex'), sexPick, t('profile.sexNote')),
      h('div', { class: 'grid-2' }, field(t('field.age'), age), field(t('field.weight'), weight)),
      field(t('field.height'), height),
      field(t('field.exercise'), h('div', {}, intensityPick, intensityHint)),
      field(t('field.minutes'), h('div', {}, minutes, estimate)),
      field(t('field.cup'), h('div', {}, cupPick, customRow)),
    ];
  }

  const cupLabel = (ml) => (units === 'imperial' ? `${formatNumber(H.flozFromMl(ml), 1)} ${t('unit.floz')}` : `${ml} ${t('unit.ml')}`);
  const cupChoice = () => (Object.values(H.CUP_SIZES).includes(draft.cupMl) ? draft.cupMl : 'custom');

  // ----- weather / location -----
  const weatherBox = h('div', { class: 'weather-box' });
  let searchResults = [];
  let searchMsg = '';
  let searchTimer = null;
  let searching = false;

  function weatherSummary() {
    const st = S.getState().hydration;
    if (st.climateOverride) return t('weather.manual', { level: t(`climate.${st.climateOverride}`) });
    if (!st.location) return t('weather.none');
    const w = st.weather;
    return w ? t('weather.current', { place: st.location.name, temp: formatNumber(w.tempC, 0), humidity: w.humidityPct == null ? '–' : formatNumber(w.humidityPct) }) : t('weather.loading', { place: st.location.name });
  }

  function renderWeather() {
    const st = S.getState().hydration;
    const input = h('input', { type: 'search', class: 'wide', placeholder: t('weather.searchPlaceholder'), 'aria-label': t('weather.search'), oninput: () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => runSearch(input.value), 350); } });
    const list = h('div', { class: 'results' }, searchResults.map((r) => h('button', { type: 'button', class: 'result', onclick: () => { searchResults = []; searchMsg = ''; S.setLocation({ name: r.label, latitude: r.latitude, longitude: r.longitude }); renderWeather(); } }, icon('pin'), h('span', {}, r.label))));
    const approx = h('button', { type: 'button', class: 'btn btn-small', onclick: useApprox }, icon('pin'), h('span', {}, t('weather.approx')));
    const select = h('select', { 'aria-label': t('weather.climate'), onchange: () => { S.setClimateOverride(select.value || null); renderWeather(); } },
      h('option', { value: '' }, t('climate.auto')),
      ...['temperate', 'warm', 'hot'].map((c) => h('option', { value: c }, t(`climate.${c}`))));
    select.value = st.climateOverride ?? '';
    weatherBox.replaceChildren();
    append(weatherBox, [
      h('div', { class: 'weather-line' }, icon('pin'), h('span', {}, weatherSummary())),
      input, list,
      searchMsg ? h('div', { class: 'hint' }, searchMsg) : null,
      h('div', { class: 'weather-actions' }, approx, select),
      h('div', { class: 'hint' }, t('weather.approxNote'))]);
  }

  async function runSearch(query) {
    if (query.trim().length < 2) { searchResults = []; searchMsg = ''; renderWeather(); return; }
    searching = true;
    const res = await window.horologium.searchCities({ query });
    searching = false;
    if (!res?.ok) searchMsg = t('weather.error');
    else { searchResults = res.results; searchMsg = res.results.length ? '' : t('weather.noResults'); }
    const keep = weatherBox.querySelector('input')?.value ?? query;
    renderWeather();
    const box = weatherBox.querySelector('input');
    if (box) { box.value = keep; box.focus(); }
  }

  async function useApprox() {
    const res = await window.horologium.approximateLocation();
    if (res?.ok) { searchResults = []; searchMsg = ''; S.setLocation({ name: res.location.label, latitude: res.location.latitude, longitude: res.location.longitude }); }
    else searchMsg = t('weather.error');
    renderWeather();
  }

  // ----- assemble -----
  function build() {
    const unitPick = segmented(t('profile.units'),
      [{ value: 'metric', label: t('profile.units.metric') }, { value: 'imperial', label: t('profile.units.imperial') }],
      units, (v) => { units = v; S.setSetting('hydration.units', v); build(); });
    body.replaceChildren(
      h('p', { class: 'hint' }, t('profile.intro')),
      field(t('profile.units'), unitPick),
      ...buildBodyFields(),
      field(t('field.weather'), weatherBox));
    renderWeather();
    refresh();
  }

  el.append(
    h('h2', { class: 'view-title' }, t('profile.title')),
    body,
    h('div', { class: 'preview' }, h('div', { class: 'preview-label' }, t('profile.preview')), previewMl, previewCups),
    problems,
    h('div', { class: 'form-actions' }, cancelBtn, saveBtn));
  build();

  const stop = S.on('change', () => { if (weatherBox.isConnected && !searching) { const hadFocus = weatherBox.contains(document.activeElement); if (!hadFocus) { renderWeather(); refresh(); } } });
  return { el, dispose: stop };
}
