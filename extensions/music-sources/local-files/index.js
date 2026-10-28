/*
 * "My music": plays audio files from folders the user picks and from music packs (data-only folders in the
 * user's extensions directory, e.g. AI-generated tracks the user made elsewhere).
 *
 * Playback uses a plain <audio> element routed through the shared music bus, so the music volume, master
 * volume and mute settings apply, and decoding costs almost nothing. OS media keys work through the
 * Media Session API. Only file NAMES are read; nothing is uploaded, copied or tag-parsed.
 *
 * Same contract as every source (see docs/extension-api.md): createSource(api) -> { mount, unmount, play, pause, ... }
 */
export default function createSource(api) {
  const { h, icon, t, lang, controls, toast } = api;
  const loc = (obj) => obj?.[lang()] ?? obj?.en ?? '';

  let audio = null;
  let library = null;   // { key, name, tracks: [{ title, url, file }] }
  let index = -1;
  let root = null;
  let seeking = false;
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());
  const music = () => api.state.get();
  const filesState = () => music().files ?? {};
  const saveFiles = (partial) => api.state.patch({ files: partial });

  // ---------- audio ----------
  /** Always goes through api.audio.ensure(): the shared context may be suspended while nothing played. */
  async function ensureAudio() {
    const { context, output } = await api.audio.ensure();
    if (audio) return audio;
    audio = new Audio();
    audio.preload = 'auto';
    context.createMediaElementSource(audio).connect(output);
    audio.addEventListener('ended', () => next());
    audio.addEventListener('timeupdate', refreshSeek);
    audio.addEventListener('loadedmetadata', refreshSeek);
    for (const name of ['play', 'pause']) audio.addEventListener(name, () => { refreshNow(); emit(); });
    audio.addEventListener('error', () => {
      const track = library?.tracks[index];
      toast(t('music.files.cantPlay', { title: track?.title ?? '' }), 'warn');
      next();
    });
    setupMediaSession();
    return audio;
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const bind = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported action */ } };
    bind('play', () => play());
    bind('pause', () => pause());
    bind('nexttrack', () => next());
    bind('previoustrack', () => previous());
  }

  const isPlaying = () => Boolean(audio && !audio.paused && !audio.ended);

  async function playIndex(i) {
    if (!library || library.tracks.length === 0) return;
    const el = await ensureAudio();
    index = ((i % library.tracks.length) + library.tracks.length) % library.tracks.length;
    const track = library.tracks[index];
    el.src = track.url;
    saveFiles({ source: library.key, track: track.file });
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: library.name, album: 'Horologium' });
    try {
      await el.play();
    } catch {
      /* the error event handles unplayable files */
    }
    refreshList();
    refreshNow();
    emit();
  }

  function next() {
    if (!library) return;
    if (filesState().shuffle && library.tracks.length > 1) {
      let pick = index;
      while (pick === index) pick = Math.floor(Math.random() * library.tracks.length);
      playIndex(pick);
    } else {
      playIndex(index + 1);
    }
  }

  const previous = () => {
    if (audio && audio.currentTime > 3) audio.currentTime = 0;
    else playIndex(index - 1);
  };

  async function play() {
    if (audio?.src && audio.paused && !audio.ended) {
      await (await ensureAudio()).play().catch(() => {});
      return;
    }
    if (!library) await restoreLibrary();
    if (library?.tracks.length) await playIndex(index >= 0 ? index : 0);
  }

  function pause() {
    audio?.pause();
  }

  // ---------- libraries (folders and packs) ----------
  function packLibrary(pack) {
    return {
      key: `pack:${pack.id}`,
      name: loc(pack.name),
      verified: pack.verified,
      license: pack.license,
      tracks: pack.tracks.map((tr) => ({ file: tr.file, title: tr.title ?? tr.file.replace(/^.*\//, '').replace(/\.[^.]+$/, ''), url: api.files.packUrl(pack, tr.file) })),
    };
  }

  async function folderLibrary(id) {
    const folder = music().folders?.[id];
    if (!folder) return null;
    const found = await api.files.tracks(id);
    return { key: `folder:${id}`, name: folder.name, tracks: found.map((f) => ({ file: f.file, title: f.title, url: api.files.folderUrl(id, f.file) })) };
  }

  async function loadLibrary(key) {
    const [kind, id] = key.split(':');
    const lib = kind === 'pack' ? (() => { const p = api.files.packs().find((x) => x.id === id); return p ? packLibrary(p) : null; })() : await folderLibrary(id);
    if (!lib) return false;
    library = lib;
    index = -1;
    return true;
  }

  async function restoreLibrary() {
    const saved = filesState();
    const key = saved.source ?? firstKey();
    if (!key || !(await loadLibrary(key))) return;
    const at = library.tracks.findIndex((tr) => tr.file === saved.track);
    index = at;
  }

  function firstKey() {
    const folder = Object.keys(music().folders ?? {})[0];
    if (folder) return `folder:${folder}`;
    const pack = api.files.packs()[0];
    return pack ? `pack:${pack.id}` : null;
  }

  async function choose(key) {
    if (!(await loadLibrary(key))) return;
    saveFiles({ source: key, track: null });
    renderBody();
  }

  async function addFolder() {
    const entry = await api.files.addFolder();
    if (!entry) return;
    api.state.patch({ folders: { [entry.id]: { path: entry.path, name: entry.name } } });
    await choose(`folder:${entry.id}`);
  }

  async function removeFolder(id) {
    await api.files.removeFolder(id);
    api.state.patch({ folders: { [id]: null } });
    if (library?.key === `folder:${id}`) {
      pause();
      library = null;
      index = -1;
      saveFiles({ source: null, track: null });
    }
    renderBody();
  }

  // ---------- UI ----------
  const nowTitle = h('div', { class: 'music-now-title' });
  const nowSub = h('div', { class: 'music-now-sub hint' });
  const playBtn = h('button', { type: 'button', class: 'btn btn-primary btn-round music-play', onclick: () => (isPlaying() ? pause() : play()) });
  const prevBtn = h('button', { type: 'button', class: 'btn btn-round', title: t('music.files.prev'), 'aria-label': t('music.files.prev'), onclick: previous }, icon('skip', 'flip'));
  const nextBtn = h('button', { type: 'button', class: 'btn btn-round', title: t('music.files.next'), 'aria-label': t('music.files.next'), onclick: next }, icon('skip'));
  const nowCard = h('div', { class: 'music-now' }, playBtn, h('div', { class: 'music-now-text' }, nowTitle, nowSub), prevBtn, nextBtn);

  const seek = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': t('music.files.seek') });
  const timeText = h('span', { class: 'slider-value' }, '0:00');
  seek.addEventListener('input', () => { seeking = true; });
  seek.addEventListener('change', () => {
    if (audio?.duration) audio.currentTime = (Number(seek.value) / 1000) * audio.duration;
    seeking = false;
  });
  const seekRow = h('div', { class: 'slider music-seek' }, seek, timeText);
  const body = h('div', { class: 'music-body' });

  const clock = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

  function refreshSeek() {
    if (!audio || seeking) return;
    const d = audio.duration;
    seek.value = d ? String(Math.round((audio.currentTime / d) * 1000)) : '0';
    timeText.textContent = `${clock(audio.currentTime)} / ${clock(d)}`;
  }

  function refreshNow() {
    const track = library?.tracks[index];
    nowTitle.textContent = track ? track.title : t('music.files.nothing');
    nowSub.textContent = track ? `${library.name} · ${index + 1}/${library.tracks.length}` : t('music.pick');
    const playing = isPlaying();
    playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', t(playing ? 'music.pause' : 'music.play'));
    nowCard.classList.toggle('is-playing', playing);
  }

  function refreshList() {
    root?.querySelectorAll('.track').forEach((el) => el.classList.toggle('playing', Number(el.dataset.i) === index && isPlaying()));
    root?.querySelectorAll('.track').forEach((el) => el.classList.toggle('on', Number(el.dataset.i) === index));
  }

  function libraryRow(key, name, detail, onRemove) {
    const active = library?.key === key;
    return h('div', { class: 'library-row' },
      h('button', { type: 'button', class: `station${active ? ' on' : ''}`, onclick: () => choose(key) },
        h('span', { class: 'station-text' }, h('span', { class: 'station-name' }, name), h('span', { class: 'station-desc hint' }, detail))),
      onRemove ? h('button', { type: 'button', class: 'btn btn-round btn-small', title: t('music.files.remove'), 'aria-label': t('music.files.remove'), onclick: onRemove }, icon('close')) : null);
  }

  function renderBody() {
    const folders = Object.entries(music().folders ?? {});
    const packs = api.files.packs();
    const parts = [];

    parts.push(h('div', { class: 'row-between' }, h('h4', { class: 'music-subtitle' }, t('music.files.folders')),
      h('button', { type: 'button', class: 'btn btn-small', onclick: addFolder }, icon('edit'), h('span', {}, t('music.files.addFolder')))));
    for (const [id, f] of folders) parts.push(libraryRow(`folder:${id}`, f.name, f.path, () => removeFolder(id)));

    if (packs.length) {
      parts.push(h('h4', { class: 'music-subtitle' }, t('music.files.packs')));
      for (const p of packs) parts.push(libraryRow(`pack:${p.id}`, loc(p.name), `${t('music.files.tracks', { n: p.tracks.length })} · ${p.verified ? p.license : t('music.files.unverified')}`, null));
      parts.push(h('div', { class: 'hint' }, t('music.files.licenseNote')));
    }
    if (!folders.length && !packs.length) parts.push(h('p', { class: 'muted center' }, t('music.files.empty')));

    if (library) {
      parts.push(h('h4', { class: 'music-subtitle' }, `${library.name} · ${t('music.files.tracks', { n: library.tracks.length })}`));
      parts.push(controls.row(t('music.files.shuffle'), controls.toggle({ checked: Boolean(filesState().shuffle), label: t('music.files.shuffle'), onChange: (v) => saveFiles({ shuffle: v }) })));
      parts.push(library.tracks.length === 0
        ? h('p', { class: 'muted center' }, t('music.files.noTracks'))
        : h('div', { class: 'track-list' }, library.tracks.map((tr, i) => h('button', { type: 'button', class: 'track', dataset: { i }, onclick: () => playIndex(i) },
          h('span', { class: 'eq', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), h('span', { class: 'track-title' }, tr.title)))));
    }
    parts.push(controls.volume()); // the Music tab's own volume (owner's note 8)
    body.replaceChildren(...parts);
    refreshNow();
    refreshList();
  }

  return {
    id: 'local-files',
    async mount(el) {
      root = h('div', { class: 'music-files' }, nowCard, seekRow, body);
      el.replaceChildren(root);
      if (!library) await restoreLibrary();
      renderBody();
    },
    unmount() { root = null; },
    play,
    pause,
    toggle: () => (isPlaying() ? pause() : play()),
    isPlaying,
    info: () => ({ title: library?.tracks[index]?.title ?? '', playing: isPlaying() }),
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    stop() { audio?.pause(); },
    dispose() { audio?.pause(); },
  };
}
