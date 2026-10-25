// 注意：窗口开了沙箱（默认开启），沙箱化的 preload 只能是 CommonJS，
// 不能用 .mjs / import，否则 preload 静默失效、window.api 为 undefined。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  parse: (payload) => ipcRenderer.invoke('parse', payload),
  import: () => ipcRenderer.invoke('import'),
  export: (payload) => ipcRenderer.invoke('export', payload),
  getSyncConfig: () => ipcRenderer.invoke('sync:getConfig'),
  saveSyncConfig: (payload) => ipcRenderer.invoke('sync:saveConfig', payload),
  testSync: () => ipcRenderer.invoke('sync:test'),
  push: () => ipcRenderer.invoke('sync:push'),
})
