import type { ITuffTransportMain } from '@talex-touch/utils/transport/main'
import type { BrowserWindow } from 'electron'
import type { BrowserWorkspaceManager } from './workspace-manager'
import { BrowserEvents } from '@talex-touch/utils/transport/sdk/domains/browser'
import { assertBrowserOwner } from './policy'

/** All browser commands share the same concrete, live main-frame authorization boundary. */
export function registerBrowserHandlers(
  transport: ITuffTransportMain,
  owner: BrowserWindow,
  manager: BrowserWorkspaceManager
): () => void {
  const disposers = [
    transport.on(BrowserEvents.getState, (_payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.getState()
    }),
    transport.on(BrowserEvents.createTab, (payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.createTab(payload?.input)
    }),
    transport.on(BrowserEvents.activateTab, (payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.activateTab(payload?.tabId)
    }),
    transport.on(BrowserEvents.closeTab, (payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.closeTab(payload?.tabId)
    }),
    transport.on(BrowserEvents.navigate, (payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.navigate(payload?.tabId, payload?.input)
    }),
    transport.on(BrowserEvents.back, (payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.back(payload?.tabId)
    }),
    transport.on(BrowserEvents.forward, (payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.forward(payload?.tabId)
    }),
    transport.on(BrowserEvents.reload, (payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.reload(payload?.tabId)
    }),
    transport.on(BrowserEvents.stop, (payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.stop(payload?.tabId)
    }),
    transport.on(BrowserEvents.setViewport, (payload, context) => {
      assertBrowserOwner(context, owner)
      manager.setViewport(payload)
    }),
    transport.on(BrowserEvents.toggleBookmark, (payload, context) => {
      assertBrowserOwner(context, owner)
      return manager.toggleBookmark(payload?.tabId)
    })
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
