import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// import() takes a URL: a bare Windows path (D:\...) is refused (found by the Windows CI run)
const noise = await import(pathToFileURL(path.join(root, 'extensions', 'music-sources', 'generated', 'synth', 'noise.js')).href);

const SR = 44100;

/** Iterative radix-2 FFT (in place). */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1; let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = i + k; const b = i + k + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

/** Welch power spectral density (power per Hz), Hann window, 50% overlap. Returns { freqs, psd }. */
function psd(data, size = 4096) {
  const bins = size / 2;
  const acc = new Float64Array(bins);
  let frames = 0;
  const win = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
  for (let start = 0; start + size <= data.length; start += size / 2) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size; i += 1) re[i] = data[start + i] * win[i];
    fft(re, im);
    for (let k = 0; k < bins; k += 1) acc[k] += re[k] * re[k] + im[k] * im[k];
    frames += 1;
  }
  return { freqs: Float64Array.from({ length: bins }, (_, k) => (k * SR) / size), psd: acc.map((v) => v / frames) };
}

/** Least-squares slope of log2(PSD) (in dB) against log2(frequency): dB per octave. */
function slopeDbPerOctave({ freqs, psd: p }, lo, hi) {
  const xs = [];
  const ys = [];
  // average PSD into log-spaced bands so low frequencies are not over-weighted
  for (let f = lo; f < hi; f *= 2 ** 0.25) {
    let sum = 0; let count = 0;
    freqs.forEach((fq, i) => { if (fq >= f && fq < f * 2 ** 0.25) { sum += p[i]; count += 1; } });
    if (count) { xs.push(Math.log2(f)); ys.push(10 * Math.log10(sum / count)); }
  }
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return num / den;
}

test('noise loops are normalized to the shared RMS (-20 dBFS)', () => {
  for (const color of ['white', 'pink', 'brown']) {
    const data = noise.noiseLoop(color, SR, 6);
    assert.ok(Math.abs(noise.rms(data) - noise.TARGET_RMS) < 0.002, `${color}: ${noise.rms(data)}`);
    assert.ok(data.every(Number.isFinite));
  }
});

test('white noise is spectrally flat; pink falls about 3 dB/octave; brown about 6 dB/octave', () => {
  const white = slopeDbPerOctave(psd(noise.noiseLoop('white', SR, 20)), 200, 10000);
  const pink = slopeDbPerOctave(psd(noise.noiseLoop('pink', SR, 20)), 200, 10000);
  const brown = slopeDbPerOctave(psd(noise.noiseLoop('brown', SR, 20)), 200, 10000);
  assert.ok(Math.abs(white) < 1, `white slope ${white.toFixed(2)} dB/oct`);
  assert.ok(pink < -2.2 && pink > -3.8, `pink slope ${pink.toFixed(2)} dB/oct`);
  assert.ok(brown < -5 && brown > -7, `brown slope ${brown.toFixed(2)} dB/oct`);
  assert.ok(white > pink && pink > brown, 'ordering: white > pink > brown');
});

test('loops are seamless: no jump at the loop point larger than normal sample-to-sample movement', () => {
  for (const color of ['white', 'pink', 'brown']) {
    const data = noise.noiseLoop(color, SR, 4);
    const jump = Math.abs(data[0] - data[data.length - 1]);
    let typical = 0;
    for (let i = 1; i < data.length; i += 1) typical += Math.abs(data[i] - data[i - 1]);
    typical /= data.length - 1;
    assert.ok(jump < typical * 8 + 1e-6, `${color}: loop jump ${jump} vs typical ${typical}`);
  }
});

test('rain and vinyl are stereo, finite, loopable, never clip, and the two ears differ', () => {
  for (const [name, make] of [['rain', noise.rainLoop], ['vinyl', noise.vinylLoop]]) {
    const [l, r] = make(SR, 5);
    assert.equal(l.length, r.length);
    assert.ok(l.every(Number.isFinite) && r.every(Number.isFinite));
    let diff = 0;
    for (let i = 0; i < l.length; i += 1) diff += Math.abs(l[i] - r[i]);
    assert.ok(diff / l.length > 0.005, `${name}: channels should be decorrelated`);
    for (const ch of [l, r]) {
      let peak = 0;
      for (const v of ch) peak = Math.max(peak, Math.abs(v));
      assert.ok(peak <= 0.9 + 1e-6, `${name}: peak ${peak} would clip at full level`);
    }
  }
  const [rain] = noise.rainLoop(SR, 5);
  assert.ok(noise.rms(rain) > 0.06 && noise.rms(rain) <= 0.1 + 1e-6, `rain rms ${noise.rms(rain)}`);
});

test('rain is bright (hiss and drops) while vinyl has distinct clicks above its hiss floor', () => {
  const [rain] = noise.rainLoop(SR, 8);
  const spec = psd(rain);
  const band = (lo, hi) => spec.freqs.reduce((s, f, i) => (f >= lo && f < hi ? s + spec.psd[i] : s), 0);
  assert.ok(band(2000, 8000) > band(50, 400) * 3, 'rain energy should sit in the highs');

  const [vinyl] = noise.vinylLoop(SR, 8);
  let peak = 0;
  for (const v of vinyl) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak / noise.rms(vinyl) > 6, `vinyl crest factor ${peak / noise.rms(vinyl)} (crackle should poke out of the hiss)`);
});

test('noise generation is deterministic', () => {
  assert.deepEqual(noise.noiseLoop('pink', 8000, 1, 's'), noise.noiseLoop('pink', 8000, 1, 's'));
  assert.notDeepEqual(noise.noiseLoop('pink', 8000, 1, 's'), noise.noiseLoop('pink', 8000, 1, 't'));
});
