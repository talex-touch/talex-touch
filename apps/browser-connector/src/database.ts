export const DATABASE_NAME = 'tuff-browser-connector'
const DATABASE_VERSION = 1
let database: Promise<IDBDatabase> | undefined

function openDatabase(): Promise<IDBDatabase> {
  if (database)
    return database
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>()
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
  request.onupgradeneeded = () => {
    request.result.createObjectStore('identity')
    request.result.createObjectStore('settings')
    request.result.createObjectStore('ledger')
  }
  request.onerror = () => reject(request.error)
  request.onsuccess = () => resolve(request.result)
  database = promise
  return promise
}

export async function getRecord<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDatabase()
  const { promise, resolve, reject } = Promise.withResolvers<T | undefined>()
  const transaction = db.transaction(store, 'readonly')
  const request = transaction.objectStore(store).get(key)
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
  return promise
}

// Resolve only after the durable commit, never merely after the put request succeeds.
export async function putRecord(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDatabase()
  const { promise, resolve, reject } = Promise.withResolvers<void>()
  const transaction = db.transaction(store, 'readwrite', { durability: 'strict' })
  transaction.objectStore(store).put(value, key)
  transaction.oncomplete = () => resolve()
  transaction.onerror = () => reject(transaction.error)
  transaction.onabort = () => reject(transaction.error ?? new Error('journalUnavailable'))
  return promise
}

export interface ProfileIdentity {
  profileId: string
  privateKey: CryptoKey
  publicKey: JsonWebKey
}
let identityPromise: Promise<ProfileIdentity> | undefined
export function getIdentity(): Promise<ProfileIdentity> {
  return (identityPromise ??= (async () => {
    const existing = await getRecord<ProfileIdentity>('identity', 'profile')
    if (existing) {
      if (
        !(existing.privateKey instanceof CryptoKey)
        || existing.privateKey.type !== 'private'
        || existing.privateKey.extractable
        || existing.privateKey.algorithm.name !== 'ECDSA'
        || !existing.privateKey.usages.includes('sign')
      ) {
        throw new Error('invalidProfileIdentity')
      }
      return existing
    }
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify'])
    const identity: ProfileIdentity = {
      profileId: crypto.randomUUID(),
      privateKey: keys.privateKey,
      publicKey: await crypto.subtle.exportKey('jwk', keys.publicKey),
    }
    await putRecord('identity', 'profile', identity)
    return identity
  })())
}

export interface ConnectorSettings {
  enabled: boolean
  paused: boolean
  label: string
}
export const defaultSettings: ConnectorSettings = { enabled: false, paused: false, label: 'Chrome' }
