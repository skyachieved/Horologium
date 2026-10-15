/*
 * Upright-style bass: a plucked sine with a touch of triangle and second harmonic, a short finger
 * click, and a low-pass that closes as the note decays. Used for walking lines and jazz balladry.
 */
import { midiToFreq, pluckEnv, noiseSource, filter } from '../synth/util.js';

export const meta = { id: 'upright-bass', roles: ['bass'] };

export function create(ctx, out) {
  return {
    play({ t, d, n, v }) {
      const f = midiToFreq(n);
      const hold = Math.max(d, 0.15);
      const lp = filter(ctx, 'lowpass', 520, 0.7);
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.setTargetAtTime(260, t + 0.01, 0.25);
      const master = ctx.createGain();
      master.gain.setValueAtTime(1, t);
      master.gain.setTargetAtTime(0, t + hold, 0.07);
      lp.connect(master).connect(out);

      [['sine', 1, 0.34], ['triangle', 1, 0.12], ['sine', 2, 0.07]].forEach(([type, mult, level]) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f * mult;
        const g = ctx.createGain();
        pluckEnv(g.gain, t, level * v, 0.008, 0.55);
        o.connect(g).connect(lp);
        o.start(t);
        o.stop(t + hold + 0.8);
      });

      const click = noiseSource(ctx, t, 0.03);
      const bp = filter(ctx, 'bandpass', 700, 1.5);
      const cg = ctx.createGain();
      pluckEnv(cg.gain, t, 0.05 * v, 0.001, 0.008);
      click.connect(bp).connect(cg).connect(master);
    },
  };
}
