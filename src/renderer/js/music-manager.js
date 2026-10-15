/*
 * Music manager: owns the single AudioContext and master music bus, and the live instances of the
 * music sources. It lives at module level (not inside the widget) on purpose: changing theme, character
 * or language rebuilds the widget, but the music must keep playing through that.
 *
 * Only code-based sources (kind "generated" / "files") are instantiated here. Web sources (YouTube,
 * Spotify...) are not audio we generate; they are shown in sandboxed web views (see the web tabs).
 */
import * as S from './app-state.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { t, tn, language } from './i18n.js';
import { segmented, slider, toggle, row, section } from './controls.js';
import { toast } from './toast.js';

let audio = null;
const instances = new Map();
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export const onChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function gainFor(volume) {
  return volume.muted ? 0 : volume.master * volume.music;
}

/** Create the audio context on first use (browsers and CPU both prefer it lazy). */
export async function ensureAudio() {
  if (!audio) {
    const context = new AudioContext({ latencyHint: 'playback' }); // fewer wake-ups than 'interactive'
    const output = context.createGain();
    output.gain.value = gainFor(S.getState().settings.volume);
    output.connect(context.destination);
    audio = { context, output };
  }
  return audio;
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
    controls: { segmented, slider, toggle, row, section },
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
  source.onChange?.(notify);
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
