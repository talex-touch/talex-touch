import type { ITuffTransport } from '../../types'
import { defineEvent } from '../../event/builder'

export interface BrowserTabState {
  id: string
  /** Empty for the local new-tab page; remote pages are HTTP(S) only. */
  url: string
  title: string
  favicon: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
}

export interface BrowserSavedPage {
  url: string
  title: string
  favicon: string | null
  visitedAt: number
}

export interface BrowserWorkspaceState {
  /** Monotonic within the owning main-process session. */
  revision: number
  tabs: BrowserTabState[]
  activeTabId: string
  recent: BrowserSavedPage[]
  bookmarks: BrowserSavedPage[]
}

export interface BrowserViewportRequest {
  /** Main-window content coordinates, in device-independent pixels. */
  bounds: { x: number, y: number, width: number, height: number }
  visible: boolean
}

const api = defineEvent('browser').module('workspace')

export const BrowserEvents = {
  getState: api.event('get').define<void, BrowserWorkspaceState>(),
  createTab: api.event('create-tab').define<{ input?: string }, BrowserWorkspaceState>(),
  activateTab: api.event('activate-tab').define<{ tabId: string }, BrowserWorkspaceState>(),
  closeTab: api.event('close-tab').define<{ tabId: string }, BrowserWorkspaceState>(),
  navigate: api.event('navigate').define<{ tabId: string, input: string }, BrowserWorkspaceState>(),
  back: api.event('back').define<{ tabId: string }, BrowserWorkspaceState>(),
  forward: api.event('forward').define<{ tabId: string }, BrowserWorkspaceState>(),
  reload: api.event('reload').define<{ tabId: string }, BrowserWorkspaceState>(),
  stop: api.event('stop').define<{ tabId: string }, BrowserWorkspaceState>(),
  setViewport: api.event('set-viewport').define<BrowserViewportRequest, void>(),
  toggleBookmark: api.event('toggle-bookmark').define<{ tabId: string }, BrowserWorkspaceState>(),
  changed: defineEvent('browser').module('push').event('changed').define<BrowserWorkspaceState, void>(),
  focusAddress: defineEvent('browser').module('push').event('focus-address').define<void, void>(),
} as const

export interface BrowserSdk {
  getState: () => Promise<BrowserWorkspaceState>
  createTab: (input?: string) => Promise<BrowserWorkspaceState>
  activateTab: (tabId: string) => Promise<BrowserWorkspaceState>
  closeTab: (tabId: string) => Promise<BrowserWorkspaceState>
  navigate: (tabId: string, input: string) => Promise<BrowserWorkspaceState>
  back: (tabId: string) => Promise<BrowserWorkspaceState>
  forward: (tabId: string) => Promise<BrowserWorkspaceState>
  reload: (tabId: string) => Promise<BrowserWorkspaceState>
  stop: (tabId: string) => Promise<BrowserWorkspaceState>
  setViewport: (request: BrowserViewportRequest) => Promise<void>
  toggleBookmark: (tabId: string) => Promise<BrowserWorkspaceState>
  onChanged: (listener: (state: BrowserWorkspaceState) => void) => () => void
  onFocusAddress: (listener: () => void) => () => void
}

export function createBrowserSdk(transport: Pick<ITuffTransport, 'send' | 'on'>): BrowserSdk {
  return {
    getState: () => transport.send(BrowserEvents.getState),
    createTab: input => transport.send(BrowserEvents.createTab, input ? { input } : {}),
    activateTab: tabId => transport.send(BrowserEvents.activateTab, { tabId }),
    closeTab: tabId => transport.send(BrowserEvents.closeTab, { tabId }),
    navigate: (tabId, input) => transport.send(BrowserEvents.navigate, { tabId, input }),
    back: tabId => transport.send(BrowserEvents.back, { tabId }),
    forward: tabId => transport.send(BrowserEvents.forward, { tabId }),
    reload: tabId => transport.send(BrowserEvents.reload, { tabId }),
    stop: tabId => transport.send(BrowserEvents.stop, { tabId }),
    setViewport: request => transport.send(BrowserEvents.setViewport, request),
    toggleBookmark: tabId => transport.send(BrowserEvents.toggleBookmark, { tabId }),
    onChanged: listener => transport.on(BrowserEvents.changed, listener),
    onFocusAddress: listener => transport.on(BrowserEvents.focusAddress, listener),
  }
}
