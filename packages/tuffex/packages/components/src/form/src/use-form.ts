import type { ComputedRef, EffectScope, Ref, ShallowRef } from 'vue'
import type {
  FieldMessage,
  FormContext,
  FormControlSize,
  FormFieldHandle,
  FormFieldRegistration,
  FormSummaryEntry,
} from './context'
import type { RuleOutcome } from './rules'
import type {
  FormErrorSource,
  FormLabelAlign,
  FormLayout,
  FormMessages,
  FormProps,
  FormRequiredMark,
  FormRule,
  FormSetErrorsOptions,
  FormStandardSchemaIssue,
  FormStandardSchemaResult,
  FormValues,
} from './types'
import {
  computed,
  effectScope,
  ErrorCodes,
  getCurrentInstance,
  handleError,
  inject,
  nextTick,
  onBeforeUnmount,
  reactive,
  ref,
  shallowRef,
  toValue,
  triggerRef,
  useId,
  watch,
} from 'vue'
import { TX_FORM_HOST_KEY } from './context'
import {
  assignInto,
  cloneValue,
  collectChangedPaths,
  getPath,
  hasPath,
  isEqualValue,
  isPlainObject,
  parsePath,
  setPath,
  toPathKey,
} from './path'
import { asyncRulesOf, isThenable, readValidatorResult, record, runSyncRules } from './rules'
import { FORM_DEFAULT_MESSAGES } from './types'

/** Typing pauses this long before an asynchronous rule runs. */
const ASYNC_DEBOUNCE = 300
/** An asynchronous rule says it is still checking once it has taken this long. */
const SLOW_AFTER = 1000
/** `checked` before any asynchronous run, so no value can match it. */
const NONE = Symbol('none')
/** Synchronous validators get a signal too; nothing ever aborts it. */
const idleSignal = new AbortController().signal

