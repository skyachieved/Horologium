/*
 * Update checks and installs (owner's notes 11 and 12). The decisions live in core/updates.js; this file talks to
 * GitHub. Privacy (hard rule 5): the check asks GitHub for the latest PUBLISHED release, nothing about the user is
 * sent, and Settings > System turns the automatic check off. Drafts are invisible to it, so nothing reaches users
 * until the owner publishes a release.
 *
 *   install route   electron-updater: reads latest.yml from the release, downloads the installer or AppImage,
 *                   verifies its sha512, then quits and installs. Loaded lazily, only on that route.
 *   other routes    GitHub's releases API; "Update" opens the release page (download) or shows the commands (source).
 */
import { net, shell } from 'electron';
import { isNewer, updateRoute, notesToText, shouldCheck, shouldNotify, CHECK_EVERY_MS, FIRST_CHECK_DELAY_MS } from '../core/updates.js';

export const REPO = Object.freeze({ owner: 'skyachieved', repo: 'Horologium' });
const RELEASES_URL = `https://github.com/${REPO.owner}/${REPO.repo}/releases`;
const LATEST_API = `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/releases/latest`;

const isHttps = (u) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};
const message = (err) => String(err?.message ?? err).split('\n')[0].slice(0, 200);

/**
 * @param {{ app: Electron.App, version: string, store: object, onStatus: (status: object) => void, onAvailable: (latest: object) => void,
 *           headless?: boolean, feedUrl?: string }} options  feedUrl replaces the GitHub API (tests)
 */
export function createUpdater({ app, version, store, onStatus, onAvailable, headless = false, feedUrl = null }) {
  const route = updateRoute({ packaged: app.isPackaged, platform: process.platform, appImage: Boolean(process.env.APPIMAGE) });
  let status = { state: 'idle', current: version, route, platform: process.platform, page: RELEASES_URL, latest: null, progress: 0, error: null, checkedAt: null };
  let updater = null;
  let installing = false;
  const timers = [];

  const set = (patch) => {
    status = { ...status, ...patch };
    onStatus(status);
  };

  async function loadUpdater() {
    if (updater) return updater;
    const mod = await import('electron-updater');
    updater = (mod.default ?? mod).autoUpdater;
    updater.autoDownload = false;          // only when the user presses "Update now"
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.logger = null;
    updater.on('download-progress', (p) => set({ state: 'downloading', progress: Math.round(p?.percent ?? 0) }));
    updater.on('update-downloaded', () => {
      set({ state: 'ready', progress: 100 });
      if (installing) setTimeout(() => updater.quitAndInstall(true, true), 600); // silent install, then reopen
    });
    updater.on('error', (err) => {
      if (!installing) return; // a failed check is handled by check() itself
      installing = false;
      set({ state: 'error', error: message(err) });
    });
    return updater;
  }

  async function fetchLatest() {
    if (route === 'install' && !feedUrl) {
      const u = await loadUpdater();
      const info = (await u.checkForUpdates())?.updateInfo;
      if (!info?.version) return null;
      const notes = Array.isArray(info.releaseNotes) ? info.releaseNotes.map((n) => n.note ?? '').join('\n') : info.releaseNotes;
      return { version: info.version, notes: notesToText(notes), date: info.releaseDate ?? null, url: `${RELEASES_URL}/tag/v${info.version}` };
    }
    const res = await net.fetch(feedUrl ?? LATEST_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (res.status === 404) return null; // nothing published yet
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const r = await res.json();
    return {
      version: String(r.tag_name ?? '').replace(/^v/, ''),
      notes: notesToText(r.body),
      date: typeof r.published_at === 'string' ? r.published_at : null,
      url: isHttps(r.html_url) ? r.html_url : RELEASES_URL,
    };
  }

  async function check({ manual = false } = {}) {
    if (['checking', 'downloading', 'ready'].includes(status.state)) return status;
    const saved = store.get();
    if (!shouldCheck({ enabled: saved.settings.updates.check, manual, lastCheckedAt: status.checkedAt, now: Date.now() })) return status;
    set({ state: 'checking', error: null });
    try {
      const latest = await fetchLatest();
      const available = Boolean(latest) && isNewer(latest.version, status.current);
      set({ state: available ? 'available' : 'none', latest: available ? latest : null, checkedAt: Date.now() });
      if (available && shouldNotify({ latest: latest.version, notifiedVersion: saved.updates.notifiedVersion })) {
        store.patch({ updates: { notifiedVersion: latest.version } });
        onAvailable(latest);
      }
    } catch (err) {
      // offline for a moment: an update we already know about stays offered
      set(status.latest ? { state: 'available', checkedAt: Date.now() } : { state: 'error', error: message(err), checkedAt: Date.now() });
    }
    return status;
  }

  /** "Update now": install route downloads and restarts; download route opens the release page. */
  async function install() {
    if (!status.latest) return status;
    if (route === 'download') {
      await shell.openExternal(isHttps(status.latest.url) ? status.latest.url : RELEASES_URL);
      return status;
    }
    if (route !== 'install' || feedUrl) return status; // source: the page shows the commands
    if (status.state === 'ready') {
      updater.quitAndInstall(true, true);
      return status;
    }
    installing = true;
    set({ state: 'downloading', progress: 0, error: null });
    try {
      await (await loadUpdater()).downloadUpdate();
    } catch (err) {
      installing = false;
      set({ state: 'error', error: message(err) });
    }
    return status;
  }

  function start() {
    if (headless) return; // tests call check() themselves
    timers.push(setTimeout(() => check(), FIRST_CHECK_DELAY_MS));
    timers.push(setInterval(() => check(), CHECK_EVERY_MS));
  }

  return {
    start,
    check,
    install,
    status: () => status,
    stop: () => timers.forEach((t) => clearTimeout(t)),
  };
}
