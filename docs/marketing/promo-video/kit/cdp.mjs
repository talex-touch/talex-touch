// Headless Chrome over CDP, shared by render.mjs, shoot.mjs and probe.mjs.
// A scene is driven only through the globals it defines: `__ready` (a promise), `__duration`, `__seek(t)`.
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export const W = 1920
export const H = 1080
const KIT = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(KIT, '../../../..')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// The scenes load kit/gsap.min.js. It is the workspace's own gsap package, copied in rather than committed.
export function ensureGsap() {
  const target = path.join(KIT, 'gsap.min.js')
  if (existsSync(target)) return
  const require = createRequire(path.join(REPO, 'packages/utils/package.json'))
  copyFileSync(require.resolve('gsap/dist/gsap.min.js'), target)
}

/**
 * Opens a scene page at 1920×1080 and waits for `window.__ready`.
 * `name` keeps each tool's Chrome profile apart; `port` lets the three tools run side by side.
 * `verbose` forwards every page console message, not only warnings and errors.
 */
export async function openScene(sceneFile, { name, port, verbose = false }) {
  ensureGsap()
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(os.tmpdir(), `tuff-promo-${name}`)}`,
    `--window-size=${W},${H}`,
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    '--force-color-profile=srgb',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--allow-file-access-from-files',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  const close = () => chrome.kill('SIGTERM')

  try {
    let wsUrl
    for (let i = 0; i < 100 && !wsUrl; i++) {
      await sleep(100)
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        wsUrl = targets.find(t => t.type === 'page')?.webSocketDebuggerUrl
      }
      catch {}
    }
    if (!wsUrl)
      throw new Error(`Chrome did not come up on port ${port} (${CHROME})`)

    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    })
    let seq = 0
    const pending = new Map()
    const listeners = new Map()
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      }
      else if (msg.method && listeners.has(msg.method)) {
        listeners.get(msg.method)(msg.params)
      }
    }
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails)
        throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 900))
      return r.result.value
    }

    await send('Page.enable')
    await send('Runtime.enable')
    listeners.set('Runtime.consoleAPICalled', (p) => {
      if (verbose || p.type === 'error' || p.type === 'warning')
        console.error('[page]', p.args.map(a => a.value ?? a.description).join(' '))
    })
    listeners.set('Runtime.exceptionThrown', p => console.error('[page exception]', JSON.stringify(p.exceptionDetails).slice(0, 900)))
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
    const loaded = new Promise(resolve => listeners.set('Page.loadEventFired', resolve))
    await send('Page.navigate', { url: `file://${path.resolve(sceneFile)}` })
    await loaded
    await evaluate('window.__ready')

    return {
      send,
      evaluate,
      seek: t => evaluate(`window.__seek(${t})`),
      close() {
        ws.close()
        close()
      },
    }
  }
  catch (error) {
    close()
    throw error
  }
}
