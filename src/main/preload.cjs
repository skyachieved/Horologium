/*
 * The only bridge between the sandboxed page and the main process. Exposes a small, explicit API as
 * `window.horologium`; the renderer never gets Node, Electron, or the raw ipcRenderer.
 * (Sandboxed preloads must be CommonJS, which is why this one file is .cjs.)
 */
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (arg) => ipcRenderer.invoke(channel, arg);

/** Subscribe to a main -> renderer event; returns an unsubscribe function. */
function on(channel, handler) {
  const listener = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('horologium', {
  init: invoke('app:init'),
  patchStore: invoke('store:patch'),

  resize: invoke('win:resize'),
  dragStart: invoke('win:dragStart'),
  dragMove: (point) => ipcRenderer.send('win:dragMove', point),
  dragEnd: invoke('win:dragEnd'),
  hideNow: invoke('win:hideNow'),

  setHotkey: invoke('hotkey:set'),
  pauseHotkey: invoke('hotkey:pause'),
  resumeHotkey: invoke('hotkey:resume'),
  searchCities: invoke('weather:search'),
  fetchWeather: invoke('weather:current'),
  approximateLocation: invoke('weather:approx'),

  webTabOpen: invoke('webtab:open'),
  webTabBounds: invoke('webtab:bounds'),
  webTabClose: invoke('webtab:close'),
  webTabSuspend: invoke('webtab:suspend'),
  webTabMute: invoke('webtab:mute'),
  webTabNav: invoke('webtab:nav'),
  webTabState: invoke('webtab:state'),
  webTabSilence: invoke('webtab:silence'),

  mediaAdd: invoke('media:add'),
  mediaRemove: invoke('media:remove'),
  mediaTracks: invoke('media:tracks'),

  notify: invoke('notify'),
  openExternal: invoke('shell:openExternal'),
  setLaunchAtLogin: invoke('login:set'),
  collectGarbage: invoke('app:gc'),
  moveView: invoke('view:move'),   // { direction: 'left' | 'right' }
  goView: invoke('view:go'),       // { state: 'menu' | 'icon' | 'hidden' }
  currentView: invoke('view:current'),
  setStatus: invoke('app:status'), // { text } for the tray tooltip
  updateStatus: invoke('update:status'),
  checkForUpdates: invoke('update:check'),
  installUpdate: invoke('update:install'),
  copyText: invoke('clipboard:write'), // { text }
  quit: invoke('app:quit'),

  onShow: (cb) => on('widget:show', cb),
  onHideRequest: (cb) => on('widget:hide-request', cb),
  onHotkeyStatus: (cb) => on('hotkey:status', cb),
  onWebTabState: (cb) => on('webtab:state', cb),
  onWebAudio: (cb) => on('webtab:audio', cb),
  onOpenTab: (cb) => on('widget:open-tab', cb),
  onSetMode: (cb) => on('widget:set-mode', cb),
  onCommand: (cb) => on('widget:command', cb),
  onUpdateStatus: (cb) => on('update:status', cb),
});
