/*
 * __NAME_EN__ (starter instrument). The engine calls create() once per station and play() for every note:
 *   t  start time (audio-clock seconds)   d  length (seconds)   n  MIDI note number   v  velocity 0..1
 * Connect everything you make to `out` and stop it yourself (o.stop), or the nodes leak. Stations pick this
 * instrument by id in a voice: { "role": "__ROLE__", "instrument": "__ID__", "level": 1 }.
 */
import { midiToFreq, filter } from '../synth/util.js';

export const meta = { id: '__ID__', roles: ['__ROLE__'] };

export function create(ctx, out, params = {}) {
  const brightness = params.brightness ?? 2400;
  return {
    play({ t, d, n, v }) {
      const hold = Math.max(d, 0.1);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midiToFreq(n);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.3 * v, t + 0.01);
      g.gain.setTargetAtTime(0, t + hold, 0.12);
      const lp = filter(ctx, 'lowpass', brightness, 0.7);
      o.connect(g).connect(lp).connect(out);
      o.start(t);
      o.stop(t + hold + 1);
    },
  };
}
