import type {
  BrowserBookmarkCommand,
  BrowserBookmarkExpectation,
  BrowserChromeTabCommand,
  ChromeBookmarkNode,
  ChromeTab,
} from '../../../packages/utils/transport/sdk/domains/browser-connection'
import {
  BROWSER_CONNECTION_MAX_SNAPSHOT_BYTES,
  BROWSER_CONNECTION_MAX_SNAPSHOT_NODES,
} from '../../../packages/utils/transport/sdk/domains/browser-connection'

export interface RawBookmark {
  id: string
  parentId?: string
  index?: number
  title: string
  url?: string
  unmodifiable?: string
  folderType?: string
  children?: RawBookmark[]
}
export interface RawTab {
  id?: number
  windowId: number
  index: number
  title?: string
  url?: string
  active: boolean
  pinned: boolean
  groupId?: number
  incognito: boolean
}
interface ChromeEvent<T extends (...args: never[]) => unknown> {
  addListener: (listener: T) => void
}
export interface NativePort {
  postMessage: (message: unknown) => void
  disconnect: () => void
  onMessage: ChromeEvent<(message: unknown) => void>
  onDisconnect: ChromeEvent<() => void>
}
export interface ChromeApi {
  runtime: {
    connectNative: (name: string) => NativePort
    lastError?: { message?: string }
    onMessage: ChromeEvent<
      (message: unknown, sender: { id?: string, url?: string }, respond: (value: unknown) => void) => boolean
    >
    onStartup: ChromeEvent<() => void>
    onInstalled: ChromeEvent<() => void>
    sendMessage: (message: unknown) => Promise<unknown>
    id: string
    getURL: (path: string) => string
  }
  i18n: { getMessage: (key: string, substitutions?: string | string[]) => string, getUILanguage: () => string }
  permissions: {
    contains: (permission: { permissions: string[] }) => Promise<boolean>
    request: (permission: { permissions: string[] }) => Promise<boolean>
    onRemoved: ChromeEvent<() => void>
    onAdded: ChromeEvent<() => void>
  }
  alarms: {
    create: (name: string, info: { periodInMinutes: number }) => Promise<void>
    onAlarm: ChromeEvent<(alarm: { name: string }) => void>
  }
  bookmarks: {
    getTree: () => Promise<RawBookmark[]>
    create: (details: { parentId: string, title: string, url?: string, index?: number }) => Promise<RawBookmark>
    update: (id: string, details: { title: string, url?: string }) => Promise<RawBookmark>
    move: (id: string, details: { parentId: string, index?: number }) => Promise<RawBookmark>
    remove: (id: string) => Promise<void>
    removeTree: (id: string) => Promise<void>
    onCreated: ChromeEvent<() => void>
    onRemoved: ChromeEvent<() => void>
    onChanged: ChromeEvent<() => void>
    onMoved: ChromeEvent<() => void>
    onChildrenReordered: ChromeEvent<() => void>
    onImportEnded: ChromeEvent<() => void>
  }
  tabs: {
    query: (query: Record<string, unknown>) => Promise<RawTab[]>
    get: (id: number) => Promise<RawTab>
    create: (details: { url: string, windowId?: number }) => Promise<RawTab>
    update: (id: number, details: { active?: boolean, url?: string }) => Promise<RawTab>
    move: (id: number, details: { index: number, windowId?: number }) => Promise<RawTab | RawTab[]>
    remove: (id: number) => Promise<void>
    onCreated: ChromeEvent<() => void>
    onRemoved: ChromeEvent<() => void>
    onUpdated: ChromeEvent<() => void>
    onMoved: ChromeEvent<() => void>
    onActivated: ChromeEvent<() => void>
    onAttached: ChromeEvent<() => void>
    onDetached: ChromeEvent<() => void>
    onReplaced: ChromeEvent<() => void>
  }
  windows: {
    get: (id: number) => Promise<{ incognito: boolean }>
    update: (id: number, details: { focused: boolean }) => Promise<unknown>
  }
}
// Chrome supplies this API in the extension isolated world; it is not a remote payload.
const extensionGlobal = globalThis as unknown as { chrome: ChromeApi }
export const chromeApi = extensionGlobal.chrome

export function flattenBookmarks(roots: RawBookmark[]): ChromeBookmarkNode[] {
  const result: ChromeBookmarkNode[] = []
  const encoder = new TextEncoder()
  const stack = [{ items: roots, cursor: 0, depth: 0, managed: false }]
  let totalBytes = 0
  while (stack.length) {
    const frame = stack[stack.length - 1]
    if (frame.cursor === frame.items.length) {
      stack.pop()
      continue
    }
    if (result.length >= BROWSER_CONNECTION_MAX_SNAPSHOT_NODES || frame.depth >= 512)
      throw new Error('snapshotTooLarge')
    const position = frame.cursor++
    const node = frame.items[position]
    const readOnly = frame.managed || Boolean(node.unmodifiable)
    if (node.title.length + (node.url?.length ?? 0) > BROWSER_CONNECTION_MAX_SNAPSHOT_BYTES)
      throw new Error('snapshotTooLarge')
    const flattened: ChromeBookmarkNode = {
      id: node.id,
      parentId: node.parentId ?? null,
      index: node.index ?? position,
      title: node.title,
      url: node.url ?? null,
      modifiable: frame.depth > 1 && !readOnly && !node.folderType,
      canAddChildren: node.url === undefined && frame.depth > 0 && !readOnly,
      ...(readOnly ? { folderType: 'managed' } : node.folderType ? { folderType: node.folderType } : {}),
    }
    totalBytes += encoder.encode(JSON.stringify(flattened)).length + 1
    if (totalBytes > BROWSER_CONNECTION_MAX_SNAPSHOT_BYTES)
      throw new Error('snapshotTooLarge')
    result.push(flattened)
    if (node.children?.length)
      stack.push({ items: node.children, cursor: 0, depth: frame.depth + 1, managed: readOnly })
  }
  return result
}

