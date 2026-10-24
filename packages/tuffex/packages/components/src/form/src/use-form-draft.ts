import type { ComputedRef, ShallowRef } from 'vue'
import type { DraftForm, DraftRecord, DraftStore, StoredField } from './draft'
import type {
  FormDraftState,
  FormLeaveContext,
  FormMessages,
  FormPersistOptions,
  FormProps,
  FormReconcile,
  FormValues,
  TxFormHost,
} from './types'
import {
  computed,
  ErrorCodes,
  getCurrentInstance,
  handleError,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  toValue,
  watch,
} from 'vue'
import {
  decodeValue,
  draftKey,
  encodeValue,
  fallbackDrafts,
  parseRecord,
  resolveDraftStore,
  toTtl,
  trackDraftForm,
} from './draft'
import {
  assignInto,
  cloneValue,
  collectChangedPaths,
  getPath,
  isEqualValue,
  isPlainObject,
  pathsOverlap,
  setPath,
  toPathKey,
} from './path'
import { isThenable } from './rules'

/** Typing pauses this long before the draft is written. */
const WRITE_DEBOUNCE = 300
/** Steady typing still writes this often. */
const WRITE_MAX_WAIT = 2000

interface DraftTarget {
  key: string
  namespace: string
  version: number
  ttl: number
  store: DraftStore
}

/** What the draft needs from the form that owns it. */
export interface FormDraftBridge {
  props: FormProps
  host: TxFormHost | null
  model: ComputedRef<FormValues>
  baseline: ShallowRef<FormValues>
  changedPaths: ComputedRef<string[]>
  messages: ComputedRef<FormMessages>
  labelOf: (path: string) => string
  /** A draft put these values back. They are the user's, checked as if each field had been left. */
  settle: (paths: string[]) => void
  /** A discard put the saved values back: those fields show nothing again. */
  forget: (paths: string[]) => void
  focus: (paths: string[]) => void
  announce: (text: string) => void
  onError: (error: unknown) => void
  /** The step the user is on, from the `TxStepsForm` around the form. */
  step?: {
    read: () => number
    restore: (step: number) => void
  }
}

/**
 * The draft behind one `TxForm`: what the user changed, written under the
 * form's `id` so a reload, a crash or a closed dialog does not lose it, and
 * laid back over the saved values when the form comes back.
 *
 * Each field is stored with the saved value it was edited from. A field whose
 * saved value has not moved since is filled in; one that was saved again
 * waits for the user, or for `reconcile`, because the draft no longer knows
 * which of the two is right.
 */
