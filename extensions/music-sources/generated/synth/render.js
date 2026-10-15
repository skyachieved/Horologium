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
  // sample rate (about half the CPU). The browser resamples the buffer when it is played.
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
  const buffer = await ctx.startRendering();
  onTiming?.({ buildMs: Math.round(built - started), renderMs: Math.round(performance.now() - built), events: plan.voices.reduce((n, v) => n + v.events.length, 0) });
  return buffer;
}
