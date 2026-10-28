/*
 * End-to-end UI check: `npm run test:ui` (runs under Electron, like `npm run test:audio`).
 *
 * Starts the REAL app headlessly (hidden window, a throwaway profile, nothing appears on screen) and drives it
 * with TRUSTED input through the DevTools protocol (Input.dispatchMouseEvent / dispatchKeyEvent). Synthetic
 * element.dispatchEvent() skips pointer capture and focus rules, which once let a dead click on the character
 * pass every test (see AGENTS.md). Any renderer error fails the run: a single typo once broke the whole UI while
 * every unit test stayed green.
 *
 * Each check is named after the owner's note it protects. Exit code 1 if anything fails.
 */
import { app } from 'electron';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'horologium-ui-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
app.disableHardwareAcceleration();

const rendererErrors = [];
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (e) => { if (e.level === 'error') rendererErrors.push(e.message); });
  wc.on('render-process-gone', (_e, d) => rendererErrors.push(`renderer gone: ${d.reason}`));
});

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

/** A 12 s two-tone WAV, so "My music" has something real to play. */
function writeWav(file, seconds = 12, rate = 22050) {
  const n = seconds * rate;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    const s = 0.25 * Math.sin(2 * Math.PI * 220 * t) + 0.15 * Math.sin(2 * Math.PI * 330 * t);
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

/** A fake GitHub "latest release" API, so the update flow is tested without the network (notes 11, 12). */
function fakeReleaseFeed() {
  const release = {
    tag_name: 'v9.9.9',
    html_url: 'https://github.com/skyachieved/Horologium/releases/tag/v9.9.9',
    published_at: '2026-12-01T00:00:00Z',
    body: '## Big news\n- **Bold** sprites\n<img src=x onerror="document.title=\'pwned\'">Plain text only',
  };
  const feed = { down: false };
  feed.server = http.createServer((_req, res) => {
    if (feed.down) { res.writeHead(500); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(release));
  });
  return new Promise((resolve) => feed.server.listen(0, '127.0.0.1', () => resolve(Object.assign(feed, { url: `http://127.0.0.1:${feed.server.address().port}/latest` }))));
}

(async () => {
  const feed = await fakeReleaseFeed();
  const { startApp } = await import(pathToFileURL(path.join(root, 'src/main/app.js')).href);
  const { win, view, updates } = await startApp({ headless: true, userDataDir, updateFeed: feed.url });
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code, true);
  const dbg = wc.debugger;
  dbg.attach('1.3');
  const mouse = async (x, y) => {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await dbg.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
    }
  };
  const key = async (k, code, vk, modifiers = 0) => {
    for (const type of ['rawKeyDown', 'keyUp']) await dbg.sendCommand('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, modifiers });
  };
  /** Center of the first element matching a JS expression, scrolled into view. */
  const centerOf = async (expr) => JSON.parse(await js(`(() => { const el = ${expr}; if (!el) return 'null'; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }); })()`));
  const clickOn = async (expr) => { const p = await centerOf(expr); if (!p) throw new Error(`nothing to click: ${expr}`); await mouse(p.x, p.y); };
  const mode = () => js(`document.querySelector('#app').dataset.mode`);
  /** Wait for the pop-in/pop-out to finish: a hidden window renders no animation frames, so the stage sits at the
   *  animation's first frame (the character starts off to the side) until the widget's 1.1 s fallback clears it. */
  const settle = async () => {
    for (let i = 0; i < 40; i += 1) {
      if (!(await js(`/is-(entering|leaving)/.test(document.querySelector('#stage').className)`))) return;
      await sleep(100);
    }
  };
  const tab = (label) => `[...document.querySelectorAll('.tab')].find((b) => b.textContent.includes(${JSON.stringify(label)}))`;
  const disk = () => JSON.parse(fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8'));

  await sleep(3000);
  const problems = JSON.parse(await js(`window.horologium.init().then((s) => JSON.stringify(s.problems.length))`));
  check('boots: every extension loads', problems === 0, `${problems} problem(s)`);

  // ---- notes 1, 5, 6, 7: three view states, a real click on the icon, Esc ----
  const steps = [];
  for (const dir of ['right', 'right', 'right', 'left', 'right', 'right', 'left']) {
    view.move(dir);
    await sleep(dir === 'right' && view.current() === 'hidden' ? 1400 : 1000);
    steps.push(view.current());
  }
  check('hotkeys walk menu <-> icon <-> hidden (note 5)', steps.join(',') === 'icon,hidden,menu,menu,icon,hidden,icon', steps.join(' > '));
  await settle();
  await clickOn(`document.querySelector('.char-btn')`);
  await sleep(900);
  check('a real mouse click on the icon opens the menu (notes 1, 6, 7)', (await mode()) === 'expanded' && view.current() === 'menu');
  await key('Escape', 'Escape', 27);
  await sleep(900);
  check('Esc moves from the menu to the icon (note 5)', view.current() === 'icon');
  view.goTo('menu');
  await sleep(1000);

  // ---- note 4: the profile is remembered ----
  await clickOn(tab('Water'));
  await sleep(600);
  const typeInto = async (label, text) => {
    await clickOn(`[...document.querySelectorAll('.profile-form input')].find((i) => (i.getAttribute('aria-label') || '').startsWith(${JSON.stringify(label)}))`);
    await key('a', 'KeyA', 65, process.platform === 'darwin' ? 4 : 2);
    await dbg.sendCommand('Input.insertText', { text });
  };
  await typeInto('Height', '181');
  await typeInto('Weight', '74');
  await sleep(1200);
  check('typed height/weight are kept as a draft on disk (note 4)', disk().hydration.profileDraft?.heightCm === 181 && disk().hydration.profileDraft?.weightKg === 74);
  check('the Save button is on screen (note 4)', await js(`(() => { const r = document.querySelector('.profile-form .btn-primary').getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })()`));
  await clickOn(`[...document.querySelectorAll('.profile-form .seg')].find((b) => /Female/.test(b.textContent))`);
  await clickOn(tab('Focus'));
  await sleep(1300);
  check('leaving a complete form saves the profile without pressing Save (note 4)', disk().hydration.profile?.heightCm === 181 && disk().hydration.profile?.sex === 'female');

  // ---- notes 3 and 15: sound actually reaches the output, one source at a time, sharing the context ----
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'horologium-ui-music-'));
  writeWav(path.join(folder, '01 - Test Tone.wav'));
  await js(`(async () => {
    const S = await import('horologium://app/js/app-state.js');
    S.patch({ music: { folders: { uitest: { path: ${JSON.stringify(folder)}, name: 'UI test' } }, files: { source: 'folder:uitest', track: null } } });
  })()`);
  await sleep(300);
  const M = `(await import('horologium://app/js/music-manager.js'))`;
  const level = (ms = 600) => js(`(async () => (${M}).outputLevel(${ms}))()`);
  const playing = (id) => js(`(async () => Boolean((await ${M}.getSource(${JSON.stringify(id)}))?.isPlaying()))()`);

  const audible = async (tries = 12) => {
    let db = -Infinity;
    for (let i = 0; i < tries && db < -45; i += 1) { await sleep(400); db = await level(); }
    return db;
  };
  await js(`(async () => { await (await ${M}.getSource('generated')).play(); })()`);
  const stationDb = await audible(20);
  check('a station is audible at the speaker tap (note 15)', stationDb > -45, `${Math.round(stationDb)} dB`);

  // The real-world switch: a station plays, My music starts (which pauses the station: note 3). The old engine
  // suspended the SHARED context 450 ms after its pause, silencing My music (note 15). Measure after that window.
  await js(`(async () => { await (await ${M}.getSource('local-files')).play(); })()`);
  await sleep(1500);
  const switchDb = await audible();
  check('switching station -> My music keeps the sound playing (notes 3 + 15)', switchDb > -45 && (await playing('local-files')) && !(await playing('generated')), `${Math.round(switchDb)} dB`);

  await js(`(async () => { await (await ${M}.getSource('generated')).play(); })()`);
  await sleep(2500);
  const backDb = await audible(20);
  check('switching My music -> station keeps the sound playing (notes 3 + 15)', backDb > -45 && (await playing('generated')) && !(await playing('local-files')), `${Math.round(backDb)} dB`);

  // pause, wait past the old suspend delay, then a fresh source must still be heard
  await js(`(async () => { (await ${M}.getSource('generated')).pause(); })()`);
  await sleep(1500);
  await js(`(async () => { await (await ${M}.getSource('local-files')).play(); })()`);
  const afterPauseDb = await audible();
  check('My music is audible after a station was paused (note 15)', afterPauseDb > -45, `${Math.round(afterPauseDb)} dB`);
  await js(`(async () => { (await ${M}.getSource('local-files')).pause(); })()`);

  // In a healthy run the watchdog never has to act: a rescue means something suspended or stalled the shared
  // context while music played (exactly the old bug; the watchdog would otherwise hide it within 3 s).
  const events = JSON.parse(await js(`(async () => JSON.stringify((${M}).recentAudioEvents().map((e) => e.text)))()`));
  const rescues = events.filter((e) => e.startsWith('watchdog:'));
  check('the audio watchdog never had to rescue playback (note 15)', rescues.length === 0, rescues.join(' | '));

  const report = JSON.parse(await js(`(async () => JSON.stringify(await ${M}.soundCheck()))()`));
  // 'device' depends on the machine (a headless/WSL box without libpulse has no outputs); the rest is our pipeline
  const pipeline = report.checks.filter((c) => c.id !== 'device');
  const device = report.checks.find((c) => c.id === 'device');
  check('the Sound check passes for everything the app controls (note 15)', pipeline.every((c) => c.ok !== false),
    `${report.checks.map((c) => `${c.id}:${c.ok === null ? '?' : c.ok ? 'ok' : 'NO'}`).join(' ')}${device?.ok === false ? ' (no audio output device on this machine)' : ''}`);

  // ---- note 8: volume in the Music tab ----
  await clickOn(tab('Music'));
  await sleep(1200);
  check('the Music tab has its own volume slider (note 8)', await js(`!!document.querySelector('.view-music .settings-section input[type=range]')`));
  check('no noise/vinyl mixer under songs (note 9)', await js(`![...document.querySelectorAll('.view-music .row-label')].some((l) => /Vinyl|Rain|noise/i.test(l.textContent))`));

  // ---- notes 2 and 10: the menu is a pixel sprite that speaks its theme's lines ----
  const init = JSON.parse(await js(`window.horologium.init().then((s) => JSON.stringify({ registry: s.registry, settings: s.state.settings }))`));
  const theme = init.registry.themes.find((th) => th.id === init.settings.theme);
  const character = theme.characters.find((c) => c.id === init.settings.character);
  const allLines = [theme.dialogueData, character.dialogueData].flatMap((d) => Object.values(d ?? {}).flatMap((set) => set.en))
    .map((l) => new RegExp(`^${l.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{\w+\\?\}/g, '.+')}$`));
  const spoken = await js(`document.querySelector('.speech-line').textContent`);
  check('the character speaks its theme\'s lines (note 10)', allLines.some((re) => re.test(spoken)), spoken);
  check('the character is a pixel sprite (note 10)', await js(`!!document.querySelector('.char svg.sprite [data-state="idle"]')`));

  // ---- notes 11 and 12: an update is noticed, the News bubble lights up, News explains how to update ----
  const dot = () => js(`!document.querySelector('.ring .tab[data-tab="news"] .tab-dot').hidden`);
  check('a fresh install shows no News dot (note 12)', !(await dot()));
  const status = await updates.check({ manual: true });
  await sleep(300);
  check('a newer release on GitHub is detected (note 12)', status.state === 'available' && status.latest?.version === '9.9.9', `${status.state}${status.error ? `: ${status.error}` : ''}`);
  check('the News bubble shows a dot while an update waits (note 12)', await dot());
  await clickOn(`document.querySelector('.ring .tab[data-tab="news"]')`);
  await sleep(600);
  const card = await js(`document.querySelector('.update-card').textContent`);
  check('News offers the update: from source it shows the commands (note 12)', card.includes('9.9.9') && card.includes('git pull && npm install'), card.slice(0, 120));
  const notesHtml = await js(`document.querySelector('.release-notes').innerHTML`);
  check('release notes are shown as text, never markup (note 12)', /Bold sprites/.test(notesHtml) && !/<img|<strong/i.test(notesHtml) && (await js('document.title')) !== 'pwned');
  check('News lists what changed in this version (note 12)', await js(`document.querySelector('.news-entry h3')?.textContent.length > 0`));
  feed.down = true; // GitHub answers 500 now: only the error path can keep "available"
  const offline = await updates.check({ manual: true });
  check('a failed re-check keeps offering the known update (note 12)', offline.state === 'available' && offline.latest?.version === '9.9.9', offline.state);

  dbg.detach();
  check('no renderer errors during the run', rendererErrors.length === 0, rendererErrors.slice(0, 3).join(' | '));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} UI checks passed.`);
  fs.rmSync(folder, { recursive: true, force: true });
  feed.server.close();
  setTimeout(() => app.exit(failed.length ? 1 : 0), 200);
})().catch((err) => {
  console.error('ui-check crashed:', err);
  app.exit(1);
});