export function useFormDraft(bridge: FormDraftBridge) {
  const { props, host, model, baseline, changedPaths, messages } = bridge
  const instance = getCurrentInstance()

  const options = computed<FormPersistOptions | null>(() => {
    const persist = props.persist
    if (!persist)
      return null
    return persist === true ? {} : persist
  })
  // `null` from the host: it does not know whose drafts these are yet, and the
  // form keeps none until it does.
  const namespace = computed<string | null>(() => {
    const own = options.value?.namespace
    if (own !== undefined)
      return own
    const hosted = toValue(host?.namespace)
    return hosted === undefined ? 'default' : hosted
  })
  const key = computed(() => (options.value && props.id && namespace.value !== null
    ? draftKey(namespace.value, props.id, options.value.recordId)
    : null))

  watch(() => !!options.value && !props.id, (missing) => {
    if (missing)
      console.warn('[TxForm] `persist` stores the draft under the form\'s `id`; this form has none, so it keeps no draft.')
  }, { immediate: true })

  // A path whose control once held a secret stays out for the form's whole
  // life: a step that unmounts its password field leaves the value in the model.
  const protectedPaths = shallowRef<string[]>([])
  const excluded = computed(() => [...protectedPaths.value, ...(options.value?.exclude ?? []).map(path => toPathKey(path))])

  function protect(path: string): void {
    if (!protectedPaths.value.includes(path))
      protectedPaths.value = [...protectedPaths.value, path]
  }

  function isExcluded(path: string): boolean {
    return excluded.value.some(other => pathsOverlap(other, path))
  }

  /**
   * The model as the namespace moved to another person's. What the last one
   * changed is theirs: it stays on screen, counts as unsaved, and goes into no
   * draft until the user changes it.
   */
  const leftBehind = shallowRef<{ model: FormValues, values: FormValues } | null>(null)

  function isLeftBehind(values: FormValues, path: string): boolean {
    const left = leftBehind.value
    return !!left && left.model === values && isEqualValue(getPath(values, path), getPath(left.values, path))
  }

  function storedField(values: FormValues, saved: FormValues, path: string): StoredField | null {
    if (isExcluded(path) || isLeftBehind(values, path))
      return null
    try {
      return { value: encodeValue(getPath(values, path)), base: encodeValue(getPath(saved, path)) }
    }
    catch {
      return null
    }
  }

  /** Changes a draft does not hold: every change while the form keeps none. */
  const unsaved = computed(() => (key.value
    ? changedPaths.value.filter(path => !storedField(model.value, baseline.value, path))
    : changedPaths.value))

  /** Path to the value a draft put there, so a discard takes back only what the user has not changed since. */
  const restored = shallowRef(new Map<string, unknown>())
  const pending = shallowRef(new Map<string, StoredField>())
  const savedAt = ref<number | null>(null)
  /** The step the draft that was found had been on. */
  let savedStep: number | null = null
  const failed = ref(false)
  const queued = ref(false)
  const inFlight = ref(0)
  /** The key whose draft has been read. Writes wait for it, or they would replace a draft nobody has seen. */
  const readyKey = ref<string | null>(null)
  const mounted = ref(false)

  /** The target of the last read or write, kept for the moment the form switches away from it. */
  let active: DraftTarget | null = null
  /** The namespace of the last target. It stays through a spell without one. */
  let lastNamespace: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let queuedAt: number | undefined
  let readId = 0
  let reading: Promise<void> | null = null
  let tail: Promise<unknown> = Promise.resolve()
  let running = 0

  function currentTarget(): DraftTarget | null {
    const persist = options.value
    const target = key.value
    const owner = namespace.value
    if (!persist || !target || owner === null)
      return null
    return {
      key: target,
      namespace: owner,
      version: persist.version ?? 1,
      ttl: toTtl(persist.ttl),
      store: resolveDraftStore(persist.storage ?? host?.storage),
    }
  }

  // --- Store calls ---
  /** One at a time, so a read sees every write made before it. */
  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    // An idle queue starts the call now: a write made as the page hides must
    // reach a synchronous store before the page is gone.
    const run = running ? tail.then(task) : task()
    running++
    const done = run.finally(() => {
      running--
    })
    tail = done.catch(() => {})
    return done
  }

  function report(error: unknown): void {
    if (failed.value)
      return
    failed.value = true
    bridge.onError(error)
  }

  async function put(target: DraftTarget, text: string): Promise<void> {
    inFlight.value++
    try {
      const result = target.store.adapter.set(target.key, text)
      if (!target.store.instant)
        target.store.async = isThenable(result)
      await result
      fallbackDrafts.delete(target.key)
      failed.value = false
    }
    catch (error) {
      fallbackDrafts.set(target.key, text)
      report(error)
    }
    finally {
      inFlight.value--
    }
  }

  async function drop(target: DraftTarget): Promise<void> {
    fallbackDrafts.delete(target.key)
    inFlight.value++
    try {
      await target.store.adapter.remove(target.key)
      failed.value = false
    }
    catch (error) {
      report(error)
    }
    finally {
      inFlight.value--
    }
  }

  async function read(target: DraftTarget): Promise<DraftRecord | null> {
    let stored: unknown = null
    try {
      stored = await target.store.adapter.get(target.key)
    }
    catch (error) {
      report(error)
    }
    // A write the store refused earlier in this page may be newer than what it holds.
    const found = [parseRecord(stored), parseRecord(fallbackDrafts.get(target.key))]
      .filter((record): record is DraftRecord => !!record)
      .sort((left, right) => right.savedAt - left.savedAt)[0]
    if (found && found.v === target.version && found.expiresAt > Date.now())
      return found
    if (found || stored != null)
      await drop(target)
    return null
  }

  // --- Writing ---
  function write(target: DraftTarget, values: FormValues, saved: FormValues): Promise<void> {
    // Fields still waiting for the user stay in the draft until they decide;
    // a field the user has changed since is written as they left it.
    const data: Record<string, StoredField> = Object.fromEntries(pending.value)
    for (const path of collectChangedPaths(values, saved)) {
      const field = storedField(values, saved, path)
      if (field)
        data[path] = field
      else
        delete data[path]
    }
    const now = Date.now()
    const record: DraftRecord = { v: target.version, savedAt: now, expiresAt: now + target.ttl, data }
    if (bridge.step)
      record.step = bridge.step.read()
    const text = Object.keys(data).length ? JSON.stringify(record) : null
    return enqueue(() => (text === null ? drop(target) : put(target, text)))
  }

  function cancelWrite(): void {
    clearTimeout(timer)
    timer = undefined
    queuedAt = undefined
    queued.value = false
  }

  function writeNow(): Promise<void> {
    cancelWrite()
    const target = currentTarget()
    if (!target || readyKey.value !== target.key)
      return Promise.resolve()
    active = target
    return write(target, model.value, baseline.value)
  }

  function queueWrite(): void {
    if (!key.value || readyKey.value !== key.value)
      return
    const now = Date.now()
    queuedAt ??= now
    clearTimeout(timer)
    queued.value = true
    timer = setTimeout(() => void writeNow(), Math.min(WRITE_DEBOUNCE, Math.max(0, queuedAt + WRITE_MAX_WAIT - now)))
  }

  /** Writes what is waiting, then resolves once every store call made so far has finished. */
  async function flush(): Promise<void> {
    if (reading)
      await reading
    if (queued.value)
      await writeNow()
    else
      await enqueue(async () => {})
  }

  watch([changedPaths, excluded, () => bridge.step?.read()], () => queueWrite())

  // --- Reading ---
  /** Restored fields still holding a change: a save, a reset or an edit back to the saved value ends the notice. */
  const inEffect = computed(() => [...restored.value.keys()]
    .filter(path => changedPaths.value.some(changed => pathsOverlap(changed, path))))

  const notice = computed(() => {
    if (savedAt.value === null || (!pending.value.size && !inEffect.value.length))
      return ''
    const date = new Date(savedAt.value)
    return pending.value.size ? messages.value.draftPending(date) : messages.value.draftRestored(date)
  })

  /** Fields saved again since the draft was written: the host may merge them itself. */
  function askReconcile(reconcile: FormReconcile, waiting: Map<string, StoredField>): FormValues | void {
    const incoming: FormValues = {}
    const origin: FormValues = {}
    for (const [path, field] of waiting) {
      setPath(incoming, path, decodeValue(field.value))
      setPath(origin, path, decodeValue(field.base))
    }
    try {
      return reconcile({
        source: 'draft',
        incoming,
        current: cloneValue(model.value),
        baseline: cloneValue(baseline.value),
        dirtyPaths: [...waiting.keys()],
        merged: cloneValue(model.value),
        origin,
      })
    }
    catch (error) {
      handleError(error, instance, ErrorCodes.COMPONENT_EVENT_HANDLER, false)
    }
  }

  function apply(record: DraftRecord): void {
    const manual = options.value?.restore === 'manual'
    const filled = new Map<string, unknown>()
    const waiting = new Map<string, StoredField>()
    for (const [path, field] of Object.entries(record.data)) {
      if (!isPlainObject(field) || isExcluded(path))
        continue
      const saved = getPath(baseline.value, path)
      // A field the user is already editing keeps what they typed.
      if (!isEqualValue(getPath(model.value, path), saved))
        continue
      const value = decodeValue(field.value)
      if (isEqualValue(value, saved))
        continue
      if (!manual && isEqualValue(decodeValue(field.base), saved))
        filled.set(path, value)
      else
        waiting.set(path, field)
    }
    for (const [path, value] of filled)
      setPath(model.value, path, cloneValue(value))

    if (waiting.size && !manual && props.reconcile) {
      const values = askReconcile(props.reconcile, waiting)
      if (values) {
        assignInto(model.value, cloneValue(values))
        for (const path of waiting.keys()) {
          const value = getPath(model.value, path)
          if (!isEqualValue(value, getPath(baseline.value, path)))
            filled.set(path, cloneValue(value))
        }
        waiting.clear()
      }
    }

    restored.value = filled
    pending.value = waiting
    savedAt.value = record.savedAt
    savedStep = typeof record.step === 'number' ? record.step : null
    if (filled.size) {
      restoreStep()
      bridge.settle([...filled.keys()])
    }
    if (notice.value)
      bridge.announce(notice.value)
  }

  /** The user goes back to the step the draft was written on. */
  function restoreStep(): void {
    if (savedStep !== null)
      bridge.step?.restore(savedStep)
  }

  /** Reads the draft for the current key and lays it over the model. */
  function load(): void {
    const target = currentTarget()
    if (target) {
      // Edits made before any namespace was known belong to the first one.
      if (lastNamespace !== null && lastNamespace !== target.namespace)
        leftBehind.value = changedPaths.value.length ? { model: model.value, values: cloneValue(model.value) } : null
      lastNamespace = target.namespace
    }
    active = target
    readyKey.value = null
    restored.value = new Map()
    pending.value = new Map()
    savedAt.value = null
    savedStep = null
    const id = ++readId
    reading = null
    if (!target || !mounted.value)
      return
    // After the render this change causes, so the fields it mounts have registered.
    const run: Promise<void> = nextTick()
      .then(() => enqueue(() => read(target)))
      .then((record) => {
        if (id !== readId)
          return
        readyKey.value = target.key
        if (record)
          apply(record)
        // Edits made while it read, and a draft that turned out to hold nothing new.
        if (record || changedPaths.value.length)
          queueWrite()
      })
      .finally(() => {
        if (reading === run)
          reading = null
      })
    reading = run
  }

  /**
   * The model or the key is about to change. The old key keeps what was typed
   * into the old record, unless the namespace moved: that is another person,
   * and what the last one typed is not written on. One not known yet may be
   * someone else's as well.
   */
  function capture(previousModel: FormValues, previousKey: string | null): void {
    const target = active
    const waiting = queued.value
    cancelWrite()
    if (!waiting || !target || target.key !== previousKey || readyKey.value !== previousKey)
      return
    if (namespace.value !== target.namespace && (key.value !== null || namespace.value === null))
      return
    void write(target, previousModel, baseline.value)
  }

  /** The values were saved, or put back: the draft is done with. */
  function afterSave(): void {
    restored.value = new Map()
    pending.value = new Map()
    savedAt.value = null
    savedStep = null
    leftBehind.value = null
    void writeNow()
  }

  function forget(): void {
    cancelWrite()
    restored.value = new Map()
    pending.value = new Map()
    savedAt.value = null
    savedStep = null
  }

  async function restoreDraft(moveFocus = false): Promise<boolean> {
    if (reading)
      await reading
    const paths: string[] = []
    const next = new Map(restored.value)
    for (const [path, field] of pending.value) {
      if (isExcluded(path) || !isEqualValue(getPath(model.value, path), getPath(baseline.value, path)))
        continue
      const value = decodeValue(field.value)
      setPath(model.value, path, cloneValue(value))
      next.set(path, value)
      paths.push(path)
    }
    pending.value = new Map()
    restored.value = next
    queueWrite()
    if (paths.length) {
      restoreStep()
      bridge.settle(paths)
      bridge.announce(notice.value)
    }
    if (moveFocus) {
      await nextTick()
      bridge.focus(paths)
    }
    return paths.length > 0
  }

  async function discardDraft(moveFocus = false): Promise<void> {
    if (reading)
      await reading
    const reverted: string[] = []
    for (const [path, value] of restored.value) {
      if (!isEqualValue(getPath(model.value, path), value))
        continue
      setPath(model.value, path, cloneValue(getPath(baseline.value, path)))
      reverted.push(path)
    }
    restored.value = new Map()
    pending.value = new Map()
    savedAt.value = null
    savedStep = null
    if (reverted.length)
      bridge.forget(reverted)
    const written = writeNow()
    if (moveFocus) {
      await nextTick()
      bridge.focus(reverted)
    }
    await written
  }

  // --- Leaving ---
  /**
   * The browser asks only when leaving would lose something: no draft, a
   * field it cannot hold, a draft that dies with the page, or one not written
   * yet to a store that cannot finish while the page unloads.
   */
  const guardUnload = computed(() => {
    if (!mounted.value || props.leaveConfirm === false || !changedPaths.value.length)
      return false
    const target = currentTarget()
    if (!target || unsaved.value.length || failed.value || target.store.volatile || readyKey.value !== target.key)
      return true
    return target.store.async && (queued.value || inFlight.value > 0)
  })

  function onBeforeUnload(event: BeforeUnloadEvent): void {
    event.preventDefault()
    // Older engines ask through the return value instead.
    event.returnValue = ''
  }

  // Attached only while needed: a `beforeunload` listener keeps the page out
  // of the back-forward cache in some browsers.
  let guarding = false
  function setGuard(on: boolean): void {
    if (on === guarding || typeof window === 'undefined')
      return
    guarding = on
    if (on)
      window.addEventListener('beforeunload', onBeforeUnload)
    else
      window.removeEventListener('beforeunload', onBeforeUnload)
  }
  watch(guardUnload, setGuard)

  async function confirmLeave(): Promise<boolean> {
    await flush()
    const ask = props.leaveConfirm ?? host?.leaveConfirm
    const paths = unsaved.value
    if (ask === false || !paths.length)
      return true
    const context: FormLeaveContext = {
      unsaved: paths.map(path => ({ path, label: bridge.labelOf(path) })),
      persisted: !!key.value && changedPaths.value.length > paths.length,
    }
    if (ask) {
      try {
        return !!(await ask(context))
      }
      catch (error) {
        handleError(error, instance, ErrorCodes.COMPONENT_EVENT_HANDLER, false)
        return false
      }
    }
    // eslint-disable-next-line no-alert -- the last resort when neither the form nor its host brings a dialog
    return typeof window === 'undefined' || window.confirm(messages.value.leaveConfirm)
  }

  // --- Lifetime ---
  const tracked: DraftForm = {
    namespace: () => (key.value ? namespace.value : null),
    flush,
    forget,
  }
  let untrack: (() => void) | undefined

  onMounted(() => {
    mounted.value = true
    untrack = trackDraftForm(tracked)
    load()
  })

  onBeforeUnmount(() => {
    mounted.value = false
    untrack?.()
    setGuard(false)
    readId++
    if (queued.value)
      void writeNow()
  })

  const draft = computed<FormDraftState>(() => ({
    restored: inEffect.value,
    pending: [...pending.value.keys()],
    savedAt: savedAt.value,
    failed: failed.value,
  }))

  return {
    key,
    draft,
    notice,
    protect,
    load,
    capture,
    afterSave,
    flush,
    confirmLeave,
    restoreDraft,
    discardDraft,
  }
}
