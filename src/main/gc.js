/*
 * Ask Chromium to collect garbage in OUR window (never in the web music tabs).
 *
 * Why: every generated phrase is rendered with a fresh OfflineAudioContext whose graph has thousands of nodes.
 * Chromium frees them lazily, so memory saw-toothed between ~330 MB and ~710 MB while a station played (measured
 * in the packaged app; the swing is garbage, not a leak: it always fell back). A full collection right after each
 * render keeps the peak near the live size.
 *
 * It uses the DevTools protocol on our own webContents instead of `--js-flags=--expose-gc`, because that flag is
 * process-wide and would hand a `gc()` global to YouTube/Spotify/Melon pages (AGENTS.md: sites load unmodified).
 * Node-only deps (no Electron import) so the logic is unit-tested with a fake debugger.
 */
export function createGarbageCollector(getWebContents, { minGapMs = 15_000, now = Date.now } = {}) {
  let last = -Infinity;
  let running = false;

  /** @returns {Promise<boolean>} true when a collection ran */
  return async function collect() {
    const wc = getWebContents();
    if (!wc || wc.isDestroyed() || running || now() - last < minGapMs) return false;
    running = true;
    const dbg = wc.debugger;
    const alreadyAttached = dbg.isAttached(); // DevTools may be open in a dev run: leave it alone
    try {
      if (!alreadyAttached) dbg.attach('1.3');
      await dbg.sendCommand('HeapProfiler.collectGarbage');
      last = now();
      return true;
    } catch {
      return false;
    } finally {
      if (!alreadyAttached) {
        try { dbg.detach(); } catch { /* the window went away mid-collection */ }
      }
      running = false;
    }
  };
}
