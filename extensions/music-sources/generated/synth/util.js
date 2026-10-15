/*
 * Small Web Audio helpers shared by instruments. These touch AudioContext objects, so they are NOT pure
 * (the pure composer lives in ../compose). Everything is deterministic: no Math.random(), so the same
 * Plan always renders to the same audio.
 */
export { midiToFreq } from '../compose/theory.js';

const noiseCache = new WeakMap();

/** Two seconds of deterministic white noise, cached per AudioContext. */
export function noiseBuffer(ctx) {
  let buffer = noiseCache.get(ctx);
  if (buffer) return buffer;
  const length = Math.floor(ctx.sampleRate * 2);
  buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let a = 0x9e3779b9;
  for (let i = 0; i < length; i += 1) {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    data[i] = ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
  }
  noiseCache.set(ctx, buffer);
  return buffer;
}

/** A looping noise source starting at time t, stopped at t + dur. The read offset depends on t, so hits differ. */
export function noiseSource(ctx, t, dur) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  src.start(t, (t * 7.31) % 1.5);
  src.stop(t + dur);
  return src;
}

/** Exponential-ish pluck envelope: quick attack to `peak`, then decay with time constant `tau`. */
export function pluckEnv(param, t, peak, attack, tau) {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  param.setTargetAtTime(0, t + attack, tau);
}

/** Sustained envelope: attack, hold at `peak` (decaying slowly toward sustain), release after `d`. */
export function sustainEnv(param, t, d, { peak, attack = 0.01, decayTau = 0.5, sustain = 0.6, release = 0.15 }) {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  param.setTargetAtTime(peak * sustain, t + attack, decayTau);
  param.setTargetAtTime(0, t + Math.max(d, attack + 0.02), release);
}

export function filter(ctx, type, frequency, q = 0.707) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = q;
  return f;
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
