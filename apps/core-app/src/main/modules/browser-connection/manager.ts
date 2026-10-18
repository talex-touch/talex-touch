import type {
  BrowserBookmarkCommand,
  BrowserBookmarkOperation,
  BrowserChromeTabCommand,
  BrowserConnectedProfile,
  BrowserConnectionServerMessage,
  BrowserConnectionState,
  BrowserConnectionTabsChanged,
  ChromeBookmarkNode,
  ChromeTab
} from '@talex-touch/utils/transport/sdk/domains/browser-connection'
import type { JsonWebKey as NodeJsonWebKey, KeyObject } from 'node:crypto'
import {
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  timingSafeEqual,
  verify
} from 'node:crypto'
import {
  BROWSER_CONNECTION_MAX_SNAPSHOT_BYTES,
  BROWSER_CONNECTION_MAX_SNAPSHOT_NODES,
  BROWSER_EXTENSION_ID,
  browserAuthenticationChallenge,
  browserServerAuthenticationChallenge
} from '@talex-touch/utils/transport/sdk/domains/browser-connection'
import {
  bookmarkExpectation,
  identifier,
  object,
  text,
  validateBookmarkCommand,
  validateBookmarkNode,
  validateChromeTab,
  validateTabCommand,
  validateTree
} from './policy'
import { serializeBrowserFrame } from './protocol'

export const BROWSER_BOOKMARK_RESULT_TIMEOUT_MS = 30_000

export interface BrowserStoredOperation extends BrowserBookmarkOperation {
  status: 'queued' | 'sent' | 'conflict'
  reason?: string
}
export interface BrowserStoredProfile {
  id: string
  label: string
  publicKey: JsonWebKey
  paused: boolean
  lastSeenAt: number | null
  lastSyncedAt: number | null
  bookmarks: ChromeBookmarkNode[]
  tabs: ChromeTab[]
  operations: BrowserStoredOperation[]
  error: string | null
}
export interface BrowserConnectionDocument {
  version: 1
  revision: number
  activeProfileId: string | null
  profiles: BrowserStoredProfile[]
}
export interface BrowserConnectionDependencies {
  persist: (document: BrowserConnectionDocument) => Promise<void>
  notify: (state: BrowserConnectionState) => void
  notifyTabs?: (change: BrowserConnectionTabsChanged) => void
  installation: BrowserConnectionState['installation']
  now?: () => number
  enabled?: () => boolean
}
export interface BrowserConnectionPeer {
  send: (message: BrowserConnectionServerMessage) => void
  close: () => void
}
export interface BrowserConnectionSession {
  receive: (message: unknown) => Promise<void>
  close: () => Promise<void>
  fail: (reason: string) => Promise<void>
}
interface Snapshot {
  id: string
  scope: 'all' | 'bookmarks' | 'tabs'
  bookmarkCount: number
  tabCount: number
  bytes: number
  bookmarks: ChromeBookmarkNode[]
  tabs: ChromeTab[]
}
interface Connection {
  peer: BrowserConnectionPeer
  nonce: string
  origin: boolean
  hello: boolean
  authenticated: boolean
  profileId: string | null
  closed: boolean
  snapshot: Snapshot | null
  seenSnapshots: Set<string>
  ready: boolean
  bookmarksReady: boolean
  tabsReady: boolean
  inFlight: string | null
  timer: NodeJS.Timeout
  operationTimer?: NodeJS.Timeout
}
interface TabRequest {
  connection: Connection
  resolve: () => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}
function blank(): BrowserConnectionDocument {
  return { version: 1, revision: 0, activeProfileId: null, profiles: [] }
}
function keyFingerprint(value: JsonWebKey): string {
  if (value.kty !== 'EC' || value.crv !== 'P-256' || !value.x || !value.y || value.d)
    throw new Error('BROWSER_PUBLIC_KEY_INVALID')
  return `${value.kty}:${value.crv}:${value.x}:${value.y}`
}
function approvedKey(value: JsonWebKey): JsonWebKey {
  keyFingerprint(value)
  return { kty: 'EC', crv: 'P-256', x: value.x, y: value.y }
}

