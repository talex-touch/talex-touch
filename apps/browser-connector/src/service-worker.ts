import type {
  BrowserBookmarkOperation,
  BrowserConnectionClientMessage,
  BrowserConnectionServerMessage,
  ChromeCookieFilter,
} from '../../../packages/utils/transport/sdk/domains/browser-connection'
import type { NativePort } from './chrome'
import type { ConnectorSettings } from './database'
import {
  BROWSER_CONNECTION_MAX_SNAPSHOT_BYTES,
  BROWSER_CONNECTION_MAX_SNAPSHOT_NODES,
  BROWSER_EXTENSION_ID,
  BROWSER_MAX_FRAME_BYTES,
  BROWSER_NATIVE_HOST_NAME,
  BROWSER_PROTOCOL_VERSION,
  browserAuthenticationChallenge,
} from '../../../packages/utils/transport/sdk/domains/browser-connection'
import { verifyBrowserServerProof } from './auth'
import {
  chromeApi,
  compareExpectation,
  fetchCookies,
  flattenBookmarks,
  flattenTabs,
  mutateBookmark,
  mutateTab,
  validateBookmarkCommand,
} from './chrome'
import { defaultSettings, getIdentity, getRecord, putRecord } from './database'
import { parseServerMessage } from './protocol'

const encoder = new TextEncoder()
let settings = { ...defaultSettings }
const ready = getRecord<ConnectorSettings>('settings', 'connection').then((value) => {
  if (value)
    settings = value
})
let port: NativePort | undefined
let epoch = 0
let authenticated = false
let authenticationSent = false
let challengeSeen = false
let serverPublicKey: string | undefined
let clientNonce: string | undefined
let serverVerified = false
let pairingCode: string | undefined
let errorCode: string | null = null
let detail: string | null = null
let lastSyncedAt: number | null = null
let errorVersion = 0
let serial: Promise<void> = Promise.resolve()
let controls: Promise<void> = Promise.resolve()
let snapshotTimer: ReturnType<typeof setTimeout> | undefined
const pendingSnapshots = new Map<string, { epoch: number, scope: 'all' | 'bookmarks' | 'tabs', errorVersion: number }>()
let bookmarksDirty = false
let tabsDirty = false

interface BookmarkOutcome {
  type: 'bookmark-result'
  operationId: string
  status: 'applied' | 'conflict' | 'indeterminate' | 'error'
  reason?: string
}
interface TabOutcome {
  type: 'tab-result'
  requestId: string
  ok: boolean
  error?: string
}
interface Journal {
  fingerprint: string
  phase: 'started' | 'complete'
  outcome?: BookmarkOutcome | TabOutcome
}

function active(expectedEpoch: number): void {
  if (expectedEpoch !== epoch || !port || !serverVerified || !authenticated || !settings.enabled || settings.paused)
    throw new Error('connectionChanged')
}
function send(message: BrowserConnectionClientMessage, expectedEpoch: number): void {
  if (expectedEpoch !== epoch || !port)
    throw new Error('connectionChanged')
  if (encoder.encode(JSON.stringify(message)).length > BROWSER_MAX_FRAME_BYTES)
    throw new Error('frameTooLarge')
  port.postMessage(message)
}
function disconnect(): void {
  epoch++
  authenticated = false
  authenticationSent = false
  challengeSeen = false
  serverPublicKey = undefined
  clientNonce = undefined
  serverVerified = false
  pendingSnapshots.clear()
  pairingCode = undefined
  const previous = port
  port = undefined
  previous?.disconnect()
  clearTimeout(snapshotTimer)
  snapshotTimer = undefined
  bookmarksDirty = false
  tabsDirty = false
}
function fail(error: unknown): void {
  errorVersion++
  errorCode = error instanceof Error ? error.message : 'connectionFailed'
  detail = null
}
function enqueue(task: () => Promise<void>): void {
  serial = serial.then(task).catch(fail)
}

