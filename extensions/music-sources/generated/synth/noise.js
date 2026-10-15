/*
 * Pure DSP for the continuous sound layers: white / pink / brown noise, rain and vinyl crackle.
 * No Web Audio here: every function returns plain Float32Arrays, so the spectra can be unit-tested in
 * Node (white is flat, pink falls 3 dB per octave, brown 6 dB). Deterministic per seed.
 * All loops are cross-faded at the seam and normalized to one RMS so layers mix predictably.
 */
import { createRng } from '../compose/rng.js';

/** Noise and rain are normalized to this RMS (-20 dBFS) before their level slider applies; vinyl is peak-normalized. */
export const TARGET_RMS = 0.1;

export function rms(data) {
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
  return Math.sqrt(sum / data.length);
}

/** Scale so the loudest sample is exactly `peak` (used for crackle, where RMS would make clicks clip). */
export function normalizePeak(data, peak = 0.6) {
  let max = 0;
  for (let i = 0; i < data.length; i += 1) max = Math.max(max, Math.abs(data[i]));
  if (max > 0) {
    const k = peak / max;
    for (let i = 0; i < data.length; i += 1) data[i] *= k;
  }
  return data;
}

/** Only turn things DOWN if they would exceed `peak`: keeps RMS-normalized layers from clipping. */
export function limitPeak(data, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < data.length; i += 1) max = Math.max(max, Math.abs(data[i]));
  if (max > peak) {
    const k = peak / max;
    for (let i = 0; i < data.length; i += 1) data[i] *= k;
  }
  return data;
}

export function normalizeRms(data, target = TARGET_RMS) {
  const r = rms(data);
  if (r > 0) {
    const k = target / r;
    for (let i = 0; i < data.length; i += 1) data[i] *= k;
  }
  return data;
}

/** RBJ biquad. type: 'lowpass' | 'highpass' | 'bandpass'. Returns an in-place processor. */
export function biquad(type, f0, q, fs) {
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  let b0; let b1; let b2;
  if (type === 'lowpass') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; }
  else if (type === 'highpass') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; }
  else { b0 = alpha; b1 = 0; b2 = -alpha; }
  const a0 = 1 + alpha;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  b0 /= a0; b1 /= a0; b2 /= a0;
  return (data) => {
    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    for (let i = 0; i < data.length; i += 1) {
      const x = data[i];
      const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      data[i] = y;
    }
    return data;
  };
}

const uniform = (rng, n) => {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = rng.next() * 2 - 1;
  return out;
};

export function whiteNoise(rng, n) {
  return uniform(rng, n);
}

/** Paul Kellet's refined pink filter (about -3 dB/octave across the audible band). */
export function pinkNoise(rng, n) {
  const out = new Float32Array(n);
  let b0 = 0; let b1 = 0; let b2 = 0; let b3 = 0; let b4 = 0; let b5 = 0; let b6 = 0;
  for (let i = 0; i < n; i += 1) {
    const w = rng.next() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return out;
}

/** Brown (red) noise: a leaky integral of white noise, then a very low high-pass to stop drift. */
export function brownNoise(rng, n, fs = 44100) {
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i += 1) {
    last = (last + 0.02 * (rng.next() * 2 - 1)) / 1.02;
    out[i] = last;
  }
  return biquad('highpass', 25, 0.707, fs)(out);
}

/**
 * Make a loop seamless: take `data` of length n + fade, return n samples whose start is an equal-power
 * cross-fade into the material that would have followed the end.
 */
export function seamless(data, fade) {
  const n = data.length - fade;
  const out = data.slice(0, n);
  for (let i = 0; i < fade; i += 1) {
    const a = i / fade;
    out[i] = data[i] * Math.sin((a * Math.PI) / 2) + data[n + i] * Math.cos((a * Math.PI) / 2);
  }
  return out;
}

/** A looping noise bed. color: 'white' | 'pink' | 'brown'. */
export function noiseLoop(color, sampleRate, seconds, seed = 'noise') {
  const rng = createRng(`${seed}:${color}`);
  const fade = Math.floor(sampleRate * 0.5);
  const n = Math.floor(sampleRate * seconds) + fade;
  const raw = color === 'pink' ? pinkNoise(rng, n) : color === 'brown' ? brownNoise(rng, n, sampleRate) : whiteNoise(rng, n);
  return normalizeRms(seamless(raw, fade));
}

