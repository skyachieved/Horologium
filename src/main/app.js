/*
 * The Electron main process: floating transparent window, tray, global hotkey, IPC, notifications.
 * `startApp(options)` is the single entry point so tests/screenshot harnesses can run the real thing
 * (options.headless keeps the window hidden and skips the tray and global shortcut).
 *
 * Security posture: sandboxed renderer, contextIsolation, no node integration, a single privileged
 * custom protocol with a strict CSP, every IPC call checks the sender is our own page, permissions
 * are denied, navigation and window.open are blocked.
 */
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, net, Notification, Tray, nativeImage, protocol, screen, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { scanFolder } from './media-scan.js';
import { serveFileWithRange } from './media-serve.js';
import { createGarbageCollector } from './gc.js';
import { createStore } from './store.js';
import { createHandler, SCHEME, ORIGIN } from './protocol.js';
import { loadExtensions } from './extensions.js';
import { createWebTabs } from './webtabs.js';
import { createMiniPlayer } from './miniplayer.js';
import { createUpdater } from './updates.js';
import * as weather from './weather.js';
import { restoreBounds, planExpand, planCollapse, pickWorkArea, clampToWorkArea } from '../core/geometry.js';
import { validateAccelerator, findConflicts } from '../core/keybinds.js';
import { DEFAULT_HOTKEYS } from '../core/defaults.js';
import { stepView, currentView } from '../core/visibility.js';

const DEFAULT_SIZE = { width: 200, height: 190 };
const SIZE_LIMITS = { min: 80, max: 1400 };

// Must run before `ready`.
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const isHttps = (u) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};

const clampInt = (n, lo, hi) => Math.round(Math.min(hi, Math.max(lo, Number(n))));

/**
 * @param {{headless?: boolean, userDataDir?: string, updateFeed?: string}} [options]  updateFeed: a fake GitHub API (tests)
 * @returns {Promise<{win: BrowserWindow, store: ReturnType<typeof createStore>, problems: object[]}>}
 */
