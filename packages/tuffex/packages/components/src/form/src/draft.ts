import type { FormClearDraftsOptions, FormDraftAdapter, FormDraftStorage, FormDraftTtl } from './types'
import { isPlainObject } from './path'

/*
 * Where drafts live and how they are written, apart from any one form: the
 * key, the stored shape, the stores, and the forms mounted on the page.
 */

const PREFIX = 'tx-form:'
const DAY = 864e5
const UNITS: Record<string, number> = { d: DAY, h: 36e5, m: 6e4 }

/** One field as stored: its value, and the saved value it was edited from. Both encoded. */
export interface StoredField {
  value: unknown
  base: unknown
}

export interface DraftRecord {
  v: number
  savedAt: number
  expiresAt: number
  data: Record<string, StoredField>
}

/** A store as the forms use it. */
export interface DraftStore {
  adapter: FormDraftAdapter
  /** Answers at once, so a write started as the page goes away still lands. */
  instant: boolean
  /** Gone with the page. */
  volatile: boolean
  /** Its writes have returned promises, or it is not known yet that they do not. */
  async: boolean
}

/** The namespace and id stay apart once encoded: clearing `user` must not reach `user:42`. */
export function namespacePrefix(namespace: string): string {
  return `${PREFIX}${encodeURIComponent(namespace)}:`
}

export function draftKey(namespace: string, id: string, recordId?: string | number): string {
  const key = `${namespacePrefix(namespace)}${encodeURIComponent(id)}`
  return recordId === undefined || recordId === '' ? key : `${key}:${encodeURIComponent(String(recordId))}`
}

export function toTtl(ttl: FormDraftTtl | undefined): number {
  if (typeof ttl === 'number')
    return ttl > 0 ? ttl : 7 * DAY
  const match = /^(\d+(?:\.\d+)?)([dhm])$/.exec(ttl ?? '')
  return match ? Number(match[1]) * UNITS[match[2]!]! : 7 * DAY
}

const UNSTORABLE = Symbol('unstorable')

/**
 * JSON, plus what a form holds that JSON drops: `undefined`, dates, and
 * numbers it cannot write. An object of the model's own that uses the `~` key
 * is wrapped so it cannot pass for one of these. Anything else — a `File`, a
 * class instance — cannot be stored, and the field stays out of the draft.
 */
export function encodeValue(value: unknown): unknown {
  if (value === undefined)
    return { '~': 'u' }
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : { '~': 'n', v: String(value) }
  if (value instanceof Date)
    return { '~': 'd', v: value.getTime() }
  if (Array.isArray(value))
    return value.map(encodeValue)
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value))
      out[key] = encodeValue(value[key])
    return '~' in out ? { '~': 'o', v: out } : out
  }
  throw UNSTORABLE
}

function decodeEntries(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value))
    out[key] = decodeValue(value[key])
  return out
}

export function decodeValue(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(decodeValue)
  if (!isPlainObject(value))
    return value
  switch (value['~']) {
    case 'u':
      return undefined
    case 'n':
      return Number(value.v)
    case 'd':
      return new Date(typeof value.v === 'number' ? value.v : Number.NaN)
    case 'o':
      return isPlainObject(value.v) ? decodeEntries(value.v) : {}
  }
  return decodeEntries(value)
}

export function parseRecord(text: unknown): DraftRecord | null {
  if (typeof text !== 'string')
    return null
  try {
    const record = JSON.parse(text)
    if (isPlainObject(record) && typeof record.v === 'number' && typeof record.savedAt === 'number'
      && typeof record.expiresAt === 'number' && isPlainObject(record.data)) {
      return record as DraftRecord
    }
  }
  catch {}
  return null
}

// --- Stores ---

/** The `memory` store. */
const memoryDrafts = new Map<string, string>()
/** Writes the configured store refused, so the page still has them. */
export const fallbackDrafts = new Map<string, string>()

function mapAdapter(map: Map<string, string>): FormDraftAdapter {
  return {
    get: key => map.get(key),
    set: (key, value) => {
      map.set(key, value)
    },
    remove: (key) => {
      map.delete(key)
    },
    clear: (prefix) => {
      for (const key of [...map.keys()]) {
        if (key.startsWith(prefix))
          map.delete(key)
      }
    },
  }
}