/** Owns approval, durable outbox and authoritative snapshots; never accesses Chrome's files. */
export class BrowserConnectionManager {
  private document: BrowserConnectionDocument
  private serial: Promise<unknown> = Promise.resolve()
  private connections = new Set<Connection>()
  private online = new Map<string, Connection>()
  private requests = new Map<string, TabRequest>()
  private pairing: { code: string; expiresAt: number } | null = null
  private pairingTimer: NodeJS.Timeout | undefined
  private disposed = false
  private readonly now: () => number
  private serverPrivateKey: KeyObject | null
  private serverPublicKey: string
  private serverBindingClaimed = false
  constructor(
    private readonly deps: BrowserConnectionDependencies,
    initial?: unknown
  ) {
    this.now = deps.now ?? Date.now
    const identity = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    this.serverPrivateKey = identity.privateKey
    this.serverPublicKey = identity.publicKey
      .export({ type: 'spki', format: 'der' })
      .toString('base64')
    this.document = blank()
    if (initial && typeof initial === 'object' && Object.keys(initial).length) {
      const saved = object(initial)
      if (
        saved.version !== 1 ||
        !Array.isArray(saved.profiles) ||
        !Number.isSafeInteger(saved.revision)
      )
        throw new Error('BROWSER_CONNECTION_STORAGE_INVALID')
      const candidate = structuredClone(saved) as unknown as BrowserConnectionDocument
      const ids = new Set<string>()
      for (const profile of candidate.profiles) {
        identifier(profile.id)
        if (ids.has(profile.id)) throw new Error('BROWSER_CONNECTION_STORAGE_DUPLICATE')
        ids.add(profile.id)
        approvedKey(profile.publicKey)
        text(profile.label, 256)
        if (!Array.isArray(profile.operations) || typeof profile.paused !== 'boolean')
          throw new Error('BROWSER_CONNECTION_STORAGE_INVALID')
        profile.bookmarks = profile.bookmarks.map(validateBookmarkNode)
        // Chrome owns tab session persistence; IDs are never restored across a host lifetime.
        profile.tabs = []
        validateTree(profile.bookmarks, profile.tabs)
        for (const operation of profile.operations) {
          identifier(operation.id)
          validateBookmarkCommand(operation.command)
          if (!['queued', 'sent', 'conflict'].includes(operation.status))
            throw new Error('BROWSER_CONNECTION_STORAGE_INVALID')
        }
      }
      if (candidate.activeProfileId !== null && !ids.has(candidate.activeProfileId))
        throw new Error('BROWSER_CONNECTION_STORAGE_INVALID')
      this.document = candidate
    }
  }
  /** Internal installer seam only; never included in a renderer DTO or durable document. */
  getServerPublicKey(): string {
    if (this.disposed || !this.serverPrivateKey) throw new Error('BROWSER_CONNECTION_DISPOSED')
    return this.serverPublicKey
  }
  /** A listener replacement must construct a new manager and therefore a new server identity. */
  claimServerBinding(): void {
    if (this.disposed || !this.serverPrivateKey) throw new Error('BROWSER_CONNECTION_DISPOSED')
    if (this.serverBindingClaimed) throw new Error('BROWSER_SERVER_REBIND_FORBIDDEN')
    this.serverBindingClaimed = true
  }
  getState(): BrowserConnectionState {
    const profiles: BrowserConnectedProfile[] = this.document.profiles.map((profile) => ({
      id: profile.id,
      label: profile.label,
      status: profile.paused
        ? 'paused'
        : profile.operations.some((op) => op.status === 'conflict')
          ? 'conflict'
          : this.online.has(profile.id)
            ? 'connected'
            : 'offline',
      lastSeenAt: profile.lastSeenAt,
      lastSyncedAt: profile.lastSyncedAt,
      bookmarks: profile.bookmarks,
      tabs: this.online.get(profile.id)?.tabsReady ? profile.tabs : [],
      pendingCount: profile.operations.filter((op) => op.status !== 'conflict').length,
      conflicts: profile.operations
        .filter((op) => op.status === 'conflict')
        .map((op) => ({
          operationId: op.id,
          title:
            'title' in op.command
              ? op.command.title
              : (profile.bookmarks.find(
                  (node) => node.id === ('id' in op.command ? op.command.id : '')
                )?.title ?? op.command.kind),
          reason: op.reason ?? 'BROWSER_BOOKMARK_CONFLICT'
        })),
      error: profile.error
    }))
    return structuredClone({
      revision: this.document.revision,
      activeProfileId: this.document.activeProfileId,
      installation: this.deps.installation,
      pairing: this.pairing && this.pairing.expiresAt > this.now() ? this.pairing : null,
      profiles
    })
  }
  private enqueue<T>(run: () => Promise<T> | T): Promise<T> {
    const result = this.serial.then(() => {
      if (this.disposed) throw new Error('BROWSER_CONNECTION_DISPOSED')
      return run()
    })
    this.serial = result.catch(() => {})
    return result
  }
  private async commit(
    change: (draft: BrowserConnectionDocument) => void,
    after?: () => void
  ): Promise<BrowserConnectionState> {
    const draft = structuredClone(this.document)
    change(draft)
    draft.revision += 1
    const durable = {
      ...draft,
      profiles: draft.profiles.map((profile) => ({ ...profile, tabs: [] }))
    }
    await this.deps.persist(durable)
    this.document = draft
    after?.()
    const state = this.getState()
    this.deps.notify(state)
    return state
  }
  private profile(id: string, document = this.document): BrowserStoredProfile {
    const profile = document.profiles.find((profile) => profile.id === id)
    if (!profile) throw new Error('BROWSER_PROFILE_NOT_FOUND')
    return profile
  }
  assertEnabled(): void {
    if (this.deps.enabled && !this.deps.enabled()) throw new Error('BROWSER_FEATURE_DISABLED')
  }
  featureGateChanged(): Promise<void> {
    if (!this.deps.enabled || this.deps.enabled()) return Promise.resolve()
    // Fence immediately, including an async persistence already in progress.
    for (const connection of this.connections) this.markClosed(connection)
    this.online.clear()
    this.pairing = null
    clearTimeout(this.pairingTimer)
    this.pairingTimer = undefined
    return this.enqueue(async () => {
      await this.commit(() => {})
    })
  }
  updateInstallation(
    installation: BrowserConnectionState['installation']
  ): Promise<BrowserConnectionState> {
    return this.enqueue(() =>
      this.commit(
        () => {},
        () => {
          this.deps.installation = installation
        }
      )
    )
  }
  beginPairing(): Promise<BrowserConnectionState> {
    this.assertEnabled()
    return this.enqueue(() =>
      this.commit(
        () => {},
        () => {
          this.assertEnabled()
          clearTimeout(this.pairingTimer)
          this.pairing = {
            code: randomBytes(12).toString('base64url'),
            expiresAt: this.now() + 120_000
          }
          this.pairingTimer = setTimeout(() => {
            void this.cancelPairing().catch(() => {})
          }, 120_000)
          this.pairingTimer.unref?.()
        }
      )
    )
  }
  cancelPairing(): Promise<BrowserConnectionState> {
    return this.enqueue(() =>
      this.commit(
        () => {},
        () => {
          this.pairing = null
          clearTimeout(this.pairingTimer)
          this.pairingTimer = undefined
        }
      )
    )
  }
  selectProfile(id: string | null): Promise<BrowserConnectionState> {
    return this.enqueue(() =>
      this.commit((draft) => {
        if (id !== null) this.profile(identifier(id), draft)
        draft.activeProfileId = id
      })
    )
  }
  setPaused(id: string, paused: boolean): Promise<BrowserConnectionState> {
    return this.enqueue(() => {
      if (typeof paused !== 'boolean') throw new Error('BROWSER_INVALID_PAUSED')
      return this.commit(
        (draft) => {
          this.profile(id, draft).paused = paused
        },
        () => {
          if (paused) this.closeLive(id)
        }
      )
    })
  }
  disconnect(id: string): Promise<BrowserConnectionState> {
    return this.enqueue(() =>
      this.commit(
        (draft) => {
          this.profile(id, draft)
          draft.profiles = draft.profiles.filter((profile) => profile.id !== id)
          if (draft.activeProfileId === id) draft.activeProfileId = null
        },
        () => this.closeLive(id)
      )
    )
  }
  bookmark(id: string, input: BrowserBookmarkCommand): Promise<BrowserConnectionState> {
    return this.enqueue(async () => {
      this.assertEnabled()
      const command = validateBookmarkCommand(input)
      const result = await this.commit((draft) => {
        const profile = this.profile(id, draft)
        if (command.kind === 'update') {
          for (let index = profile.operations.length - 1; index >= 0; index -= 1) {
            const pending = profile.operations[index]
            if (pending.command.kind === 'update' && pending.command.id === command.id) {
              if (pending.status !== 'queued') break
              // Only an unsent intention can change fingerprint under the same operation ID.
              // Keep its original expected baseline: a fresh Chrome snapshot is not a rebase.
              const previousUrl = pending.command.url
              pending.command = {
                ...command,
                ...(command.url === undefined && previousUrl !== undefined
                  ? { url: previousUrl }
                  : {})
              }
              serializeBrowserFrame(this.operationPacket(pending))
              return
            }
            // Do not move an edit across another intention whose expectation depends on it.
            if (
              pending.expected.nodes.some((node) => node.id === command.id) ||
              Object.prototype.hasOwnProperty.call(pending.expected.children, command.id)
            )
              break
          }
        }
        if (profile.operations.length >= 1000) throw new Error('BROWSER_QUEUE_FULL')
        const operation: BrowserStoredOperation = {
          id: randomUUID(),
          command,
          expected: bookmarkExpectation(command, profile.bookmarks),
          status: 'queued'
        }
        serializeBrowserFrame(this.operationPacket(operation))
        profile.operations.push(operation)
      })
      await this.drain(id)
      return this.getState().revision === result.revision ? result : this.getState()
    })
  }
  resolveConflict(
    id: string,
    operationId: string,
    resolution: 'useChrome' | 'retryTuff'
  ): Promise<BrowserConnectionState> {
    return this.enqueue(async () => {
      if (resolution === 'retryTuff') this.assertEnabled()
      await this.commit((draft) => {
        const profile = this.profile(id, draft)
        const index = profile.operations.findIndex(
          (op) => op.id === operationId && op.status === 'conflict'
        )
        if (index < 0) throw new Error('BROWSER_CONFLICT_NOT_FOUND')
        const operation = profile.operations[index]
        if (resolution === 'retryTuff') {
          // Explicit retry is a NEW intention; never overwrite the old operation journal entry.
          const replacement: BrowserStoredOperation = {
            id: randomUUID(),
            command: operation.command,
            expected: bookmarkExpectation(operation.command, profile.bookmarks),
            status: 'queued'
          }
          serializeBrowserFrame(this.operationPacket(replacement))
          profile.operations[index] = replacement
        } else if (resolution === 'useChrome') profile.operations.splice(index, 1)
        else throw new Error('BROWSER_CONFLICT_RESOLUTION_INVALID')
      })
      await this.drain(id)
      return this.getState()
    })
  }
  async tab(id: string, input: BrowserChromeTabCommand): Promise<BrowserConnectionState> {
    let completion: Promise<void> = Promise.resolve()
    await this.enqueue(() => {
      this.assertEnabled()
      const profile = this.profile(id)
      const connection = this.online.get(id)
      if (profile.paused || !connection?.ready || connection.closed)
        throw new Error('BROWSER_PROFILE_OFFLINE')
      const command = validateTabCommand(input, profile.tabs)
      const requestId = randomUUID()
      completion = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.requests.delete(requestId)
          reject(new Error('BROWSER_TAB_RESULT_UNKNOWN'))
        }, 15_000)
        timer.unref?.()
        this.requests.set(requestId, { connection, resolve, reject, timer })
      })
      // Requests are transient, not persisted, and are never resent after disconnect/restart.
      try {
        connection.peer.send({ type: 'tab', requestId, command })
      } catch (error) {
        const request = this.requests.get(requestId)
        if (request) {
          clearTimeout(request.timer)
          this.requests.delete(requestId)
          request.reject(error instanceof Error ? error : new Error('BROWSER_SEND_FAILED'))
        }
      }
    })
    await completion
    return this.getState()
  }
  refresh(id: string): Promise<BrowserConnectionState> {
    return this.enqueue(() => {
      this.assertEnabled()
      this.profile(id)
      const connection = this.online.get(id)
      if (!connection || connection.closed) throw new Error('BROWSER_PROFILE_OFFLINE')
      connection.peer.send({ type: 'refresh' })
      return this.getState()
    })
  }
  openConnection(peer: BrowserConnectionPeer): BrowserConnectionSession {
    if (this.disposed || this.connections.size >= 16) {
      peer.close()
      throw new Error('BROWSER_CONNECTION_LIMIT')
    }
    const connection: Connection = {
      peer,
      nonce: randomBytes(32).toString('base64url'),
      origin: false,
      hello: false,
      authenticated: false,
      profileId: null,
      closed: false,
      snapshot: null,
      seenSnapshots: new Set(),
      ready: false,
      bookmarksReady: false,
      tabsReady: false,
      inFlight: null,
      timer: setTimeout(() => {
        void this.enqueue(() => this.closeConnection(connection)).catch(() => {})
      }, 15_000)
    }
    connection.timer.unref?.()
    this.connections.add(connection)
    return {
      receive: (message) =>
        this.enqueue(async () => {
          try {
            await this.receive(connection, message)
          } catch (error) {
            if (connection.authenticated && this.live(connection)) {
              const reason = error instanceof Error ? error.message : 'BROWSER_PROTOCOL_ERROR'
              await this.commit((draft) => {
                this.profile(connection.profileId!, draft).error = reason
              }).catch(() => {})
            }
            try {
              peer.send({
                type: 'error',
                error: error instanceof Error ? error.message : 'BROWSER_PROTOCOL_ERROR'
              })
            } catch {}
            await this.closeConnection(connection)
            throw error
          }
        }),
      close: () => this.enqueue(() => this.closeConnection(connection)),
      fail: (reason) =>
        this.enqueue(async () => {
          if (connection.authenticated && this.live(connection))
            await this.commit((draft) => {
              this.profile(connection.profileId!, draft).error = text(reason, 128)
            }).catch(() => {})
          await this.closeConnection(connection)
        })
    }
  }
  private live(connection: Connection): boolean {
    return (
      !connection.closed &&
      (!connection.authenticated || this.online.get(connection.profileId!) === connection)
    )
  }
  private closeLive(id: string): void {
    const connection = this.online.get(id)
    if (!connection) return
    this.online.delete(id)
    this.markClosed(connection)
  }
  private markClosed(connection: Connection): void {
    connection.closed = true
    connection.snapshot = null
    clearTimeout(connection.timer)
    clearTimeout(connection.operationTimer)
    this.connections.delete(connection)
    for (const [id, request] of this.requests) {
      if (request.connection === connection) {
        clearTimeout(request.timer)
        this.requests.delete(id)
        request.reject(new Error('BROWSER_TAB_RESULT_UNKNOWN'))
      }
    }
    connection.peer.close()
  }
  private async closeConnection(connection: Connection): Promise<void> {
    if (connection.closed) return
    const wasOnline = connection.profileId && this.online.get(connection.profileId) === connection
    if (wasOnline) this.online.delete(connection.profileId!)
    this.markClosed(connection)
    if (wasOnline) await this.commit(() => {})
  }
  private async receive(connection: Connection, input: unknown): Promise<void> {
    this.assertEnabled()
    if (!this.live(connection)) throw new Error('BROWSER_CONNECTION_STALE')
    const message = object(input)
    if (!connection.origin) {
      if (
        message.type !== 'origin' ||
        message.origin !== `chrome-extension://${BROWSER_EXTENSION_ID}/`
      )
        throw new Error('BROWSER_ORIGIN_DENIED')
      connection.origin = true
      return
    }
    if (!connection.hello) {
      if (
        message.type !== 'hello' ||
        typeof message.clientNonce !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(message.clientNonce)
      )
        throw new Error('BROWSER_HELLO_REQUIRED')
      if (!this.serverPrivateKey) throw new Error('BROWSER_CONNECTION_DISPOSED')
      const signature = sign(
        'sha256',
        Buffer.from(browserServerAuthenticationChallenge(message.clientNonce, connection.nonce)),
        { key: this.serverPrivateKey, dsaEncoding: 'ieee-p1363' }
      ).toString('base64')
      connection.hello = true
      connection.peer.send({
        type: 'challenge',
        version: 1,
        nonce: connection.nonce,
        clientNonce: message.clientNonce,
        signature
      })
      return
    }
    if (!connection.authenticated) {
      if (message.type !== 'authenticate' || message.version !== 1)
        throw new Error('BROWSER_AUTH_REQUIRED')
      const id = identifier(message.profileId)
      const publicKey = approvedKey(object(message.publicKey) as JsonWebKey)
      const verificationKey: NodeJsonWebKey = {
        kty: 'EC',
        crv: 'P-256',
        x: publicKey.x,
        y: publicKey.y
      }
      const signature = text(message.signature, 128)
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) throw new Error('BROWSER_SIGNATURE_INVALID')
      const bytes = Buffer.from(signature, 'base64')
      if (
        bytes.length !== 64 ||
        !verify(
          'sha256',
          Buffer.from(browserAuthenticationChallenge(id, connection.nonce)),
          {
            key: createPublicKey({ key: verificationKey, format: 'jwk' }),
            dsaEncoding: 'ieee-p1363'
          },
          bytes
        )
      )
        throw new Error('BROWSER_SIGNATURE_INVALID')
      const existing = this.document.profiles.find((profile) => profile.id === id)
      if (existing) {
        if (existing.paused || keyFingerprint(existing.publicKey) !== keyFingerprint(publicKey))
          throw new Error('BROWSER_APPROVAL_DENIED')
      } else {
        const code =
          typeof message.pairingCode === 'string'
            ? Buffer.from(message.pairingCode)
            : Buffer.alloc(0)
        const approved =
          this.pairing && this.pairing.expiresAt > this.now()
            ? Buffer.from(this.pairing.code)
            : null
        if (!approved || approved.length !== code.length || !timingSafeEqual(approved, code))
          throw new Error('BROWSER_PAIRING_REQUIRED')
        if (this.document.profiles.length >= 16) throw new Error('BROWSER_PROFILE_LIMIT')
      }
      const label = text(message.label, 256) || 'Chrome'
      await this.commit(
        (draft) => {
          let profile = draft.profiles.find((profile) => profile.id === id)
          if (!profile) {
            profile = {
              id,
              label,
              publicKey,
              paused: false,
              lastSeenAt: null,
              lastSyncedAt: null,
              bookmarks: [],
              tabs: [],
              operations: [],
              error: null
            }
            draft.profiles.push(profile)
            draft.activeProfileId ??= id
          }
          profile.label = label
          profile.lastSeenAt = this.now()
          profile.error = null
        },
        () => {
          this.assertEnabled()
          if (connection.closed) throw new Error('BROWSER_CONNECTION_STALE')
          this.closeLive(id)
          connection.authenticated = true
          connection.profileId = id
          this.online.set(id, connection)
          clearTimeout(connection.timer)
          if (!existing) {
            this.pairing = null
            clearTimeout(this.pairingTimer)
            this.pairingTimer = undefined
          }
        }
      )
      connection.peer.send({ type: 'authenticated', profileId: id })
      return
    }
    const id = connection.profileId!
    if (message.type === 'snapshot-start') {
      const snapshotId = identifier(message.snapshotId)
      const scope = message.scope ?? 'all'
      if (scope !== 'all' && scope !== 'bookmarks' && scope !== 'tabs')
        throw new Error('BROWSER_SNAPSHOT_SCOPE')
      if (
        (scope === 'tabs' && message.bookmarkCount !== 0) ||
        (scope === 'bookmarks' && message.tabCount !== 0)
      )
        throw new Error('BROWSER_SNAPSHOT_SCOPE')
      if (
        connection.snapshot ||
        connection.seenSnapshots.has(snapshotId) ||
        connection.seenSnapshots.size >= 100_000
      )
        throw new Error('BROWSER_SNAPSHOT_SEQUENCE')
      if (
        !Number.isSafeInteger(message.bookmarkCount) ||
        !Number.isSafeInteger(message.tabCount) ||
        (message.bookmarkCount as number) < 0 ||
        (message.tabCount as number) < 0 ||
        (message.bookmarkCount as number) + (message.tabCount as number) >
          BROWSER_CONNECTION_MAX_SNAPSHOT_NODES
      )
        throw new Error('BROWSER_SNAPSHOT_SIZE')
      connection.seenSnapshots.add(snapshotId)
      connection.snapshot = {
        id: snapshotId,
        scope,
        bookmarkCount: message.bookmarkCount as number,
        tabCount: message.tabCount as number,
        bytes: 0,
        bookmarks: [],
        tabs: []
      }
      return
    }
    if (message.type === 'snapshot-chunk') {
      const snapshot = connection.snapshot
      if (
        !snapshot ||
        message.snapshotId !== snapshot.id ||
        !Array.isArray(message.bookmarks) ||
        !Array.isArray(message.tabs)
      )
        throw new Error('BROWSER_SNAPSHOT_SEQUENCE')
      snapshot.bytes += Buffer.byteLength(JSON.stringify(message))
      if (
        snapshot.bytes > BROWSER_CONNECTION_MAX_SNAPSHOT_BYTES ||
        snapshot.bookmarks.length + message.bookmarks.length > snapshot.bookmarkCount ||
        snapshot.tabs.length + message.tabs.length > snapshot.tabCount
      )
        throw new Error('BROWSER_SNAPSHOT_SIZE')
      snapshot.bookmarks.push(...message.bookmarks.map(validateBookmarkNode))
      snapshot.tabs.push(...message.tabs.map(validateChromeTab))
      return
    }
    if (message.type === 'snapshot-end') {
      const snapshot = connection.snapshot
      if (
        !snapshot ||
        message.snapshotId !== snapshot.id ||
        snapshot.bookmarkCount !== snapshot.bookmarks.length ||
        snapshot.tabCount !== snapshot.tabs.length
      )
        throw new Error('BROWSER_SNAPSHOT_INCOMPLETE')
      validateTree(snapshot.bookmarks, snapshot.tabs)
      const accept = () => {
        connection.snapshot = null
        if (snapshot.scope !== 'tabs') connection.bookmarksReady = true
        if (snapshot.scope !== 'bookmarks') connection.tabsReady = true
        connection.ready = connection.bookmarksReady && connection.tabsReady
      }
      if (snapshot.scope === 'tabs') {
        // Ephemeral Chrome-owned tab metadata does not rewrite the durable bookmark library.
        const profile = this.profile(id)
        profile.tabs = snapshot.tabs
        profile.lastSeenAt = this.now()
        this.document.revision += 1
        accept()
        if (this.deps.notifyTabs)
          this.deps.notifyTabs({
            revision: this.document.revision,
            profileId: id,
            tabs: structuredClone(snapshot.tabs),
            lastSeenAt: profile.lastSeenAt
          })
        else this.deps.notify(this.getState())
      } else
        await this.commit((draft) => {
          const profile = this.profile(id, draft)
          profile.bookmarks = snapshot.bookmarks
          if (snapshot.scope === 'all') profile.tabs = snapshot.tabs
          profile.lastSyncedAt = this.now()
          profile.lastSeenAt = this.now()
          profile.error = null
        }, accept)
      if (!this.live(connection) || (this.deps.enabled && !this.deps.enabled())) return
      connection.peer.send({
        type: 'snapshot-accepted',
        snapshotId: snapshot.id,
        scope: snapshot.scope
      })
      await this.drain(id)
      return
    }
    if (message.type === 'bookmark-result') {
      const operationId = identifier(message.operationId)
      if (connection.inFlight !== operationId) throw new Error('BROWSER_OPERATION_STALE')
      if (!['applied', 'conflict', 'indeterminate', 'error'].includes(message.status as string))
        throw new Error('BROWSER_OPERATION_RESULT_INVALID')
      const reason =
        message.reason === undefined ? String(message.status) : text(message.reason, 1024)
      await this.commit(
        (draft) => {
          const profile = this.profile(id, draft)
          const operation = profile.operations.find((op) => op.id === operationId)
          if (!operation || operation.status !== 'sent') throw new Error('BROWSER_OPERATION_STALE')
          if (message.status === 'applied')
            profile.operations = profile.operations.filter((op) => op.id !== operationId)
          else {
            operation.status = 'conflict'
            operation.reason = reason
          }
        },
        () => {
          connection.inFlight = null
          clearTimeout(connection.operationTimer)
          connection.operationTimer = undefined
        }
      )
      await this.drain(id)
      return
    }
    if (message.type === 'tab-result') {
      const request = this.requests.get(identifier(message.requestId))
      if (!request || request.connection !== connection || typeof message.ok !== 'boolean')
        throw new Error('BROWSER_TAB_RESULT_STALE')
      clearTimeout(request.timer)
      this.requests.delete(message.requestId as string)
      if (message.ok) request.resolve()
      else
        request.reject(
          new Error(message.error === undefined ? 'BROWSER_TAB_FAILED' : text(message.error, 1024))
        )
      return
    }
    if (message.type === 'snapshot-error' || message.type === 'error') {
      const reason = text(message.type === 'snapshot-error' ? message.reason : message.error, 1024)
      await this.commit(
        (draft) => {
          this.profile(id, draft).error = reason
        },
        () => {
          connection.snapshot = null
          connection.ready = false
          connection.bookmarksReady = false
          connection.tabsReady = false
        }
      )
      return
    }
    throw new Error('BROWSER_MESSAGE_INVALID')
  }
  private operationPacket(
    operation: BrowserBookmarkOperation
  ): Extract<BrowserConnectionServerMessage, { type: 'bookmark' }> {
    return {
      type: 'bookmark',
      operation: { id: operation.id, command: operation.command, expected: operation.expected }
    }
  }
  private async drain(id: string): Promise<void> {
    const connection = this.online.get(id)
    const profile = this.profile(id)
    if (
      !connection?.ready ||
      connection.closed ||
      connection.inFlight ||
      profile.paused ||
      profile.operations.some((op) => op.status === 'conflict')
    )
      return
    if (this.deps.enabled && !this.deps.enabled()) return
    const operation = profile.operations.find(
      (op) => op.status === 'sent' || op.status === 'queued'
    )
    if (!operation) return
    const packet = this.operationPacket(operation)
    try {
      serializeBrowserFrame(packet)
    } catch {
      // Old/corrupt durable work must become visible, not reconnect forever on an unsendable frame.
      await this.commit((draft) => {
        const stored = this.profile(id, draft).operations.find((op) => op.id === operation.id)!
        stored.status = 'conflict'
        stored.reason = 'BROWSER_FRAME_SIZE'
      })
      return
    }
    await this.commit(
      (draft) => {
        this.profile(id, draft).operations.find((op) => op.id === operation.id)!.status = 'sent'
      },
      () => {
        connection.inFlight = operation.id
      }
    )
    if (!this.live(connection) || (this.deps.enabled && !this.deps.enabled())) return
    connection.operationTimer = setTimeout(() => {
      void this.enqueue(async () => {
        if (!this.live(connection) || connection.inFlight !== operation.id) return
        // Preserve the sent ID for Chrome's durable outcome journal; never create a replacement.
        this.online.delete(id)
        this.markClosed(connection)
        await this.commit((draft) => {
          this.profile(id, draft).error = 'BROWSER_BOOKMARK_RESULT_UNKNOWN'
        })
      }).catch(() => {})
    }, BROWSER_BOOKMARK_RESULT_TIMEOUT_MS)
    connection.operationTimer.unref?.()
    try {
      connection.peer.send(packet)
    } catch {
      await this.closeConnection(connection)
    }
  }
  async dispose(): Promise<void> {
    await this.serial
    this.disposed = true
    clearTimeout(this.pairingTimer)
    this.pairing = null
    for (const connection of this.connections) this.markClosed(connection)
    this.online.clear()
    this.serverPrivateKey = null
    this.serverPublicKey = ''
  }
}