const FOCUSABLE = [
  'input:not([type="hidden"]):not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  'button:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

const SIZES: Record<NonNullable<FormProps['size']>, FormControlSize> = { small: 'sm', medium: 'md', large: 'lg' }

interface ExternalError {
  message: string
  source: FormErrorSource
  /** The value the error was given for; the user editing it away clears the error. */
  value: unknown
}

interface StrayError {
  message: string
  source: FormErrorSource
}

interface FieldEntry {
  reg: FormFieldRegistration
  path: string
  scope: EffectScope
  value: ComputedRef<unknown>
  label: ComputedRef<string>
  rules: ComputedRef<FormRule[]>
  asyncRules: ComputedRef<FormRule[]>
  required: ComputedRef<boolean>
  sync: ComputedRef<RuleOutcome>
  blocking: ComputedRef<string | null>
  message: ComputedRef<FieldMessage | null>
  /** The field has spoken, and follows every edit from here on. */
  shown: Ref<boolean>
  external: ShallowRef<ExternalError | null>
  async: ShallowRef<RuleOutcome | null>
  slow: Ref<boolean>
  /** Bumped when a `deps` field changes, so the synchronous rules run again. */
  depsTick: Ref<number>
  /** The value when focus last left the item. */
  committed: unknown
  /** The value the asynchronous result, or the run in flight, belongs to. */
  checked: unknown
  run: Promise<void> | null
  runId: number
  controller: AbortController | null
  debounce: ReturnType<typeof setTimeout> | undefined
  slowTimer: ReturnType<typeof setTimeout> | undefined
}

type FormEmit = (event: 'validate', valid: boolean) => void

function toRuleList(rules: FormRule | FormRule[] | undefined): FormRule[] {
  if (rules === undefined)
    return []
  return Array.isArray(rules) ? rules : [rules]
}

function issueKey(issue: FormStandardSchemaIssue): string {
  if (!issue.path)
    return ''
  return toPathKey(issue.path.map(segment => typeof segment === 'object' ? segment.key : segment))
}

function longestOwner(paths: string[], key: string): string | undefined {
  let owner: string | undefined
  for (const path of paths) {
    if (key.startsWith(`${path}.`) && (!owner || path.length > owner.length))
      owner = path
  }
  return owner
}

/** `incoming` writes over `path`: it carries the path, or replaces a container on the way to it. */
function overwrites(incoming: unknown, path: string): boolean {
  let current: any = incoming
  for (const segment of parsePath(path)) {
    if (current === null || typeof current !== 'object')
      return true
    if (!(segment in current))
      return false
    current = current[segment]
  }
  return true
}

function byDocumentOrder(entries: FieldEntry[]): FieldEntry[] {
  return [...entries].sort((a, b) => {
    const left = a.reg.root()
    const right = b.reg.root()
    if (!left || !right || left === right)
      return 0
    // 4 is Node.DOCUMENT_POSITION_FOLLOWING; `Node` does not exist during SSR.
    return left.compareDocumentPosition(right) & 4 ? -1 : 1
  })
}

/** The state and behaviour behind one `TxForm`. Call it from the form's `setup`. */
export function useFormStore(props: FormProps, emit: FormEmit) {
  const instance = getCurrentInstance()
  const host = inject(TX_FORM_HOST_KEY, null)
  const autoId = useId()

  const fallbackModel = reactive<FormValues>({})
  const model = computed<FormValues>(() => props.model ?? fallbackModel)

  const formId = computed(() => props.id || autoId)
  const layout = computed<FormLayout>(() => {
    if (props.layout)
      return props.layout
    if (props.labelPosition === 'top')
      return 'stacked'
    return props.labelPosition ? 'side' : 'auto'
  })
  const labelAlign = computed<FormLabelAlign>(() => props.labelAlign ?? (props.labelPosition === 'left' ? 'start' : 'end'))
  const requiredMark = computed<FormRequiredMark>(() => props.requiredMark ?? 'asterisk')
  const messages = computed<FormMessages>(() => ({
    ...FORM_DEFAULT_MESSAGES,
    ...toValue(host?.messages),
    ...props.messages,
  }))
  const size = computed<FormControlSize>(() => SIZES[props.size ?? 'medium'] ?? 'md')
  const disabled = computed(() => !!props.disabled)

  const entries = shallowRef<FieldEntry[]>([])
  const baseline = shallowRef<FormValues>(cloneValue(model.value))
  /** Moves on every `setBaseline()`, so a submit knows whether the host set one meanwhile. */
  let baselineRevision = 0
  /** Moves whenever `setErrors()` or `setRootError()` reports a problem, so a submit knows its handler did. */
  let failureReports = 0

  const submitting = ref(false)
  const submitted = ref(false)
  /** `validate()` or a submit has shown every field's message. */
  const shownAll = ref(false)
  const rootError = ref('')
  const strays = shallowRef(new Map<string, StrayError>())
  const announcement = ref('')
  const summaries = shallowRef<Array<() => HTMLElement | null>>([])

  const formRules = computed(() => {
    const map = new Map<string, FormRule[]>()
    for (const [key, rules] of Object.entries(props.rules ?? {}))
      map.set(toPathKey(key), toRuleList(rules))
    return map
  })

  // --- Schema ---
  // The schema reads the model through its proxies, so this re-runs on every
  // edit. A schema that answers with a promise lands in `lateIssues` instead.
  const schemaResult = computed<FormStandardSchemaResult | PromiseLike<FormStandardSchemaResult> | null>(() => {
    const schema = props.schema
    if (!schema)
      return null
    try {
      return schema['~standard'].validate(model.value)
    }
    catch (error) {
      console.warn('[TxForm] The schema threw while validating; its issues are ignored.', error)
      return null
    }
  })
  const lateIssues = shallowRef<readonly FormStandardSchemaIssue[]>([])
  let schemaRunId = 0
  watch(schemaResult, (result) => {
    const runId = ++schemaRunId
    if (!isThenable<FormStandardSchemaResult>(result))
      return
    Promise.resolve(result).then(
      (resolved) => {
        if (runId === schemaRunId)
          lateIssues.value = resolved.issues ?? []
      },
      (error) => {
        if (runId !== schemaRunId)
          return
        console.warn('[TxForm] The schema rejected while validating; its issues are ignored.', error)
        lateIssues.value = []
      },
    )
  }, { immediate: true })

  const schemaIssues = computed<readonly FormStandardSchemaIssue[]>(() => {
    const result = schemaResult.value
    if (!result)
      return []
    return isThenable(result) ? lateIssues.value : (result.issues ?? [])
  })

  /** Each issue goes to the item showing its path, or the nearest item above it. */
  const schemaAttribution = computed(() => {
    const owned = new Map<string, string>()
    const orphans: Array<{ key: string, message: string }> = []
    const paths = entries.value.map(entry => entry.path)
    for (const issue of schemaIssues.value) {
      const key = issueKey(issue)
      const owner = paths.includes(key) ? key : longestOwner(paths, key)
      if (owner === undefined)
        orphans.push({ key, message: issue.message })
      else if (!owned.has(owner))
        owned.set(owner, issue.message)
    }
    return { owned, orphans }
  })

  async function settleSchema(): Promise<void> {
    const result = schemaResult.value
    if (!isThenable<FormStandardSchemaResult>(result))
      return
    try {
      const resolved = await result
      if (schemaResult.value === result)
        lateIssues.value = resolved.issues ?? []
    }
    catch {
      // The watcher has reported it.
    }
  }

  // --- Asynchronous rules ---
  function announce(text: string): void {
    announcement.value = ''
    void nextTick(() => {
      announcement.value = text
    })
  }

  function cancelAsync(entry: FieldEntry): void {
    clearTimeout(entry.debounce)
    clearTimeout(entry.slowTimer)
    entry.debounce = undefined
    entry.slowTimer = undefined
    entry.controller?.abort()
    entry.controller = null
    entry.run = null
    entry.runId++
    entry.slow.value = false
  }

  function runAsync(entry: FieldEntry): Promise<void> {
    cancelAsync(entry)
    const rules = entry.asyncRules.value
    if (!rules.length || entry.sync.value.error) {
      entry.async.value = null
      entry.checked = NONE
      return Promise.resolve()
    }

    const value = entry.value.value
    const controller = new AbortController()
    const runId = entry.runId
    entry.controller = controller
    entry.checked = cloneValue(value)
    entry.slowTimer = setTimeout(() => {
      if (runId !== entry.runId)
        return
      entry.slow.value = true
      if (entry.shown.value)
        announce(messages.value.validating)
    }, SLOW_AFTER)

    const run = (async () => {
      const outcome: RuleOutcome = {}
      for (const rule of rules) {
        let message: string | null
        try {
          const result = await rule.validator!(value, rule, model.value, { signal: controller.signal, path: entry.path })
          message = readValidatorResult(result, rule, entry.label.value, messages.value)
        }
        catch (error) {
          if (controller.signal.aborted)
            return
          console.warn(`[TxForm] The validator for "${entry.path}" threw; the field counts as invalid.`, error)
          message = rule.message ?? messages.value.invalid(entry.label.value)
        }
        if (controller.signal.aborted || runId !== entry.runId)
          return
        if (message && record(outcome, rule, message))
          break
      }
      if (runId !== entry.runId)
        return
      clearTimeout(entry.slowTimer)
      entry.slowTimer = undefined
      entry.slow.value = false
      entry.controller = null
      entry.run = null
      entry.async.value = outcome
      if (entry.shown.value && outcome.error)
        announce(`${messages.value.errorPrefix}${outcome.error}`)
    })()
    entry.run = run
    return run
  }

  function scheduleAsync(entry: FieldEntry): void {
    if (!entry.asyncRules.value.length || entry.sync.value.error)
      return
    clearTimeout(entry.debounce)
    entry.debounce = setTimeout(() => {
      entry.debounce = undefined
      void runAsync(entry)
    }, ASYNC_DEBOUNCE)
  }

  /** Brings a field's asynchronous result up to date with its value, without waiting out the debounce. */
  async function settleField(entry: FieldEntry): Promise<void> {
    if (!entry.asyncRules.value.length || entry.sync.value.error)
      return
    if (entry.checked !== NONE && isEqualValue(entry.value.value, entry.checked)) {
      if (entry.run)
        await entry.run
      if (entry.async.value)
        return
    }
    await runAsync(entry)
  }

  // --- Fields ---
  function createEntry(reg: FormFieldRegistration, scope: EffectScope): FieldEntry {
    const path = reg.path
    const value = computed(() => getPath(model.value, path))
    const label = computed(() => reg.label() || messages.value.field)
    const rules = computed<FormRule[]>(() => {
      const own = reg.rules()
      const list = own === undefined ? formRules.value.get(path) ?? [] : toRuleList(own)
      const requiresValue = list.some(rule => rule.required && rule.level !== 'warning')
      return reg.required() && !requiresValue ? [{ required: true }, ...list] : list
    })
    const asyncRules = computed(() => asyncRulesOf(rules.value))
    const required = computed(() => rules.value.some(rule => rule.required && rule.level !== 'warning'))
    const depsTick = ref(0)
    const sync = computed(() => {
      void depsTick.value
      return runSyncRules(value.value, rules.value, model.value, path, label.value, messages.value, idleSignal)
    })
    const schemaError = computed(() => schemaAttribution.value.owned.get(path))
    const shown = ref(false)
    const external = shallowRef<ExternalError | null>(null)
    const asyncOutcome = shallowRef<RuleOutcome | null>(null)
    const slow = ref(false)

    const blocking = computed(() => {
      if (external.value?.source === 'client')
        return external.value.message
      return sync.value.error ?? schemaError.value ?? asyncOutcome.value?.error ?? null
    })

    // Validity above is always current; what the user sees waits until the
    // field has been left with a changed value, or the form was submitted.
    const message = computed<FieldMessage | null>(() => {
      if (external.value)
        return { kind: 'error', text: external.value.message }
      if (!shown.value)
        return null
      const error = sync.value.error ?? schemaError.value ?? asyncOutcome.value?.error
      if (error)
        return { kind: 'error', text: error }
      if (slow.value)
        return { kind: 'validating', text: messages.value.validating }
      const warning = sync.value.warning ?? asyncOutcome.value?.warning
      return warning ? { kind: 'warning', text: warning } : null
    })

    const entry: FieldEntry = {
      reg,
      path,
      scope,
      value,
      label,
      rules,
      asyncRules,
      required,
      sync,
      blocking,
      message,
      shown,
      external,
      async: asyncOutcome,
      slow,
      depsTick,
      committed: cloneValue(value.value),
      checked: NONE,
      run: null,
      runId: 0,
      controller: null,
      debounce: undefined,
      slowTimer: undefined,
    }

    watch(value, (next) => {
      const error = entry.external.value
      if (error && !isEqualValue(next, error.value))
        entry.external.value = null
      // A blur that normalizes the value (a number input rounding) lands here
      // after the commit already checked that value: keep that run.
      if (entry.checked !== NONE && isEqualValue(next, entry.checked))
        return
      cancelAsync(entry)
      entry.async.value = null
      entry.checked = NONE
      if (entry.shown.value)
        scheduleAsync(entry)
    }, { deep: true })

    const deps = computed(() => [...new Set(rules.value.flatMap(rule => rule.deps ?? []).map(dep => toPathKey(dep)))])
    watch(() => deps.value.map(dep => getPath(model.value, dep)), () => {
      depsTick.value++
      if (!entry.shown.value)
        return
      cancelAsync(entry)
      entry.async.value = null
      entry.checked = NONE
      scheduleAsync(entry)
    }, { deep: true })

    return entry
  }

  /**
   * A registered field the baseline lacks gets its current value there, so
   * editing it makes the form dirty. The copy starts at the first segment the
   * baseline is missing, the level `collectChangedPaths` compares from.
   */
  function coverInBaseline(entry: FieldEntry, target: FormValues = baseline.value): void {
    const segments = parsePath(entry.path)
    let into: any = target
    let from: any = model.value
    for (const [index, segment] of segments.entries()) {
      // An array or a value already stands for everything below it.
      if (!isPlainObject(into))
        return
      if (!(segment in into)) {
        const exists = from !== null && typeof from === 'object' && segment in from
        // Inventing the containers the model lacks would make it differ at once.
        if (!exists && index < segments.length - 1)
          return
        into[segment] = cloneValue(exists ? from[segment] : undefined)
        if (target === baseline.value)
          triggerRef(baseline)
        return
      }
      into = into[segment]
      from = from?.[segment]
    }
  }

  function register(reg: FormFieldRegistration): FormFieldHandle {
    // Detached: the item's `dispose` ends it, whichever component was rendering.
    const scope = effectScope(true)
    const entry = scope.run(() => createEntry(reg, scope))!
    coverInBaseline(entry)
    // An error set before the item mounted, in a step or a section not shown yet.
    const stray = strays.value.get(entry.path)
    if (stray) {
      entry.external.value = { ...stray, value: cloneValue(entry.value.value) }
      const next = new Map(strays.value)
      next.delete(entry.path)
      strays.value = next
    }
    entries.value = [...entries.value, entry]
    return {
      message: entry.message,
      required: entry.required,
      commit: () => commit(entry),
      dispose: () => {
        cancelAsync(entry)
        scope.stop()
        entries.value = entries.value.filter(item => item !== entry)
      },
    }
  }

  function commit(entry: FieldEntry): void {
    const value = entry.value.value
    if (isEqualValue(value, entry.committed))
      return
    entry.committed = cloneValue(value)
    if (props.validateOn === 'submit' && !submitted.value)
      return
    entry.shown.value = true
    void settleField(entry).then(() => entry.reg.validated?.(!entry.blocking.value))
  }

  // --- Form state ---
  const valid = computed(() => {
    if (schemaAttribution.value.orphans.length)
      return false
    for (const stray of strays.value.values()) {
      if (stray.source === 'client')
        return false
    }
    return entries.value.every(entry => !entry.blocking.value)
  })

  const dirty = computed(() => collectChangedPaths(model.value, baseline.value).length > 0)

  /** What the user sees, by path. */
  const errors = computed<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const entry of entries.value) {
      const message = entry.message.value
      if (message?.kind === 'error' && !(entry.path in out))
        out[entry.path] = message.text
    }
    for (const [key, stray] of strays.value)
      out[key] ??= stray.message
    if (shownAll.value) {
      for (const orphan of schemaAttribution.value.orphans)
        out[orphan.key] ??= orphan.message
    }
    return out
  })

  const summary = computed<FormSummaryEntry[]>(() => {
    const list: FormSummaryEntry[] = []
    for (const entry of byDocumentOrder(entries.value)) {
      const message = entry.message.value
      if (message?.kind !== 'error')
        continue
      list.push({
        key: `field:${entry.path}:${list.length}`,
        message: message.text,
        target: entry.reg.controlId(),
        focus: () => focusEntry(entry),
      })
    }
    for (const [key, stray] of strays.value)
      list.push({ key: `stray:${key}`, message: stray.message })
    if (shownAll.value) {
      schemaAttribution.value.orphans.forEach((orphan, index) => {
        list.push({ key: `schema:${orphan.key}:${index}`, message: orphan.message })
      })
    }
    return list
  })

  const showSummary = computed(() => !!rootError.value || (shownAll.value && summary.value.length > 0))
  const summaryAttached = computed(() => summaries.value.length > 0)

  function focusEntry(entry: FieldEntry): void {
    const root = entry.reg.root()
    if (!root)
      return
    const doc = root.ownerDocument
    let control = doc.getElementById(entry.reg.controlId())
    // A control may hide the element holding the id (a masked secret) and
    // take focus on a wrapper instead.
    if (control?.getAttribute('aria-hidden') === 'true')
      control = control.parentElement?.closest<HTMLElement>('[tabindex="0"]') ?? null
    // A group holding the id — a radio group, a multiple select's trigger —
    // takes no focus itself; its tab stop or first focusable element does.
    if (control && !control.matches(FOCUSABLE))
      control = control.querySelector<HTMLElement>('[tabindex="0"]') ?? control.querySelector<HTMLElement>(FOCUSABLE)
    control ??= root.querySelector<HTMLElement>(FOCUSABLE)
    const labelId = entry.reg.labelId()
    const anchor = (labelId ? doc.getElementById(labelId) : null) ?? root
    // The label goes to the middle of the view, so the user reads the field's
    // name and its message together; focus then must not scroll again.
    anchor.scrollIntoView?.({ block: 'center' })
    control?.focus({ preventScroll: true })
  }

  async function focusFirstError(): Promise<void> {
    await nextTick()
    const summaryElement = summaries.value.map(get => get()).find(element => !!element)
    if (summaryElement) {
      summaryElement.focus()
      return
    }
    const first = byDocumentOrder(entries.value).find(entry => entry.message.value?.kind === 'error')
    if (first)
      focusEntry(first)
  }

  // --- API ---
  async function validate(): Promise<boolean> {
    shownAll.value = true
    for (const entry of entries.value)
      entry.shown.value = true
    await Promise.all([...entries.value.map(settleField), settleSchema()])
    for (const entry of entries.value)
      entry.reg.validated?.(!entry.blocking.value)
    const result = valid.value
    emit('validate', result)
    return result
  }

  async function validateField(path: string): Promise<boolean> {
    const key = toPathKey(path)
    const matches = entries.value.filter(entry => entry.path === key)
    for (const entry of matches)
      entry.shown.value = true
    await Promise.all([...matches.map(settleField), settleSchema()])
    for (const entry of matches)
      entry.reg.validated?.(!entry.blocking.value)
    return matches.every(entry => !entry.blocking.value)
  }

  async function submit(event?: Event): Promise<boolean> {
    if (submitting.value || disabled.value)
      return false
    submitted.value = true
    rootError.value = ''

    if (!await validate()) {
      for (const orphan of schemaAttribution.value.orphans)
        console.warn(`[TxForm] The schema reports "${orphan.message}" at "${orphan.key || '(root)'}", which no TxFormItem shows.`)
      await focusFirstError()
      return false
    }

    const handler = props.onSubmit
    if (!handler)
      return true

    // The handler gets its own copy: it may trim or rename fields for the request.
    const snapshot = cloneValue(model.value)
    const revision = baselineRevision
    const reported = failureReports
    submitting.value = true
    try {
      const result = await handler(cloneValue(snapshot), event)
      if (result === false || failureReports !== reported) {
        await focusFirstError()
        return false
      }
      // What was sent is what is saved now, unless the handler loaded the
      // saved record itself through `setBaseline()`.
      if (revision === baselineRevision)
        baseline.value = { ...baseline.value, ...snapshot }
      for (const entry of entries.value) {
        if (entry.external.value?.source === 'server')
          entry.external.value = null
      }
      strays.value = new Map()
      return true
    }
    catch (error) {
      handleError(error, instance, ErrorCodes.COMPONENT_EVENT_HANDLER, false)
      if (failureReports !== reported)
        await focusFirstError()
      return false
    }
    finally {
      submitting.value = false
    }
  }

  function forgetDisplay(entry: FieldEntry): void {
    cancelAsync(entry)
    entry.async.value = null
    entry.checked = NONE
    entry.shown.value = false
    entry.external.value = null
    entry.committed = cloneValue(entry.value.value)
  }

  function reset(): void {
    assignInto(model.value, cloneValue(baseline.value))
    rootError.value = ''
    strays.value = new Map()
    submitted.value = false
    shownAll.value = false
    entries.value.forEach(forgetDisplay)
  }

  function clearValidate(paths?: string | string[]): void {
    const keys = paths === undefined ? null : new Set((Array.isArray(paths) ? paths : [paths]).map(path => toPathKey(path)))
    for (const entry of entries.value) {
      if (keys && !keys.has(entry.path))
        continue
      entry.shown.value = false
      entry.external.value = null
    }
    if (!keys) {
      shownAll.value = false
      rootError.value = ''
      strays.value = new Map()
    }
  }

  /**
   * Makes `values` the saved state: what `dirty` compares against and `reset()`
   * restores. Without `values`, the model as it stands becomes the baseline.
   * Fields the user has changed are not overwritten unless `reconcile` says so.
   */
  function setBaseline(values?: FormValues): void {
    baselineRevision++
    const before = entries.value.map(entry => cloneValue(entry.value.value))
    if (values === undefined) {
      const next = cloneValue(model.value)
      entries.value.forEach(entry => coverInBaseline(entry, next))
      baseline.value = next
    }
    else {
      const incoming = cloneValue(values)
      const previous = baseline.value
      const dirtyPaths = collectChangedPaths(model.value, previous).filter(path => overwrites(incoming, path))
      let next: FormValues = incoming
      if (dirtyPaths.length) {
        const merged = cloneValue(incoming)
        for (const path of dirtyPaths)
          setPath(merged, path, cloneValue(getPath(model.value, path)))
        next = props.reconcile?.({
          source: 'baseline',
          incoming: cloneValue(incoming),
          current: cloneValue(model.value),
          baseline: cloneValue(previous),
          dirtyPaths,
          merged,
        }) ?? merged
      }
      const nextBaseline = cloneValue({ ...previous, ...incoming })
      // A field `incoming` says nothing about keeps the saved value it had.
      for (const entry of entries.value) {
        if (!hasPath(nextBaseline, entry.path) && hasPath(previous, entry.path))
          setPath(nextBaseline, entry.path, cloneValue(getPath(previous, entry.path)))
      }
      assignInto(model.value, cloneValue(next))
      entries.value.forEach(entry => coverInBaseline(entry, nextBaseline))
      baseline.value = nextBaseline
    }
    // A value replaced from outside is not one the user left behind.
    entries.value.forEach((entry, index) => {
      if (!isEqualValue(entry.value.value, before[index]))
        entry.committed = cloneValue(entry.value.value)
    })
  }

  function setErrors(map: Record<string, string | null | undefined>, options: FormSetErrorsOptions = {}): void {
    const source = options.source ?? 'server'
    if (Object.values(map).some(message => !!message))
      failureReports++
    const nextStrays = new Map(strays.value)
    for (const [path, message] of Object.entries(map)) {
      const key = toPathKey(path)
      const matches = entries.value.filter(entry => entry.path === key)
      if (!matches.length) {
        if (message)
          nextStrays.set(key, { message, source })
        else
          nextStrays.delete(key)
        continue
      }
      for (const entry of matches)
        entry.external.value = message ? { message, source, value: cloneValue(entry.value.value) } : null
    }
    strays.value = nextStrays
  }

  function setRootError(message?: string | null): void {
    if (message)
      failureReports++
    rootError.value = message ?? ''
  }

  // A new model object is a new record: it becomes the baseline, and nothing
  // shown for the old one carries over.
  watch(() => props.model, (next, previous) => {
    if (next === previous)
      return
    baselineRevision++
    baseline.value = cloneValue(model.value)
    rootError.value = ''
    strays.value = new Map()
    submitted.value = false
    shownAll.value = false
    entries.value.forEach((entry) => {
      coverInBaseline(entry)
      forgetDisplay(entry)
    })
  })

  onBeforeUnmount(() => {
    for (const entry of entries.value) {
      cancelAsync(entry)
      entry.scope.stop()
    }
  })

  const context: FormContext = {
    id: formId,
    layout,
    labelAlign,
    requiredMark,
    messages,
    size,
    disabled,
    register,
    rootError,
    summary,
    showSummary,
    attachSummary(element) {
      summaries.value = [...summaries.value, element]
      return () => {
        summaries.value = summaries.value.filter(item => item !== element)
      }
    },
  }

  return {
    context,
    formId,
    layout,
    labelAlign,
    announcement,
    summaryAttached,
    dirty,
    valid,
    submitting,
    submitted,
    errors,
    rootError,
    validate,
    validateField,
    submit,
    reset,
    clearValidate,
    setBaseline,
    setErrors,
    setRootError,
  }
}
