/*
 * Warm pad: three slightly detuned triangle/saw voices through a low-pass, slow attack and release.
 */
import { midiToFreq, filter } from '../synth/util.js';

export const meta = { id: 'pad', roles: ['pad', 'chords'] };

export function create(ctx, out, params = {}) {
  const cutoff = params.cutoff ?? 1100;
  return {
    play({ t, d, n, v }) {
      const f = midiToFreq(n);
      const hold = Math.max(d, 0.5);
      const lp = filter(ctx, 'lowpass', cutoff, 0.6);
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.linearRampToValueAtTime(0.07 * v, t + 0.4);
      amp.gain.setTargetAtTime(0, t + hold, 0.45);
      lp.connect(amp).connect(out);
      [[-7, 'triangle'], [0, 'sawtooth'], [7, 'triangle']].forEach(([cents, type]) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        o.detune.value = cents;
        const g = ctx.createGain();
        g.gain.value = type === 'sawtooth' ? 0.5 : 1;
        o.connect(g).connect(lp);
        o.start(t);
        o.stop(t + hold + 2.0);
      });
    },
  };
}
