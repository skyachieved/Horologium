/*
 * A soft, felt-style piano from additive partials: higher partials die faster, a touch of inharmonicity,
 * a quiet hammer thump, and a damper release. Not a sampled grand, but warm and calm at low velocity.
 */
import { midiToFreq, pluckEnv, noiseSource, filter } from '../synth/util.js';

export const meta = { id: 'piano', roles: ['chords', 'melody'] };

const PARTIALS = [1, 0.55, 0.3, 0.16, 0.08];

export function create(ctx, out, params = {}) {
  const brightness = params.brightness ?? 1;
  return {
    play({ t, d, n, v }) {
      const f = midiToFreq(n);
      const hold = Math.max(d, 0.25);
      const tau = Math.min(2.0, Math.max(0.55, 1.9 - (n - 48) / 55));
      const lp = filter(ctx, 'lowpass', (1800 + 3600 * v) * brightness, 0.5);
      const master = ctx.createGain();
      master.connect(lp).connect(out);
      // damper: the whole note fades after `hold`
      master.gain.setValueAtTime(1, t);
      master.gain.setTargetAtTime(0, t + hold, 0.16);

      PARTIALS.forEach((amp, i) => {
        const k = i + 1;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * k * (1 + 0.0004 * k * k);
        const g = ctx.createGain();
        pluckEnv(g.gain, t, 0.16 * v * amp, 0.003, tau / (1 + 0.75 * i));
        o.connect(g).connect(master);
        o.start(t);
        o.stop(t + hold + 1.2);
      });

      const thump = noiseSource(ctx, t, 0.05);
      const bp = filter(ctx, 'bandpass', Math.min(f * 3, 3000), 1);
      const tg = ctx.createGain();
      pluckEnv(tg.gain, t, 0.05 * v, 0.001, 0.01);
      thump.connect(bp).connect(tg).connect(master);
    },
  };
}