export function flattenTabs(tabs: RawTab[]): ChromeTab[] {
  return tabs
    .filter(tab => !tab.incognito && tab.id !== undefined)
    .map(tab => ({
      id: tab.id!,
      windowId: tab.windowId,
      index: tab.index,
      title: tab.title ?? '',
      url: tab.url ?? '',
      active: tab.active,
      pinned: tab.pinned,
      groupId: tab.groupId ?? -1,
    }))
}

export function requireSafeUrl(value: string): void {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('unsafeUrl')
}

function sameNode(left: ChromeBookmarkNode, right: ChromeBookmarkNode): boolean {
  return (
    left.id === right.id
    && left.parentId === right.parentId
    && left.index === right.index
    && left.title === right.title
    && left.url === right.url
    && left.modifiable === right.modifiable
    && left.canAddChildren === right.canAddChildren
    && left.folderType === right.folderType
  )
}
export function compareExpectation(current: ChromeBookmarkNode[], expected: BrowserBookmarkExpectation): void {
  const byId = new Map(current.map(node => [node.id, node]))
  const children = new Map<string, ChromeBookmarkNode[]>()
  for (const node of current) {
    if (node.parentId === null)
      continue
    const siblings = children.get(node.parentId)
    if (siblings)
      siblings.push(node)
    else children.set(node.parentId, [node])
  }
  for (const node of expected.nodes) {
    const actual = byId.get(node.id)
    if (!actual || !sameNode(actual, node))
      throw new Error('bookmarkChanged')
  }
  for (const [parentId, ids] of Object.entries(expected.children)) {
    const actual = (children.get(parentId) ?? []).sort((a, b) => a.index - b.index).map(node => node.id)
    if (actual.length !== ids.length || actual.some((id, index) => id !== ids[index]))
      throw new Error('bookmarkChanged')
  }
}

export function validateBookmarkCommand(command: BrowserBookmarkCommand, nodes: ChromeBookmarkNode[]): void {
  const byId = new Map(nodes.map(node => [node.id, node]))
  if ('id' in command && !byId.get(command.id)?.modifiable)
    throw new Error('readOnlyBookmark')
  if ('parentId' in command) {
    const parent = byId.get(command.parentId)
    if (!parent || !parent.canAddChildren)
      throw new Error('readOnlyBookmark')
    // All descendants of managed roots are read-only, including folder destinations.
    let ancestor: ChromeBookmarkNode | undefined = parent
    while (ancestor) {
      if (ancestor.folderType === 'managed')
        throw new Error('readOnlyBookmark')
      if (command.kind === 'move' && ancestor.id === command.id)
        throw new Error('invalidFolderMove')
      ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined
    }
  }
  if ('url' in command && command.url !== undefined)
    requireSafeUrl(command.url)
  if (command.kind === 'remove' && !command.recursive && nodes.some(node => node.parentId === command.id))
    throw new Error('recursiveConfirmationRequired')
}

export async function mutateBookmark(command: BrowserBookmarkCommand): Promise<void> {
  switch (command.kind) {
    case 'create':
      await chromeApi.bookmarks.create({
        parentId: command.parentId,
        title: command.title,
        ...(command.url !== undefined ? { url: command.url } : {}),
        ...(command.index !== undefined ? { index: command.index } : {}),
      })
      break
    case 'update':
      await chromeApi.bookmarks.update(command.id, {
        title: command.title,
        ...(command.url !== undefined ? { url: command.url } : {}),
      })
      break
    case 'move':
      await chromeApi.bookmarks.move(command.id, {
        parentId: command.parentId,
        ...(command.index !== undefined ? { index: command.index } : {}),
      })
      break
    case 'remove':
      await (command.recursive ? chromeApi.bookmarks.removeTree(command.id) : chromeApi.bookmarks.remove(command.id))
      break
    default:
      throw new Error('invalidCommand')
  }
}

export async function mutateTab(command: BrowserChromeTabCommand, assertActive: () => void): Promise<void> {
  if ('url' in command)
    requireSafeUrl(command.url)
  if (
    'windowId' in command
    && command.windowId !== undefined
    && (await chromeApi.windows.get(command.windowId)).incognito
  ) {
    throw new Error('incognitoDenied')
  }
  if ('id' in command && (await chromeApi.tabs.get(command.id)).incognito)
    throw new Error('incognitoDenied')
  assertActive()
  switch (command.kind) {
    case 'create': {
      // Do not let Chrome's implicit current-window selection land in an incognito window.
      const windowId = command.windowId ?? (await chromeApi.tabs.query({})).find(tab => !tab.incognito)?.windowId
      if (windowId === undefined || (await chromeApi.windows.get(windowId)).incognito)
        throw new Error('normalWindowRequired')
      assertActive()
      await chromeApi.tabs.create({ url: command.url, windowId })
      break
    }
    case 'activate': {
      const tab = await chromeApi.tabs.update(command.id, { active: true })
      assertActive()
      await chromeApi.windows.update(tab.windowId, { focused: true })
      break
    }
    case 'navigate':
      await chromeApi.tabs.update(command.id, { url: command.url })
      break
    case 'move':
      await chromeApi.tabs.move(command.id, {
        index: command.index,
        ...(command.windowId !== undefined ? { windowId: command.windowId } : {}),
      })
      break
    case 'close':
      await chromeApi.tabs.remove(command.id)
      break
    default:
      throw new Error('invalidCommand')
  }
}