async function snapshot(expectedEpoch: number, scope: 'all' | 'bookmarks' | 'tabs' = 'all'): Promise<void> {
  active(expectedEpoch)
  if (scope !== 'tabs')
    bookmarksDirty = false
  if (scope !== 'bookmarks')
    tabsDirty = false
  try {
    if (!(await chromeApi.permissions.contains({ permissions: ['bookmarks', 'tabs'] })))
      throw new Error('permissionsRequired')
    if (pendingSnapshots.size >= 8)
      throw new Error('snapshotReceiptsPending')
    active(expectedEpoch)
    const bookmarks = scope === 'tabs' ? [] : flattenBookmarks(await chromeApi.bookmarks.getTree())
    const tabs = scope === 'bookmarks' ? [] : flattenTabs(await chromeApi.tabs.query({}))
    active(expectedEpoch)
    if (bookmarks.length + tabs.length > BROWSER_CONNECTION_MAX_SNAPSHOT_NODES)
      throw new Error('snapshotTooLarge')
    const snapshotId = crypto.randomUUID()
    const chunks: BrowserConnectionClientMessage[] = []
    let chunk: Extract<BrowserConnectionClientMessage, { type: 'snapshot-chunk' }> = {
      type: 'snapshot-chunk',
      snapshotId,
      bookmarks: [],
      tabs: [],
    }
    let chunkBytes = encoder.encode(JSON.stringify(chunk)).length
    let aggregateBytes = 0
    for (const [kind, items] of [
      ['bookmarks', bookmarks],
      ['tabs', tabs],
    ] as const) {
      for (const item of items) {
        const bytes = encoder.encode(JSON.stringify(item)).length + 1
        aggregateBytes += bytes
        if (aggregateBytes > BROWSER_CONNECTION_MAX_SNAPSHOT_BYTES || bytes > 192 * 1024)
          throw new Error('snapshotTooLarge')
        if (chunkBytes + bytes > 192 * 1024) {
          chunks.push(chunk)
          chunk = { type: 'snapshot-chunk', snapshotId, bookmarks: [], tabs: [] }
          chunkBytes = encoder.encode(JSON.stringify(chunk)).length
        }
        if (kind === 'bookmarks')
          chunk.bookmarks.push(item as (typeof bookmarks)[number])
        else chunk.tabs.push(item as (typeof tabs)[number])
        chunkBytes += bytes
      }
    }
    if (chunk.bookmarks.length || chunk.tabs.length)
      chunks.push(chunk)
    const wireBytes = chunks.reduce((total, message) => total + encoder.encode(JSON.stringify(message)).length, 0)
    if (wireBytes > BROWSER_CONNECTION_MAX_SNAPSHOT_BYTES)
      throw new Error('snapshotTooLarge')
    // Validate the entire aggregate before beginning a replacement snapshot.
    pendingSnapshots.set(snapshotId, { epoch: expectedEpoch, scope, errorVersion })
    send(
      { type: 'snapshot-start', snapshotId, scope, bookmarkCount: bookmarks.length, tabCount: tabs.length },
      expectedEpoch,
    )
    for (const message of chunks) {
      active(expectedEpoch)
      send(message, expectedEpoch)
    }
    send({ type: 'snapshot-end', snapshotId }, expectedEpoch)
  }
  catch (error) {
    if (expectedEpoch === epoch && port && authenticated)
      send({ type: 'snapshot-error', reason: error instanceof Error ? error.message : 'snapshotFailed' }, expectedEpoch)
    throw error
  }
}

