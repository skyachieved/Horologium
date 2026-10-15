/*
 * Sub bass: a sine with a quick pitch drop at the start (the "boom"), a long sustain, and gentle
 * saturation so it stays audible on small speakers. Used by lofi, hip-hop and R&B stations.
 */
import { midiToFreq, filter } from '../synth/util.js';

export const meta = { id: 'sub-bass', roles: ['bass'] };

let curve = null;
function softClip() {
  if (!curve) {
    curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i += 1) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
    }
  }
  return curve;
}

export function create(ctx, out, params = {}) {
  const glide = params.glide ?? 1.5;
  return {
    play({ t, d, n, v }) {
      const f = midiToFreq(n);
      const hold = Math.max(d, 0.12);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * glide, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.035);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.5 * v, t + 0.014);
      g.gain.setTargetAtTime(0.42 * v, t + 0.014, 0.4);
      g.gain.setTargetAtTime(0, t + hold, 0.07);
      const shaper = ctx.createWaveShaper();
      shaper.curve = softClip();
      const lp = filter(ctx, 'lowpass', 240, 0.7);
      o.connect(g).connect(shaper).connect(lp).connect(out);
      o.start(t);
      o.stop(t + hold + 0.6);
    },
  };
}
