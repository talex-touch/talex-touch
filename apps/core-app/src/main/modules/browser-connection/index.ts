import type { ModuleInitContext } from '@talex-touch/utils'
import type { TalexEvents } from '../../core/eventbus/touch-event'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { StorageList } from '@talex-touch/utils'
import { BrowserConnectionEvents } from '@talex-touch/utils/transport/sdk/domains/browser-connection'
import { app, shell } from 'electron'
import { isBetaFeatureEnabled } from '../../../shared/beta-features'
import { resolveMainRuntime } from '../../core/runtime-accessor'
import { BaseModule } from '../abstract-base-module'
import { normalizeAsarUnpackedPath } from '../box-tool/addon/files/native-binary-path'
import { getMainConfig, subscribeMainConfig, useMainStorage } from '../storage'
import { resolveAppConfigBackend } from '../storage/app-config-repository'
import { BROWSER_CONNECTIONS_STORAGE_KEY } from '../storage/main-storage-registry'
import { registerBrowserConnectionHandlers } from './handlers'
import { BrowserBridgeInstaller } from './installer'
import { BrowserConnectionManager } from './manager'
import { BrowserConnectionServer } from './server'

export class BrowserConnectionModule extends BaseModule<TalexEvents> {
  static key = Symbol.for('BrowserConnection')
  private manager: BrowserConnectionManager | null = null
  private server: BrowserConnectionServer | null = null
  private installer: BrowserBridgeInstaller | null = null
  private disposers: Array<() => void> = []
  private installed = false
  constructor() {
    super(BrowserConnectionModule.key, { create: false })
  }
  async onInit(ctx: ModuleInitContext<TalexEvents>): Promise<void> {
    const runtime = resolveMainRuntime(ctx, 'BrowserConnectionModule.onInit')
    const owner = runtime.window?.window
    if (!owner || owner.isDestroyed()) throw new Error('BROWSER_MAIN_WINDOW_UNAVAILABLE')
    if (resolveAppConfigBackend() !== 'sqlite') throw new Error('BROWSER_SQLITE_REQUIRED')
    if (!runtime.app.rootPath) throw new Error('BROWSER_DATA_ROOT_UNAVAILABLE')
    const storage = useMainStorage()
    const binaryName = `tuff-browser-bridge${process.platform === 'win32' ? '.exe' : ''}`
    const externalBinary = path.join(
      process.resourcesPath,
      'node_modules/@talex-touch/tuff-native/build/Release',
      binaryName
    )
    let binaryPath = externalBinary
    if (!existsSync(externalBinary)) {
      // Resolve lazily: ordinary startup must still work when the optional helper isn't built.
      try {
        const root = path.dirname(require.resolve('@talex-touch/tuff-native'))
        binaryPath = normalizeAsarUnpackedPath(path.join(root, 'build/Release', binaryName))!
      } catch {
        binaryPath = path.join(
          app.getAppPath(),
          'node_modules/@talex-touch/tuff-native/build/Release',
          binaryName
        )
      }
    }
    const extensionDirectory = app.isPackaged
      ? path.join(process.resourcesPath, 'resources/browser-connector')
      : path.join(app.getAppPath(), 'resources/browser-connector')
    const installer = new BrowserBridgeInstaller({
      home: app.getPath('home'),
      root: runtime.app.rootPath,
      extensionDirectory,
      binaryPath,
      platform: process.platform
    })
    this.installer = installer
    const installation = await installer.getState()
    this.installed = installation.installed
    const manager = new BrowserConnectionManager(
      {
        installation,
        persist: async (document) => {
          const result = await storage.saveConfigDurable(
            BROWSER_CONNECTIONS_STORAGE_KEY,
            document,
            { force: true }
          )
          if (!result.success) throw new Error('BROWSER_CONNECTION_PERSIST_FAILED')
        },
        enabled: () =>
          isBetaFeatureEnabled(getMainConfig(StorageList.APP_SETTING), 'browserWorkspace'),
        notifyTabs: (change) => {
          if (!owner.isDestroyed() && !owner.webContents.isDestroyed())
            runtime.transport.notifyTo(
              owner.webContents,
              BrowserConnectionEvents.tabsChanged,
              change
            )
        },
        notify: (state) => {
          if (!owner.isDestroyed() && !owner.webContents.isDestroyed())
            runtime.transport.notifyTo(owner.webContents, BrowserConnectionEvents.changed, state)
        }
      },
      storage.getConfig(BROWSER_CONNECTIONS_STORAGE_KEY)
    )
    this.manager = manager
    const server = new BrowserConnectionServer(manager)
    this.server = server
    if (installation.installed)
      await installer.setEndpoint(await server.start(), manager.getServerPublicKey())
    let enabled = isBetaFeatureEnabled(getMainConfig(StorageList.APP_SETTING), 'browserWorkspace')
    this.disposers.push(
      subscribeMainConfig(StorageList.APP_SETTING, (settings) => {
        const next = isBetaFeatureEnabled(settings, 'browserWorkspace')
        if (next === enabled) return
        enabled = next
        void manager.featureGateChanged().catch(() => {})
      })
    )
    this.disposers.push(
      registerBrowserConnectionHandlers(runtime.transport, owner, manager, {
        install: async () => {
          manager.assertEnabled()
          await installer.setEndpoint(await server.start(), manager.getServerPublicKey())
          manager.assertEnabled()
          const state = await installer.install()
          this.installed = state.installed
          return state
        },
        revealExtension: async () => {
          const state = await installer.getState()
          if (!state.extensionDirectory) throw new Error('BROWSER_EXTENSION_RESOURCE_MISSING')
          shell.showItemInFolder(path.join(state.extensionDirectory, 'manifest.json'))
        }
      })
    )
  }
  async onDestroy(): Promise<void> {
    for (const dispose of this.disposers.splice(0).reverse()) dispose()
    await this.server?.dispose()
    await this.manager?.dispose()
    if (this.installed) await this.installer?.clearEndpoint()
    this.server = null
    this.manager = null
    this.installer = null
  }
}
export const browserConnectionModule = new BrowserConnectionModule()