async function bookmark(operation: BrowserBookmarkOperation, expectedEpoch: number): Promise<void> {
  active(expectedEpoch)
  const key = `bookmark:${operation.id}`
  const fingerprint = JSON.stringify(operation)
  const previous = await getRecord<Journal>('ledger', key)
  active(expectedEpoch)
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new Error('operationIdReused')
    const outcome: BookmarkOutcome
      = previous.phase === 'complete' && previous.outcome?.type === 'bookmark-result'
        ? previous.outcome
        : {
            type: 'bookmark-result',
            operationId: operation.id,
            status: 'indeterminate',
            reason: 'interruptedOperation',
          }
    if (previous.phase !== 'complete')
      await putRecord('ledger', key, { fingerprint, phase: 'complete', outcome })
    if (outcome.status === 'applied')
      await snapshot(expectedEpoch, 'bookmarks')
    send(outcome, expectedEpoch)
    return
  }
  let outcome: BookmarkOutcome
  try {
    const roots = await chromeApi.bookmarks.getTree()
    active(expectedEpoch)
    const nodes = flattenBookmarks(roots)
    compareExpectation(nodes, operation.expected)
    validateBookmarkCommand(operation.command, nodes)
  }
  catch (error) {
    active(expectedEpoch)
    outcome = {
      type: 'bookmark-result',
      operationId: operation.id,
      status: 'conflict',
      reason: error instanceof Error ? error.message : 'bookmarkChanged',
    }
    await putRecord('ledger', key, { fingerprint, phase: 'complete', outcome })
    await snapshot(expectedEpoch, 'bookmarks')
    send(outcome, expectedEpoch)
    return
  }
  await putRecord('ledger', key, { fingerprint, phase: 'started' })
  active(expectedEpoch)
  // Re-read immediately after the durable journal commit: persistence must not widen the CAS window.
  try {
    const roots = await chromeApi.bookmarks.getTree()
    active(expectedEpoch)
    const nodes = flattenBookmarks(roots)
    compareExpectation(nodes, operation.expected)
    validateBookmarkCommand(operation.command, nodes)
  }
  catch (error) {
    active(expectedEpoch)
    outcome = {
      type: 'bookmark-result',
      operationId: operation.id,
      status: 'conflict',
      reason: error instanceof Error ? error.message : 'bookmarkChanged',
    }
    await putRecord('ledger', key, { fingerprint, phase: 'complete', outcome })
    await snapshot(expectedEpoch, 'bookmarks')
    send(outcome, expectedEpoch)
    return
  }
  try {
    active(expectedEpoch)
    await mutateBookmark(operation.command)
    outcome = { type: 'bookmark-result', operationId: operation.id, status: 'applied' }
  }
  catch (error) {
    // A rejected API call may have been interrupted after Chrome committed. Never retry it blindly.
    outcome = {
      type: 'bookmark-result',
      operationId: operation.id,
      status: 'indeterminate',
      reason: error instanceof Error ? error.message : 'interruptedOperation',
    }
  }
  await putRecord('ledger', key, { fingerprint, phase: 'complete', outcome })
  active(expectedEpoch)
  await snapshot(expectedEpoch, 'bookmarks')
  send(outcome, expectedEpoch)
}

async function tab(
  message: Extract<BrowserConnectionServerMessage, { type: 'tab' }>,
  expectedEpoch: number,
): Promise<void> {
  active(expectedEpoch)
  const key = `tab:${message.requestId}`
  const fingerprint = JSON.stringify(message)
  const previous = await getRecord<Journal>('ledger', key)
  active(expectedEpoch)
  if (previous) {
    if (previous.fingerprint !== fingerprint)
      throw new Error('operationIdReused')
    // Online-only commands are never executed again, even if their first result is uncertain.
    const outcome: TabOutcome
      = previous.phase === 'complete' && previous.outcome?.type === 'tab-result'
        ? previous.outcome
        : { type: 'tab-result', requestId: message.requestId, ok: false, error: 'interruptedOperation' }
    send(outcome, expectedEpoch)
    return
  }
  await putRecord('ledger', key, { fingerprint, phase: 'started' })
  active(expectedEpoch)
  let outcome: TabOutcome
  try {
    await mutateTab(message.command, () => active(expectedEpoch))
    outcome = { type: 'tab-result', requestId: message.requestId, ok: true }
  }
  catch (error) {
    outcome = {
      type: 'tab-result',
      requestId: message.requestId,
      ok: false,
      error: error instanceof Error ? error.message : 'interruptedOperation',
    }
  }
  await putRecord('ledger', key, { fingerprint, phase: 'complete', outcome })
  active(expectedEpoch)
  await snapshot(expectedEpoch, 'tabs')
  send(outcome, expectedEpoch)
}
async function handleCookies(
  message: { type: 'cookies', requestId: string, filter: ChromeCookieFilter },
  expectedEpoch: number,
): Promise<void> {
  active(expectedEpoch)
  try {
    const cookies = await fetchCookies(message.filter)
    active(expectedEpoch)
    send({ type: 'cookies-result', requestId: message.requestId, ok: true, cookies }, expectedEpoch)
  }
  catch (error) {
    active(expectedEpoch)
    send(
      {
        type: 'cookies-result',
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : 'cookiesFetchFailed',
      },
      expectedEpoch,
    )
  }
}

