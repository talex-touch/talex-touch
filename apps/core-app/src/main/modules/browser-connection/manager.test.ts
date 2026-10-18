import type {
  BrowserBookmarkCommand,
  BrowserConnectionState,
  ChromeBookmarkNode,
  ChromeTab
} from '@talex-touch/utils/transport/sdk/domains/browser-connection'
import {
  BROWSER_EXTENSION_ID,
  browserAuthenticationChallenge,
  browserServerAuthenticationChallenge
} from '@talex-touch/utils/transport/sdk/domains/browser-connection'
import {
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  type KeyObject
} from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserConnectionPeer } from './manager'
import { BrowserConnectionManager } from './manager'

const origin = `chrome-extension://${BROWSER_EXTENSION_ID}/`

type BrowserConnectionSession = {
  receive: (message: unknown) => Promise<void>
  close: () => Promise<void>
}
type ProfileKey = { id: string; privateKey: KeyObject; publicKey: JsonWebKey }
type Snapshot = { bookmarks?: ChromeBookmarkNode[]; tabs?: ChromeTab[]; id?: string }
type Harness = {
  manager: BrowserConnectionManager
  published: BrowserConnectionState[]
  persisted: unknown[]
  setPersistenceFailure: (failure: boolean) => void
}

function createHarness(): Harness {
  const published: BrowserConnectionState[] = []
  const persisted: unknown[] = []
  let failPersistence = false
  const manager = new BrowserConnectionManager({
    installation: {
      installed: false,
      extensionId: BROWSER_EXTENSION_ID,
      extensionDirectory: null,
      supported: true
    },
    persist: async (document) => {
      if (failPersistence) throw new Error('PERSISTENCE_FAILED')
      persisted.push(structuredClone(document))
    },
    notify: (state) => published.push(structuredClone(state)),
    now: () => 1_000
  })
  return {
    manager,
    published,
    persisted,
    setPersistenceFailure: (failure) => {
      failPersistence = failure
    }
  }
}

function profileKey(id: string): ProfileKey {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return {
    id,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey.export({ format: 'jwk' }) as JsonWebKey
  }
}

function messageOfType(messages: unknown[], type: string): Record<string, unknown> {
  const message = messages.find((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate) ||
      !('type' in candidate)
    )
      return false
    return candidate.type === type
  })
  if (!message || typeof message !== 'object' || Array.isArray(message))
    throw new Error(`missing ${type}`)
  const record = message as Record<string, unknown>
  return record
}

function stringField(message: Record<string, unknown>, field: string): string {
  const value = message[field]
  if (typeof value !== 'string') throw new Error(`missing string field ${field}`)
  return value
}

function verifyServerChallenge(
  manager: BrowserConnectionManager,
  challenge: Record<string, unknown>,
  clientNonce: string
): string {
  const nonce = stringField(challenge, 'nonce')
  expect(stringField(challenge, 'clientNonce')).toBe(clientNonce)
  const signature = Buffer.from(stringField(challenge, 'signature'), 'base64')
  const key = createPublicKey({
    key: Buffer.from(manager.getServerPublicKey(), 'base64'),
    format: 'der',
    type: 'spki'
  })
  expect(
    verify(
      'sha256',
      Buffer.from(browserServerAuthenticationChallenge(clientNonce, nonce)),
      { key, dsaEncoding: 'ieee-p1363' },
      signature
    )
  ).toBe(true)
  return nonce
}
function bookmarkOperation(messages: unknown[]): { id: string; command: BrowserBookmarkCommand } {
  const message = [...messages].reverse().find((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate) ||
      !('type' in candidate)
    )
      return false
    return candidate.type === 'bookmark'
  })
  if (
    !message ||
    typeof message !== 'object' ||
    Array.isArray(message) ||
    !('operation' in message)
  ) {
    throw new Error('missing bookmark operation')
  }
  const operation = message.operation
  if (
    !operation ||
    typeof operation !== 'object' ||
    Array.isArray(operation) ||
    !('id' in operation) ||
    !('command' in operation)
  ) {
    throw new Error('invalid bookmark operation')
  }
  const id = operation.id
  const command = operation.command
  if (typeof id !== 'string' || !command || typeof command !== 'object' || Array.isArray(command)) {
    throw new Error('invalid bookmark operation fields')
  }
  return { id, command: command as BrowserBookmarkCommand }
}

function tabRequest(messages: unknown[]): string {
  const message = [...messages].reverse().find((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate) ||
      !('type' in candidate)
    )
      return false
    return candidate.type === 'tab'
  })
  if (
    !message ||
    typeof message !== 'object' ||
    Array.isArray(message) ||
    !('requestId' in message)
  )
    throw new Error('missing tab request')
  const requestId = message.requestId
  if (typeof requestId !== 'string') throw new Error('invalid tab request')
  return requestId
}
function cookieRequest(messages: unknown[]): { requestId: string; filter: unknown } {
  const message = [...messages].reverse().find((candidate) => {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate) ||
      !('type' in candidate)
    )
      return false
    return candidate.type === 'cookies'
  })
  if (
    !message ||
    typeof message !== 'object' ||
    Array.isArray(message) ||
    !('requestId' in message) ||
    !('filter' in message)
  )
    throw new Error('missing cookie request')
  const requestId = message.requestId
  if (typeof requestId !== 'string') throw new Error('invalid cookie request')
  return { requestId, filter: message.filter }
}

