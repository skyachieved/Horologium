/*
 * The "Stations" music source: generated music and soundscapes (see AGENTS.md > Music).
 *
 * Contract (docs/extension-api.md): default export createSource(api) returns
 *   { mount(el), unmount(), play(), pause(), toggle(), isPlaying(), info(), onChange(cb), dispose() }
 * The shell gives this module everything it needs through `api` (DOM helper, icons, i18n, shared controls,
 * the audio context + master music bus, persisted state), so extension code never imports shell internals.
 */
import { createEngine } from './synth/engine.js';

const newSeed = () => Math.floor(Math.random() * 2 ** 31).toString(36);

export default function createSource(api) {
  const { h, icon, t, lang, controls } = api;
  const gen = api.registry.generated;
  const loc = (obj) => obj?.[lang()] ?? obj?.en ?? '';

  const modules = new Map();
  const loadInstrument = (id) => {
    if (!modules.has(id)) modules.set(id, import(api.url(gen.origin, gen.base, `instruments/${id}.js`)));
    return modules.get(id);
  };
  const loadLayerModule = (def) => import(api.url(def.origin, def.base, def.entry));

  let engine = null;
  let root = null;
  let restartTimer = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());

  async function getEngine() {
    if (engine) return engine;
    const { context, output } = await api.audio.ensure();
    engine = createEngine({
      context,
      output,
      library: { progressionBanks: gen.progressionBanks, grooves: gen.grooves },
      layerDefs: gen.layers,
      loadInstrument,
      loadLayerModule,
      onChange: () => { refreshNow(); emit(); },
      onRendered: () => api.memory?.release(),
    });
    return engine;
  }

  // ---------- persisted choices ----------
  const music = () => api.state.get();
  const stationById = (id) => gen.stations.find((s) => s.id === id) ?? null;
  const selected = () => stationById(music().station);
  const saved = (id) => music().perStation?.[id] ?? {};
  const paramValues = (st) => Object.fromEntries((st.params ?? []).map((p) => [p.id, saved(st.id).params?.[p.id] ?? p.default]));
  const layerLevels = (st) => ({ ...Object.fromEntries((st.layers ?? []).map((l) => [l.id, l.level])), ...(saved(st.id).layers ?? {}) });
  const patchStation = (id, partial) => api.state.patch({ perStation: { [id]: partial } });

  function ensureSeed() {
    if (!music().seed) api.state.patch({ seed: newSeed() });
  }

  // ---------- playback ----------
  async function startStation(st, { crossfade } = {}) {
    ensureSeed();
    const eng = await getEngine();
    await eng.play({
      station: st,
      seed: music().seed,
      params: paramValues(st),
      layers: layerLevels(st),
      crossfade: crossfade ?? api.settings().crossfadeSec,
    });
    api.state.patch({ playing: true });
    refreshNow();
    emit();
  }

  async function play() {
    const st = selected() ?? gen.stations.find((s) => s.category === gen.categories[0]?.id) ?? gen.stations[0];
    if (!st) return;
    if (!selected()) api.state.patch({ station: st.id });
    if (engine?.isActive() && engine.currentStationId() === st.id && engine.isPaused()) {
      await engine.resume();
      api.state.patch({ playing: true });
      refreshNow();
      emit();
    } else if (!(engine?.isActive() && engine.currentStationId() === st.id)) {
      await startStation(st);
    }
  }

  function pause() {
    engine?.pause();
    api.state.patch({ playing: false });
    refreshNow();
    emit();
  }

  const isPlaying = () => Boolean(engine?.isActive() && !engine.isPaused());

  /** A param or preset changed: restart the station shortly (same seed, short crossfade) so sliders feel live. */
  function scheduleRestart() {
    const st = selected();
    if (!st || !engine?.isActive()) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => { if (isPlaying()) startStation(st, { crossfade: 1.2 }); }, 450);
  }

  // ---------- UI ----------
  const nowTitle = h('div', { class: 'music-now-title' });
  const nowSub = h('div', { class: 'music-now-sub hint' });
  const playBtn = h('button', { type: 'button', class: 'btn btn-primary btn-round music-play', onclick: () => (isPlaying() ? pause() : play()) });
  const variationBtn = h('button', { type: 'button', class: 'btn btn-round', title: t('music.variation'), 'aria-label': t('music.variation'), onclick: newVariation }, icon('reset'));
  const nowCard = h('div', { class: 'music-now' }, playBtn, h('div', { class: 'music-now-text' }, nowTitle, nowSub), variationBtn);
  const body = h('div', { class: 'music-body' });

  function newVariation() {
    api.state.patch({ seed: newSeed() });
    const st = selected();
    if (st && engine?.isActive()) startStation(st, { crossfade: 2 });
  }

  function infoLine() {
    const st = selected();
    if (!st) return t('music.pick');
    const s = engine?.state();
    if (isPlaying() && !s?.plan && st.composer) return t('music.composing');
    if (!st.composer) return isPlaying() ? t('music.playingSound') : t('music.paused');
    if (s?.plan && engine.currentStationId() === st.id) {
      const mode = s.plan.mode === 'minor' ? t('music.minor') : t('music.major');
      const line = `${s.plan.key} ${mode} · ${s.plan.tempo} BPM · ${s.plan.progression}`;
      return isPlaying() ? line : `${t('music.paused')} · ${line}`;
    }
    return t('music.ready');
  }

  function refreshNow() {
    const st = selected();
    setText(nowTitle, st ? loc(st.name) : t('music.pick'));
    setText(nowSub, infoLine());
    const playing = isPlaying();
    playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', t(playing ? 'music.pause' : 'music.play'));
    nowCard.classList.toggle('is-playing', playing);
    root?.querySelectorAll('.station').forEach((el) => el.classList.toggle('playing', playing && el.dataset.id === st?.id));
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function categoriesInUse() {
    const used = new Set(gen.stations.map((s) => s.category));
    const list = gen.categories.filter((c) => used.has(c.id)).map((c) => ({ value: c.id, label: loc(c.name) }));
    if (used.has('custom')) list.push({ value: 'custom', label: t('music.category.custom') });
    return list;
  }

  const currentCategory = () => music().category ?? selected()?.category ?? gen.categories[0]?.id;

  function renderBody() {
    const st = selected();
    const category = currentCategory();
    const cats = categoriesInUse();

    const chips = controls.segmented(t('music.genres'), cats, category, (value) => {
      api.state.patch({ category: value });
      renderBody();
    });

    const list = h('div', { class: 'station-list' }, gen.stations.filter((s) => s.category === category).map((s) => {
      const btn = h('button', { type: 'button', class: `station${st?.id === s.id ? ' on' : ''}`, dataset: { id: s.id }, onclick: () => choose(s) },
        h('span', { class: 'eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
        h('span', { class: 'station-text' }, h('span', { class: 'station-name' }, loc(s.name)), h('span', { class: 'station-desc hint' }, loc(s.description))));
      return btn;
    }));

    const parts = [chips, list];
    if (st) parts.push(...controlsFor(st));
    body.replaceChildren(...parts);
    refreshNow();
  }

  function controlsFor(st) {
    const out = [];
    const sv = saved(st.id);

    if ((st.presets ?? []).length) {
      const options = st.presets.map((p) => ({ value: p.id, label: loc(p.name) }));
      out.push(controls.row(t('music.presets'), controls.segmented(t('music.presets'), options, sv.preset ?? '', (id) => applyPreset(st, st.presets.find((p) => p.id === id))), null, { stack: true }));
    }

    const values = paramValues(st);
    for (const p of st.params ?? []) {
      out.push(controls.row(loc(p.label), controls.slider({
        min: p.min, max: p.max, step: p.step, value: values[p.id], label: loc(p.label),
        format: (v) => (p.target === 'tempo' ? `${Math.round(v)} BPM` : p.target === 'lowpassHz' ? `${(v / 1000).toFixed(1)} kHz` : String(Math.round(v * 100) / 100)),
        onChange: (v) => onParam(st, p, v),
      })));
    }

    const levels = layerLevels(st);
    out.push(h('h4', { class: 'music-subtitle' }, t('music.sounds')));
    for (const layer of gen.layers) {
      out.push(controls.row(loc(layer.name), controls.slider({
        min: 0, max: 1, step: 0.05, value: levels[layer.id] ?? 0, label: loc(layer.name), format: (v) => `${Math.round(v * 100)}%`,
        onInput: (v) => engine?.setLayerLevel(layer.id, v),
        onChange: (v) => { patchStation(st.id, { layers: { [layer.id]: v } }); if (engine?.currentStationId() === st.id) engine.setLayerLevel(layer.id, v); },
      })));
    }
    return out;
  }

  function onParam(st, p, value) {
    patchStation(st.id, { preset: null, params: { [p.id]: value } });
    if (!st.composer) {
      if (engine?.currentStationId() === st.id) engine.setTone(value); // layer-only stations: the tone filter is live
      return;
    }
    scheduleRestart(); // composed stations re-render with the new value
  }

  function applyPreset(st, preset) {
    const layers = Object.fromEntries((preset.layers ?? []).map((l) => [l.id, l.level]));
    // a preset REPLACES the saved choices for this station (patch merges objects, so clear first)
    api.state.patch({ perStation: { [st.id]: null } });
    api.state.patch({ perStation: { [st.id]: { preset: preset.id, params: { ...preset.params }, ...(Object.keys(layers).length ? { layers } : {}) } } });
    renderBody();
    if (!st.composer && engine?.currentStationId() === st.id) {
      const tone = paramValues(st).tone;
      if (tone) engine.setTone(tone);
      for (const layer of gen.layers) engine.setLayerLevel(layer.id, layerLevels(st)[layer.id] ?? 0);
    } else {
      scheduleRestart();
    }
  }

  async function choose(st) {
    api.state.patch({ station: st.id, category: st.category });
    renderBody();
    await startStation(st);
  }

  return {
    id: 'generated',
    mount(el) {
      root = h('div', { class: 'music-generated' }, nowCard, body);
      el.replaceChildren(root);
      renderBody();
    },
    unmount() {
      clearTimeout(restartTimer);
      root = null;
    },
    play,
    pause,
    toggle: () => (isPlaying() ? pause() : play()),
    isPlaying,
    info() {
      const st = selected();
      return { title: st ? loc(st.name) : '', playing: isPlaying() };
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    stop() {
      engine?.stop();
      api.state.patch({ playing: false });
      emit();
    },
    dispose() {
      clearTimeout(restartTimer);
      engine?.stop(0.2);
    },
  };
}