async function receive(raw: unknown, expectedEpoch: number): Promise<void> {
  if (expectedEpoch !== epoch || !port)
    return
  const message = parseServerMessage(raw)
  if (message.type === 'native-host-info') {
    if (serverPublicKey || challengeSeen || authenticationSent || authenticated)
      throw new Error('invalidServerProof')
    serverPublicKey = message.serverPublicKey
    clientNonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    send({ type: 'hello', clientNonce }, expectedEpoch)
    return
  }
  if (!serverPublicKey || !clientNonce)
    throw new Error('invalidServerProof')
  if (message.type === 'error') {
    errorCode = 'serverRejected'
    detail = message.error
    disconnect()
    return
  }
  if (message.type === 'challenge') {
    if (challengeSeen || authenticated || serverVerified)
      throw new Error('invalidServerProof')
    challengeSeen = true
    const valid = await verifyBrowserServerProof(serverPublicKey, clientNonce, message)
    if (expectedEpoch !== epoch)
      return
    if (!valid)
      throw new Error('invalidServerProof')
    serverVerified = true
    const identity = await getIdentity()
    if (expectedEpoch !== epoch || !serverVerified)
      return
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      identity.privateKey,
      encoder.encode(browserAuthenticationChallenge(identity.profileId, message.nonce)),
    )
    if (expectedEpoch !== epoch)
      return
    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    send(
      {
        type: 'authenticate',
        version: BROWSER_PROTOCOL_VERSION,
        profileId: identity.profileId,
        label: settings.label,
        publicKey: identity.publicKey,
        signature: encodedSignature,
        ...(pairingCode ? { pairingCode } : {}),
      },
      expectedEpoch,
    )
    authenticationSent = true
    pairingCode = undefined
    return
  }
  if (message.type === 'authenticated') {
    if (!serverVerified || !authenticationSent || authenticated)
      throw new Error('invalidServerProof')
    const identity = await getIdentity()
    if (expectedEpoch !== epoch)
      return
    if (!serverVerified || !authenticationSent || authenticated || message.profileId !== identity.profileId)
      throw new Error('invalidMessage')
    authenticated = true
    await snapshot(expectedEpoch)
    return
  }
  active(expectedEpoch)
  if (message.type === 'snapshot-accepted') {
    const pending = pendingSnapshots.get(message.snapshotId)
    if (!pending || pending.epoch !== expectedEpoch || pending.scope !== message.scope)
      return
    pendingSnapshots.delete(message.snapshotId)
    lastSyncedAt = Date.now()
    if (pending.errorVersion === errorVersion) {
      errorCode = null
      detail = null
    }
    return
  }
  if (message.type === 'refresh')
    await snapshot(expectedEpoch)
  else if (message.type === 'bookmark')
    await bookmark(message.operation, expectedEpoch)
  else if (message.type === 'tab')
    await tab(message, expectedEpoch)
  else if (message.type === 'cookies')
    await handleCookies(message, expectedEpoch)
}

async function connect(): Promise<void> {
  await ready
  if (chromeApi.runtime.id !== BROWSER_EXTENSION_ID)
    throw new Error('invalidExtensionIdentity')
  if (port || !settings.enabled || settings.paused)
    return
  if (!(await chromeApi.permissions.contains({ permissions: ['bookmarks', 'tabs'] }))) {
    errorCode = 'permissionsRequired'
    return
  }
  registerChangeListeners()
  if (port || !settings.enabled || settings.paused)
    return
  const expectedEpoch = ++epoch
  const next = chromeApi.runtime.connectNative(BROWSER_NATIVE_HOST_NAME)
  port = next
  errorCode = null
  detail = null
  next.onMessage.addListener(raw =>
    enqueue(async () => {
      try {
        await receive(raw, expectedEpoch)
      }
      catch (error) {
        if (expectedEpoch !== epoch)
          return
        fail(error)
        disconnect()
      }
    }),
  )
  next.onDisconnect.addListener(() => {
    const message = chromeApi.runtime.lastError?.message
    if (expectedEpoch !== epoch)
      return
    port = undefined
    disconnect()
    errorCode ??= 'connectionFailed'
    detail ??= message ?? null
  })
}

