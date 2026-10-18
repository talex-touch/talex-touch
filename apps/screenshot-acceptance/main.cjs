'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const process = require('node:process')
const { app, BrowserWindow, ipcMain } = require('electron')

const WORKSPACE_ROOT = path.resolve(__dirname, '../..')
const CORE_APP_DIR = path.join(WORKSPACE_ROOT, 'apps', 'core-app')
let mainWindow = null
let coreAppProcess = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 520,
    minWidth: 620,
    minHeight: 440,
    show: false,
    title: 'Tuff Screenshot Acceptance',
    backgroundColor: '#111315',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', event => event.preventDefault())
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = null
    stopCoreApp()
  })
  void mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

function isCoreAppRunning() {
  return Boolean(coreAppProcess && coreAppProcess.exitCode === null && !coreAppProcess.killed)
}

function stopCoreApp() {
  const child = coreAppProcess
  coreAppProcess = null
  if (child && !child.killed)
    child.kill('SIGTERM')
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('无法分配截图验收端口')))
        return
      }
      server.close((error) => {
        if (error)
          reject(error)
        else resolve(address.port)
      })
    })
  })
}

async function startCoreApp() {
  if (isCoreAppRunning())
    return { accepted: true, alreadyRunning: true }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'tuff-screenshot-acceptance-'))
  const port = await findFreePort()
  const child = spawn('pnpm', ['-C', CORE_APP_DIR, 'dev', '--', '--silent'], {
    cwd: WORKSPACE_ROOT,
    env: {
      ...process.env,
      TUFF_DEV_NICE: '10',
      TUFF_DEV_SERVER_PORT: String(port),
      TUFF_PACKAGED_ACCEPTANCE_ISOLATED: '1',
      TUFF_SCREENSHOT_ACCEPTANCE: '1',
      TUFF_STARTUP_BENCHMARK_USER_DATA_DIR: profile,
    },
    shell: false,
    stdio: 'ignore',
  })
  coreAppProcess = child
  child.once('exit', () => {
    if (coreAppProcess === child)
      coreAppProcess = null
  })
  return { accepted: true, alreadyRunning: false, port }
}

ipcMain.handle('screenshot:start', async () => startCoreApp())

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0)
      createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin')
    app.quit()
})

app.on('before-quit', () => {
  stopCoreApp()
})
