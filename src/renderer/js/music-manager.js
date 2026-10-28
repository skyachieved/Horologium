/*
 * Music manager: owns the single AudioContext and master music bus, and the live instances of the
 * music sources. It lives at module level (not inside the widget) on purpose: changing theme, character
 * or language rebuilds the widget, but the music must keep playing through that.
 *
 * Only code-based sources (kind "generated" / "files") are instantiated here. Web sources (YouTube,
 * Spotify...) are not audio we generate; they are shown in sandboxed web views (see the web tabs).
 *
 * The AudioContext is SHARED by every source, so only this module suspends or resumes it: resume whenever
 * anything is about to play, suspend after a quiet spell with nothing playing (saves CPU). A source that
 * suspended it on its own once silenced the others (owner's note 15). While something plays, a watchdog checks
 * the context really runs, and soundCheck() lets the user (and `npm run test:ui`) verify the whole path.
 */
import * as S from './app-state.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { t, tn, language } from './i18n.js';
import { segmented, slider, toggle, row, section } from './controls.js';
import { toast } from './toast.js';
import { createSoundCheck } from './sound-check.js';

let audio = null;
const instances = new Map();
const wasPlaying = new Map(); // source id -> playing at the last change, to spot the moment one starts
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());
const resetListeners = new Set();
const IDLE_SUSPEND_MS = 15_000;
const WATCHDOG_MS = 3_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The last audio events (state changes, watchdog actions), shown by the sound check. */
const audioLog = [];
function logAudio(text) {
  audioLog.push({ at: Date.now(), text });
  if (audioLog.length > 20) audioLog.shift();
}
export const recentAudioEvents = () => [...audioLog];

/** Called whenever the audio is rebuilt (resetAudio): views holding a source instance must fetch it again. */
export const onReset = (fn) => {
  resetListeners.add(fn);
  return () => resetListeners.delete(fn);
};

export const onChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function gainFor(volume) {
  return volume.muted ? 0 : volume.master * volume.music;
}

/**
 * The shared audio graph, created on first use (browsers and CPU both prefer it lazy) and resumed if the idle
 * timer suspended it. Every source calls this before it plays.
 */
export async function ensureAudio() {
  if (!audio) {
    const context = new AudioContext({ latencyHint: 'playback' }); // fewer wake-ups than 'interactive'
    const output = context.createGain();
    output.gain.value = gainFor(S.getState().settings.volume);
    output.connect(context.destination);
    // a read-only tap after the volume: what actually goes to the speakers (sound check, tests)
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    output.connect(analyser);
    context.addEventListener('statechange', () => logAudio(`context ${context.state}`));
    audio = { context, output, analyser };
    logAudio(`context created (${context.sampleRate} Hz)`);
  }
  if (audio.context.state === 'suspended') {
    try {
      await audio.context.resume();
    } catch (err) {
      logAudio(`resume failed: ${err.message}`);
    }
  }
  updatePower();
  return audio;
}

const anyPlaying = () => [...instances.values()].some((s) => s.isPlaying?.());

// ---- power: suspend the shared context only when NOTHING has played for a while ----
let idleTimer = null;
function updatePower() {
  clearTimeout(idleTimer);
  if (anyPlaying()) {
    watchdog.start();
    return;
  }
  watchdog.stop();
  idleTimer = setTimeout(() => {
    if (audio && audio.context.state === 'running' && !anyPlaying()) audio.context.suspend().catch(() => {});
  }, IDLE_SUSPEND_MS);
}

// ---- watchdog: while something plays, the context must be running and its clock moving ----
const watchdog = (() => {
  let timer = null;
  let lastTime = null;
  let strikes = 0;
  let warned = false;
  async function check() {
    if (!audio || !anyPlaying()) return;
    const { context } = audio;
    if (context.state !== 'running') {
      strikes += 1;
      logAudio(`watchdog: context was ${context.state} while playing; resuming`);
      try { await context.resume(); } catch (err) { logAudio(`watchdog: resume failed: ${err.message}`); }
    } else if (lastTime !== null && context.currentTime - lastTime < (WATCHDOG_MS / 1000) * 0.3) {
      strikes += 1;
      logAudio('watchdog: the audio clock stalled; restarting it');
      try { await context.suspend(); await context.resume(); } catch { /* logged by statechange */ }
    } else {
      strikes = 0;
    }
    lastTime = context.currentTime;
    if (strikes >= 2 && !warned) {
      warned = true;
      toast(t('sound.stuck'), 'warn', 9000);
    }
  }
  return {
    start() {
      if (timer) return;
      lastTime = audio?.context.currentTime ?? null;
      strikes = 0;
      timer = setInterval(check, WATCHDOG_MS);
    },
    stop() {
      clearInterval(timer);
      timer = null;
      lastTime = null;
      strikes = 0;
      warned = false;
    },
  };
})();