function rainChannel(sampleRate, seconds, seed) {
  const rng = createRng(seed);
  const fade = Math.floor(sampleRate * 0.5);
  const n = Math.floor(sampleRate * seconds) + fade;
  // steady wash: band-limited noise
  const wash = uniform(rng, n);
  biquad('highpass', 500, 0.707, sampleRate)(wash);
  biquad('lowpass', 7500, 0.707, sampleRate)(wash);
  for (let i = 0; i < n; i += 1) wash[i] *= 0.5;
  // individual drops: short bright bursts at random times
  const drops = new Float32Array(n);
  const rate = 55; // drops per second
  const count = Math.floor((n / sampleRate) * rate);
  for (let d = 0; d < count; d += 1) {
    const at = Math.floor(rng.next() * (n - 400));
    const len = 60 + Math.floor(rng.next() * 260);
    const amp = (0.15 + rng.next() ** 3 * 0.85) * (rng.chance(0.5) ? 1 : 0.7);
    for (let i = 0; i < len; i += 1) drops[at + i] += (rng.next() * 2 - 1) * amp * Math.exp((-6 * i) / len);
  }
  biquad('bandpass', 4200, 0.6, sampleRate)(drops);
  const mix = new Float32Array(n);
  for (let i = 0; i < n; i += 1) mix[i] = wash[i] + drops[i] * 2.2;
  return limitPeak(normalizeRms(seamless(mix, fade)), 0.9);
}

/** Stereo rain loop: [left, right] with different drops per ear. */
export function rainLoop(sampleRate, seconds, seed = 'rain') {
  return [rainChannel(sampleRate, seconds, `${seed}:L`), rainChannel(sampleRate, seconds, `${seed}:R`)];
}

function vinylChannel(sampleRate, seconds, seed) {
  const rng = createRng(seed);
  const fade = Math.floor(sampleRate * 0.5);
  const n = Math.floor(sampleRate * seconds) + fade;
  const out = new Float32Array(n);
  // surface hiss
  const hiss = uniform(rng, n);
  biquad('highpass', 2500, 0.707, sampleRate)(hiss);
  for (let i = 0; i < n; i += 1) out[i] = hiss[i] * 0.05;
  // crackle: sparse clicks with an exponential decay, plus rarer louder pops
  const addClick = (at, amp, len) => {
    const sign = rng.chance(0.5) ? 1 : -1;
    for (let i = 0; i < len && at + i < n; i += 1) out[at + i] += sign * amp * Math.exp((-5 * i) / len) * (0.6 + 0.4 * rng.next());
  };
  const seconds2 = n / sampleRate;
  for (let c = 0; c < Math.floor(seconds2 * 9); c += 1) addClick(Math.floor(rng.next() * (n - 200)), 0.15 + rng.next() ** 2 * 0.5, 20 + Math.floor(rng.next() * 60));
  for (let c = 0; c < Math.floor(seconds2 * 0.6); c += 1) addClick(Math.floor(rng.next() * (n - 400)), 0.7 + rng.next() * 0.3, 80 + Math.floor(rng.next() * 200));
  // faint low rumble
  const rumble = brownNoise(rng, n, sampleRate);
  biquad('lowpass', 60, 0.707, sampleRate)(rumble);
  const rumbleRms = rms(rumble) || 1;
  for (let i = 0; i < n; i += 1) out[i] += (rumble[i] / rumbleRms) * 0.01;
  // clicks must stay below full scale: normalize by PEAK, not RMS (crackle has a very high crest factor)
  return normalizePeak(seamless(out, fade), 0.6);
}

/** Stereo vinyl crackle loop. */
export function vinylLoop(sampleRate, seconds, seed = 'vinyl') {
  return [vinylChannel(sampleRate, seconds, `${seed}:L`), vinylChannel(sampleRate, seconds, `${seed}:R`)];
}
