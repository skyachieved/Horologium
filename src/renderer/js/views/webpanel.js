/*
 * The panel for a web music source: a toolbar (back, forward, reload, site switcher, mute, open in browser),
 * the manifest's "unofficial" notice, and a surface rectangle. The actual page is a sandboxed WebContentsView
 * that the main process lays over that rectangle, so this module only reports where the rectangle is.
 */
import { h } from '../dom.js';
import { icon } from '../icons.js';
import { t, language } from '../i18n.js';
import { segmented } from '../controls.js';
import { toast } from '../toast.js';

export function createWebPanel({ source, wide }) {
  const bridge = window.horologium;
  const web = source.web;
  const label = (obj) => obj?.[language()] ?? obj?.en ?? '';
  let siteId = web.sites[0].id;
  let muted = false;
  let observer = null;
  let offState = null;
  let onResize = null;

  const surface = h('div', { class: 'webtab-surface' });
  const status = h('div', { class: 'webtab-status hint' });
  const btn = (name, key, onclick) => h('button', { type: 'button', class: 'btn btn-round', title: t(key), 'aria-label': t(key), onclick }, icon(name));
  const back = btn('back', 'web.back', () => bridge.webTabNav({ action: 'back' }));
  const forward = btn('forward', 'web.forward', () => bridge.webTabNav({ action: 'forward' }));
  const reload = btn('reset', 'web.reload', () => bridge.webTabNav({ action: 'reload' }));
  const muteBtn = h('button', { type: 'button', class: 'btn btn-round', title: t('web.mute'), 'aria-label': t('web.mute'), 'aria-pressed': 'false', onclick: async () => {
    muted = !muted;
    muteBtn.setAttribute('aria-pressed', String(muted));
    muteBtn.replaceChildren(icon(muted ? 'mute' : 'volume'));
    await bridge.webTabMute({ muted });
  } }, icon('volume'));
  const external = btn('external', 'web.external', () => bridge.webTabNav({ action: 'external' }));

  const sites = web.sites.length > 1
    ? segmented(label(source.name), web.sites.map((s) => ({ value: s.id, label: label(s.name) })), siteId, (id) => { siteId = id; sites.setValue(id); open(); })
    : null;

  const el = h('div', { class: 'webpanel' },
    h('div', { class: 'webtoolbar' }, back, forward, reload, sites ?? h('span', { class: 'webtoolbar-title' }, label(web.sites[0].name)), h('span', { class: 'spacer' }), muteBtn, external),
    h('div', { class: 'webnotice hint' }, label(web.notice)),
    surface,
    status);

  const rect = () => {
    const r = surface.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };

  async function open() {
    await bridge.webTabOpen({ sourceId: source.id, siteId, bounds: rect() });
  }

  function onState(state) {
    if (state.sourceId && state.sourceId !== source.id) return;
    if (state.siteId && state.siteId !== siteId) { // e.g. a pinned page came back showing the other site
      siteId = state.siteId;
      sites?.setValue(siteId);
    }
    back.disabled = !state.canGoBack;
    forward.disabled = !state.canGoForward;
    if (state.openedExternally) toast(t('web.openedExternally', { host: state.openedExternally }));
    status.textContent = state.error ? t('web.error') : state.loading ? t('web.loading') : '';
    status.classList.toggle('error', Boolean(state.error));
  }

  function detach() {
    observer?.disconnect();
    offState?.();
    if (onResize) window.removeEventListener('resize', onResize);
    observer = null;
    offState = null;
    onResize = null;
  }

  return {
    el,
    async mount(host) {
      host.replaceChildren(el);
      await wide.set(web.size); // widen the card first so the surface has its final size
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      offState = bridge.onWebTabState(onState);
      await open();
      observer = new ResizeObserver(() => bridge.webTabBounds(rect()));
      observer.observe(surface);
      onResize = () => bridge.webTabBounds(rect());
      window.addEventListener('resize', onResize);
    },
    /** Switching to another sub-tab: destroy the page (frees memory, stops playback). */
    unmount() {
      detach();
      bridge.webTabClose();
      wide.set(null);
    },
    /** The widget is leaving the page (collapsed, hidden, other tab): a playing video is pinned to the mini player. */
    suspend() {
      detach();
      bridge.webTabSuspend();
      wide.set(null);
    },
  };
}
