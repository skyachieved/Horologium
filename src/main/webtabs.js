/*
 * Web music tabs (YouTube, Spotify, Melon): the service's own website in a sandboxed WebContentsView
 * placed over the widget's panel.
 *
 * Hard rules (AGENTS.md): the site is loaded UNMODIFIED. We never inject scripts that change content,
 * rewrite headers, spoof the user agent, block ads, or download anything. The only things we do are
 * navigation control, permission denial and layout (size/zoom/position) of the view.
 *
 * A view exists only while its tab is open: closing the tab destroys the WebContents, which frees its
 * memory and stops playback (YouTube's policy forbids a hidden background player).
 */
import { WebContentsView, session as electronSession, shell } from 'electron';
import { isNavigationAllowed, isExternalOpenAllowed } from '../core/webhosts.js';

const MAX_DIMENSION = 4000;

const toBounds = (b) => {
  const n = (v) => Math.max(0, Math.min(MAX_DIMENSION, Math.round(Number(v) || 0)));
  return { x: n(b?.x), y: n(b?.y), width: n(b?.width), height: n(b?.height) };
};

/**
 * @param {object} deps
 * @param {() => import('electron').BrowserWindow} deps.getWindow
 * @param {() => object[]} deps.getSources  web music-source manifests
 * @param {(channel: string, payload: any) => void} deps.notify  send to the renderer
 * @param {boolean} [deps.devTools]
 */
export function createWebTabs({ getWindow, getSources, notify, devTools = false, getMini = () => null }) {
  let active = null; // { source, site, view, bounds }
  const hardened = new Set();
  let suspending = null; // hide and collapse can both fire; run one suspend at a time

  function hardenSession(partition) {
    if (hardened.has(partition)) return;
    hardened.add(partition);
    const ses = electronSession.fromPartition(partition);
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (event) => event.preventDefault()); // never download media or anything else
  }

  const findSource = (id) => getSources().find((s) => s.id === id && s.kind === 'web') ?? null;

  function snapshot() {
    if (!active) return { open: false };
    const wc = active.view.webContents;
    return {
      open: true,
      sourceId: active.source.id,
      siteId: active.site.id,
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    };
  }

  const push = (extra = {}) => notify('webtab:state', { ...snapshot(), ...extra });

  function guardNavigation(wc, navAllow) {
    const handle = (event, url) => {
      if (isNavigationAllowed(url, navAllow)) return;
      event.preventDefault();
      if (isExternalOpenAllowed(url)) {
        shell.openExternal(url);
        push({ openedExternally: new URL(url).hostname });
      }
    };
    wc.on('will-navigate', handle);
    wc.on('will-redirect', handle);
    // Pop-ups: stay inside the view when the target is allowed, otherwise use the real browser.
    wc.setWindowOpenHandler(({ url }) => {
      if (isNavigationAllowed(url, navAllow)) wc.loadURL(url);
      else if (isExternalOpenAllowed(url)) {
        shell.openExternal(url);
        push({ openedExternally: new URL(url).hostname });
      }
      return { action: 'deny' };
    });
  }

  function create(source, site) {
    const { web } = source;
    hardenSession(web.partition);
    const view = new WebContentsView({
      webPreferences: {
        partition: web.partition,        // logins persist per service
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        backgroundThrottling: false,     // a playing video must not be throttled while the widget is open
        devTools,
      },
    });
    const wc = view.webContents;
    guardNavigation(wc, web.navAllow);
    for (const event of ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading']) wc.on(event, () => push());
    wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
      if (isMainFrame && code !== -3) push({ error: description, failedUrl: url }); // -3 = aborted (a redirect), not an error
    });
    wc.loadURL(site.url);
    return view;
  }

  return {
    /** Open (or switch site within) a web source. Bounds are the panel rectangle in window coordinates. */
    open({ sourceId, siteId, bounds }) {
      const win = getWindow();
      const source = findSource(sourceId);
      if (!win || !source) return { ok: false, error: 'unknown-source' };
      const site = source.web.sites.find((s) => s.id === siteId) ?? source.web.sites[0];

      if (active && active.source.id !== source.id) this.close();
      if (!active) {
        // a page parked in the mini player comes back instead of being reloaded: playback continues
        const held = getMini()?.release(source.id);
        const view = held?.view ?? create(source, site);
        win.contentView.addChildView(view);
        // a pinned page keeps whatever it was showing (the panel follows via the state event below)
        active = { source, site: held?.site ?? site, view, bounds: toBounds(bounds) };
      } else if (active.site.id !== site.id) {
        active.site = site;
        active.view.webContents.loadURL(site.url);
      }
      active.view.setBounds(toBounds(bounds));
      active.bounds = toBounds(bounds);
      push();
      return { ok: true };
    },

    setBounds(bounds) {
      if (!active) return;
      active.bounds = toBounds(bounds);
      active.view.setBounds(active.bounds);
    },

    navigate(action) {
      if (!active) return;
      const wc = active.view.webContents;
      if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
      else if (action === 'reload') wc.reload();
      else if (action === 'home') wc.loadURL(active.site.url);
      else if (action === 'external' && isExternalOpenAllowed(wc.getURL())) shell.openExternal(wc.getURL());
    },

    /**
     * The widget is leaving this page (collapsed, hidden, or another tab opened): pin a playing video in the
     * mini player when the source allows it, otherwise destroy the page (no hidden background playback).
     */
    suspend() {
      if (!active) return Promise.resolve();
      if (!suspending) {
        suspending = (async () => {
          const mini = getMini();
          if (mini && (await mini.canEnter()) && (await mini.enter())) {
            notify('webtab:state', { open: false, pinned: true });
          } else {
            this.close();
          }
        })().finally(() => { suspending = null; });
      }
      return suspending;
    },

    /** Take the active view out of the widget WITHOUT destroying it (the mini player owns it next). */
    detach() {
      if (!active) return null;
      const { view, source, site } = active;
      active = null;
      try {
        getWindow()?.contentView.removeChildView(view);
      } catch {
        /* window already gone */
      }
      return { view, source, site };
    },

    /** Mute or unmute the page's audio (a standard WebContents setting; the page itself is not touched). */
    setMuted(muted) {
      if (active) active.view.webContents.setAudioMuted(Boolean(muted));
    },

    /** Destroy the view: frees its memory and stops any playback. */
    close() {
      if (!active) return;
      const { view } = active;
      active = null;
      try {
        getWindow()?.contentView.removeChildView(view);
      } catch {
        /* window already gone */
      }
      if (!view.webContents.isDestroyed()) view.webContents.close();
      notify('webtab:state', { open: false });
    },

    isOpen: () => active !== null,
    state: snapshot,
    /** For tests and the mini player. */
    activeView: () => active?.view ?? null,
    activeSource: () => active?.source ?? null,
  };
}