async function waitForTabRequest(messages: unknown[]): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return tabRequest(messages)
    } catch {
      await Promise.resolve()
    }
  }
  return tabRequest(messages)
}

function bookmark(
  id: string,
  parentId: string | null,
  url: string | null,
  index: number,
  modifiable = true,
  canAddChildren = url === null && modifiable
): ChromeBookmarkNode {
  return { id, parentId, url, index, title: id, modifiable, canAddChildren }
}

function tab(id: number, url: string, extra: Partial<ChromeTab> = {}): ChromeTab {
  return {
    id,
    windowId: 1,
    index: 0,
    title: `tab-${id}`,
    url,
    active: true,
    pinned: false,
    groupId: -1,
    ...extra
  }
}

async function openAuthenticated(
  manager: BrowserConnectionManager,
  profile: ProfileKey,
  pairingCode?: string
): Promise<{ session: BrowserConnectionSession; messages: unknown[] }> {
  const messages: unknown[] = []
  const peer: BrowserConnectionPeer = {
    send: (message) => messages.push(message),
    close: () => messages.push({ type: 'closed' })
  }
  const session = manager.openConnection(peer)
  await session.receive({ type: 'origin', origin })
  const clientNonce = randomBytes(32).toString('base64url')
  await session.receive({ type: 'hello', clientNonce })
  const challenge = messageOfType(messages, 'challenge')
  const nonce = verifyServerChallenge(manager, challenge, clientNonce)
  const signature = sign('sha256', Buffer.from(browserAuthenticationChallenge(profile.id, nonce)), {
    key: profile.privateKey,
    dsaEncoding: 'ieee-p1363'
  }).toString('base64')
  await session.receive({
    type: 'authenticate',
    version: 1,
    profileId: profile.id,
    label: profile.id,
    publicKey: profile.publicKey,
    signature,
    ...(pairingCode === undefined ? {} : { pairingCode })
  })
  return { session, messages }
}

async function connect(
  manager: BrowserConnectionManager,
  profile: ProfileKey,
  pairingCode?: string,
  snapshot: Snapshot = {}
) {
  const connection = await openAuthenticated(manager, profile, pairingCode)
  const bookmarks = snapshot.bookmarks ?? []
  const tabs = snapshot.tabs ?? []
  const snapshotId = snapshot.id ?? `snapshot-${profile.id}`
  await connection.session.receive({
    type: 'snapshot-start',
    snapshotId,
    bookmarkCount: bookmarks.length,
    tabCount: tabs.length
  })
  if (bookmarks.length || tabs.length)
    await connection.session.receive({ type: 'snapshot-chunk', snapshotId, bookmarks, tabs })
  await connection.session.receive({ type: 'snapshot-end', snapshotId })
  expect(connection.messages).toContainEqual(
    expect.objectContaining({ type: 'snapshot-accepted', snapshotId, scope: 'all' })
  )
  return connection
}

async function pairAndConnect(harness: Harness, profile: ProfileKey, snapshot: Snapshot = {}) {
  const pairing = await harness.manager.beginPairing()
  const code = pairing.pairing?.code
  if (!code) throw new Error('pairing code was not issued')
  return connect(harness.manager, profile, code, snapshot)
}

