/*
 * Playback engine for generated stations. Runs in the renderer.
 *
 *   compose(seed:n) -> Plan -> renderPlan (OfflineAudioContext, off the UI thread) -> AudioBuffer
 *   buffers are queued ahead and started back to back on the audio clock; each buffer carries a reverb
 *   tail that overlaps the next phrase, so the join is seamless.
 *
 * A "session" is one station playing. Starting another station crossfades: the old session fades out
 * while the new one fades in. Layers (noise, rain, vinyl) are looping buffers with their own gains.
 *
 * Pausing stops only THIS station (fade out, stop its scheduled phrases, keep the phrases already rendered so
 * resuming is instant, at the next phrase). It must never suspend the AudioContext: that context is shared with
 * My music, and suspending it once silenced every other source (owner's note 15). The music manager suspends
 * the shared context when nothing at all has played for a while.
 */
import { createSongStream } from './../compose/song.js';
import { createRng } from './../compose/rng.js';
import { renderPlan } from './render.js';
import { noiseLoop } from './noise.js';

const LOOKAHEAD_SECONDS = 2.5;
const PRERENDER_PHRASES = 2;
const TICK_MS = 300;

/** Map a station's numeric params (target -> value) from slider ids. */
export function overridesFromParams(station, values = {}) {
  const out = {};
  for (const p of station.params ?? []) out[p.target] = values[p.id] ?? p.default;
  return out;
}

/**
 * @param {object} deps
 * @param {AudioContext} deps.context
 * @param {AudioNode} deps.output           master music bus (volume lives outside the engine)
 * @param {{progressionBanks: object, grooves: object}} deps.library
 * @param {object[]} deps.layerDefs         registry.generated.layers
 * @param {(id: string) => Promise<object>} deps.loadInstrument
 * @param {(def: object) => Promise<{generate: Function}>} deps.loadLayerModule
 * @param {(state: object) => void} [deps.onChange]
 * @param {() => void} [deps.onRendered]  a phrase finished rendering (the shell uses it to release the render graph's memory)
 */
