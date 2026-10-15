/* Jazz brushes: a swirling brush swish for the ride pattern, a soft pedal hat, a feathered kick. */
import { createKit } from '../synth/drums.js';

export const meta = { id: 'kit-brushes', roles: ['drums'] };

export const create = (ctx, out) => createKit(ctx, out, {
  brush: { hz: 4600, decay: 0.16, gain: 0.3 },
  ride: { decay: 0.3, gain: 0.2 },
  hat: { hp: 5200, bpHz: 7500, decay: 0.05, openDecay: 0.2, gain: 0.2 },
  ohat: { hp: 5200, bpHz: 7500, decay: 0.05, openDecay: 0.2, gain: 0.16 },
  kick: { start: 100, end: 52, drop: 0.08, decay: 0.28, gain: 0.35, click: 0.04 },
  snare: { noiseHz: 3000, noiseDecay: 0.1, bodyHz: 190, gain: 0.25, lowpass: 5000 },
  rim: { gain: 0.3 },
});
