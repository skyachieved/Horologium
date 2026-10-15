/* R&B kit: tight kick, finger snaps and claps on the backbeat, crisp 16th hats. */
import { createKit } from '../synth/drums.js';

export const meta = { id: 'kit-rnb', roles: ['drums'] };

export const create = (ctx, out) => createKit(ctx, out, {
  kick: { start: 125, end: 48, drop: 0.07, decay: 0.3, gain: 0.85, click: 0.12 },
  snap: { hz: 1700, gain: 0.5 },
  clap: { hz: 1400, gain: 0.32 },
  snare: { noiseHz: 2100, noiseDecay: 0.12, bodyHz: 200, gain: 0.4, lowpass: 6000 },
  hat: { hp: 7200, bpHz: 10500, decay: 0.028, openDecay: 0.22, gain: 0.18 },
  ohat: { hp: 7200, bpHz: 10000, decay: 0.028, openDecay: 0.22, gain: 0.16 },
  rim: { gain: 0.3 },
  shaker: { gain: 0.14 },
});
