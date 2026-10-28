/*
 * Runs inside a hidden Chromium page (started by tools/audio-qa.js). Renders stations with the real
 * Web Audio engine (OfflineAudioContext) and reports objective measurements.
 */
import { compose } from '/ext/bundled/music-sources/generated/compose/compose.js';
import { createSongStream } from '/ext/bundled/music-sources/generated/compose/song.js';
import { renderPlan } from '/ext/bundled/music-sources/generated/synth/render.js';
import { noiseLoop, rms as rmsOf } from '/ext/bundled/music-sources/generated/synth/noise.js';
import { overridesFromParams } from '/ext/bundled/music-sources/generated/synth/engine.js';

const BASE = '/ext/bundled/music-sources/generated';
const loadInstrument = (id) => import(`${BASE}/instruments/${id}.js`);
const loadLayerModule = (def) => import(`${BASE}/${def.base.split('/').slice(2).join('/')}/${def.entry}`);

const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k += 1) {
        const wr = Math.cos(ang * k); const wi = Math.sin(ang * k);
        const a = i + k; const b = i + k + len / 2;
        const tr = re[b] * wr - im[b] * wi; const ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

/** Energy per band (dB relative to the loudest band) plus spectral centroid. */
function spectrum(data, sr) {
  const size = 8192;
  const acc = new Float64Array(size / 2);
  let frames = 0;
  for (let s = 0; s + size <= data.length && frames < 40; s += size * 2) {
    const re = new Float64Array(size); const im = new Float64Array(size);
    for (let i = 0; i < size; i += 1) re[i] = data[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
    fft(re, im);
    for (let k = 0; k < size / 2; k += 1) acc[k] += re[k] * re[k] + im[k] * im[k];
    frames += 1;
  }
  const edges = [0, 150, 500, 2000, 6000, 22050];
  const bands = new Array(edges.length - 1).fill(0);
  let num = 0; let den = 0; let weighted = 0; let above14k = 0;
  acc.forEach((p, k) => {
    const f = (k * sr) / size;
    for (let b = 0; b < bands.length; b += 1) if (f >= edges[b] && f < edges[b + 1]) bands[b] += p;
    num += f * p; den += p; weighted += p * aWeight(f) ** 2;
    if (f >= 14000) above14k += p;
  });
  const top = Math.max(...bands, 1e-12);
  return {
    bandsDb: bands.map((b) => Math.round(10 * Math.log10(Math.max(b, 1e-12) / top))),
    centroidHz: Math.round(den ? num / den : 0),
    aRatio: den ? weighted / den : 1, // fraction of power that survives A-weighting
    // energy above 14 kHz relative to all of it: for a station low-passed at <= 8 kHz this can only be resampling
    // images ("fizz"), the artifact behind the owner's "a bit of static" (fixed in render.js upsampleClean)
    above14kDb: Math.round(10 * Math.log10(Math.max(above14k, 1e-30) / Math.max(den, 1e-30))),
  };
}

/** IEC A-weighting as a linear amplitude factor (0 dB at 1 kHz). */
function aWeight(f) {
  if (f < 10) return 0;
  const f2 = f * f;
  const ra = (12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return ra * 1.2589;
}

function measure(channels, sr, seconds) {
  const n = Math.min(channels[0].length, Math.floor(seconds * sr));
  let peak = 0; let sum = 0; let dc = 0; let bad = 0;
  for (const ch of channels) {
    for (let i = 0; i < n; i += 1) {
      const v = ch[i];
      if (!Number.isFinite(v)) { bad += 1; continue; }
      peak = Math.max(peak, Math.abs(v)); sum += v * v; dc += v;
    }
  }
  const count = n * channels.length;
  const flatRms = Math.sqrt(sum / count);
  const spec = spectrum(channels[0], sr);
  return {
    peakDb: +db(peak).toFixed(1),
    rmsDb: +db(flatRms).toFixed(1),
    aRmsDb: +db(flatRms * Math.sqrt(spec.aRatio)).toFixed(1), // perceptual loudness (A-weighted)
    dc: +(dc / count / Math.max(flatRms, 1e-9)).toFixed(4), // relative to the signal, not absolute
    nonFinite: bad,
    bandsDb: spec.bandsDb,
    centroidHz: spec.centroidHz,
    above14kDb: spec.above14kDb,
  };
}

function layerChannels(def, sr) {
  if (def.kind === 'noise') return Promise.resolve([noiseLoop(def.noise.color, sr, 10)]);
  return loadLayerModule(def).then((m) => m.generate({ sampleRate: sr, seconds: 10 }));
}

const buffersToChannels = (buf) => Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));

/** RMS (dBFS) of samples [from, to) across channels. */
function windowDb(channels, from, to) {
  let sum = 0;
  let count = 0;
  for (const ch of channels) for (let i = Math.max(0, from); i < Math.min(ch.length, to); i += 1) { sum += ch[i] * ch[i]; count += 1; }
  return +db(Math.sqrt(sum / Math.max(1, count))).toFixed(1);
}

/**
 * A phrase buffer is played to its very last sample and then stops. If it is still sounding there (a reverb or
 * note tail cut off), that is an audible click at every phrase change: one candidate for the owner's "static".
 */
function edges(buffer) {
  const ch = buffersToChannels(buffer);
  const r = buffer.sampleRate;
  return { startDb: windowDb(ch, 0, Math.round(r * 0.005)), endDb: windowDb(ch, ch[0].length - Math.round(r * 0.01), ch[0].length) };
}

window.qaStation = async (registry, stationId, { phrases = 2, seedBase = 'qa', sampleRate = 44100, gainDbOverride = null } = {}) => {
  const gen = registry.generated;
  const station = gen.stations.find((s) => s.id === stationId);
  if (!station) throw new Error(`no station ${stationId}`);
  const library = { progressionBanks: gen.progressionBanks, grooves: gen.grooves };
  const out = { id: stationId, kind: station.composer ? 'composed' : 'layers', gainDb: gainDbOverride ?? station.gainDb, lowpassHz: station.composer?.fx.lowpassHz ?? null, phrases: [] };

  if (station.composer) {
    const overrides = overridesFromParams(station, {});
    const t0 = performance.now();
    for (let i = 0; i < phrases; i += 1) {
      const plan = compose({ composer: station.composer, library, seed: `${seedBase}:${stationId}:${i}`, overrides });
      let timing = null;
      const buffer = await renderPlan(plan, { loadInstrument, sampleRate, gainDb: out.gainDb, onTiming: (t) => { timing = t; } });
      out.timing = timing;
      out.phrases.push({ plan: { key: `${plan.key.name} ${plan.key.mode}`, tempo: plan.tempo, progression: plan.progression, seconds: +plan.seconds.toFixed(1), renderRate: buffer.sampleRate }, ...measure(buffersToChannels(buffer), buffer.sampleRate, plan.seconds), ...edges(buffer) });
    }
    out.renderMsPerPhrase = Math.round((performance.now() - t0) / phrases);
  } else {
    // layer-only station: measure its layers at their default levels, summed
    const parts = [];
    for (const ref of station.layers) {
      const def = gen.layers.find((l) => l.id === ref.id);
      const chans = await layerChannels(def, sampleRate);
      parts.push({ chans, k: ref.level * 10 ** ((def.gainDb ?? 0) / 20) * 10 ** (out.gainDb / 20) });
    }
    const len = Math.min(...parts.map((p) => p.chans[0].length));
    const mix = [new Float32Array(len), new Float32Array(len)];
    for (const { chans, k } of parts) for (let c = 0; c < 2; c += 1) { const src = chans[c] ?? chans[0]; for (let i = 0; i < len; i += 1) mix[c][i] += src[i] * k; }
    out.phrases.push({ plan: { layers: station.layers.map((l) => l.id).join('+') }, ...measure(mix, sampleRate, len / sampleRate) });
  }
  return out;
};

/** Render `seconds` of a station into one stereo WAV (phrases overlap-added) and return it base64-encoded. */
window.renderWav = async (registry, stationId, { seconds = 60, seed = 'render', sampleRate = 44100 } = {}) => {
  const gen = registry.generated;
  const station = gen.stations.find((s) => s.id === stationId);
  if (!station) throw new Error(`no station ${stationId}`);
  const total = Math.floor(seconds * sampleRate);
  const mix = [new Float32Array(total), new Float32Array(total)];
  // linear resampling to the output rate, as the browser does when it plays a half-rate buffer
  const addAt = (channels, offset, rate = sampleRate) => {
    const ratio = rate / sampleRate;
    for (let c = 0; c < 2; c += 1) {
      const src = channels[c] ?? channels[0];
      for (let i = 0; offset + i < total; i += 1) {
        const pos = i * ratio; const i0 = Math.floor(pos);
        if (i0 + 1 >= src.length) break;
        mix[c][offset + i] += src[i0] + (src[i0 + 1] - src[i0]) * (pos - i0);
      }
    }
  };
  if (station.composer) {
    const library = { progressionBanks: gen.progressionBanks, grooves: gen.grooves };
    const overrides = overridesFromParams(station, {});
    const probe = compose({ composer: station.composer, library, seed: `${seed}:0`, overrides });
    // the same song stream the app plays (intro, A, B, break..., new key per song)
    const stream = createSongStream({ composer: station.composer, library, seed, overrides: { ...overrides, key: probe.key.name, tempo: probe.tempo } });
    let at = 0;
    while (at < total) {
      const { plan } = stream.next();
      const buffer = await renderPlan(plan, { loadInstrument, sampleRate, gainDb: station.gainDb });
      addAt(buffersToChannels(buffer), at, buffer.sampleRate);
      at += Math.round(plan.seconds * sampleRate);
    }
  }
  for (const ref of station.layers) {
    const def = gen.layers.find((l) => l.id === ref.id);
    const chans = await layerChannels(def, sampleRate);
    const k = ref.level * 10 ** ((def.gainDb ?? 0) / 20);
    for (let c = 0; c < 2; c += 1) { const src = chans[c] ?? chans[0]; for (let i = 0; i < total; i += 1) mix[c][i] += src[i % src.length] * k; }
  }
  // 16-bit PCM WAV
  const bytes = new Uint8Array(44 + total * 4);
  const view = new DataView(bytes.buffer);
  const w = (o, s) => { for (let i = 0; i < s.length; i += 1) view.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); view.setUint32(4, 36 + total * 4, true); w(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); w(36, 'data'); view.setUint32(40, total * 4, true);
  for (let i = 0; i < total; i += 1) for (let c = 0; c < 2; c += 1) view.setInt16(44 + (i * 2 + c) * 2, Math.max(-1, Math.min(1, mix[c][i])) * 32767, true);
  let bin = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
};

window.qaReady = true;
