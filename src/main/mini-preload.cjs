/* Preload for the mini player's control strip only: two buttons and a title. Sandboxed, so CommonJS. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miniBridge', {
  expand: () => ipcRenderer.send('mini:expand'),
  close: () => ipcRenderer.send('mini:close'),
  onTitle: (cb) => {
    ipcRenderer.on('mini:title', (_event, title) => cb(String(title ?? '')));
  },
});
