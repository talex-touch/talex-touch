import type { ITuffTransport } from '../../types'
import { defineEvent } from '../../event/builder'

export const BROWSER_CONNECTION_DOMAIN = 'browser-connection'
export const BROWSER_CONNECTION_EVENT_PREFIX = `${BROWSER_CONNECTION_DOMAIN}:`
export const BROWSER_PROTOCOL_VERSION = 1
export const BROWSER_MAX_FRAME_BYTES = 768 * 1024
export const BROWSER_CONNECTION_MAX_SNAPSHOT_NODES = 100_000
export const BROWSER_CONNECTION_MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024
export const BROWSER_NATIVE_HOST_NAME = 'com.talex.tuff.browser'
// This manifest identity is the sole allowed Native Messaging caller.
export const BROWSER_EXTENSION_ID = 'dalmacfpdfmbedbaamfinhaikanpafcl'
export function browserAuthenticationChallenge(profileId: string, nonce: string): string {
  return `tuff-browser-connection:1\n${profileId}\n${nonce}`
}
/** Binds an ephemeral Main server identity to this fresh extension handshake. */
export function browserServerAuthenticationChallenge(clientNonce: string, nonce: string): string {
  return `tuff-browser-server:1\n${clientNonce}\n${nonce}`
}
export interface ChromeBookmarkNode {
  id: string
  parentId: string | null
  index: number
  title: string
  url: string | null
  modifiable: boolean
  /** Special roots can accept children even though their own identity is immutable. */
  canAddChildren: boolean
  folderType?: string
}
export interface ChromeTab {
  id: number
  windowId: number
  index: number
  title: string
  url: string
  active: boolean
  pinned: boolean
  groupId: number
}
export type BrowserBookmarkCommand =
  | { kind: 'create'; parentId: string; title: string; url?: string; index?: number }
  | { kind: 'update'; id: string; title: string; url?: string }
  | { kind: 'move'; id: string; parentId: string; index?: number }
  | { kind: 'remove'; id: string; recursive?: boolean }
export type BrowserChromeTabCommand =
  | { kind: 'create'; url: string; windowId?: number }
  | { kind: 'activate'; id: number }
  | { kind: 'navigate'; id: number; url: string }
  | { kind: 'move'; id: number; index: number; windowId?: number }
  | { kind: 'close'; id: number }
export interface BrowserBookmarkConflict {
  operationId: string
  title: string
  reason: string
}
export interface BrowserConnectedProfile {
  id: string
  label: string
  status: 'offline' | 'connected' | 'paused' | 'conflict'
  lastSeenAt: number | null
  lastSyncedAt: number | null
  bookmarks: ChromeBookmarkNode[]
  tabs: ChromeTab[]
  pendingCount: number
  conflicts: BrowserBookmarkConflict[]
  error: string | null
}
export interface BrowserConnectionState {
  revision: number
  activeProfileId: string | null
  installation: { installed: boolean; extensionId: string; extensionDirectory: string | null; supported: boolean }
  pairing: { code: string; expiresAt: number } | null
  profiles: BrowserConnectedProfile[]
}
/** Ephemeral tab-only push; applying it must not replace bookmarks or other profiles. */
export interface BrowserConnectionTabsChanged {
  revision: number
  profileId: string
  tabs: ChromeTab[]
  lastSeenAt: number
}
export interface BrowserBookmarkExpectation {
  nodes: ChromeBookmarkNode[]
  children: Record<string, string[]>
}
export interface BrowserBookmarkOperation {
  id: string
  command: BrowserBookmarkCommand
  expected: BrowserBookmarkExpectation
}
export type BrowserConnectionClientMessage =
  | { type: 'origin'; origin: string }
  | { type: 'hello'; clientNonce: string }
  | {
      type: 'authenticate'
      version: 1
      profileId: string
      label: string
      publicKey: JsonWebKey
      signature: string
      pairingCode?: string
    }
  | {
      type: 'snapshot-start'
      snapshotId: string
      scope?: 'all' | 'bookmarks' | 'tabs'
      bookmarkCount: number
      tabCount: number
    }
  | { type: 'snapshot-chunk'; snapshotId: string; bookmarks: ChromeBookmarkNode[]; tabs: ChromeTab[] }
  | { type: 'snapshot-end'; snapshotId: string }
  | { type: 'snapshot-error'; reason: string }
  | {
      type: 'bookmark-result'
      operationId: string
      status: 'applied' | 'conflict' | 'indeterminate' | 'error'
      reason?: string
    }
  | { type: 'tab-result'; requestId: string; ok: boolean; error?: string }
  | { type: 'error'; error: string }
