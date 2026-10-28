/*
 * News tab (owner's note 12): whether an update is out (and the button that installs it), its release notes, and
 * what changed in each version so far (news.json, bundled, EN + KO). Release notes from GitHub are shown as plain
 * text lines (core/updates.js notesToText), never as markup.
 */
import { h, clear } from '../dom.js';
import { icon } from '../icons.js';
import { t, language } from '../i18n.js';
import * as S from '../app-state.js';
import * as U from '../updates.js';
import { SOURCE_COMMAND } from '../../core/updates.js';

let newsPromise = null;
const loadNews = () => (newsPromise ??= fetch(new URL('../../news.json', import.meta.url)).then((r) => r.json()).catch(() => []));

export function createNewsView() {
  const bridge = window.horologium;
  const card = h('div', { class: 'update-card', 'aria-live': 'polite' });
  const notes = h('div', { class: 'release-notes' });
  const history = h('div', { class: 'news-history' });
  const el = h('section', { class: 'view view-news', id: 'view-news' }, card, notes, history);

  const button = (label, onclick, primary = false) => h('button', { type: 'button', class: `btn btn-small${primary ? ' btn-primary' : ''}`, onclick }, label);
  const check = () => bridge.checkForUpdates().catch(() => {});

  function renderCard(st) {
    clear(card);
    const state = st?.state ?? 'idle';
    const latest = st?.latest;
    const line = (text, ...extra) => card.append(h('p', { class: 'update-line' }, text), ...extra);
    card.dataset.state = state;
    if (state === 'checking') line(t('update.checking'));
    else if (state === 'downloading') line(t('update.downloading', { percent: st.progress ?? 0 }), h('div', { class: 'progress' }, h('span', { style: `width: ${st.progress ?? 0}%` })));
    else if (state === 'ready') line(t('update.restarting'));
    else if (state === 'available' && latest) {
      line(t('update.available', { version: latest.version }));
      if (st.route === 'install') {
        card.append(h('div', { class: 'btn-row' }, button(t('update.install'), () => bridge.installUpdate().catch(() => {}), true)), h('p', { class: 'hint' }, t('update.installHint')));
      } else if (st.route === 'download') {
        card.append(h('div', { class: 'btn-row' }, button([icon('external'), ' ', t('update.download')], () => bridge.installUpdate().catch(() => {}), true)),
          h('p', { class: 'hint' }, st.platform === 'darwin' ? t('update.downloadHintMac') : t('update.downloadHint')));
      } else {
        const copied = h('span', { class: 'hint' });
        card.append(h('p', { class: 'hint' }, t('update.sourceHint')),
          h('div', { class: 'command-row' }, h('code', { class: 'command' }, SOURCE_COMMAND),
            button(t('update.copy'), async () => { await bridge.copyText({ text: SOURCE_COMMAND }); copied.textContent = t('update.copied'); }), copied),
          h('p', { class: 'hint' }, t('update.sourceAfter')));
      }
    } else if (state === 'error') {
      // a failed check or download never strands anyone: the release page always works
      const page = latest?.url ?? st.page;
      line(latest ? t('update.failed', { version: latest.version }) : t('update.error'),
        h('div', { class: 'btn-row' }, button(t('update.retry'), latest ? () => bridge.installUpdate().catch(() => {}) : check),
          button([icon('external'), ' ', t('update.page')], () => bridge.openExternal({ url: page }).catch(() => {}))));
    } else if (state === 'none') {
      line(t('update.none', { version: st.current }), h('div', { class: 'btn-row' }, button(t('update.check'), check)));
    } else {
      line(S.getState().settings.updates.check ? t('update.idle', { version: st?.current ?? S.env.version }) : t('update.off'), h('div', { class: 'btn-row' }, button(t('update.check'), check)));
    }

    clear(notes);
    if (latest?.notes?.length && ['available', 'downloading', 'ready'].includes(state)) {
      notes.append(h('h3', {}, t('update.whatsNew', { version: latest.version })),
        h('div', { class: 'notes-text' }, latest.notes.map((text) => (text ? h('p', {}, text) : h('br')))));
    }
  }

  async function renderHistory() {
    const news = await loadNews();
    const lang = language();
    clear(history);
    for (const entry of news) {
      const text = entry[lang] ?? entry.en;
      history.append(h('article', { class: 'news-entry' },
        h('header', {}, h('h3', {}, text.title), h('span', { class: 'hint' }, `v${entry.version} · ${entry.date}`)),
        h('ul', {}, text.items.map((item) => h('li', {}, item)))));
    }
  }

  renderCard(U.updateStatus());
  renderHistory();
  const off = U.onUpdate(renderCard);

  return {
    el,
    update() {
      if (el.checkVisibility()) U.markNewsSeen(); // opening News clears the dot (not a restore of the last tab while collapsed)
    },
    dispose: off,
  };
}
