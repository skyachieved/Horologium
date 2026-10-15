/* Boom-bap kit: deep, long kick, cracking snare with body, dusty hats. */
import { createKit } from '../synth/drums.js';

export const meta = { id: 'kit-boombap', roles: ['drums'] };

export const create = (ctx, out) => createKit(ctx, out, {
  kick: { start: 135, end: 42, drop: 0.11, decay: 0.5, gain: 1.0, click: 0.14 },
  snare: { noiseHz: 2300, noiseDecay: 0.14, bodyHz: 190, gain: 0.55, lowpass: 5200 },
  hat: { hp: 6000, bpHz: 8500, decay: 0.04, openDecay: 0.24, gain: 0.2 },
  ohat: { hp: 6000, bpHz: 8000, decay: 0.04, openDecay: 0.26, gain: 0.18 },
  rim: { gain: 0.4 },
  clap: { hz: 1300, gain: 0.4 },
});
