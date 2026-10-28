/*
 * Audio QA and WAV rendering, run with Electron (so it uses the same Web Audio engine as the app):
 *   npm run test:audio                        measure every station, fail on problems
 *   npm run test:audio -- <station> ...       measure only these stations
 *   npm run test:audio -- --calibrate         also print the gainDb that would hit the loudness target
 *   npm run render -- <station> [--seconds 60] [--seed 1] [--out file.wav]   (the render script adds --render)
 *
 * It starts a hidden window, serves the extensions through the same horologium:// protocol as the app,
 * and never plays any sound. Agents cannot listen, so this is how structure, loudness, clipping and
 * spectral balance are checked; the owner auditions by ear.
 */
import { app, BrowserWindow, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler, SCHEME } from '../src/main/protocol.js';
import { loadExtensions } from '../src/main/extensions.js';

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Under Electron, argv also carries Chromium switches and the script path itself; keep only our own arguments.
const args = process.argv.slice(1).filter((a) => !a.startsWith('--no-sandbox') && !a.startsWith('--disable-gpu') && !a.startsWith('--ozone') && !/audio-qa\.js$/.test(a));
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && ['seconds', 'seed', 'out', 'phrases', 'target', 'fx'].includes(args[i - 1].slice(2))));

const TARGET_A_RMS_DB = Number(value('target', -27)); // A-weighted, so bass rumble does not fool the comparison
const SPREAD_DB = 3;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