function keysOf(storage: Storage, prefix: string): string[] {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key?.startsWith(prefix))
      keys.push(key)
  }
  return keys
}

const swept = new WeakSet<Storage>()

/** Drafts nobody came back for: removed on the first use in each page. */
function sweep(storage: Storage): void {
  if (swept.has(storage))
    return
  swept.add(storage)
  const now = Date.now()
  for (const key of keysOf(storage, PREFIX)) {
    const record = parseRecord(storage.getItem(key))
    if (!record || record.expiresAt <= now)
      storage.removeItem(key)
  }
}

function webAdapter(name: 'localStorage' | 'sessionStorage'): FormDraftAdapter {
  // Read on every call: reaching it throws where storage is blocked, and
  // that has to land in the caller's error handling.
  const storage = (): Storage => {
    const store = window[name]
    if (!store)
      throw new Error(`[TxForm] ${name} is not available.`)
    sweep(store)
    return store
  }
  return {
    get: key => storage().getItem(key),
    set: (key, value) => storage().setItem(key, value),
    remove: key => storage().removeItem(key),
    clear: (prefix) => {
      const store = storage()
      for (const key of keysOf(store, prefix))
        store.removeItem(key)
    },
  }
}

const builtins = new Map<string, DraftStore>()
const customs = new WeakMap<FormDraftAdapter, DraftStore>()

/** One record per store, so what its writes taught carries over. */
export function resolveDraftStore(storage: FormDraftStorage = 'local'): DraftStore {
  if (typeof storage !== 'string') {
    let store = customs.get(storage)
    if (!store)
      customs.set(storage, store = { adapter: storage, instant: false, volatile: false, async: true })
    return store
  }
  let store = builtins.get(storage)
  if (!store) {
    const adapter = storage === 'memory'
      ? mapAdapter(memoryDrafts)
      : webAdapter(storage === 'session' ? 'sessionStorage' : 'localStorage')
    store = { adapter, instant: true, volatile: storage === 'memory', async: false }
    builtins.set(storage, store)
  }
  return store
}

// --- Mounted forms ---

export interface DraftForm {
  /** The namespace its draft lives under, or `null` while it keeps none. */
  namespace: () => string | null
  flush: () => Promise<void>
  /** Its namespace was cleared: drop the write it was about to make and what the draft held. */
  forget: () => void
}

const forms = new Set<DraftForm>()
let listening = false

function flushOnHide(): void {
  if (document.visibilityState === 'hidden')
    void flushTxForms()
}

export function trackDraftForm(form: DraftForm): () => void {
  forms.add(form)
  // Hidden is the last moment a page is sure to run code: a closed tab, a
  // killed app or a discarded page may never fire anything after it.
  if (!listening && typeof document !== 'undefined') {
    listening = true
    document.addEventListener('visibilitychange', flushOnHide)
    window.addEventListener('pagehide', () => void flushTxForms())
  }
  return () => {
    forms.delete(form)
  }
}

/**
 * Writes the pending draft of every mounted form now. Call it before the page
 * or the process goes away without warning: in a plugin,
 * `onBeforeClose(flushTxForms)`.
 */
export async function flushTxForms(): Promise<void> {
  await Promise.all([...forms].map(form => form.flush().catch(() => {})))
}

/**
 * Removes drafts: every TxForm draft, or one namespace's, such as the user's
 * who just signed out. Mounted forms in that namespace drop their pending
 * writes too.
 */
export async function clearTxFormDrafts(options: FormClearDraftsOptions = {}): Promise<void> {
  const { namespace } = options
  const prefix = namespace === undefined ? PREFIX : namespacePrefix(namespace)
  for (const form of forms) {
    const own = form.namespace()
    if (own !== null && (namespace === undefined || own === namespace))
      form.forget()
  }
  mapAdapter(fallbackDrafts).clear!(prefix)
  const targets: FormDraftStorage[] = options.storage === undefined ? ['local', 'session', 'memory'] : [options.storage]
  for (const target of targets) {
    const { adapter } = resolveDraftStore(target)
    if (!adapter.clear) {
      console.warn('[TxForm] clearTxFormDrafts(): this storage has no `clear(prefix)`, so its drafts stay until they expire.')
      continue
    }
    try {
      await adapter.clear(prefix)
    }
    catch (error) {
      console.warn('[TxForm] clearTxFormDrafts() could not clear a storage.', error)
    }
  }
}
