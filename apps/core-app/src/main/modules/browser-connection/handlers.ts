import type { BrowserWindow } from 'electron'
import { session } from 'electron'
import type { ITuffTransportMain } from '@talex-touch/utils/transport/main'
import type { BrowserConnectionManager } from './manager'
import type { BrowserBridgeInstaller } from './installer'
import { BrowserConnectionEvents as events } from '@talex-touch/utils/transport/sdk/domains/browser-connection'
import { assertBrowserOwner } from '../browser/policy'
import { TUFF_BROWSER_PARTITION } from '../browser'

export function registerBrowserConnectionHandlers(
  transport: ITuffTransportMain,
  owner: BrowserWindow,
  manager: BrowserConnectionManager,
  installer: Pick<BrowserBridgeInstaller, 'install'> & { revealExtension: () => Promise<void> }
): () => void {
  const disposers = [
    transport.on(events.getState, (_payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.getState()
    }),
    transport.on(events.install, async (_payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.updateInstallation(await installer.install())
    }),
    transport.on(events.revealExtension, (_payload, context) => {
      assertBrowserOwner(context, owner)
      return installer.revealExtension()
    }),
    transport.on(events.beginPairing, (_payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.beginPairing()
    }),
    transport.on(events.cancelPairing, (_payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.cancelPairing()
    }),
    transport.on(events.selectProfile, (payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.selectProfile(payload?.profileId)
    }),
    transport.on(events.setPaused, (payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.setPaused(payload?.profileId, payload?.paused)
    }),
    transport.on(events.disconnect, (payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.disconnect(payload?.profileId)
    }),
    transport.on(events.bookmark, (payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.bookmark(payload?.profileId, payload?.command)
    }),
    transport.on(events.resolveConflict, (payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.resolveConflict(payload?.profileId, payload?.operationId, payload?.resolution)
    }),
    transport.on(events.tab, (payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.tab(payload?.profileId, payload?.command)
    }),
    transport.on(events.refresh, (payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.refresh(payload?.profileId)
    }),
    transport.on(events.getCookies, async (payload, context) => {
      assertBrowserOwner(context, owner)
      const cookies = await manager.getCookies(payload?.profileId, payload?.filter)
      return { cookies }
    }),
    transport.on(events.importCookies, async (payload, context) => {
      assertBrowserOwner(context, owner)
      const cookies = await manager.getCookies(payload?.profileId, payload?.filter)
      const browserSession = session.fromPartition(TUFF_BROWSER_PARTITION)
      let importedCount = 0
      const domainSet = new Set<string>()
      for (const cookie of cookies) {
        const domainClean = cookie.domain.replace(/^\./, '')
        const scheme = cookie.secure ? 'https' : 'http'
        const pathClean = cookie.path.startsWith('/') ? cookie.path : `/${cookie.path}`
        const url = `${scheme}://${domainClean}${pathClean}`
        try {
          await browserSession.cookies.set({
            url,
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite:
              cookie.sameSite === 'no_restriction'
                ? 'no_restriction'
                : cookie.sameSite === 'strict'
                  ? 'strict'
                  : 'lax',
            expirationDate: cookie.expirationDate
          })
          importedCount += 1
          domainSet.add(domainClean)
        } catch {
          // ignore invalid single cookie
        }
      }
      await browserSession.cookies.flushStore().catch(() => {})
      return {
        importedCount,
        domains: Array.from(domainSet)
      }
    })
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
