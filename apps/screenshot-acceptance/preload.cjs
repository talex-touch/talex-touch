'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('screenshotAcceptance', {
  start: () => ipcRenderer.invoke('screenshot:start'),
})
