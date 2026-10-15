/* Rain layer: synthesized (no audio files): a steady wash plus individual drops, stereo, loopable. */
import { rainLoop } from '../../synth/noise.js';

export function generate({ sampleRate, seconds = 14 }) {
  return rainLoop(sampleRate, seconds);
}
