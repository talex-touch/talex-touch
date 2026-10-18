import type {
  BrowserBookmarkCommand,
  BrowserBookmarkOperation,
  BrowserChromeTabCommand,
  BrowserConnectionServerMessage,
  ChromeBookmarkNode,
  ChromeCookieFilter,
} from '../../../packages/utils/transport/sdk/domains/browser-connection'
import {
  BROWSER_MAX_FRAME_BYTES,
  BROWSER_PROTOCOL_VERSION,
} from '../../../packages/utils/transport/sdk/domains/browser-connection'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function id(value: unknown): value is string {
  return typeof value === 'string' && /^[\w-]{1,128}$/.test(value)
}
function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}
function text(value: unknown, limit = 65536): value is string {
  return typeof value === 'string' && value.length <= limit
}
function bookmarkNode(value: unknown): value is ChromeBookmarkNode {
  return (
    record(value)
    && id(value.id)
    && (value.parentId === null || id(value.parentId))
    && integer(value.index)
    && text(value.title)
    && (value.url === null || text(value.url))
    && typeof value.modifiable === 'boolean'
    && typeof value.canAddChildren === 'boolean'
    && (value.folderType === undefined || text(value.folderType, 128))
  )
}
function bookmarkCommand(value: unknown): value is BrowserBookmarkCommand {
  if (!record(value))
    return false
  if (value.kind === 'create') {
    return (
      id(value.parentId)
      && text(value.title)
      && (value.url === undefined || text(value.url))
      && (value.index === undefined || integer(value.index))
    )
  }
  if (value.kind === 'update')
    return id(value.id) && text(value.title) && (value.url === undefined || text(value.url))
  if (value.kind === 'move')
    return id(value.id) && id(value.parentId) && (value.index === undefined || integer(value.index))
  return (
    value.kind === 'remove' && id(value.id) && (value.recursive === undefined || typeof value.recursive === 'boolean')
  )
}
function operation(value: unknown): value is BrowserBookmarkOperation {
  if (!record(value) || !id(value.id) || !bookmarkCommand(value.command) || !record(value.expected))
    return false
  const { nodes, children } = value.expected
  return (
    Array.isArray(nodes)
    && nodes.length <= 100000
    && nodes.every(bookmarkNode)
    && record(children)
    && Object.entries(children).every(([parent, items]) => id(parent) && Array.isArray(items) && items.every(id))
  )
}
function tabCommand(value: unknown): value is BrowserChromeTabCommand {
  if (!record(value))
    return false
  if (value.kind === 'create')
    return text(value.url) && (value.windowId === undefined || integer(value.windowId))
  if (!integer(value.id))
    return false
  if (value.kind === 'activate' || value.kind === 'close')
    return true
  if (value.kind === 'navigate')
    return text(value.url)
  return (
    value.kind === 'move'
    && Number.isSafeInteger(value.index)
    && Number(value.index) >= -1
    && (value.windowId === undefined || integer(value.windowId))
  )
}
function cookieFilter(value: unknown): value is ChromeCookieFilter {
  if (!record(value))
    return false
  if (value.domain !== undefined && !text(value.domain, 256))
    return false
  if (value.url !== undefined && !text(value.url, 4096))
    return false
  if (value.domains !== undefined) {
    if (!Array.isArray(value.domains) || value.domains.length > 50)
      return false
    if (!value.domains.every(d => text(d, 256)))
      return false
  }
  return true
}
export function parseServerMessage(value: unknown): BrowserConnectionServerMessage {
  if (new TextEncoder().encode(JSON.stringify(value)).length > BROWSER_MAX_FRAME_BYTES || !record(value))
    throw new Error('invalidMessage')
  if (
    value.type === 'native-host-info'
    && text(value.serverPublicKey, 4096)
    && value.serverPublicKey.length >= 64
    && value.serverPublicKey.length % 4 === 0
    && /^[A-Z0-9+/]+={0,2}$/i.test(value.serverPublicKey)
  ) {
    return { type: 'native-host-info', serverPublicKey: value.serverPublicKey }
  }
  if (
    value.type === 'challenge'
    && value.version === BROWSER_PROTOCOL_VERSION
    && text(value.nonce, 43)
    && /^[\w-]{43}$/.test(value.nonce)
    && text(value.clientNonce, 43)
    && /^[\w-]{43}$/.test(value.clientNonce)
    && text(value.signature, 88)
    && /^[A-Z0-9+/]{86}==$/i.test(value.signature)
  ) {
    return { type: 'challenge', nonce: value.nonce, clientNonce: value.clientNonce, signature: value.signature, version: 1 }
  }
  if (value.type === 'authenticated' && id(value.profileId))
    return { type: 'authenticated', profileId: value.profileId }
  if (
    value.type === 'snapshot-accepted'
    && id(value.snapshotId)
    && (value.scope === 'all' || value.scope === 'bookmarks' || value.scope === 'tabs')
  ) {
    return { type: 'snapshot-accepted', snapshotId: value.snapshotId, scope: value.scope }
  }
  if (value.type === 'bookmark' && operation(value.operation))
    return { type: 'bookmark', operation: value.operation }
  if (value.type === 'tab' && id(value.requestId) && tabCommand(value.command))
    return { type: 'tab', requestId: value.requestId, command: value.command }
  if (value.type === 'refresh')
    return { type: 'refresh' }
  if (value.type === 'cookies' && id(value.requestId) && cookieFilter(value.filter))
    return { type: 'cookies', requestId: value.requestId, filter: value.filter }
  if (value.type === 'error' && text(value.error, 4096))
    return { type: 'error', error: value.error }
  throw new Error('invalidMessage')
}
