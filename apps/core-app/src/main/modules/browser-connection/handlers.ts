import type { BrowserWindow } from 'electron'
import type { ITuffTransportMain } from '@talex-touch/utils/transport/main'
import type { BrowserConnectionManager } from './manager'
import type { BrowserBridgeInstaller } from './installer'
import { BrowserConnectionEvents as events } from '@talex-touch/utils/transport/sdk/domains/browser-connection'
import { assertBrowserOwner } from '../browser/policy'

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
    })
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