export async function startApp(options = {}) {
  const { headless = false } = options;
  // Derived from this file's location (not app.getAppPath) so it is right in dev, in a packaged asar, and in test harnesses.
  const appRoot = fileURLToPath(new URL('../..', import.meta.url));

  // Our package.json (in every build), not app.getVersion(): under a test harness that reports someone else's version.
  const version = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version;
    } catch {
      return app.getVersion();
    }
  })();

  app.setName('Horologium');
  if (options.userDataDir) app.setPath('userData', options.userDataDir);
  if (process.platform === 'win32') app.setAppUserModelId('dev.horologium.app');
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required'); // chimes without a prior click
  if (process.platform === 'linux') app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal'); // Wayland hotkeys

  if (!headless && !app.requestSingleInstanceLock()) {
    app.quit();
    return new Promise(() => {});
  }

  await app.whenReady();
  if (process.platform === 'darwin') app.dock?.hide();

  // ---------- state + extensions ----------
  const locale = app.getLocale().toLowerCase().startsWith('ko') ? 'ko' : 'en';
  const store = createStore({ file: path.join(app.getPath('userData'), 'settings.json'), language: locale });

  const bundledExtRoot = path.join(appRoot, 'extensions');
  const userExtRoot = path.join(app.getPath('userData'), 'extensions');
  const { registry, problems } = loadExtensions({ bundledRoot: bundledExtRoot, userRoot: userExtRoot });
  for (const p of problems) console.warn(`extension problem: ${p.file} [${p.id ?? '?'}]\n  - ${p.errors.join('\n  - ')}`);

  // ---------- protocol, session hardening ----------
  protocol.handle(SCHEME, createHandler({
    rendererRoot: path.join(appRoot, 'src', 'renderer'),
    coreRoot: path.join(appRoot, 'src', 'core'),
    bundledExtRoot,
    userExtRoot,
    // "My music" folders the user picked (re-read per request, so add/remove takes effect at once)
    mediaRoots: () => Object.fromEntries(Object.entries(store.get().music?.folders ?? {}).map(([id, f]) => [id, f.path])),
    // explicit Content-Length + 206 ranges: the <audio> element needs them to learn a file's duration and to seek
    serveFile: serveFileWithRange,
  }));
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  // ---------- window ----------
  const workAreas = () => screen.getAllDisplays().map((d) => d.workArea);
  const initial = restoreBounds(store.get().window, DEFAULT_SIZE, workAreas());

  const win = new BrowserWindow({
    ...initial,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Horologium',
    icon: path.join(appRoot, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(appRoot, 'src', 'main', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false, // timers and audio must keep running while hidden
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver'); // stays above full-screen apps on macOS
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  const send = (channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

  // sandboxed web views for YouTube / Spotify / Melon (created on demand, destroyed on close)
  let mini = null;
  const webtabs = createWebTabs({ getWindow: () => win, getSources: () => registry.musicSources, notify: send, devTools: !app.isPackaged, getMini: () => mini });

  // ---------- show / hide ----------
  const trKey = (key, fallback) => registry.locales[store.get().settings.language]?.strings[key] ?? fallback;
  let hiding = false;
  let hideTimer = null;
  // Three view states (core/visibility.js): menu (expanded) <-> icon (collapsed) <-> hidden. The renderer owns
  // expand/collapse and reports it through win:resize; the window's visibility is ours. Headless runs track a
  // virtual visibility so tests can drive the same state machine without showing anything.
  let rendererExpanded = false;
  let virtuallyShown = true;
  const isShown = () => (headless ? virtuallyShown : win.isVisible());
  const viewNow = () => currentView({ visible: isShown(), hiding, expanded: rendererExpanded });

  /** Show the window; `mode` ('expanded' | 'collapsed') also sets menu vs icon. */
  function showWidget(mode) {
    clearTimeout(hideTimer);
    hiding = false;
    if (!isShown()) {
      if (headless) virtuallyShown = true;
      else win.show();
      send('widget:show', { mode: mode ?? null });
    } else if (mode) {
      send('widget:set-mode', mode);
    }
    if (!headless) win.focus();
  }

  function hideWidget() {
    if (hiding || !isShown()) return;
    hiding = true;
    send('widget:hide-request'); // renderer plays the pop-out, then calls win:hideNow
    hideTimer = setTimeout(finishHide, 900); // safety net if the renderer never answers
  }

  function finishHide() {
    clearTimeout(hideTimer);
    hiding = false;
    webtabs.suspend(); // a playing video moves to the mini player; anything else is destroyed (no hidden playback)
    if (headless) virtuallyShown = false;
    else if (!win.isDestroyed()) win.hide();
  }

  /** Go to a view state: 'menu' | 'icon' | 'hidden'. */
  function goTo(target) {
    const now = viewNow();
    if (target === now) return now;
    if (target === 'hidden') hideWidget();
    else showWidget(target === 'menu' ? 'expanded' : 'collapsed');
    return target;
  }
  const moveView = (direction) => goTo(stepView(viewNow(), direction));

  // pinned mini player for playing videos (see miniplayer.js); "expand" brings the widget back to the Music tab
  mini = createMiniPlayer({
    getWebtabs: () => webtabs,
    appRoot,
    origin: ORIGIN,
    labels: () => ({ expand: trKey('mini.expand', 'Open in the widget'), close: trKey('mini.close', 'Close the mini player') }),
    onExpand: () => {
      goTo('menu');
      send('widget:open-tab', 'music');
    },
    store,
    headless,
  });

  // ---------- global hotkeys: "left" moves towards the menu, "right" towards hidden (see core/visibility.js) ----------
  const registeredKeys = { left: null, right: null };
  const register = (accel, id) => {
    try {
      return globalShortcut.register(accel, () => moveView(id));
    } catch {
      return false;
    }
  };
  function applyHotkey(id, accel) {
    if (!(id in registeredKeys)) return { ok: false, error: 'invalid' };
    const v = validateAccelerator(accel, process.platform);
    if (!v.ok) return { ok: false, error: 'invalid', details: v.errors };
    const other = id === 'left' ? 'right' : 'left';
    const otherAccel = registeredKeys[other] ?? store.get().settings.hotkeys[other];
    if (findConflicts({ [id]: accel, [other]: otherAccel }, process.platform).length) return { ok: false, error: 'duplicate' };
    if (headless) {
      registeredKeys[id] = accel;
      return { ok: true, warnings: v.warnings };
    }
    const previous = registeredKeys[id];
    if (previous) globalShortcut.unregister(previous);
    if (!register(accel, id)) {
      if (previous) register(previous, id); // keep the old binding rather than none; the tray still works
      return { ok: false, error: 'taken' };
    }
    registeredKeys[id] = accel;
    return { ok: true, warnings: v.warnings };
  }

  const savedKeys = store.get().settings.hotkeys;
  let hotkeyStatus = {
    left: applyHotkey('left', savedKeys.left || DEFAULT_HOTKEYS.left),
    right: applyHotkey('right', savedKeys.right || DEFAULT_HOTKEYS.right),
  };

  // ---------- tray ----------
  let tray = null;
  const tr = (key, fallback) => registry.locales[store.get().settings.language]?.strings[key] ?? fallback;
  // The tray (Windows: the notification area / hidden icons) shows what the app is doing in its tooltip, which
  // the renderer keeps current through app:status. Note: WSLg has no tray at all; run the native build there.
  let trayStatus = '';
  let updates = null;
  function buildTray() {
    if (headless) return;
    if (!tray) {
      const img = nativeImage.createFromPath(path.join(appRoot, 'assets', 'tray.png'));
      tray = new Tray(img);
      tray.on('click', () => goTo(viewNow() === 'menu' ? 'icon' : 'menu'));
    }
    tray.setToolTip(trayStatus ? `Horologium\n${trayStatus}` : 'Horologium');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: tr('tray.menu', 'Open the menu'), click: () => goTo('menu') },
      { label: tr('tray.icon', 'Icon only'), click: () => goTo('icon') },
      { label: tr('tray.hide', 'Hide'), click: () => goTo('hidden') },
      { type: 'separator' },
      { label: tr('tray.pomodoro', 'Start / pause the focus timer'), click: () => send('widget:command', 'pomodoro-toggle') },
      { label: tr('tray.drink', 'Log a cup of water'), click: () => send('widget:command', 'drink') },
      ...(['available', 'ready'].includes(updates?.status().state)
        ? [{ type: 'separator' }, { label: tr('update.tray', 'Update to {version}...').replace('{version}', updates.status().latest.version), click: openNews }]
        : []),
      { type: 'separator' },
      { label: tr('tray.quit', 'Quit Horologium'), click: () => app.quit() },
    ]));
  }
  buildTray();

  // ---------- updates (notes 11, 12): GitHub releases; see updates.js ----------
  function openNews() {
    goTo('menu');
    send('widget:open-tab', 'news');
  }
  updates = createUpdater({
    app,
    version,
    store,
    headless,
    feedUrl: options.updateFeed ?? null,
    onStatus: (status) => {
      send('update:status', status);
      buildTray();
    },
    onAvailable: (latest) => {
      if (headless || !Notification.isSupported()) return;
      const n = new Notification({
        title: tr('update.notifyTitle', 'Horologium {version} is available').replace('{version}', latest.version),
        body: tr('update.notifyBody', 'Open News to see what is new and update.'),
        silent: true,
        icon: path.join(appRoot, 'assets', 'icon.png'),
      });
      n.on('click', openNews);
      n.show();
    },
  });

  // ---------- window sizing (expand / collapse) ----------
  let session_ = null; // geometry session from planExpand, so collapse returns to the same spot
  let flipped = false;

  function savePosition(bounds) {
    store.patch({ window: { x: bounds.x, y: bounds.y } });
  }

  function resize({ mode, width, height }) {
    rendererExpanded = mode === 'expanded';
    const size = { width: clampInt(width, SIZE_LIMITS.min, SIZE_LIMITS.max), height: clampInt(height, SIZE_LIMITS.min, SIZE_LIMITS.max) };
    const cur = win.getBounds();
    const wa = pickWorkArea(cur, workAreas());

    if (mode === 'collapsed') {
      const next = session_ ? planCollapse(cur, size, wa, session_) : clampToWorkArea({ ...cur, ...size }, wa);
      session_ = null;
      flipped = false;
      win.setBounds(next);
      savePosition(next);
    } else {
      // Expanded sizes can change while open (e.g. a tab needs more room): re-plan from the collapsed anchor.
      const anchor = session_ && cur.x === session_.expanded.x && cur.y === session_.expanded.y ? session_.collapsed : null;
      const base = anchor ?? (session_
        ? { x: cur.x + (cur.width - session_.collapsed.width) / 2, y: session_.flipped ? cur.y + cur.height - session_.collapsed.height : cur.y, width: session_.collapsed.width, height: session_.collapsed.height }
        : cur);
      const plan = planExpand(base, size, wa);
      session_ = plan.session;
      flipped = plan.flipped;
      win.setBounds(plan.bounds);
    }
    return { flipped };
  }

  // ---------- drag ----------
  let drag = null;

  // ---------- IPC (every handler verifies the sender is our own page) ----------
  const fromOurPage = (event) => String(event.senderFrame?.url ?? '').startsWith(`${ORIGIN}/`);
  const handle = (channel, fn) => ipcMain.handle(channel, (event, arg) => (fromOurPage(event) ? fn(arg, event) : undefined));

  handle('app:init', () => ({
    state: store.get(),
    registry,
    problems,
    platform: process.platform,
    systemLocale: locale,
    version,
    hotkeyStatus,
    loginSupported: process.platform === 'win32' || process.platform === 'darwin',
    userExtDir: userExtRoot,
    // Linux under WSL2 (WSLg): no system tray and a flaky audio bridge; the UI says so where it matters
    wsl: process.platform === 'linux' && (Boolean(process.env.WSL_DISTRO_NAME) || /microsoft/i.test(os.release())),
  }));

  handle('store:patch', (patch) => {
    if (patch && typeof patch === 'object') {
      store.patch(patch);
      if (patch.settings?.language) buildTray();
    }
  });

  handle('win:resize', (arg) => resize(arg ?? {}));

  handle('win:dragStart', ({ screenX, screenY } = {}) => {
    const b = win.getBounds();
    drag = { sx: screenX, sy: screenY, bx: b.x, by: b.y, w: b.width, h: b.height };
  });
  ipcMain.on('win:dragMove', (event, { screenX, screenY } = {}) => {
    if (!drag || !fromOurPage(event)) return;
    win.setBounds({ x: Math.round(drag.bx + screenX - drag.sx), y: Math.round(drag.by + screenY - drag.sy), width: drag.w, height: drag.h });
  });
  handle('win:dragEnd', () => {
    drag = null;
    const b = clampToWorkArea(win.getBounds(), pickWorkArea(win.getBounds(), workAreas()));
    win.setBounds(b);
    if (!session_) savePosition(b); // only remember the collapsed spot
  });

  handle('win:hideNow', finishHide);

  handle('hotkey:set', ({ id, accel } = {}) => {
    const result = applyHotkey(String(id ?? ''), String(accel ?? ''));
    if (result.ok) {
      store.patch({ settings: { hotkeys: { [id]: accel } } });
      hotkeyStatus = { ...hotkeyStatus, [id]: result };
    }
    return result;
  });

  // The hotkey recorder pauses the global shortcuts so pressing a current combo is captured, not acted on.
  handle('hotkey:pause', () => {
    if (headless) return;
    for (const accel of Object.values(registeredKeys)) if (accel) globalShortcut.unregister(accel);
  });
  handle('hotkey:resume', () => {
    if (headless) return;
    for (const [id, accel] of Object.entries(registeredKeys)) if (accel && !globalShortcut.isRegistered(accel)) register(accel, id);
  });

  // The three view states, also reachable from inside the widget (Esc, the close button) and from tests.
  handle('view:move', ({ direction } = {}) => (direction === 'left' || direction === 'right' ? moveView(direction) : viewNow()));
  handle('view:go', ({ state } = {}) => (['menu', 'icon', 'hidden'].includes(state) ? goTo(state) : viewNow()));
  handle('view:current', () => viewNow());

  // What the app is doing, for the tray tooltip (note 14). Plain text, capped.
  handle('app:status', ({ text } = {}) => {
    const next = String(text ?? '').slice(0, 120);
    if (next === trayStatus) return;
    trayStatus = next;
    if (tray) tray.setToolTip(trayStatus ? `Horologium\n${trayStatus}` : 'Horologium');
  });

  handle('weather:search', ({ query } = {}) => weather.searchCities(query));
  handle('weather:current', ({ latitude, longitude } = {}) => weather.fetchCurrent(latitude, longitude));
  handle('weather:approx', () => weather.approximateLocation());

  handle('notify', ({ title, body, tab } = {}) => {
    if (!Notification.isSupported() || typeof title !== 'string') return false;
    const n = new Notification({ title: title.slice(0, 80), body: String(body ?? '').slice(0, 200), silent: true, icon: path.join(appRoot, 'assets', 'icon.png') });
    n.on('click', () => {
      goTo('menu');
      if (typeof tab === 'string') send('widget:open-tab', tab);
    });
    n.show();
    return true;
  });

  handle('update:status', () => updates.status());
  handle('update:check', () => updates.check({ manual: true }));
  handle('update:install', () => updates.install());
  handle('clipboard:write', ({ text } = {}) => {
    clipboard.writeText(String(text ?? '').slice(0, 500));
    return true;
  });

  handle('shell:openExternal', ({ url } = {}) => (isHttps(url) ? shell.openExternal(url).then(() => true) : false));

  handle('login:set', ({ enabled } = {}) => {
    if (process.platform !== 'win32' && process.platform !== 'darwin') return false;
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
    store.patch({ settings: { launchAtLogin: Boolean(enabled) } });
    return true;
  });

  handle('webtab:open', (arg) => webtabs.open(arg ?? {}));
  handle('webtab:bounds', (bounds) => webtabs.setBounds(bounds));
  handle('webtab:close', () => webtabs.close());
  handle('webtab:suspend', () => webtabs.suspend());
  handle('webtab:mute', ({ muted } = {}) => webtabs.setMuted(muted));
  handle('webtab:nav', ({ action } = {}) => webtabs.navigate(action));
  handle('webtab:state', () => webtabs.state());
  handle('webtab:silence', () => webtabs.silence());

  // ----- My music: folders the user chooses (names only are read; nothing is copied or uploaded) -----
  handle('media:add', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    const chosen = result.filePaths?.[0];
    if (result.canceled || !chosen) return null;
    const id = crypto.createHash('sha1').update(chosen).digest('hex').slice(0, 8);
    const entry = { id, path: chosen, name: path.basename(chosen) || chosen };
    store.patch({ music: { folders: { [id]: { path: entry.path, name: entry.name } } } });
    return entry;
  });
  handle('media:remove', ({ id } = {}) => {
    if (typeof id === 'string') store.patch({ music: { folders: { [id]: null } } });
  });
  handle('media:tracks', ({ id } = {}) => {
    const folder = store.get().music?.folders?.[id];
    return folder ? scanFolder(folder.path) : [];
  });

  const collectGarbage = createGarbageCollector(() => win?.webContents);
  handle('app:gc', () => collectGarbage()); // the music engine asks after each rendered phrase (see gc.js)

  handle('app:quit', () => app.quit());

  // ---------- lifecycle ----------
  app.on('second-instance', () => goTo('menu'));
  app.on('activate', () => goTo('menu'));
  app.on('window-all-closed', () => {}); // tray app: stay alive
  app.on('before-quit', () => store.flush());
  app.on('will-quit', () => globalShortcut.unregisterAll());

  await win.loadURL(`${ORIGIN}/index.html`);
  win.webContents.once('did-finish-load', () => send('hotkey:status', hotkeyStatus));
  if (!headless) showWidget();
  updates.start();

  return { win, store, problems, webtabs, mini, updates, view: { move: moveView, goTo, current: viewNow }, hotkeys: () => ({ ...registeredKeys }) };
}
