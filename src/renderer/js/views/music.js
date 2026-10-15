/*
 * Music tab: a sub-tab per music source (the list comes from the extension registry, so installing a source
 * adds a tab). Code sources (Stations) draw their own panel; web sources (YouTube, Spotify, Melon) get a
 * web panel and widen the card. This view only switches between them.
 */
import { h } from '../dom.js';
import { t, language } from '../i18n.js';
import { segmented } from '../controls.js';
import * as S from '../app-state.js';
import * as Manager from '../music-manager.js';
import { createWebPanel } from './webpanel.js';

/** @param {{registry: object, wide: {set: (size: {w: number, h: number}|null) => Promise<void>}}} ctx */
export function createMusicView({ registry, wide }) {
  const sources = Manager.musicSources(registry);
  const el = h('section', { class: 'view view-music', id: 'view-music' });
  const host = h('div', { class: 'music-host' });
  let current = null;
  let currentId = null;
  let mounted = false;
  let tabs = null;

  async function show(id) {
    current?.unmount?.();
    current = null;
    currentId = id;
    S.patch({ music: { source: id } });
    const def = sources.find((s) => s.id === id);
    if (!def) return;
    if (def.kind === 'web') {
      const panel = createWebPanel({ source: def, wide });
      current = panel;
      await panel.mount(host);
      return;
    }
    await wide.set(null);
    const source = await Manager.getSource(id);
    if (!source || currentId !== id) return; // the user switched again while it was loading
    current = source;
    source.mount(host);
  }

  if (sources.length === 0) {
    el.append(h('p', { class: 'muted center' }, t('music.noSources')));
  } else {
    const label = (s) => `${s.tab.icon} ${s.name[language()] ?? s.name.en}`;
    const wanted = sources.find((s) => s.id === S.getState().music.source) ?? sources[0];
    if (sources.length > 1) {
      tabs = segmented(t('tab.music'), sources.map((s) => ({ value: s.id, label: label(s) })), wanted.id, (id) => {
        tabs.setValue(id);
        show(id);
      });
      el.append(tabs);
    }
    el.append(host);
    el.dataset.pendingSource = wanted.id;
  }

  return {
    el,
    /** Called by the widget whenever this tab is visible; the first call (after each leave) mounts the panel. */
    update() {
      if (!mounted && el.dataset.pendingSource) {
        mounted = true;
        show(S.getState().music.source && sources.some((s) => s.id === S.getState().music.source) ? S.getState().music.source : el.dataset.pendingSource);
      }
    },
    /** The user left this tab (or closed the widget): web pages are destroyed, generated music keeps playing. */
    deactivate() {
      if (current?.suspend) current.suspend();
      else current?.unmount?.();
      current = null;
      currentId = null;
      mounted = false;
    },
    dispose() {
      current?.unmount?.();
    },
  };
}
