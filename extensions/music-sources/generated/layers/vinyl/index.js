/* Vinyl layer: surface hiss, crackle and pops, plus a faint rumble. Synthesized, stereo, loopable. */
import { vinylLoop } from '../../synth/noise.js';

export function generate({ sampleRate, seconds = 14 }) {
  return vinylLoop(sampleRate, seconds);
}
