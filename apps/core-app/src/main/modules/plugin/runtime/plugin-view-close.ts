import type { WebContentsView } from 'electron'
import { PluginEvents } from '@talex-touch/utils/transport/events'
import { getCurrentTouchApp } from '../../../core/main-runtime-state'
import { createLogger } from '../../../utils/logger'
import { resolvePluginRegistrationByWebContents } from './plugin-view-registry'

const pluginViewCloseLog = createLogger('PluginViewClose')

/** How long a closing page waits for its plugin to finish writing. */
export const PLUGIN_BEFORE_CLOSE_TIMEOUT_MS = 1_000

/**
 * Tells the plugin on a page that the page is about to close, and resolves once its
 * `onBeforeClose` hooks have finished or `timeoutMs` has passed. `webContents.close()` skips the
 * page's `beforeunload`, and its unload handlers may not finish, so this is when a plugin writes
 * what it holds - a form draft, for one.
 *
 * @returns `null` when there is nobody to tell: not a plugin page, or one that cannot answer.
 */
export function notifyPluginBeforeClose(
  webContents: Electron.WebContents,
  timeoutMs = PLUGIN_BEFORE_CLOSE_TIMEOUT_MS
): Promise<unknown> | null {
  const registration = resolvePluginRegistrationByWebContents(webContents.id)
  const channel = getCurrentTouchApp()?.channel
  if (!registration || !channel || webContents.isDestroyed() || webContents.isCrashed()) {
    return null
  }
  return channel._sendTo(
    // The channel reaches a page through its host's `webContents`, whichever kind of host it is.
    { webContents } as unknown as WebContentsView,
    'plugin',
    PluginEvents.lifecycleSignal.beforeClose.toEventName(),
    { plugin: registration.name },
    { uniqueKey: registration.key },
    { timeoutMs }
  )
}

/**
 * Closes a plugin page once its plugin has written what it holds. Take its view out of the
 * window first: a plugin page closes when the plugin answers or the wait runs out, and any other
 * page closes at once.
 */
export function closePluginWebContents(webContents: Electron.WebContents | null | undefined): void {
  if (!webContents || webContents.isDestroyed()) return
  const notified = notifyPluginBeforeClose(webContents)
  if (!notified) {
    webContents.close()
    return
  }
  void notified
    .catch((error) => {
      pluginViewCloseLog.warn('Plugin page did not take the before-close signal', { error })
    })
    .finally(() => {
      if (!webContents.isDestroyed()) webContents.close()
    })
}
