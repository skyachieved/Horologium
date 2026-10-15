/*
 * A parametric drum machine. Each kit file (instruments/kit-*.js) is a spec: how every voice sounds.
 * Voices: kick, snare, hat, ohat, rim, clap, snap, brush, ride, shaker.
 * A voice that a groove asks for but the spec lacks is simply skipped.
 */
import { noiseSource, pluckEnv, filter } from './util.js';

const peak = (v, level) => Math.max(0.0003, v * level);

function kick(ctx, out, t, v, s) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(s.start, t);
  osc.frequency.exponentialRampToValueAtTime(s.end, t + s.drop);
  const g = ctx.createGain();
  pluckEnv(g.gain, t, peak(v, s.gain), 0.002, s.decay / 3.2);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + s.decay * 2);
  if (s.click) {
    const n = noiseSource(ctx, t, 0.02);
    const hp = filter(ctx, 'highpass', 1800);
    const cg = ctx.createGain();
    pluckEnv(cg.gain, t, peak(v, s.click), 0.001, 0.004);
    n.connect(hp).connect(cg).connect(out);
  }
}

function snare(ctx, out, t, v, s) {
  const n = noiseSource(ctx, t, s.noiseDecay * 6);
  const bp = filter(ctx, 'bandpass', s.noiseHz, 0.7);
  const hp = filter(ctx, 'highpass', 250);
  const ng = ctx.createGain();
  pluckEnv(ng.gain, t, peak(v, s.gain), 0.001, s.noiseDecay);
  n.connect(bp).connect(hp);
  let tail = hp;
  if (s.lowpass) {
    const lp = filter(ctx, 'lowpass', s.lowpass);
    hp.connect(lp);
    tail = lp;
  }
  tail.connect(ng).connect(out);
  const body = ctx.createOscillator();
  body.type = 'triangle';
  body.frequency.setValueAtTime(s.bodyHz * 1.4, t);
  body.frequency.exponentialRampToValueAtTime(s.bodyHz, t + 0.06);
  const bg = ctx.createGain();
  pluckEnv(bg.gain, t, peak(v, s.gain * 0.55), 0.001, 0.05);
  body.connect(bg).connect(out);
  body.start(t);
  body.stop(t + 0.4);
}

function hat(ctx, out, t, v, s, open) {
  const decay = open ? s.openDecay : s.decay;
  const n = noiseSource(ctx, t, decay * 7);
  const hp = filter(ctx, 'highpass', s.hp);
  const bp = filter(ctx, 'bandpass', s.bpHz, 0.8);
  const g = ctx.createGain();
  pluckEnv(g.gain, t, peak(v, s.gain * (open ? 0.8 : 1)), 0.001, decay);
  n.connect(hp).connect(bp).connect(g).connect(out);
}

function rim(ctx, out, t, v, s) {
  const n = noiseSource(ctx, t, 0.1);
  const bp = filter(ctx, 'bandpass', 1700, 1.2);
  const g = ctx.createGain();
  pluckEnv(g.gain, t, peak(v, s.gain), 0.001, 0.012);
  n.connect(bp).connect(g).connect(out);
  const click = ctx.createOscillator();
  click.type = 'sine';
  click.frequency.value = 1050;
  const cg = ctx.createGain();
  pluckEnv(cg.gain, t, peak(v, s.gain * 0.5), 0.001, 0.01);
  click.connect(cg).connect(out);
  click.start(t);
  click.stop(t + 0.1);
}

function clapLike(ctx, out, t, v, s, tail) {
  [0, 0.011, 0.022].forEach((offset, i) => {
    const at = t + offset;
    const n = noiseSource(ctx, at, tail * 7);
    const bp = filter(ctx, 'bandpass', s.hz, 1.1);
    const g = ctx.createGain();
    pluckEnv(g.gain, at, peak(v, s.gain * (i === 2 ? 1 : 0.7)), 0.001, i === 2 ? tail : 0.008);
    n.connect(bp).connect(g).connect(out);
  });
}

function brush(ctx, out, t, v, s) {
  const n = noiseSource(ctx, t, 0.9);
  const bp = filter(ctx, 'bandpass', s.hz, 0.5);
  const lp = filter(ctx, 'lowpass', 8500);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak(v, s.gain), t + 0.03);
  g.gain.setTargetAtTime(0, t + 0.03, s.decay);
  n.connect(bp).connect(lp).connect(g).connect(out);
}

function ride(ctx, out, t, v, s) {
  const n = noiseSource(ctx, t, 1.4);
  const bp = filter(ctx, 'bandpass', 7200, 1.4);
  const g = ctx.createGain();
  pluckEnv(g.gain, t, peak(v, s.gain), 0.002, s.decay);
  n.connect(bp).connect(g).connect(out);
  [1, 1.51, 2.04].forEach((ratio, i) => {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 3200 * ratio;
    const hp = filter(ctx, 'highpass', 5000);
    const og = ctx.createGain();
    pluckEnv(og.gain, t, peak(v, s.gain * 0.08), 0.002, s.decay * (1 - i * 0.2));
    o.connect(hp).connect(og).connect(out);
    o.start(t);
    o.stop(t + s.decay * 6);
  });
}

function shaker(ctx, out, t, v, s) {
  const n = noiseSource(ctx, t, 0.2);
  const hp = filter(ctx, 'highpass', 5500);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak(v, s.gain), t + 0.012);
  g.gain.setTargetAtTime(0, t + 0.012, 0.025);
  n.connect(hp).connect(g).connect(out);
}

const SYNTHS = {
  kick, snare, rim, brush, ride, shaker,
  hat: (ctx, out, t, v, s) => hat(ctx, out, t, v, s, false),
  ohat: (ctx, out, t, v, s) => hat(ctx, out, t, v, s, true),
  clap: (ctx, out, t, v, s) => clapLike(ctx, out, t, v, s, 0.14),
  snap: (ctx, out, t, v, s) => clapLike(ctx, out, t, v, s, 0.05),
};

const PAN = { hat: 0.25, ohat: 0.25, shaker: -0.3, ride: 0.2, brush: -0.15, rim: -0.1 };

/**
 * @param {BaseAudioContext} ctx
 * @param {AudioNode} out
 * @param {Record<string, object>} spec  voice name -> parameters
 */
export function createKit(ctx, out, spec) {
  const buses = {};
  const bus = (name) => {
    if (!buses[name]) {
      const g = ctx.createGain();
      if (ctx.createStereoPanner && PAN[name]) {
        const p = ctx.createStereoPanner();
        p.pan.value = PAN[name];
        g.connect(p).connect(out);
      } else {
        g.connect(out);
      }
      buses[name] = g;
    }
    return buses[name];
  };
  return {
    play({ t, n, v }) {
      const s = spec[n];
      if (s && SYNTHS[n]) SYNTHS[n](ctx, bus(n), t, v, s);
    },
  };
}