export type BrowserConnectionServerMessage =
  /** Injected by the trusted native helper, never emitted by the TCP server. */
  | { type: 'native-host-info'; serverPublicKey: string }
  | { type: 'challenge'; nonce: string; clientNonce: string; signature: string; version: 1 }
  | { type: 'authenticated'; profileId: string }
  | { type: 'snapshot-accepted'; snapshotId: string; scope: 'all' | 'bookmarks' | 'tabs' }
  | { type: 'bookmark'; operation: BrowserBookmarkOperation }
  | { type: 'tab'; requestId: string; command: BrowserChromeTabCommand }
  | { type: 'refresh' }
  | { type: 'error'; error: string }

const api = defineEvent(BROWSER_CONNECTION_DOMAIN).module('profiles')
export const BrowserConnectionEvents = {
  getState: api.event('get').define<void, BrowserConnectionState>(),
  install: api.event('install').define<void, BrowserConnectionState>(),
  revealExtension: api.event('reveal-extension').define<void, void>(),
  beginPairing: api.event('begin-pairing').define<void, BrowserConnectionState>(),
  cancelPairing: api.event('cancel-pairing').define<void, BrowserConnectionState>(),
  selectProfile: api.event('select').define<{ profileId: string | null }, BrowserConnectionState>(),
  setPaused: api.event('pause').define<{ profileId: string; paused: boolean }, BrowserConnectionState>(),
  disconnect: api.event('disconnect').define<{ profileId: string }, BrowserConnectionState>(),
  bookmark: api
    .event('bookmark')
    .define<{ profileId: string; command: BrowserBookmarkCommand }, BrowserConnectionState>(),
  resolveConflict: api
    .event('resolve-conflict')
    .define<
      { profileId: string; operationId: string; resolution: 'useChrome' | 'retryTuff' },
      BrowserConnectionState
    >(),
  tab: api.event('tab').define<{ profileId: string; command: BrowserChromeTabCommand }, BrowserConnectionState>(),
  refresh: api.event('refresh').define<{ profileId: string }, BrowserConnectionState>(),
  changed: defineEvent('browser-connection').module('push').event('changed').define<BrowserConnectionState, void>(),
  tabsChanged: defineEvent('browser-connection')
    .module('push')
    .event('tabs-changed')
    .define<BrowserConnectionTabsChanged, void>(),
} as const
export function createBrowserConnectionSdk(transport: Pick<ITuffTransport, 'send' | 'on'>) {
  return {
    getState: () => transport.send(BrowserConnectionEvents.getState),
    install: () => transport.send(BrowserConnectionEvents.install),
    revealExtension: () => transport.send(BrowserConnectionEvents.revealExtension),
    beginPairing: () => transport.send(BrowserConnectionEvents.beginPairing),
    cancelPairing: () => transport.send(BrowserConnectionEvents.cancelPairing),
    selectProfile: (profileId: string | null) => transport.send(BrowserConnectionEvents.selectProfile, { profileId }),
    setPaused: (profileId: string, paused: boolean) =>
      transport.send(BrowserConnectionEvents.setPaused, { profileId, paused }),
    disconnect: (profileId: string) => transport.send(BrowserConnectionEvents.disconnect, { profileId }),
    bookmark: (profileId: string, command: BrowserBookmarkCommand) =>
      transport.send(BrowserConnectionEvents.bookmark, { profileId, command }),
    resolveConflict: (profileId: string, operationId: string, resolution: 'useChrome' | 'retryTuff') =>
      transport.send(BrowserConnectionEvents.resolveConflict, { profileId, operationId, resolution }),
    tab: (profileId: string, command: BrowserChromeTabCommand) =>
      transport.send(BrowserConnectionEvents.tab, { profileId, command }),
    refresh: (profileId: string) => transport.send(BrowserConnectionEvents.refresh, { profileId }),
    onChanged: (listener: (state: BrowserConnectionState) => void) =>
      transport.on(BrowserConnectionEvents.changed, listener),
    onTabsChanged: (listener: (change: BrowserConnectionTabsChanged) => void) =>
      transport.on(BrowserConnectionEvents.tabsChanged, listener),
  }
}
