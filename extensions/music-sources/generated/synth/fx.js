/*
 * Master chain for a rendered phrase, plus the reverb impulse response.
 *   voices -> premaster -> tape wobble -> tone lowpass -> saturation -> DC blocker -> gentle compressor -> trim -> limiter -> out
 *   reverb send (chords/melody) -> convolver -> premaster
 */
import { filter, clamp } from './util.js';

/** Synthetic room: stereo noise with a smooth exponential decay and softened highs. Deterministic. */
export function impulseResponse(ctx, seconds = 2.4, decay = 3.4) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buffer.getChannelData(ch);
    let a = 0x1234567 + ch * 7919;
    let lp = 0;
    for (let i = 0; i < length; i += 1) {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      const noise = ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1;
      const x = i / length;
      lp += (noise - lp) * (0.55 - 0.4 * x); // darker as it decays
      data[i] = lp * (1 - x) ** decay;
    }
  }
  return buffer;
}

function saturationCurve(amount) {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = 1 + amount * 9;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / norm;
  }
  return curve;
}

function limiterCurve() {
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    curve[i] = Math.sign(x) * (a <= 0.6 ? a : 0.6 + 0.3 * Math.tanh((a - 0.6) / 0.3));
  }
  return curve;
}

/**
 * @returns {{ input: AudioNode, reverbSend: AudioNode }}
 */
export function createMasterChain(ctx, fx, gainDb = 0) {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  input.connect(dry);

  // tape wobble: a short delay whose time is modulated by a slow LFO (pitch flutter)
  let tail = dry;
  if (fx.wobble > 0.001) {
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.012;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.55;
    const depth = ctx.createGain();
    depth.gain.value = 0.0007 * fx.wobble; // +/- 0.7 ms at full amount
    lfo.connect(depth).connect(delay.delayTime);
    lfo.start(0);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 3.1;
    const depth2 = ctx.createGain();
    depth2.gain.value = 0.00015 * fx.wobble;
    lfo2.connect(depth2).connect(delay.delayTime);
    lfo2.start(0);
    dry.connect(delay);
    tail = delay;
  }

  const tone = filter(ctx, 'lowpass', clamp(fx.lowpassHz, 500, 20000), 0.6);
  tail.connect(tone);

  let post = tone;
  if (fx.saturation > 0.001) {
    const shaper = ctx.createWaveShaper();
    shaper.curve = saturationCurve(fx.saturation);
    shaper.oversample = '2x';
    tone.connect(shaper);
    post = shaper;
  }

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 18;
  comp.ratio.value = 2.5;
  comp.attack.value = 0.02;
  comp.release.value = 0.3;
  // DC blocker: the net area of decaying sub-bass and kick sines shows up as a slow drift below 20 Hz,
  // which eats headroom and does nothing audible. A gentle 25 Hz high-pass removes it.
  const dcBlock = filter(ctx, 'highpass', 25, 0.707);
  post.connect(dcBlock);
  dcBlock.connect(comp);

  const trim = ctx.createGain();
  trim.gain.value = 10 ** (gainDb / 20);
  comp.connect(trim);

  // safety limiter: transparent below 0.6, smoothly bends to a ceiling of 0.9 (about -0.9 dBFS)
  const limiter = ctx.createWaveShaper();
  limiter.curve = limiterCurve();
  limiter.oversample = '2x';
  trim.connect(limiter);
  limiter.connect(ctx.destination);

  // reverb returns into the chain before the tone filter so it is warmed like everything else
  const reverbSend = ctx.createGain();
  if (fx.reverb > 0.001) {
    const convolver = ctx.createConvolver();
    convolver.buffer = impulseResponse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = clamp(fx.reverb, 0, 1) * 0.9;
    reverbSend.connect(convolver).connect(wet).connect(input);
  }
  return { input, reverbSend };
}
