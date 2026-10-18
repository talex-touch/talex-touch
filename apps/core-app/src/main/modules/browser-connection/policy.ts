import type {
  BrowserBookmarkCommand,
  BrowserBookmarkExpectation,
  BrowserChromeTabCommand,
  ChromeBookmarkNode,
  ChromeTab
} from '@talex-touch/utils/transport/sdk/domains/browser-connection'
import { isAllowedBrowserUrl } from '../browser/policy'

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('BROWSER_INVALID_OBJECT')
  return value as Record<string, unknown>
}
export function text(value: unknown, maximum = 8192): string {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\u0000'))
    throw new Error('BROWSER_INVALID_TEXT')
  return value
}
export function identifier(value: unknown): string {
  const result = text(value, 128)
  if (!result || !/^[\w-]+$/.test(result)) throw new Error('BROWSER_INVALID_ID')
  return result
}
function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    throw new Error('BROWSER_INVALID_INTEGER')
  return value as number
}
function url(value: unknown): string {
  if (!isAllowedBrowserUrl(value)) throw new Error('BROWSER_URL_BLOCKED')
  return value
}
export function validateBookmarkCommand(input: unknown): BrowserBookmarkCommand {
  const command = object(input)
  const kind = command.kind
  if (kind === 'create')
    return {
      kind,
      parentId: identifier(command.parentId),
      title: text(command.title),
      ...(command.url === undefined ? {} : { url: url(command.url) }),
      ...(command.index === undefined ? {} : { index: integer(command.index) })
    }
  if (kind === 'update')
    return {
      kind,
      id: identifier(command.id),
      title: text(command.title),
      ...(command.url === undefined ? {} : { url: url(command.url) })
    }
  if (kind === 'move')
    return {
      kind,
      id: identifier(command.id),
      parentId: identifier(command.parentId),
      ...(command.index === undefined ? {} : { index: integer(command.index) })
    }
  if (kind === 'remove') {
    if (command.recursive !== undefined && typeof command.recursive !== 'boolean')
      throw new Error('BROWSER_INVALID_RECURSIVE')
    return { kind, id: identifier(command.id), recursive: command.recursive === true }
  }
  throw new Error('BROWSER_INVALID_BOOKMARK_COMMAND')
}
export function validateTabCommand(input: unknown, tabs: ChromeTab[]): BrowserChromeTabCommand {
  const command = object(input)
  const kind = command.kind
  const windowId = command.windowId === undefined ? undefined : integer(command.windowId)
  if (kind === 'create')
    return { kind, url: url(command.url), ...(windowId === undefined ? {} : { windowId }) }
  const id = integer(command.id)
  if (!tabs.some((tab) => tab.id === id)) throw new Error('BROWSER_TAB_NOT_FOUND')
  if (kind === 'navigate') return { kind, id, url: url(command.url) }
  if (kind === 'activate' || kind === 'close') return { kind, id }
  if (kind === 'move')
    return {
      kind,
      id,
      index: integer(command.index),
      ...(windowId === undefined ? {} : { windowId })
    }
  throw new Error('BROWSER_INVALID_TAB_COMMAND')
}
export function validateBookmarkNode(input: unknown): ChromeBookmarkNode {
  const node = object(input)
  if (typeof node.modifiable !== 'boolean' || typeof node.canAddChildren !== 'boolean')
    throw new Error('BROWSER_INVALID_MODIFIABLE')
  if (
    node.canAddChildren &&
    (node.url !== null || node.parentId === null || node.folderType === 'managed')
  )
    throw new Error('BROWSER_INVALID_FOLDER_CAPABILITY')
  return {
    id: identifier(node.id),
    parentId: node.parentId === null ? null : identifier(node.parentId),
    index: integer(node.index),
    title: text(node.title),
    url: node.url === null ? null : text(node.url, 65536),
    modifiable: node.modifiable,
    canAddChildren: node.canAddChildren,
    ...(node.folderType === undefined ? {} : { folderType: text(node.folderType, 128) })
  }
}
export function validateChromeTab(input: unknown): ChromeTab {
  const tab = object(input)
  if (typeof tab.active !== 'boolean' || typeof tab.pinned !== 'boolean' || tab.incognito === true)
    throw new Error('BROWSER_INVALID_TAB')
  return {
    id: integer(tab.id),
    windowId: integer(tab.windowId),
    index: integer(tab.index),
    title: text(tab.title),
    url: text(tab.url, 65536),
    active: tab.active,
    pinned: tab.pinned,
    groupId: integer(tab.groupId, -1)
  }
}
export function validateTree(nodes: ChromeBookmarkNode[], tabs: ChromeTab[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  if (byId.size !== nodes.length || new Set(tabs.map((tab) => tab.id)).size !== tabs.length)
    throw new Error('BROWSER_SNAPSHOT_DUPLICATE')
  const depths = new Map<string, number>()
  for (const node of nodes) {
    let current: ChromeBookmarkNode | undefined = node
    const chain: ChromeBookmarkNode[] = []
    const visiting = new Set<string>()
    let depth = 0
    while (current) {
      const cachedDepth = depths.get(current.id)
      if (cachedDepth !== undefined) {
        depth = cachedDepth
        break
      }
      if (visiting.has(current.id)) throw new Error('BROWSER_SNAPSHOT_CYCLE')
      visiting.add(current.id)
      chain.push(current)
      if (chain.length > 512) throw new Error('BROWSER_SNAPSHOT_DEPTH')
      if (current.parentId === null) break
      const parent = byId.get(current.parentId)
      if (!parent || parent.url !== null) throw new Error('BROWSER_SNAPSHOT_PARENT')
      current = parent
    }
    if (depth + chain.length > 512) throw new Error('BROWSER_SNAPSHOT_DEPTH')
    for (let index = chain.length - 1; index >= 0; index -= 1) depths.set(chain[index].id, ++depth)
  }
}
export function bookmarkExpectation(
  command: BrowserBookmarkCommand,
  nodes: ChromeBookmarkNode[]
): BrowserBookmarkExpectation {
  const selected = new Set<string>()
  const parents = new Set<string>()
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const childrenByParent = new Map<string, ChromeBookmarkNode[]>()
  for (const node of nodes) {
    if (node.parentId !== null) {
      const siblings = childrenByParent.get(node.parentId) ?? []
      siblings.push(node)
      childrenByParent.set(node.parentId, siblings)
    }
  }
  if (command.kind !== 'create') {
    const target = byId.get(command.id)
    if (!target || !target.modifiable || target.parentId === null || target.folderType)
      throw new Error('BROWSER_BOOKMARK_READ_ONLY')
    selected.add(target.id)
    if (command.kind === 'remove' && target.url === null) {
      const descendants = new Set([target.id])
      for (const id of descendants) {
        parents.add(id)
        for (const child of childrenByParent.get(id) ?? []) {
          if (!child.modifiable || child.folderType) throw new Error('BROWSER_BOOKMARK_READ_ONLY')
          descendants.add(child.id)
          selected.add(child.id)
        }
      }
      if (descendants.size > 1 && command.recursive !== true)
        throw new Error('BROWSER_RECURSIVE_CONFIRMATION_REQUIRED')
    }
  }
  if (command.kind === 'create' || command.kind === 'move') {
    const parent = byId.get(command.parentId)
    // Chrome's special roots cannot themselves be renamed/moved, but accept ordinary children.
    if (
      !parent ||
      parent.url !== null ||
      parent.parentId === null ||
      parent.folderType === 'managed' ||
      !parent.canAddChildren
    )
      throw new Error('BROWSER_FOLDER_READ_ONLY')
    selected.add(parent.id)
    // Append is identity/capability-based; our earlier queued additions may change siblings.
    if (command.index !== undefined) parents.add(parent.id)
    if (command.kind === 'move') {
      let ancestor: ChromeBookmarkNode | undefined = parent
      while (ancestor) {
        if (ancestor.id === command.id) throw new Error('BROWSER_BOOKMARK_CYCLE')
        ancestor = ancestor.parentId === null ? undefined : byId.get(ancestor.parentId)
      }
    }
  }
  const children: Record<string, string[]> = Object.create(null)
  for (const parentId of parents)
    children[parentId] = (childrenByParent.get(parentId) ?? [])
      .sort((a, b) => a.index - b.index)
      .map((node) => node.id)
  return { nodes: nodes.filter((node) => selected.has(node.id)), children }
}
