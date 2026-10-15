/*
 * Pinned mini player. When a YouTube video is playing and the widget is collapsed, hidden, or the user
 * leaves the Music tab, the SAME web view moves into a small always-on-top window that shows only the
 * video. It dims to 35 % after 3 s of rest (never fully invisible) and returns to full opacity on hover.
 *
 * Guardrails (AGENTS.md): the page is not modified. We read the <video> rectangle (a layout query),
 * scroll to the top, and change only the view's zoom and position so the window edge clips everything
 * but the video. YouTube's policy forbids a hidden background player; this one is always visible.
 */
import { BrowserWindow, WebContentsView, ipcMain, screen } from 'electron';
import path from 'node:path';
import {
  MINI, cropLayout, defaultMiniPosition, fadeTarget, stepOpacity, pointInside,
} from '../core/mini.js';

const POLL_MS = 100;
const RECHECK_MS = 2000;
const GIVE_UP_AFTER_MS = 15_000;

const PROBE = `(() => {
  const v = document.querySelector('video');
  if (!v) return null;
  window.scrollTo(0, 0);
  const r = v.getBoundingClientRect();
  return { playing: !v.paused && !v.ended && v.readyState > 2, x: r.x, y: r.y, width: r.width, height: r.height, vw: window.innerWidth, vh: window.innerHeight };
})()`;

/**
 * @param {object} deps
 * @param {() => ReturnType<import('./webtabs.js').createWebTabs>} deps.getWebtabs
 * @param {string} deps.appRoot
 * @param {string} deps.origin            horologium://app
 * @param {() => {expand: string, close: string}} deps.labels
 * @param {() => void} deps.onExpand      bring the widget back to the Music tab
 * @param {{get: Function, patch: Function}} deps.store
 * @param {() => {x: number, y: number}} [deps.getCursor]
 * @param {boolean} [deps.headless]
 */
