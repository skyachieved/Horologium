/*
 * Electric piano (Rhodes-like): two-operator FM with a decaying modulation index (the "bark" fades to a
 * soft bell), a detuned twin for chorus warmth, and a velocity-controlled brightness filter.
 */
import { midiToFreq, sustainEnv, filter } from '../synth/util.js';

export const meta = { id: 'epiano', roles: ['chords', 'pad', 'melody'] };

export function create(ctx, out, params = {}) {
  const warmth = params.warmth ?? 1;
  return {
    play({ t, d, n, v }) {
      const f = midiToFreq(n);
      const hold = Math.max(d, 0.2);
      const amp = ctx.createGain();
      const lp = filter(ctx, 'lowpass', Math.min(1400 + 4200 * v, 5200) * warmth, 0.5);
      amp.connect(lp).connect(out);
      sustainEnv(amp.gain, t, hold, { peak: 0.2 * v, attack: 0.006, decayTau: 0.45, sustain: 0.55, release: 0.22 });

      const end = t + hold + 1.2;
      // main voice: a two-operator FM pair
      const carrier = ctx.createOscillator();
      carrier.type = 'sine';
      carrier.frequency.value = f;
      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.value = f;
      const index = ctx.createGain();
      index.gain.setValueAtTime(f * (1.1 + 1.7 * v), t);
      index.gain.setTargetAtTime(f * 0.22, t, 0.32);
      mod.connect(index).connect(carrier.frequency);
      carrier.connect(amp);
      carrier.start(t);
      mod.start(t);
      carrier.stop(end);
      mod.stop(end);
      // chorus twin: a plain, slightly detuned sine (a third of the cost of a second FM pair)
      const twin = ctx.createOscillator();
      twin.type = 'sine';
      twin.frequency.value = f * 1.0035;
      const tg = ctx.createGain();
      tg.gain.value = 0.4;
      twin.connect(tg).connect(amp);
      twin.start(t);
      twin.stop(end);
    },
  };
}