function scheduleSnapshot(scope: 'bookmarks' | 'tabs'): void {
  if (!authenticated)
    return
  if (scope === 'bookmarks')
    bookmarksDirty = true
  else tabsDirty = true
  if (snapshotTimer !== undefined)
    return
  const expectedEpoch = epoch
  snapshotTimer = setTimeout(() => {
    snapshotTimer = undefined
    if (!bookmarksDirty && !tabsDirty)
      return
    const dirtyScope = bookmarksDirty && tabsDirty ? 'all' : bookmarksDirty ? 'bookmarks' : 'tabs'
    bookmarksDirty = false
    tabsDirty = false
    enqueue(async () => {
      if (expectedEpoch === epoch && authenticated)
        await snapshot(expectedEpoch, dirtyScope)
    })
  }, 250)
}

chromeApi.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chromeApi.runtime.id || sender.url !== chromeApi.runtime.getURL('popup.html'))
    return false
  controls = controls
    .then(async () => {
      await ready
      if (message === null || typeof message !== 'object' || !('action' in message))
        throw new Error('invalidMessage')
      const action = message.action
      if (action === 'pair') {
        if (!('code' in message) || typeof message.code !== 'string')
          throw new Error('invalidPairingCode')
        const normalizedCode = message.code.trim()
        if (!/^[\w-]{4,64}$/.test(normalizedCode))
          throw new Error('invalidPairingCode')
        if (!('label' in message) || typeof message.label !== 'string')
          throw new Error('invalidProfileLabel')
        const normalizedLabel = message.label.trim()
        if (!normalizedLabel || normalizedLabel.length > 100)
          throw new Error('invalidProfileLabel')
        settings = { enabled: true, paused: false, label: normalizedLabel }
        disconnect()
        pairingCode = normalizedCode
        await putRecord('settings', 'connection', settings)
        await connect()
      }
      else if (action === 'pause' || action === 'resume' || action === 'reconnect') {
        settings = { ...settings, enabled: true, paused: action === 'pause' }
        disconnect()
        await putRecord('settings', 'connection', settings)
        if (!settings.paused)
          await connect()
      }
      else if (action === 'disconnect') {
        settings = { ...settings, enabled: false, paused: false }
        disconnect()
        await putRecord('settings', 'connection', settings)
        errorCode = null
        detail = null
      }
      else if (action !== 'status') {
        throw new Error('invalidMessage')
      }
      const identity = await getIdentity()
      respond({
        ok: true,
        profileId: identity.profileId,
        label: settings.label,
        status: !settings.enabled
          ? 'disabled'
          : settings.paused
            ? 'paused'
            : authenticated
              ? 'connected'
              : port
                ? 'connecting'
                : 'offline',
        errorCode,
        detail,
        lastSyncedAt,
      })
    })
    .catch((error) => {
      fail(error)
      respond({ ok: false, errorCode, detail })
    })
  return true
})

function bookmarkChanged(): void {
  scheduleSnapshot('bookmarks')
}
function tabsChanged(): void {
  scheduleSnapshot('tabs')
}
function registerChangeListeners(): void {
  // Optional permission namespaces may not exist before the first explicit grant.
  if (chromeApi.bookmarks) {
    for (const event of [
      chromeApi.bookmarks.onCreated,
      chromeApi.bookmarks.onRemoved,
      chromeApi.bookmarks.onChanged,
      chromeApi.bookmarks.onMoved,
      chromeApi.bookmarks.onChildrenReordered,
      chromeApi.bookmarks.onImportEnded,
    ])
      event.addListener(bookmarkChanged)
  }
  if (chromeApi.tabs) {
    for (const event of [
      chromeApi.tabs.onCreated,
      chromeApi.tabs.onRemoved,
      chromeApi.tabs.onUpdated,
      chromeApi.tabs.onMoved,
      chromeApi.tabs.onActivated,
      chromeApi.tabs.onAttached,
      chromeApi.tabs.onDetached,
      chromeApi.tabs.onReplaced,
    ])
      event.addListener(tabsChanged)
  }
}
registerChangeListeners()
chromeApi.permissions.onAdded.addListener(registerChangeListeners)
chromeApi.permissions.onRemoved.addListener(() => {
  errorCode = 'permissionsRequired'
  disconnect()
})
chromeApi.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'reconnect')
    void connect().catch(fail)
})
chromeApi.runtime.onStartup.addListener(() => {
  void connect().catch(fail)
})
chromeApi.runtime.onInstalled.addListener(() => {
  void chromeApi.alarms.create('reconnect', { periodInMinutes: 1 })
  void connect().catch(fail)
})
void chromeApi.alarms.create('reconnect', { periodInMinutes: 1 }).then(connect).catch(fail)