export function createEngine({ context, output, library, layerDefs, loadInstrument, loadLayerModule, onChange = () => {}, onRendered = () => {} }) {
  const layerBuffers = new Map();
  let session = null;

  async function layerBuffer(def) {
    if (layerBuffers.has(def.id)) return layerBuffers.get(def.id);
    const channels = def.kind === 'noise'
      ? [noiseLoop(def.noise.color, context.sampleRate, 14)]
      : (await loadLayerModule(def)).generate({ sampleRate: context.sampleRate });
    const buffer = context.createBuffer(channels.length, channels[0].length, context.sampleRate);
    channels.forEach((data, i) => buffer.copyToChannel(data, i));
    layerBuffers.set(def.id, buffer);
    return buffer;
  }

  function createSession(cfg) {
    const { station, seed, overrides, layerLevels, skipIntro = false } = cfg;
    const gain = context.createGain();
    gain.gain.value = 0.0001;
    gain.connect(output);

    // layers share a tone filter, which is what the "tone" slider of noise stations drives
    const tone = context.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = station.composer ? 20000 : Math.min(20000, overrides.lowpassHz ?? 20000);
    tone.Q.value = 0.5;
    const layerBus = context.createGain();
    layerBus.connect(tone).connect(gain);

    const layers = new Map();
    const levels = { ...layerLevels }; // what each layer should be at, so a resume can bring them back
    const scheduled = new Set();       // phrase buffer sources started on the audio clock (stopped on pause)
    let disposed = false;
    let paused = false;
    const queue = [];
    let nextIndex = 0;
    let nextStart = 0;
    let started = false;
    let currentPlan = null;
    let timer = null;

    const rng = createRng(seed);
    const composer = station.composer;
    const key = composer ? rng.pick(composer.keys) : null;
    const tempo = composer ? Math.round(overrides.tempo ?? rng.range(composer.tempo[0], composer.tempo[1])) : null;
    // songs, not unrelated phrases (compose/song.js): the first song keeps this session's key
    const stream = composer ? createSongStream({ composer, library, seed, overrides: { ...overrides, key, tempo }, skipIntro }) : null;

    async function setLayerLevel(id, level) {
      const def = layerDefs.find((l) => l.id === id);
      if (!def || disposed) return;
      levels[id] = level;
      if (paused) return; // applied when playback resumes
      // a layer-only station is trimmed by its own gainDb (loudness-matched by `npm run test:audio`);
      // layers under a composed station are the listener's explicit mix and are left alone
      const stationTrim = station.composer ? 1 : 10 ** ((station.gainDb ?? 0) / 20);
      const linear = level * 10 ** ((def.gainDb ?? 0) / 20) * stationTrim;
      let entry = layers.get(id);
      if (level <= 0.001) {
        if (entry) {
          entry.gain.gain.setTargetAtTime(0, context.currentTime, 0.08);
          const old = entry;
          layers.delete(id);
          setTimeout(() => { try { old.source.stop(); } catch { /* already stopped */ } }, 600);
        }
        return;
      }
      if (!entry) {
        if (layers.has(`pending:${id}`)) return;
        layers.set(`pending:${id}`, true);
        const buffer = await layerBuffer(def);
        layers.delete(`pending:${id}`);
        if (disposed || paused) return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const g = context.createGain();
        g.gain.value = 0.0001;
        source.connect(g).connect(layerBus);
        source.start();
        entry = { source, gain: g };
        layers.set(id, entry);
      }
      entry.gain.gain.setTargetAtTime(linear, context.currentTime, 0.1);
    }

    function startRender(index) {
      const entry = { index, plan: null, buffer: null, failed: false };
      try {
        entry.plan = stream.next().plan;
      } catch (err) {
        console.error('compose failed', err);
        entry.failed = true;
        return entry;
      }
      renderPlan(entry.plan, { loadInstrument, sampleRate: context.sampleRate, gainDb: station.gainDb ?? 0 })
        .then((buffer) => { entry.buffer = buffer; onRendered(); })
        .catch((err) => { console.error('render failed', err); entry.failed = true; });
      return entry;
    }

    function pump() {
      if (disposed || paused || !composer) return;
      while (queue.length < PRERENDER_PHRASES) queue.push(startRender(nextIndex++));
      const head = queue[0];
      if (head.failed) {
        queue.shift();
        return;
      }
      if (!head.buffer) return;
      if (started && nextStart - context.currentTime > LOOKAHEAD_SECONDS) return;
      queue.shift();
      const when = Math.max(nextStart, context.currentTime + 0.06);
      const source = context.createBufferSource();
      source.buffer = head.buffer;
      source.connect(gain);
      source.start(when);
      scheduled.add(source);
      source.onended = () => scheduled.delete(source);
      started = true;
      nextStart = when + head.plan.seconds; // the tail beyond this overlaps the next phrase
      currentPlan = head.plan;
      onChange(state());
    }

    function state() {
      return { stationId: station.id, seed, plan: currentPlan ? summarize(currentPlan) : null };
    }

    return {
      station,
      gain,
      state,
      setLayerLevel,
      setTone(hz) { tone.frequency.setTargetAtTime(Math.min(20000, Math.max(300, hz)), context.currentTime, 0.1); },
      start(fadeSeconds) {
        nextStart = context.currentTime + 0.05;
        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(1, context.currentTime + Math.max(0.05, fadeSeconds));
        for (const [id, level] of Object.entries(layerLevels)) setLayerLevel(id, level);
        if (composer) {
          pump();
          timer = setInterval(pump, TICK_MS);
        }
      },
      /** Stop this station only (see the header): fade, stop what is scheduled, keep the rendered queue. */
      pause(fade = 0.12) {
        if (disposed || paused) return;
        paused = true;
        clearInterval(timer);
        timer = null;
        const now = context.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + fade);
        const stopAt = now + fade + 0.02;
        for (const source of scheduled) { try { source.stop(stopAt); } catch { /* already ended */ } }
        scheduled.clear();
        for (const entry of layers.values()) { try { entry.source?.stop(stopAt); } catch { /* already stopped */ } }
        layers.clear();
        started = false; // on resume the next rendered phrase starts right away
      },
      resume(fade = 0.3) {
        if (disposed || !paused) return;
        paused = false;
        const now = context.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(1, now + fade);
        nextStart = now + 0.05;
        for (const [id, level] of Object.entries(levels)) setLayerLevel(id, level);
        if (composer) {
          pump();
          timer = setInterval(pump, TICK_MS);
        }
      },
      isPaused: () => paused,
      /** Fade out and release everything after the fade. */
      stop(fadeSeconds) {
        if (disposed) return;
        disposed = true;
        clearInterval(timer);
        gain.gain.cancelScheduledValues(context.currentTime);
        gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + Math.max(0.05, fadeSeconds));
        setTimeout(() => {
          for (const entry of layers.values()) { try { entry.source?.stop(); } catch { /* ignore */ } }
          gain.disconnect();
        }, fadeSeconds * 1000 + 3500); // let reverb tails of the last phrase finish
      },
    };
  }

  function summarize(plan) {
    return { key: plan.key.name, mode: plan.key.mode, tempo: plan.tempo, progression: plan.progression, section: plan.section };
  }

  /** The shared context may have been suspended by the music manager while nothing was playing. */
  async function ensureRunning() {
    if (context.state !== 'running') await context.resume();
  }
  const isPaused = () => Boolean(session?.isPaused());

  return {
    /** Start (or switch to) a station. `crossfade` seconds blend from the previous one. */
    async play({ station, seed = String(Date.now()), params = {}, layers = {}, crossfade = 2, skipIntro = false }) {
      await ensureRunning();
      const previous = session;
      const layerLevels = { ...Object.fromEntries((station.layers ?? []).map((l) => [l.id, l.level])), ...layers };
      session = createSession({ station, seed, overrides: overridesFromParams(station, params), layerLevels, skipIntro });
      previous?.stop(crossfade);
      session.start(crossfade);
      onChange(session.state());
    },
    setLayerLevel(id, level) { session?.setLayerLevel(id, level); },
    setTone(hz) { session?.setTone(hz); },
    /** Pause this station only; the shared AudioContext keeps running for anything else (see the header). */
    pause() {
      if (!session || isPaused()) return;
      session.pause();
      onChange({ ...session.state(), paused: true });
    },
    async resume() {
      if (!session) return;
      await ensureRunning();
      session.resume();
      onChange(session.state());
    },
    stop(fade = 0.6) {
      session?.stop(fade);
      session = null;
      onChange({ stationId: null });
    },
    isActive: () => session !== null,
    isPaused,
    currentStationId: () => session?.station.id ?? null,
    state: () => (session ? { ...session.state(), paused: isPaused() } : { stationId: null, paused: false }),
  };
}
