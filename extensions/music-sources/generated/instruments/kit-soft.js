/* Soft lofi kit: round kick, quiet dull snare, dark short hats. */
import { createKit } from '../synth/drums.js';

export const meta = { id: 'kit-soft', roles: ['drums'] };

export const create = (ctx, out) => createKit(ctx, out, {
  kick: { start: 120, end: 46, drop: 0.09, decay: 0.38, gain: 0.8, click: 0.1 },
  snare: { noiseHz: 1900, noiseDecay: 0.1, bodyHz: 175, gain: 0.34, lowpass: 3600 },
  hat: { hp: 6500, bpHz: 9500, decay: 0.03, openDecay: 0.2, gain: 0.16 },
  ohat: { hp: 6500, bpHz: 9000, decay: 0.03, openDecay: 0.2, gain: 0.14 },
  rim: { gain: 0.3 },
  shaker: { gain: 0.12 },
});
