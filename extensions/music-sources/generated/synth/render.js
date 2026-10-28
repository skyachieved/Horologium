/*
 * Plan -> audio. Renders one phrase with an OfflineAudioContext (on the audio thread, so the UI stays
 * responsive) into a stereo AudioBuffer. The buffer is longer than the phrase: the extra seconds are the
 * reverb/decay tail, which the engine overlaps onto the next phrase for seamless playback.
 */
import { createMasterChain } from './fx.js';

/** How much of each role goes to the reverb. Bass stays dry; melody and pads bloom. */
const REVERB_SEND = { chords: 0.7, pad: 0.9, melody: 1, bass: 0, drums: 0.12 };

/**
 * @param {object} plan  output of compose()
 * @param {object} opts
 * @param {(id: string) => Promise<{create: Function}>} opts.loadInstrument
 * @param {number} [opts.sampleRate]
 * @param {number} [opts.gainDb]   station loudness trim
 * @param {number} [opts.tailSeconds]
 * @param {typeof OfflineAudioContext} [opts.OfflineContext]
 * @param {(t: {buildMs: number, renderMs: number, nodes: number}) => void} [opts.onTiming]  diagnostics
 */
export async function renderPlan(plan, { loadInstrument, sampleRate = 44100, gainDb = 0, tailSeconds = 3.2, OfflineContext = globalThis.OfflineAudioContext, onTiming }) {
  const started = performance.now();
  // Stations low-passed at 8 kHz or below carry nothing above ~11 kHz anyway, so render them at half the
  // sample rate (about half the CPU), then upsample cleanly (upsampleClean, below) before anything plays it.
  const renderRate = plan.fx.lowpassHz <= 8000 ? Math.round(sampleRate / 2) : sampleRate;
  const length = Math.ceil((plan.seconds + tailSeconds) * renderRate);
  const ctx = new OfflineContext(2, length, renderRate);
  const chain = createMasterChain(ctx, plan.fx, gainDb);

  const modules = await Promise.all(plan.voices.map((v) => loadInstrument(v.instrument)));
  const secPerBeat = 60 / plan.tempo;

  plan.voices.forEach((voice, i) => {
    const bus = ctx.createGain();
    bus.gain.value = voice.level;
    bus.connect(chain.input);
    const send = ctx.createGain();
    send.gain.value = REVERB_SEND[voice.role] ?? 0.3;
    bus.connect(send);
    send.connect(chain.reverbSend);

    const instrument = modules[i].create(ctx, bus, voice.params);
    for (const ev of voice.events) {
      instrument.play({ t: ev.t * secPerBeat, d: ev.d * secPerBeat, n: ev.n, v: ev.v });
    }
  });
  const built = performance.now();
  const rendered = await ctx.startRendering();
  const buffer = renderRate === sampleRate ? rendered : await upsampleClean(rendered, sampleRate, OfflineContext);
  onTiming?.({ buildMs: Math.round(built - started), renderMs: Math.round(performance.now() - built), events: plan.voices.reduce((n, v) => n + v.events.length, 0) });
  return buffer;
}

// Butterworth 8th order as four biquads. Web Audio's lowpass Q is in dB, so these are 20*log10 of the classic
// linear Qs (0.5098, 0.6013, 0.9000, 2.5629).
const BUTTERWORTH_8_Q_DB = [-5.85, -4.42, -0.92, 8.17];
const IMAGE_CUTOFF_HZ = 9500;

/**
 * Bring a half-rate phrase up to the playback rate WITHOUT the "fizz". Chromium resamples a buffer whose rate
 * differs from the context's with linear interpolation, which mirrors the content around the half-rate Nyquist
 * (11 kHz): measured, a lofi phrase gained 30-60 dB of energy above 14 kHz that the music does not contain, more
 * than its own treble (owner's note 13, "a bit of static"). So resample once here, on the audio thread, and strip
 * the mirror images with a steep low-pass well above anything a low-passed station plays (its lowpass is <= 8 kHz).
 */
async function upsampleClean(buffer, rate, OfflineContext) {
  const ctx = new OfflineContext(buffer.numberOfChannels, Math.ceil(buffer.duration * rate), rate);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  let node = source;
  for (const q of BUTTERWORTH_8_Q_DB) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = IMAGE_CUTOFF_HZ;
    f.Q.value = q;
    node.connect(f);
    node = f;
  }
  node.connect(ctx.destination);
  source.start();
  return ctx.startRendering();
}