(async () => {
  await app.whenReady();
  const { registry } = loadExtensions({ bundledRoot: path.join(root, 'extensions') });
  protocol.handle(SCHEME, createHandler({
    rendererRoot: path.join(root, 'tools', 'audio-qa'),
    coreRoot: path.join(root, 'src', 'core'),
    bundledExtRoot: path.join(root, 'extensions'),
    userExtRoot: null,
  }));
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (e) => { if (e.level >= 2) console.error('[page]', e.message); });
  await win.loadURL(`${SCHEME}://app/index.html`);
  for (let i = 0; i < 100 && !(await win.webContents.executeJavaScript('window.qaReady === true')); i += 1) await new Promise((r) => setTimeout(r, 100));
  const run = (code) => win.webContents.executeJavaScript(code, true);
  // Diagnostic: --fx '{"reverb":0,"wobble":0}' overrides every composed station's fx (to see what costs CPU).
  if (value('fx', null)) for (const st of registry.generated.stations) if (st.composer) Object.assign(st.composer.fx, JSON.parse(value('fx', '{}')));
  const reg = JSON.stringify({ generated: registry.generated });

  // ----- WAV export -----
  if (flag('render')) {
    if (positional.length === 0) throw new Error('usage: npm run render -- <station> [--seconds 60] [--seed 1] [--out file.wav]');
    const id = positional[0];
    const seconds = Number(value('seconds', 60));
    const out = path.resolve(value('out', path.join(root, 'renders', `${id}.wav`)));
    const b64 = await run(`window.renderWav(${reg}, ${JSON.stringify(id)}, { seconds: ${seconds}, seed: ${JSON.stringify(value('seed', '1'))} })`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(b64, 'base64'));
    console.log(`wrote ${path.relative(root, out)} (${seconds}s)`);
    app.exit(0);
    return;
  }

  // ----- measurements -----
  const gen = registry.generated;
  const ids = positional.length ? positional : gen.stations.map((s) => s.id);
  const results = [];
  for (const id of ids) results.push(await run(`window.qaStation(${reg}, ${JSON.stringify(id)}, { phrases: ${Number(value('phrases', 2))} })`));

  const problems = [];
  const rows = results.map((r) => {
    const rmsDb = r.phrases.reduce((s, p) => s + p.rmsDb, 0) / r.phrases.length;
    const aDb = r.phrases.reduce((s, p) => s + p.aRmsDb, 0) / r.phrases.length;
    const peakDb = Math.max(...r.phrases.map((p) => p.peakDb));
    const centroid = Math.round(r.phrases.reduce((s, p) => s + p.centroidHz, 0) / r.phrases.length);
    const bands = r.phrases[0].bandsDb.join(' ');
    if (r.phrases.some((p) => p.nonFinite > 0)) problems.push(`${r.id}: produced NaN/Infinity samples`);
    if (rmsDb < -50) problems.push(`${r.id}: effectively silent (${rmsDb.toFixed(1)} dB RMS)`);
    if (peakDb > -0.9) problems.push(`${r.id}: peak ${peakDb} dBFS would clip`);
    if (r.phrases.some((p) => Math.abs(p.dc) > 0.03)) problems.push(`${r.id}: DC offset above 3 % of the signal (${r.phrases.map((p) => `${(p.dc * 100).toFixed(1)}%`).join(', ')})`);
    const endDb = Math.max(...r.phrases.map((p) => p.endDb ?? -Infinity));
    const fizzDb = Math.max(...r.phrases.map((p) => p.above14kDb ?? -Infinity));
    if (r.kind === 'composed' && r.lowpassHz <= 8000 && fizzDb > -90) problems.push(`${r.id}: ${fizzDb} dB of energy above 14 kHz in a station low-passed at ${r.lowpassHz} Hz: resampling images ("fizz", heard as static)`);
    if (endDb > -60) problems.push(`${r.id}: a phrase buffer still sounds at its last sample (${endDb} dB in the last 10 ms): an audible click at every phrase change`);
    return { id: r.id, kind: r.kind, rmsDb: +rmsDb.toFixed(1), aDb: +aDb.toFixed(1), peakDb, centroid, bands, gainDb: r.gainDb, endDb: Number.isFinite(endDb) ? endDb : '-', fizzDb: r.kind === 'composed' ? fizzDb : '-', ms: r.timing ? `${r.timing.buildMs}+${r.timing.renderMs} (${r.timing.events} ev)` : '-' };
  });
  const sorted = rows.map((r) => r.aDb).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  for (const r of rows) if (Math.abs(r.aDb - median) > SPREAD_DB) problems.push(`${r.id}: ${r.aDb} dB (A-weighted) is more than ${SPREAD_DB} dB from the median ${median} dB (switching stations would jump in volume)`);

  console.log('\nstation               kind      RMS dB  A-wtd dB  peak dB  end dB  >14k dB  centroid  bands(<150,<500,<2k,<6k,>6k)  gainDb  build+render ms');
  for (const r of rows) console.log(`${r.id.padEnd(21)} ${r.kind.padEnd(9)} ${String(r.rmsDb).padStart(6)}  ${String(r.aDb).padStart(8)}  ${String(r.peakDb).padStart(7)}  ${String(r.endDb).padStart(6)}  ${String(r.fizzDb).padStart(7)}  ${String(r.centroid).padStart(8)}  ${r.bands.padEnd(28)}  ${String(r.gainDb).padStart(6)}  ${r.ms}`);
  console.log(`median A-weighted ${median} dB; target ${TARGET_A_RMS_DB} dB; allowed spread +/-${SPREAD_DB} dB`);

  if (flag('calibrate')) {
    console.log('\nSuggested gainDb (current gainDb + distance to the target, capped so peaks stay under -1.5 dBFS):');
    for (const r of rows) {
      const wantRms = TARGET_A_RMS_DB - r.aDb;
      const headroom = -1.5 - r.peakDb;
      console.log(`  ${r.id.padEnd(21)} ${(r.gainDb + Math.min(wantRms, headroom)).toFixed(1)}`);
    }
  }
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n - ${problems.join('\n - ')}`);
    app.exit(1);
  } else {
    console.log('\nAll stations pass the audio checks.');
    app.exit(0);
  }
})().catch((err) => { console.error('audio-qa failed:', err); app.exit(1); });
