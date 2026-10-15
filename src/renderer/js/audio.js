/*
 * Chimes: tiny synthesized note sequences defined by the active theme (chimes.json). No audio files.
 * Volume = master x chimes, and a global mute. The AudioContext is created lazily.
 */
let ctx = null;
let chimes = {};
let volume = { master: 0.8, chimes: 0.8, muted: false };

export function setChimes(set) {
  chimes = set ?? {};
}

export function setVolume(v) {
  volume = { ...volume, ...v };
}

function context() {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** Play one named chime ('focusEnd', 'drinkDue', ...). `scale` lets a caller soften a sound. */
export function play(event, scale = 1) {
  const notes = chimes[event];
  const level = volume.master * volume.chimes * scale;
  if (!notes || volume.muted || level <= 0.001) return;

  const audio = context();
  const start = audio.currentTime + 0.02;
  for (const note of notes) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const at = start + note.at;
    const peak = Math.max(0.0002, note.gain * level);
    osc.type = note.type;
    osc.frequency.value = note.freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + note.dur);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + note.dur + 0.05);
  }
}