/**
 * Rebuild the audio from scratch (Settings > Sound check > "Restart sound"): every source is disposed, the
 * context closed, and views that hold a source fetch a fresh one. Playback stops; the user presses play again.
 */
export async function resetAudio() {
  for (const source of instances.values()) {
    try { source.pause?.(); source.dispose?.(); } catch { /* keep going */ }
  }
  instances.clear();
  wasPlaying.clear();
  watchdog.stop();
  clearTimeout(idleTimer);
  const old = audio;
  audio = null;
  if (old) {
    try { await old.context.close(); } catch { /* already closed */ }
  }
  logAudio('audio restarted');
  resetListeners.forEach((fn) => fn());
  notify();
}

/**
 * Loudest RMS (dBFS) seen at the speaker tap over `ms` milliseconds. A suspended or stalled context plays nothing,
 * but its analyser keeps returning the last block it rendered, so a clock that did not move counts as silence.
 */
async function measureOutput(analyser, ms) {
  const { context } = analyser;
  const data = new Float32Array(analyser.fftSize);
  const t0 = context.currentTime;
  let peak = 0;
  for (let waited = 0; waited < ms; waited += 40) {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const x of data) sum += x * x;
    peak = Math.max(peak, Math.sqrt(sum / data.length));
    await sleep(40);
  }
  if (context.state !== 'running' || context.currentTime - t0 < (ms / 1000) * 0.5) return -Infinity;
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/**
 * Sound check (owner's note 15): verifies the whole path we control and plays two short notes the user should
 * hear. Each check is { id, ok: true | false | null (unknown), detail }. What we cannot measure is the OS side
 * (speaker volume, the chosen device, WSL's audio bridge), so the result ends with "did you hear it?".
 */
export async function soundCheck() {
  const checks = [];
  const a = await ensureAudio();
  const { context, output, analyser } = a;
  checks.push({ id: 'engine', ok: context.state === 'running', detail: context.state });

  const t0 = context.currentTime;
  await sleep(300);
  const advanced = context.currentTime - t0;
  checks.push({ id: 'clock', ok: advanced > 0.1, detail: `${Math.round(advanced * 1000)} ms / 300 ms` });

  const outputs = await audioOutputCount();
  checks.push({ id: 'device', ok: outputs === null ? null : outputs > 0, detail: outputs === null ? '?' : String(outputs) });

  const volume = S.getState().settings.volume;
  const level = gainFor(volume);
  checks.push({ id: 'volume', ok: level >= 0.05, detail: volume.muted ? 'muted' : `${Math.round(level * 100)}%` });

  // two short notes through the same bus as the music, measured after the volume
  const notes = [659.25, 880];
  const tone = context.createGain();
  tone.gain.value = 0.0001;
  tone.connect(output);
  notes.forEach((freq, i) => {
    const at = context.currentTime + 0.05 + i * 0.28;
    const osc = context.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    osc.connect(env).connect(tone);
    osc.start(at);
    osc.stop(at + 0.3);
  });
  tone.gain.setValueAtTime(1, context.currentTime);
  const peakDb = await measureOutput(analyser, 700);
  setTimeout(() => tone.disconnect(), 200);
  checks.push({ id: 'signal', ok: level >= 0.05 ? peakDb > -50 : null, detail: Number.isFinite(peakDb) ? `${Math.round(peakDb)} dB` : 'silent' });

  return {
    ok: checks.every((c) => c.ok !== false),
    checks,
    info: { sampleRate: context.sampleRate, baseLatencyMs: Math.round((context.baseLatency ?? 0) * 1000), outputLatencyMs: Math.round((context.outputLatency ?? 0) * 1000), wsl: Boolean(S.env.wsl) },
    events: recentAudioEvents(),
  };
}

/** Current level at the speaker tap in dBFS (tests and the sound check use it). */
export async function outputLevel(ms = 500) {
  if (!audio) return -Infinity;
  return measureOutput(audio.analyser, ms);
}

/** Apply the volume settings (optionally with live slider values that are not saved yet). */
export function applyVolume(preview = {}) {
  if (!audio) return;
  const volume = { ...S.getState().settings.volume, ...preview };
  audio.output.gain.setTargetAtTime(gainFor(volume), audio.context.currentTime, 0.05);
}

const urlFor = (origin, base, rel) => new URL(`ext/${origin}/${base}/${rel}`, document.baseURI).href;