export function createMiniPlayer({ getWebtabs, appRoot, origin, labels, onExpand, store, getCursor = () => screen.getCursorScreenPoint(), headless = false }) {
  let mini = null; // { win, strip, view, source, site, lastActiveAt, opacity, timers, lastLayoutKey, lastVideoAt }

  async function probe(view) {
    try {
      return await view.webContents.executeJavaScript(PROBE, true);
    } catch {
      return null;
    }
  }

  function applyLayout(info, { initial = false } = {}) {
    const layout = cropLayout({ viewport: { width: info.vw, height: info.vh }, video: info, miniWidth: mini.miniWidth });
    const key = JSON.stringify([layout.window, layout.view, layout.zoom]);
    if (key === mini.layoutKey) return;
    mini.layoutKey = key;
    mini.view.webContents.setZoomFactor(layout.zoom);
    mini.view.setBounds(layout.view);
    mini.strip.setBounds({ x: 0, y: 0, width: layout.window.width, height: MINI.strip });
    const b = mini.win.getBounds();
    if (initial) {
      const display = screen.getDisplayNearestPoint({ x: b.x, y: b.y });
      const saved = store.get().window?.mini;
      const pos = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : defaultMiniPosition(layout.window, display.workArea);
      mini.win.setBounds({ ...pos, ...layout.window });
    } else {
      mini.win.setBounds({ x: b.x, y: b.y, ...layout.window });
    }
  }

  function tick() {
    if (!mini) return;
    const now = Date.now();
    const hovering = pointInside(getCursor(), mini.win.getBounds());
    if (hovering) mini.lastActiveAt = now;
    const target = fadeTarget({ hovering, lastActiveAt: mini.lastActiveAt, now });
    const next = stepOpacity(mini.opacity, target); // snaps exactly onto the target when close
    if (next !== mini.opacity) {
      mini.opacity = next;
      if (!headless) mini.win.setOpacity(next);
    }
  }

  async function recheck() {
    if (!mini) return;
    const info = await probe(mini.view);
    if (!mini) return;
    if (info && info.width > 80) {
      mini.lastVideoAt = Date.now();
      applyLayout(info);
    } else if (Date.now() - mini.lastVideoAt > GIVE_UP_AFTER_MS) {
      close(); // the page no longer shows a video: nothing left to pin
    }
  }

  /** Tear the mini window down. `keepView` leaves the page alive (it is being handed back to the widget). */
  function dispose({ keepView }) {
    if (!mini) return null;
    const current = mini;
    mini = null;
    clearInterval(current.pollTimer);
    clearInterval(current.recheckTimer);
    current.view.webContents.off('page-title-updated', current.sendTitle); // only OUR listener; webtabs keeps its own
    try {
      current.win.contentView.removeChildView(current.view);
    } catch {
      /* already detached */
    }
    if (!keepView && !current.view.webContents.isDestroyed()) current.view.webContents.close();
    if (!current.strip.webContents.isDestroyed()) current.strip.webContents.close();
    if (!current.win.isDestroyed()) current.win.destroy();
    return current;
  }

  function close() {
    dispose({ keepView: false });
  }

  ipcMain.on('mini:expand', (event) => {
    if (mini && event.sender === mini.strip.webContents) onExpand();
  });
  ipcMain.on('mini:close', (event) => {
    if (mini && event.sender === mini.strip.webContents) close();
  });

  return {
    /** Is the active web view a playing, pin-able video? */
    async canEnter() {
      const webtabs = getWebtabs();
      const source = webtabs.activeSource();
      const view = webtabs.activeView();
      if (!view || source?.web.miniPlayer !== 'video-clip') return false;
      const info = await probe(view);
      return Boolean(info?.playing && info.width > 80);
    },

    /** Move the active web view into the mini window. Returns true when it was pinned. */
    async enter() {
      const webtabs = getWebtabs();
      const view = webtabs.activeView();
      if (!view || mini) return false;
      const info = await probe(view);
      if (!info?.playing || info.width <= 80) return false;
      const { source, site } = webtabs.detach();

      const win = new BrowserWindow({
        width: MINI.width,
        height: Math.round(MINI.width * 0.5625) + MINI.strip,
        show: false,
        frame: false,
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        hasShadow: true,
        backgroundColor: '#000000',
        title: 'Horologium mini player',
      });
      win.setAlwaysOnTop(true, 'screen-saver');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });

      const strip = new WebContentsView({
        webPreferences: { preload: path.join(appRoot, 'src', 'main', 'mini-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
      });
      const l = labels();
      strip.webContents.loadURL(`${origin}/mini/mini.html?expand=${encodeURIComponent(l.expand)}&close=${encodeURIComponent(l.close)}`);
      const sendTitle = () => {
        if (!strip.webContents.isDestroyed()) strip.webContents.send('mini:title', view.webContents.getTitle());
      };
      strip.webContents.once('did-finish-load', sendTitle);
      view.webContents.on('page-title-updated', sendTitle);

      mini = {
        win, strip, view, source, site, sendTitle, miniWidth: MINI.width, opacity: 1, lastActiveAt: Date.now(), lastVideoAt: Date.now(), layoutKey: null,
      };
      win.contentView.addChildView(view);
      win.contentView.addChildView(strip); // the strip sits above the page
      applyLayout(info, { initial: true });
      win.on('moved', () => {
        const b = win.getBounds();
        store.patch({ window: { mini: { x: b.x, y: b.y } } });
      });
      if (!headless) win.showInactive();
      mini.pollTimer = setInterval(tick, POLL_MS);
      mini.recheckTimer = setInterval(recheck, RECHECK_MS);
      return true;
    },

    /** Hand the pinned view back (to be re-attached to the widget). Returns {view, source, site} or null. */
    release(sourceId) {
      if (!mini || mini.source.id !== sourceId) return null;
      const { view, source, site } = mini;
      dispose({ keepView: true });
      view.webContents.setZoomFactor(1); // zoom is per-host in the partition: put it back
      return { view, source, site };
    },

    close,
    isActive: () => mini !== null,
    activeSourceId: () => mini?.source.id ?? null,
    /** For tests. */
    inspect: () => (mini ? { win: mini.win, strip: mini.strip, view: mini.view, opacity: mini.opacity, lastActiveAt: mini.lastActiveAt, bounds: mini.win.getBounds() } : null),
    forceLastActive(ms) { if (mini) mini.lastActiveAt = ms; },
    tick,
  };
}