describe('browser connection authentication and profile isolation', () => {
  it('denies a non-extension origin before issuing a challenge', async () => {
    const harness = createHarness()
    const session = harness.manager.openConnection({ send: () => {}, close: () => {} })
    await expect(
      session.receive({ type: 'origin', origin: 'chrome-extension://attacker/' })
    ).rejects.toThrow('BROWSER_ORIGIN_DENIED')
    expect(harness.manager.getState().profiles).toEqual([])
    expect(harness.published).toEqual([])
    await harness.manager.dispose()
  })

  it('allows one listener binding claim and rejects a rebind on the same manager identity', async () => {
    const harness = createHarness()
    expect(harness.manager.claimServerBinding()).toBeUndefined()
    expect(() => harness.manager.claimServerBinding()).toThrow('BROWSER_SERVER_REBIND_FORBIDDEN')
    await harness.manager.dispose()
  })
  it('requires a fresh nonce proof and consumes a pairing code once', async () => {
    const harness = createHarness()
    const first = profileKey('profile-one')
    const pairing = await harness.manager.beginPairing()
    const firstConnection = await openAuthenticated(harness.manager, first, pairing.pairing?.code)
    await firstConnection.session.receive({
      type: 'snapshot-start',
      snapshotId: 'first',
      bookmarkCount: 0,
      tabCount: 0
    })
    await firstConnection.session.receive({ type: 'snapshot-end', snapshotId: 'first' })

    const replayMessages: unknown[] = []
    const replay = harness.manager.openConnection({
      send: (message) => replayMessages.push(message),
      close: () => {}
    })
    await replay.receive({ type: 'origin', origin })
    const replayedClientNonce = stringField(
      messageOfType(firstConnection.messages, 'challenge'),
      'clientNonce'
    )
    await replay.receive({ type: 'hello', clientNonce: replayedClientNonce })
    const replayChallenge = messageOfType(replayMessages, 'challenge')
    const oldChallenge = messageOfType(firstConnection.messages, 'challenge')
    const oldNonce = stringField(oldChallenge, 'nonce')
    const newNonce = verifyServerChallenge(harness.manager, replayChallenge, replayedClientNonce)
    const serverKey = createPublicKey({
      key: Buffer.from(harness.manager.getServerPublicKey(), 'base64'),
      format: 'der',
      type: 'spki'
    })
    const oldServerSignature = Buffer.from(stringField(oldChallenge, 'signature'), 'base64')
    expect(
      verify(
        'sha256',
        Buffer.from(browserServerAuthenticationChallenge(replayedClientNonce, newNonce)),
        { key: serverKey, dsaEncoding: 'ieee-p1363' },
        oldServerSignature
      )
    ).toBe(false)
    const wrongServer = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    expect(
      verify(
        'sha256',
        Buffer.from(browserServerAuthenticationChallenge(replayedClientNonce, newNonce)),
        { key: wrongServer.publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(stringField(replayChallenge, 'signature'), 'base64')
      )
    ).toBe(false)
    const replaySignature = sign(
      'sha256',
      Buffer.from(browserAuthenticationChallenge(first.id, oldNonce)),
      {
        key: first.privateKey,
        dsaEncoding: 'ieee-p1363'
      }
    ).toString('base64')
    await expect(
      replay.receive({
        type: 'authenticate',
        version: 1,
        profileId: first.id,
        label: first.id,
        publicKey: first.publicKey,
        signature: replaySignature
      })
    ).rejects.toThrow('BROWSER_SIGNATURE_INVALID')
    expect(newNonce).not.toBe(oldNonce)

    const duplicate = harness.manager.openConnection({ send: () => {}, close: () => {} })
    await duplicate.receive({ type: 'origin', origin })
    const duplicateClientNonce = randomBytes(32).toString('base64url')
    await duplicate.receive({ type: 'hello', clientNonce: duplicateClientNonce })
    await expect(
      duplicate.receive({ type: 'hello', clientNonce: randomBytes(32).toString('base64url') })
    ).rejects.toThrow('BROWSER_AUTH_REQUIRED')
    const second = profileKey('profile-two')
    const secondPairing = await harness.manager.beginPairing()
    await connect(harness.manager, second, secondPairing.pairing?.code)
    const third = profileKey('profile-three')
    await expect(openAuthenticated(harness.manager, third)).rejects.toThrow(
      'BROWSER_PAIRING_REQUIRED'
    )
    await harness.manager.dispose()
  })

  it('keeps distinct profiles separate and fences a replaced connection late result', async () => {
    const harness = createHarness()
    const first = profileKey('profile-one')
    const second = profileKey('profile-two')
    const firstSnapshot = [
      bookmark('root', null, null, 0, false),
      bookmark('one', 'root', 'https://same.example/', 0)
    ]
    const secondSnapshot = [
      bookmark('root', null, null, 0, false),
      bookmark('two', 'root', 'https://same.example/', 0)
    ]
    const firstConnection = await pairAndConnect(harness, first, { bookmarks: firstSnapshot })
    await pairAndConnect(harness, second, { bookmarks: secondSnapshot })
    await harness.manager.bookmark(first.id, { kind: 'update', id: 'one', title: 'updated' })
    const operationId = bookmarkOperation(firstConnection.messages).id
    const replacement = await connect(harness.manager, first)
    await expect(
      firstConnection.session.receive({ type: 'bookmark-result', operationId, status: 'applied' })
    ).rejects.toThrow('BROWSER_CONNECTION_STALE')
    expect(replacement.messages).toContainEqual({ type: 'authenticated', profileId: first.id })

    await expect(
      firstConnection.session.receive({
        type: 'snapshot-start',
        snapshotId: 'late',
        bookmarkCount: 0,
        tabCount: 0
      })
    ).rejects.toThrow('BROWSER_CONNECTION_STALE')
    expect(firstConnection.messages).not.toContainEqual(
      expect.objectContaining({ type: 'snapshot-accepted', snapshotId: 'late' })
    )
    expect(replacement.messages).toContainEqual({ type: 'authenticated', profileId: first.id })
    await harness.manager.disconnect(second.id)
    expect(harness.manager.getState().profiles.map((profile) => profile.id)).toEqual([
      'profile-one'
    ])
    await harness.manager.dispose()
  })

  it('fences late messages when a profile is paused and resumes offline', async () => {
    const harness = createHarness()
    const profile = profileKey('paused')
    const connection = await pairAndConnect(harness, profile)
    const paused = await harness.manager.setPaused(profile.id, true)
    expect(paused.profiles[0].status).toBe('paused')
    await expect(
      connection.session.receive({
        type: 'snapshot-start',
        snapshotId: 'late',
        bookmarkCount: 0,
        tabCount: 0
      })
    ).rejects.toThrow('BROWSER_CONNECTION_STALE')
    const resumed = await harness.manager.setPaused(profile.id, false)
    expect(resumed.profiles[0].status).toBe('offline')
    await harness.manager.dispose()
  })
})
describe('browser connection durability and operation replay', () => {
  it('does not publish or mutate state when persistence fails', async () => {
    const harness = createHarness()
    const profile = profileKey('durable')
    await pairAndConnect(harness, profile, {
      bookmarks: [bookmark('root', null, null, 0, false), bookmark('folder', 'root', null, 0)]
    })
    const before = harness.manager.getState()
    const published = harness.published.length
    harness.setPersistenceFailure(true)
    await expect(
      harness.manager.bookmark(profile.id, {
        kind: 'create',
        parentId: 'folder',
        title: 'new',
        url: 'https://new.example/'
      })
    ).rejects.toThrow('PERSISTENCE_FAILED')
    expect(harness.manager.getState()).toEqual(before)
    expect(harness.published).toHaveLength(published)
    await harness.manager.dispose()
  })

  it('does not acknowledge a snapshot whose durable publish fails', async () => {
    const harness = createHarness()
    const profile = profileKey('snapshot-persist-failure')
    const pairing = await harness.manager.beginPairing()
    const connection = await openAuthenticated(harness.manager, profile, pairing.pairing?.code)
    harness.setPersistenceFailure(true)
    await connection.session.receive({
      type: 'snapshot-start',
      snapshotId: 'failed',
      bookmarkCount: 1,
      tabCount: 0
    })
    await connection.session.receive({
      type: 'snapshot-chunk',
      snapshotId: 'failed',
      bookmarks: [bookmark('root', null, null, 0, false)],
      tabs: []
    })
    await expect(
      connection.session.receive({ type: 'snapshot-end', snapshotId: 'failed' })
    ).rejects.toThrow('PERSISTENCE_FAILED')
    expect(connection.messages).not.toContainEqual(
      expect.objectContaining({ type: 'snapshot-accepted', snapshotId: 'failed' })
    )
    await harness.manager.dispose()
  })
  it('replays one queued operation id after reconnect and removes it only after applied result', async () => {
    const harness = createHarness()
    const profile = profileKey('replay')
    const initial = [bookmark('root', null, null, 0, false), bookmark('folder', 'root', null, 0)]
    const connected = await pairAndConnect(harness, profile, { bookmarks: initial })
    await connected.session.close()
    await expect(
      harness.manager.bookmark(profile.id, {
        kind: 'create',
        parentId: 'folder',
        title: 'queued',
        url: 'https://queued.example/'
      })
    ).resolves.toMatchObject({ profiles: [{ pendingCount: 1 }] })

    const reconnected = await connect(harness.manager, profile, undefined, {
      bookmarks: initial,
      id: 'reconnected'
    })
    const firstId = bookmarkOperation(reconnected.messages).id
    await reconnected.session.close()
    const third = await connect(harness.manager, profile, undefined, {
      bookmarks: initial,
      id: 'third'
    })
    const replayId = bookmarkOperation(third.messages).id
    expect(replayId).toBe(firstId)
    await third.session.receive({
      type: 'bookmark-result',
      operationId: replayId,
      status: 'applied'
    })
    expect(harness.manager.getState().profiles[0].pendingCount).toBe(0)
    await harness.manager.dispose()
  })

  it('replays multiple offline creates into one folder without self-conflicts', async () => {
    const harness = createHarness()
    const profile = profileKey('offline-creates')
    const initial = [bookmark('root', null, null, 0, false), bookmark('folder', 'root', null, 0)]
    const connected = await pairAndConnect(harness, profile, { bookmarks: initial })
    await connected.session.close()
    await harness.manager.bookmark(profile.id, {
      kind: 'create',
      parentId: 'folder',
      title: 'first',
      url: 'https://first.example/'
    })
    await harness.manager.bookmark(profile.id, {
      kind: 'create',
      parentId: 'folder',
      title: 'second',
      url: 'https://second.example/'
    })

    const reconnected = await connect(harness.manager, profile, undefined, {
      bookmarks: initial,
      id: 'offline-creates-reconnect'
    })
    const first = bookmarkOperation(reconnected.messages)
    await reconnected.session.receive({
      type: 'bookmark-result',
      operationId: first.id,
      status: 'applied'
    })
    const second = bookmarkOperation(reconnected.messages)
    expect(second.command).toEqual({
      kind: 'create',
      parentId: 'folder',
      title: 'second',
      url: 'https://second.example/'
    })
    expect(harness.manager.getState().profiles[0].conflicts).toEqual([])
    await harness.manager.dispose()
  })

  it('preserves the latest repeated unsent edit without a false self-conflict', async () => {
    const harness = createHarness()
    const profile = profileKey('offline-edits')
    const initial = [
      bookmark('root', null, null, 0, false),
      bookmark('page', 'root', 'https://page.example/', 0)
    ]
    const connected = await pairAndConnect(harness, profile, { bookmarks: initial })
    await connected.session.close()
    await harness.manager.bookmark(profile.id, {
      kind: 'update',
      id: 'page',
      title: 'first edit',
      url: 'https://new.example/'
    })
    await harness.manager.bookmark(profile.id, { kind: 'update', id: 'page', title: 'latest edit' })

    const reconnected = await connect(harness.manager, profile, undefined, {
      bookmarks: initial,
      id: 'offline-edits-reconnect'
    })
    const first = bookmarkOperation(reconnected.messages)
    await reconnected.session.receive({
      type: 'bookmark-result',
      operationId: first.id,
      status: 'applied'
    })
    expect(bookmarkOperation(reconnected.messages).command).toEqual({
      kind: 'update',
      id: 'page',
      title: 'latest edit',
      url: 'https://new.example/'
    })
    expect(harness.manager.getState().profiles[0].conflicts).toEqual([])
    await harness.manager.dispose()
  })

  it('retains the sibling guard for an explicitly indexed offline create', async () => {
    const harness = createHarness()
    const profile = profileKey('indexed-create')
    const initial = [
      bookmark('root', null, null, 0, false),
      bookmark('folder', 'root', null, 0),
      bookmark('existing', 'folder', 'https://existing.example/', 0)
    ]
    const connected = await pairAndConnect(harness, profile, { bookmarks: initial })
    await connected.session.close()
    await harness.manager.bookmark(profile.id, {
      kind: 'create',
      parentId: 'folder',
      title: 'indexed',
      url: 'https://indexed.example/',
      index: 0
    })
    const reconnected = await connect(harness.manager, profile, undefined, {
      bookmarks: initial,
      id: 'indexed-reconnect'
    })
    expect(reconnected.messages).toContainEqual(
      expect.objectContaining({
        type: 'bookmark',
        operation: expect.objectContaining({
          command: {
            kind: 'create',
            parentId: 'folder',
            title: 'indexed',
            url: 'https://indexed.example/',
            index: 0
          },
          expected: expect.objectContaining({ children: { folder: ['existing'] } })
        })
      })
    )
    await harness.manager.dispose()
  })

  it('preserves a recursive delete as conflict when Chrome gains a child before execution', async () => {
    const harness = createHarness()
    const profile = profileKey('recursive-delete')
    const initial = [
      bookmark('root', null, null, 0, false),
      bookmark('folder', 'root', null, 0),
      bookmark('existing', 'folder', 'https://existing.example/', 0)
    ]
    const connected = await pairAndConnect(harness, profile, { bookmarks: initial })
    await connected.session.close()
    await harness.manager.bookmark(profile.id, { kind: 'remove', id: 'folder', recursive: true })
    const changed = [...initial, bookmark('external', 'folder', 'https://external.example/', 1)]
    const reconnected = await connect(harness.manager, profile, undefined, {
      bookmarks: changed,
      id: 'recursive-delete-reconnect'
    })
    const operationId = bookmarkOperation(reconnected.messages).id
    await reconnected.session.receive({
      type: 'bookmark-result',
      operationId,
      status: 'conflict',
      reason: 'bookmarkChanged'
    })
    expect(harness.manager.getState().profiles[0].conflicts[0]).toMatchObject({
      operationId,
      reason: 'bookmarkChanged'
    })
    expect(harness.manager.getState().profiles[0].bookmarks).toEqual(changed)
    await harness.manager.dispose()
  })
  it('turns an interrupted create into a conflict and requires an explicit discard', async () => {
    const harness = createHarness()
    const profile = profileKey('conflicts')
    const initial = [bookmark('root', null, null, 0, false), bookmark('folder', 'root', null, 0)]
    const connected = await pairAndConnect(harness, profile, { bookmarks: initial })
    await harness.manager.bookmark(profile.id, {
      kind: 'create',
      parentId: 'folder',
      title: 'new',
      url: 'https://new.example/'
    })
    const operationId = bookmarkOperation(connected.messages).id
    await connected.session.receive({
      type: 'bookmark-result',
      operationId,
      status: 'indeterminate',
      reason: 'connection lost during create'
    })
    expect(harness.manager.getState().profiles[0].status).toBe('conflict')
    expect(harness.manager.getState().profiles[0].conflicts[0].operationId).toBe(operationId)
    const afterDiscard = await harness.manager.resolveConflict(profile.id, operationId, 'useChrome')
    expect(afterDiscard.profiles[0].conflicts).toEqual([])
    await harness.manager.dispose()
  })
})

describe('bookmark and tab safety boundaries', () => {
  it('preserves duplicate URLs by node identity and protects roots and recursive deletion', async () => {
    const harness = createHarness()
    const profile = profileKey('bookmarks')
    const nodes = [
      bookmark('root', null, null, 0, false),
      bookmark('folder', 'root', null, 0),
      bookmark('first', 'folder', 'https://same.example/', 0),
      bookmark('second', 'folder', 'https://same.example/', 1)
    ]
    const connected = await pairAndConnect(harness, profile, { bookmarks: nodes })
    await expect(
      harness.manager.bookmark(profile.id, { kind: 'remove', id: 'root', recursive: true })
    ).rejects.toThrow('BROWSER_BOOKMARK_READ_ONLY')
    await expect(
      harness.manager.bookmark(profile.id, { kind: 'remove', id: 'folder' })
    ).rejects.toThrow('BROWSER_RECURSIVE_CONFIRMATION_REQUIRED')
    await harness.manager.bookmark(profile.id, { kind: 'remove', id: 'first' })
    expect(bookmarkOperation(connected.messages).command).toEqual({
      kind: 'remove',
      id: 'first',
      recursive: false
    })
    expect(
      harness.manager
        .getState()
        .profiles[0].bookmarks.filter((node) => node.url === 'https://same.example/')
    ).toHaveLength(2)
    await harness.manager.dispose()
  })

  it('allows adding children to an immutable Chrome root while protecting its identity', async () => {
    const harness = createHarness()
    const profile = profileKey('root-capability')
    const chromeRoot = bookmark('0', null, null, 0, false)
    const root = { ...bookmark('1', '0', null, 0, false, true), folderType: 'bookmarks-bar' }
    const managed = { ...bookmark('managed', '1', null, 0, true, false), folderType: 'managed' }
    const connected = await pairAndConnect(harness, profile, {
      bookmarks: [chromeRoot, root, managed]
    })
    await expect(
      harness.manager.bookmark(profile.id, { kind: 'update', id: 'managed', title: 'renamed' })
    ).rejects.toThrow('BROWSER_BOOKMARK_READ_ONLY')
    await expect(
      harness.manager.bookmark(profile.id, {
        kind: 'create',
        parentId: 'managed',
        title: 'blocked',
        url: 'https://blocked.example/'
      })
    ).rejects.toThrow('BROWSER_FOLDER_READ_ONLY')
    await expect(
      harness.manager.bookmark(profile.id, { kind: 'update', id: '1', title: 'renamed' })
    ).rejects.toThrow('BROWSER_BOOKMARK_READ_ONLY')
    await expect(
      harness.manager.bookmark(profile.id, { kind: 'move', id: '1', parentId: '1' })
    ).rejects.toThrow('BROWSER_BOOKMARK_READ_ONLY')
    await expect(
      harness.manager.bookmark(profile.id, { kind: 'remove', id: '1', recursive: true })
    ).rejects.toThrow('BROWSER_BOOKMARK_READ_ONLY')
    await harness.manager.bookmark(profile.id, {
      kind: 'create',
      parentId: '1',
      title: 'child',
      url: 'https://child.example/'
    })
    expect(bookmarkOperation(connected.messages).command).toEqual({
      kind: 'create',
      parentId: '1',
      title: 'child',
      url: 'https://child.example/'
    })
    await harness.manager.dispose()
  })

  it('preserves unsupported existing bookmark URLs while refusing unsafe new URLs', async () => {
    const harness = createHarness()
    const profile = profileKey('restricted')
    const nodes = [
      bookmark('root', null, null, 0, false),
      bookmark('chrome', 'root', 'chrome://settings/', 0),
      bookmark('script', 'root', 'javascript:alert(1)', 1)
    ]
    const connected = await pairAndConnect(harness, profile, { bookmarks: nodes })
    expect(harness.manager.getState().profiles[0].bookmarks.map((node) => node.url)).toEqual([
      null,
      'chrome://settings/',
      'javascript:alert(1)'
    ])
    await harness.manager.bookmark(profile.id, { kind: 'update', id: 'chrome', title: 'Settings' })
    await expect(
      harness.manager.bookmark(profile.id, {
        kind: 'create',
        parentId: 'root',
        title: 'unsafe',
        url: 'javascript:alert(1)'
      })
    ).rejects.toThrow('BROWSER_URL_BLOCKED')
    await expect(
      harness.manager.bookmark(profile.id, {
        kind: 'create',
        parentId: 'root',
        title: 'credential',
        url: 'https://alice@example.com/'
      })
    ).rejects.toThrow('BROWSER_URL_BLOCKED')
    await expect(
      harness.manager.tab(profile.id, { kind: 'create', url: 'chrome://settings/' })
    ).rejects.toThrow('BROWSER_URL_BLOCKED')
    expect(bookmarkOperation(connected.messages).command).toEqual({
      kind: 'update',
      id: 'chrome',
      title: 'Settings'
    })
    await harness.manager.dispose()
  })

  it('allows tab commands only for a ready online non-incognito snapshot', async () => {
    const harness = createHarness()
    const profile = profileKey('tabs')
    const connected = await pairAndConnect(harness, profile, {
      tabs: [tab(7, 'https://safe.example/')]
    })
    await Promise.resolve()
    const command = harness.manager.tab(profile.id, { kind: 'activate', id: 7 })
    const requestId = await waitForTabRequest(connected.messages)
    await connected.session.receive({ type: 'tab-result', requestId, ok: true })
    await expect(command).resolves.toMatchObject({ profiles: [{ status: 'connected' }] })
    await connected.session.close()

    await expect(harness.manager.tab(profile.id, { kind: 'activate', id: 7 })).rejects.toThrow(
      'BROWSER_PROFILE_OFFLINE'
    )

    const incognitoHarness = createHarness()
    const incognito = profileKey('incognito')
    const pairing = await incognitoHarness.manager.beginPairing()
    const connection = await openAuthenticated(
      incognitoHarness.manager,
      incognito,
      pairing.pairing?.code
    )
    await expect(
      connection.session.receive({
        type: 'snapshot-start',
        snapshotId: 'incognito',
        bookmarkCount: 0,
        tabCount: 1
      })
    ).resolves.toBeUndefined()
    await expect(
      connection.session.receive({
        type: 'snapshot-chunk',
        snapshotId: 'incognito',
        bookmarks: [],
        tabs: [
          { ...tab(8, 'https://private.example/'), incognito: true } as ChromeTab & {
            incognito: true
          }
        ]
      })
    ).rejects.toThrow('BROWSER_INVALID_TAB')
    await incognitoHarness.manager.dispose()
    await harness.manager.dispose()
  })
})

describe('browser snapshot scopes', () => {
  it('publishes tab-only snapshots without rewriting durable bookmarks', async () => {
    const harness = createHarness()
    const profile = profileKey('tab-scope')
    const bookmarks = [bookmark('root', null, null, 0, false)]
    const connected = await pairAndConnect(harness, profile, { bookmarks })
    const persistedCount = harness.persisted.length
    await connected.session.receive({
      type: 'snapshot-start',
      snapshotId: 'tabs-only',
      scope: 'tabs',
      bookmarkCount: 0,
      tabCount: 1
    })
    await connected.session.receive({
      type: 'snapshot-chunk',
      snapshotId: 'tabs-only',
      bookmarks: [],
      tabs: [tab(11, 'https://tab.example/')]
    })
    await connected.session.receive({ type: 'snapshot-end', snapshotId: 'tabs-only' })
    expect(connected.messages).toContainEqual(
      expect.objectContaining({ type: 'snapshot-accepted', snapshotId: 'tabs-only', scope: 'tabs' })
    )
    expect(harness.persisted).toHaveLength(persistedCount)
    expect(harness.manager.getState().profiles[0].bookmarks).toEqual(bookmarks)
    expect(harness.manager.getState().profiles[0].tabs).toEqual([tab(11, 'https://tab.example/')])
    await harness.manager.dispose()
  })
})
describe('browser snapshot bounds', () => {
  it('rejects oversized, out-of-sequence, and incomplete snapshots without publishing them', async () => {
    const harness = createHarness()

    const oversizedProfile = profileKey('snapshot-oversized')
    const oversizedPairing = await harness.manager.beginPairing()
    const oversized = await openAuthenticated(
      harness.manager,
      oversizedProfile,
      oversizedPairing.pairing?.code
    )
    await expect(
      oversized.session.receive({
        type: 'snapshot-start',
        snapshotId: 'too-large',
        bookmarkCount: 100_001,
        tabCount: 0
      })
    ).rejects.toThrow('BROWSER_SNAPSHOT_SIZE')

    const sequenceProfile = profileKey('snapshot-sequence')
    const sequencePairing = await harness.manager.beginPairing()
    const sequence = await openAuthenticated(
      harness.manager,
      sequenceProfile,
      sequencePairing.pairing?.code
    )
    await sequence.session.receive({
      type: 'snapshot-start',
      snapshotId: 'valid',
      bookmarkCount: 1,
      tabCount: 0
    })
    await expect(
      sequence.session.receive({
        type: 'snapshot-chunk',
        snapshotId: 'wrong',
        bookmarks: [],
        tabs: []
      })
    ).rejects.toThrow('BROWSER_SNAPSHOT_SEQUENCE')

    const incompleteProfile = profileKey('snapshot-incomplete')
    const incompletePairing = await harness.manager.beginPairing()
    const incomplete = await openAuthenticated(
      harness.manager,
      incompleteProfile,
      incompletePairing.pairing?.code
    )
    await incomplete.session.receive({
      type: 'snapshot-start',
      snapshotId: 'incomplete',
      bookmarkCount: 1,
      tabCount: 0
    })
    await expect(
      incomplete.session.receive({ type: 'snapshot-end', snapshotId: 'incomplete' })
    ).rejects.toThrow('BROWSER_SNAPSHOT_INCOMPLETE')
    expect(
      harness.manager.getState().profiles.every((profile) => profile.bookmarks.length === 0)
    ).toBe(true)
    await harness.manager.dispose()
  })
})

describe('bookmark operation deadlines', () => {
  it('fences a silent result while retaining the same durable sent operation for replay', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    try {
      const profile = profileKey('deadline')
      const initial = [
        bookmark('root', null, null, 0, false),
        bookmark('page', 'root', 'https://page.example/', 0)
      ]
      const connected = await pairAndConnect(harness, profile, { bookmarks: initial })
      await harness.manager.bookmark(profile.id, { kind: 'update', id: 'page', title: 'updated' })
      const operationId = bookmarkOperation(connected.messages).id
      expect(harness.persisted.at(-1)).toMatchObject({
        profiles: [{ operations: [{ id: operationId, status: 'sent' }] }]
      })

      await vi.advanceTimersByTimeAsync(30_000)
      expect(harness.manager.getState().profiles[0].error).toBe('BROWSER_BOOKMARK_RESULT_UNKNOWN')
      expect(harness.manager.getState().profiles[0].pendingCount).toBe(1)
      expect(harness.persisted.at(-1)).toMatchObject({
        profiles: [{ operations: [{ id: operationId, status: 'sent' }] }]
      })

      const replay = await connect(harness.manager, profile, undefined, {
        bookmarks: initial,
        id: 'deadline-replay'
      })
      expect(bookmarkOperation(replay.messages).id).toBe(operationId)
      await harness.manager.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('browser connection boundary regressions', () => {
  it('rejects a topologically ordered bookmark chain deeper than the cumulative depth limit', async () => {
    const harness = createHarness()
    const profile = profileKey('deep-tree')
    const nodes: ChromeBookmarkNode[] = [
      bookmark('0', null, null, 0, false),
      { ...bookmark('1', '0', null, 0, false, true), folderType: 'bookmarks-bar' }
    ]
    let parentId = '1'
    for (let index = 0; index < 511; index += 1) {
      const id = `folder-${index}`
      nodes.push(bookmark(id, parentId, null, 0, true, true))
      parentId = id
    }
    const pairing = await harness.manager.beginPairing()
    const connection = await openAuthenticated(harness.manager, profile, pairing.pairing?.code)
    await connection.session.receive({
      type: 'snapshot-start',
      snapshotId: 'deep',
      bookmarkCount: nodes.length,
      tabCount: 0
    })
    await expect(
      (async () => {
        await connection.session.receive({
          type: 'snapshot-chunk',
          snapshotId: 'deep',
          bookmarks: nodes,
          tabs: []
        })
        await connection.session.receive({ type: 'snapshot-end', snapshotId: 'deep' })
      })()
    ).rejects.toThrow('BROWSER_SNAPSHOT_DEPTH')
    expect(harness.manager.getState().profiles[0].bookmarks).toEqual([])
    await harness.manager.dispose()
  })

  it('rejects an oversized recursive bookmark operation before durable enqueue or peer send', async () => {
    const harness = createHarness()
    const profile = profileKey('oversized-operation')
    const children = Array.from({ length: 100 }, (_unused, index) => ({
      ...bookmark(`child-${index}`, 'folder', `https://child-${index}.example/`, index),
      title: 'x'.repeat(8192)
    }))
    const nodes = [
      bookmark('root', null, null, 0, false),
      bookmark('folder', 'root', null, 0),
      ...children
    ]
    const connected = await pairAndConnect(harness, profile, { bookmarks: nodes })
    const persistedCount = harness.persisted.length
    const messagesCount = connected.messages.length
    await expect(
      harness.manager.bookmark(profile.id, { kind: 'remove', id: 'folder', recursive: true })
    ).rejects.toThrow('BROWSER_FRAME_SIZE')
    expect(harness.persisted).toHaveLength(persistedCount)
    expect(connected.messages).toHaveLength(messagesCount)
    await harness.manager.dispose()
  })

  it('does not make bookmarks actionable when snapshot-error is followed by tabs-only data', async () => {
    const harness = createHarness()
    const profile = profileKey('stale-readiness')
    const connected = await pairAndConnect(harness, profile, {
      bookmarks: [bookmark('root', null, null, 0, false)],
      tabs: [tab(1, 'https://old.example/')]
    })
    await connected.session.receive({
      type: 'snapshot-error',
      reason: 'bookmark stream interrupted'
    })
    await connected.session.receive({
      type: 'snapshot-start',
      snapshotId: 'tabs-after-error',
      scope: 'tabs',
      bookmarkCount: 0,
      tabCount: 1
    })
    await connected.session.receive({
      type: 'snapshot-chunk',
      snapshotId: 'tabs-after-error',
      bookmarks: [],
      tabs: [tab(2, 'https://new.example/')]
    })
    await connected.session.receive({ type: 'snapshot-end', snapshotId: 'tabs-after-error' })
    await expect(harness.manager.tab(profile.id, { kind: 'activate', id: 2 })).rejects.toThrow(
      'BROWSER_PROFILE_OFFLINE'
    )
    await harness.manager.dispose()
  })

  it('routes getCookies and receives cookies-result from active connection', async () => {
    const harness = createHarness()
    const profile = profileKey('cookies-test')
    const connected = await pairAndConnect(harness, profile, { bookmarks: [] })
    const promise = harness.manager.getCookies(profile.id, { domain: 'example.com' })
    await Promise.resolve()
    const req = cookieRequest(connected.messages)
    expect(req.filter).toEqual({ domain: 'example.com' })
    await connected.session.receive({
      type: 'cookies-result',
      requestId: req.requestId,
      ok: true,
      cookies: [
        {
          name: 'session_token',
          value: 'secret123',
          domain: 'example.com',
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'lax'
        }
      ]
    })
    const cookies = await promise
    expect(cookies).toEqual([
      {
        name: 'session_token',
        value: 'secret123',
        domain: 'example.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax'
      }
    ])
    await harness.manager.dispose()
  })
})