/** The small, explicit API handed to a music source (it never imports shell internals). */
function apiFor() {
  return {
    h, icon, t, tn, lang: language, toast,
    controls: { segmented, slider, toggle, row, section, volume: volumeSection },
    registry: S.env.registry,
    state: { get: () => S.getState().music, patch: (partial) => S.patch({ music: partial }) },
    settings: () => S.getState().settings.music,
    audio: { ensure: ensureAudio },
    memory: { release: () => window.horologium.collectGarbage().catch(() => {}) }, // main throttles it
    files: {
      addFolder: () => window.horologium.mediaAdd(),
      removeFolder: (id) => window.horologium.mediaRemove({ id }),
      tracks: (id) => window.horologium.mediaTracks({ id }),
      folderUrl: (id, rel) => new URL(`media/${id}/${rel.split('/').map(encodeURIComponent).join('/')}`, document.baseURI).href,
      packUrl: (pack, rel) => new URL(`ext/${pack.origin}/${pack.base}/${rel.split('/').map(encodeURIComponent).join('/')}`, document.baseURI).href,
      packs: () => S.env.registry.musicPacks ?? [],
    },
    url: urlFor,
  };
}

/** Every music source (each becomes a sub-tab). */
export const musicSources = (registry) => registry.musicSources;
/** Sources we generate or play ourselves (they use the music volume), as opposed to web pages. */
export const codeSources = (registry) => registry.musicSources.filter((s) => s.kind !== 'web');

export async function getSource(id) {
  if (instances.has(id)) return instances.get(id);
  const def = S.env.registry.musicSources.find((s) => s.id === id);
  if (!def || def.kind === 'web') return null;
  const mod = await import(urlFor(def.origin, def.base, def.entry));
  const source = mod.default(apiFor());
  source.onChange?.(() => {
    exclusive(id, source);
    updatePower();
    notify();
  });
  instances.set(id, source);
  return source;
}

/** Title of whatever is playing, or null. */
export function nowPlaying() {
  for (const source of instances.values()) {
    const info = source.info?.();
    if (info?.playing) return info.title;
  }
  return null;
}

export function pauseAll() {
  for (const source of instances.values()) if (source.isPlaying?.()) source.pause();
}

/**
 * One audio at a time (owner's note 3): when a source starts, every other source pauses and web audio (a YouTube
 * page or the pinned mini player) is stopped. Chimes are not music and are never affected.
 */
function exclusive(id, source) {
  const playing = Boolean(source.isPlaying?.());
  const started = playing && !wasPlaying.get(id);
  wasPlaying.set(id, playing);
  if (!started) return;
  warnIfNoOutput();
  for (const [other, inst] of instances) if (other !== id && inst.isPlaying?.()) inst.pause();
  window.horologium.webTabSilence?.().catch(() => {});
}

// ...and when a web page starts playing, our own music pauses.
window.horologium?.onWebAudio?.(() => pauseAll());

/**
 * Linux without the PulseAudio client library (e.g. WSL with only libasound2) has NO audio output: Chromium plays
 * into a silent placeholder and everything looks fine. Measured on the owner's WSL: 0 outputs without libpulse0,
 * 2 with it. Say so once, with the fix, the first time something plays.
 */
let warnedNoOutput = false;
export async function audioOutputCount() {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput').length;
  } catch {
    return null;
  }
}
async function warnIfNoOutput() {
  if (warnedNoOutput || S.env.platform !== 'linux') return;
  const n = await audioOutputCount();
  if (n !== 0) return;
  warnedNoOutput = true;
  logAudio('no audio output device found');
  toast(t(S.env.wsl ? 'sound.noDeviceWsl' : 'sound.noDevice'), 'warn', 15000);
}

/** The Music tab's own volume control (owner's note 8): the same setting as Settings > Sound > Music volume. */
export function volumeSection() {
  const volume = () => S.getState().settings.volume;
  const check = createSoundCheck();
  return section(t('music.volume'),
    row(t('settings.volume.music'), slider({
      min: 0, max: 1, step: 0.05, value: volume().music, label: t('settings.volume.music'), format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => applyVolume({ music: v }),
      onChange: (v) => { S.setSetting('volume.music', v); applyVolume(); },
    })),
    volume().muted ? h('p', { class: 'hint' }, t('music.mutedHint')) : null,
    row(t('sound.check'), check.button),
    check.results);
}

// ---- "music follows my Pomodoro": play while focusing, pause otherwise ----
S.on('effect', async (e) => {
  if (e.type !== 'pomo-phase' || !S.getState().settings.music.followPomodoro) return;
  try {
    const source = await getSource(S.getState().music.source ?? 'generated');
    if (!source) return;
    if (e.running && e.phase === 'focus') {
      if (!source.isPlaying()) await source.play();
    } else if (source.isPlaying()) {
      source.pause();
    }
  } catch (err) {
    console.error('music follow failed', err);
  }
});
