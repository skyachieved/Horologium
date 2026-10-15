/*
 * __NAME_EN__ layer (starter). Synthesized the first time a station uses it; no audio files.
 *
 * generate() returns one Float32Array per channel and the engine loops the result, so it must be seamless:
 * build `seconds + fade` samples and let seamless() cross-fade the end into the start. Normalize with
 * normalizeRms() (steady beds) or normalizePeak() (sparse clicks) so the level slider behaves like the other
 * layers. Keep this pure (no Web Audio) so it can be tested in Node.
 */
import { createRng } from '../../compose/rng.js';
import { pinkNoise, biquad, seamless, normalizeRms } from '../../synth/noise.js';

function channel(sampleRate, seconds, seed) {
  const rng = createRng(seed);
  const fade = Math.floor(sampleRate * 0.5);
  const n = Math.floor(sampleRate * seconds) + fade;
  const data = pinkNoise(rng, n);
  biquad('lowpass', 900, 0.707, sampleRate)(data); // a soft, dark hush: replace this with your own sound
  return normalizeRms(seamless(data, fade));
}

export function generate({ sampleRate, seconds = 10 }) {
  return [channel(sampleRate, seconds, '__ID__:L'), channel(sampleRate, seconds, '__ID__:R')];
}
