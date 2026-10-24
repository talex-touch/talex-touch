import type { MaybeRefOrGetter } from 'vue'

export type { FormControlKind, TxFormField, TxFormFieldOptions } from '../../../../utils/form-field'

export type FormValues = Record<string, any>

/**
 * `stacked` puts labels above controls; `side` gives labels a column of their
 * own; `auto` is `side` once the form is at least 520px wide and `stacked`
 * below that; `inline` lays items out in a wrapping line, for filters.
 */
export type FormLayout = 'stacked' | 'side' | 'auto' | 'inline'
/** Older spelling of `layout`: `top` is `stacked`; `left` and `right` are `side` with that label alignment. */
export type FormLabelPosition = 'left' | 'right' | 'top'
export type FormLabelAlign = 'start' | 'end'
export type FormSize = 'small' | 'medium' | 'large'
/** When a field's first message appears. Either way, a field that has shown one follows every edit after. */
export type FormValidateOn = 'blur' | 'submit'
export type FormRequiredMark = 'asterisk' | 'optional' | 'none'
/** Control width that fits what the field holds: 80, 160, 240 or 360px, or the whole field column. */
export type FormItemWidth = 'xs' | 'sm' | 'md' | 'lg' | 'full'
export type FormRuleType = 'email' | 'url' | 'number' | 'integer'
export type FormRuleLevel = 'error' | 'warning'
/**
 * Where an error set through `setErrors()` came from. Both show at once and
 * stay until the user edits the field. A `client` error also blocks submit; a
 * `server` error does not, so the user may send the same values again.
 */
export type FormErrorSource = 'server' | 'client'

export interface FormValidatorContext {
  /** Aborted once the value changes again, or the field resets or unmounts. */
  signal: AbortSignal
  /** The field's path, dotted: `links.0.url`. */
  path: string
}

export interface FormRule {
  /** Fails on `undefined`, `null`, `''`, `false` and an empty array. */
  required?: boolean
  type?: FormRuleType
  /** Smallest number allowed. */
  min?: number
  /** Largest number allowed. */
  max?: number
  /** Fewest characters in a string, or items in an array. */
  minLength?: number
  /** Most characters in a string, or items in an array. */
  maxLength?: number
  pattern?: RegExp
  message?: string
  /** `warning` shows its message but never blocks submit. */
  level?: FormRuleLevel
  /** Fields whose edits re-check this one while it shows a message, as a confirmation follows its password. */
  deps?: string[]
  /**
   * Return `false` or a message to fail. Declare it `async` when it awaits:
   * TxForm then runs it only after every synchronous rule passes, debounces it
   * while the user types, and aborts `context.signal` when the value moves on.
   */
  validator?: (
    value: any,
    rule: FormRule,
    model: FormValues,
    context: FormValidatorContext,
  ) => boolean | string | Promise<boolean | string>
}

export type FormRules = Record<string, FormRule | FormRule[]>

/** Built-in text. TuffEx has no i18n, so a host passes its language here or through `provideTxFormHost()`. */
export interface FormMessages {
  /** Stands in for the label when an item has neither `label` nor `prop`. */
  field: string
  required: (label: string) => string
  type: (label: string, type: FormRuleType) => string
  min: (label: string, min: number) => string
  max: (label: string, max: number) => string
  minLength: (label: string, min: number, unit: 'characters' | 'items') => string
  maxLength: (label: string, max: number, unit: 'characters' | 'items') => string
  pattern: (label: string) => string
  /** A validator returned `false`, or threw. */
  invalid: (label: string) => string
  /** Read before an error; hidden on screen. */
  errorPrefix: string
  /** Read before a warning; hidden on screen. */
  warningPrefix: string
  /** Under a field whose asynchronous check has run for over a second. */
  validating: string
  /** After optional labels when `requiredMark` is `optional`. */
  optional: string
  /** Heading of `TxFormErrorSummary`. */
  summaryTitle: string
  /** Above the form once a draft has filled it in. */
  draftRestored: (savedAt: Date) => string
  /** Above the form while a draft waits for the user to restore or discard it. */
  draftPending: (savedAt: Date) => string
  draftRestore: string
  draftDiscard: string
  /** Asked through `window.confirm` before leaving with changes no draft holds, when nothing else asks. */
  leaveConfirm: string
  /** Read once an autosave went through; hidden on screen. */
  autosaved: string
  /** Read when an autosave failed and no message on screen says why; hidden on screen. */
  autosaveFailed: string
}

function draftTime(date: Date): string {
  return date.toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })
}

export const FORM_DEFAULT_MESSAGES: FormMessages = {
  field: 'Field',
  required: label => `${label} is required`,
  type: (label, type) => {
    const expected = { email: 'an email address', url: 'a web address', number: 'a number', integer: 'a whole number' }[type]
    return `${label} must be ${expected}`
  },
  min: (label, min) => `${label} must be at least ${min}`,
  max: (label, max) => `${label} must be at most ${max}`,
  minLength: (label, min, unit) => `${label} needs at least ${min} ${unit}`,
  maxLength: (label, max, unit) => `${label} allows at most ${max} ${unit}`,
  pattern: label => `${label} is not in the expected format`,
  invalid: label => `${label} is invalid`,
  errorPrefix: 'Error: ',
  warningPrefix: 'Warning: ',
  validating: 'Validating…',
  optional: '(optional)',
  summaryTitle: 'There is a problem',
  draftRestored: savedAt => `Restored unsaved changes from ${draftTime(savedAt)}.`,
  draftPending: savedAt => `You have unsaved changes from ${draftTime(savedAt)}.`,
  draftRestore: 'Restore',
  draftDiscard: 'Discard',
  leaveConfirm: 'You have unsaved changes. Leave anyway?',
  autosaved: 'Changes saved.',
  autosaveFailed: 'Your changes could not be saved.',
}

/** A Standard Schema v1 issue: what Zod, Valibot and ArkType report. */
export interface FormStandardSchemaIssue {
  readonly message: string
  readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined
}

export type FormStandardSchemaResult =
  | { readonly value: unknown, readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<FormStandardSchemaIssue> }

/** The part of the Standard Schema v1 interface TxForm calls, so any compliant schema fits without a dependency. */
export interface FormStandardSchema {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => FormStandardSchemaResult | Promise<FormStandardSchemaResult>
  }
}

/**
 * Where incoming values came from. `baseline` is `setBaseline()`: data the
 * host fetched. `draft` is a stored draft whose fields were saved again after
 * it was written, so its edits were made against older values.
 */
export type FormReconcileSource = 'baseline' | 'draft'

export interface FormReconcileContext {
  source: FormReconcileSource
  /** The values arriving. They become the new baseline whatever the model ends up holding. */
  incoming: FormValues
  /** The model as the user left it. */
  current: FormValues
  /** The baseline the user's edits were made against. */
  baseline: FormValues
  /** Fields the user changed that `incoming` also carries, as dotted paths. */
  dirtyPaths: string[]
  /**
   * TxForm's default. For `baseline`: `incoming`, with every field in
   * `dirtyPaths` kept as the user left it. For `draft`: the model as it is,
   * so the saved values stay and the draft waits in the notice.
   */
  merged: FormValues
  /** For `draft`: the saved values its edits were made against, for a three-way merge. */
  origin?: FormValues
}

/**
 * Decides what the model holds when values arrive for fields the user has
 * changed. Return the values to write, or nothing to take `merged`. Each
 * argument is a copy, free to change. It is not called when nothing conflicts.
 */
export type FormReconcile = (context: FormReconcileContext) => FormValues | void

/** A store for drafts. Any method may return a promise. */
export interface FormDraftAdapter {
  get: (key: string) => string | null | undefined | Promise<string | null | undefined>
  /** Throw or reject when the value was not stored, so the form can keep it in memory instead. */
  set: (key: string, value: string) => void | Promise<void>
  remove: (key: string) => void | Promise<void>
  /** Removes every key that starts with `prefix`. `clearTxFormDrafts()` needs it. */
  clear?: (prefix: string) => void | Promise<void>
  /** The keys that start with `prefix`. `clearTxFormDrafts()` needs it to pick namespaces with a function. */
  keys?: (prefix: string) => string[] | Promise<string[]>
}

/**
 * Where drafts are kept. `local` survives restarts, `session` lasts as long
 * as the tab, and `memory` as long as the page: it outlives a closed dialog
 * or a route change, not a reload.
 */
export type FormDraftStorage = 'local' | 'session' | 'memory' | FormDraftAdapter

/** Milliseconds, or days, hours or minutes: `'7d'`, `'12h'`, `'30m'`. */
export type FormDraftTtl = number | `${number}${'d' | 'h' | 'm'}`

export interface FormPersistOptions {
  /** Keeps the drafts of different records apart: `42` for `/posts/42/edit`. */
  recordId?: string | number
  /** Whose drafts these are. Defaults to the host's namespace, then `default`. */
  namespace?: string
  /** Bump it when the model's shape changes: a draft written under another version is dropped. Default `1`. */
  version?: number
  /** How long a draft lasts after its last write. Default `'7d'`. */
  ttl?: FormDraftTtl
  /** Defaults to the host's storage, then `local`. */
  storage?: FormDraftStorage
  /** Paths never written, on top of the fields whose controls hold secrets. */
  exclude?: string[]
  /**
   * `auto` fills in the fields the user has not touched as soon as the draft
   * is read. `manual` waits for the notice or `restoreDraft()`. Default `auto`.
   */
  restore?: 'auto' | 'manual'
}

export interface FormDraftState {
  /** Fields the draft filled in. */
  restored: string[]
  /** Fields the draft holds but did not fill in: they were saved again since, or `restore` is `manual`. */
  pending: string[]
  /** When the draft that was found had been written, in epoch milliseconds; `null` without one. */
  savedAt: number | null
  /** The last write failed: the draft lives in memory until a write succeeds. */
  failed: boolean
}

export interface FormLeaveField {
  path: string
  label: string
}

export interface FormLeaveContext {
  /** Changed fields no draft holds: secrets and excluded paths, or every change when the form keeps no draft. */
  unsaved: FormLeaveField[]
  /** The other changes are in the draft and come back with the form. */
  persisted: boolean
}

/** Resolve `true` to leave. */
export type FormLeaveConfirm = (context: FormLeaveContext) => boolean | Promise<boolean>

export interface FormClearDraftsOptions {
  /**
   * Only this namespace's drafts, or those of every namespace the function
   * accepts: at startup, every account's but the one signed in. Default: every
   * TxForm draft.
   */
  namespace?: string | ((namespace: string) => boolean)
  /** The store to clear. Default: `local`, `session` and `memory`. */
  storage?: FormDraftStorage
}

export interface FormAutosaveOptions {
  /** How long editing pauses before the changes are saved, in milliseconds. Default `1000`. */
  delay?: number
}

export interface FormProps {
  /** One id, used for the `<form>` element and as the prefix of every field id (`<id>-<prop>`). */
  id?: string
  model?: FormValues
  rules?: FormRules
  /** A Standard Schema v1 validator (Zod, Valibot, ArkType…) checked against the whole model. */
  schema?: FormStandardSchema
  /** Defaults to `auto`, or to what `labelPosition` asks for. */
  layout?: FormLayout
  labelPosition?: FormLabelPosition
  /** Label alignment in the side column. Defaults to `end`, or `start` with `labelPosition="left"`. */
  labelAlign?: FormLabelAlign
  /** Widest the side label column may grow; it stays narrower when every label is. */
  labelWidth?: string | number
  requiredMark?: FormRequiredMark
  validateOn?: FormValidateOn
  messages?: Partial<FormMessages>
  /** Passed to the controls inside that have sizes. */
  size?: FormSize
  /** Disables every control inside that reads the form. */
  disabled?: boolean
  /**
   * Shows the values as a record to read: every control inside that reads
   * the form can be focused and copied but not changed, and no field is
   * marked required. Submitting still works.
   */
  readonly?: boolean
  reconcile?: FormReconcile
  /**
   * Keeps what the user typed across reloads, under the form's `id`. `true`
   * takes the defaults. Turn it on once the record has loaded —
   * `:persist="loaded && { recordId }"` — so the draft is laid over the saved
   * values rather than empty ones.
   */
  persist?: boolean | FormPersistOptions
  /**
   * Asked before leaving with changes no draft holds. Defaults to the host's,
   * then `window.confirm`. `false` never asks: a filter has nothing to lose.
   */
  leaveConfirm?: FormLeaveConfirm | false
  /**
   * Called with a copy of the values once every check passes. A returned
   * promise is awaited, and while it runs `submitting` is true. Resolving
   * makes the submitted values the baseline; resolving `false`, rejecting, or
   * calling `setErrors()` / `setRootError()` on the way counts as a failure.
   */
  onSubmit?: (values: FormValues, event?: Event) => unknown
  /**
   * Saves through `onSubmit` once editing pauses, as a settings page does,
   * instead of on a submit button. Only the changed fields are checked; one
   * with an error stays unsaved until it is fixed, and the rest are saved
   * without it. `true` waits a second.
   */
  autosave?: boolean | FormAutosaveOptions
}

export interface FormEmits {
  (e: 'validate', valid: boolean): void
  /** A submit or an autosave went through: every check passed, and `onSubmit`, when given, succeeded. */
  (e: 'submit-success', values: FormValues): void
  /** A draft could not be read or written. Writes fall back to memory until one succeeds; this fires once per run of failures. */
  (e: 'persist-error', error: unknown): void
}

export interface FormSetErrorsOptions {
  source?: FormErrorSource
}

export interface FormItemProps {
  label?: string
  /** Path into the model: `name`, `meta.homepage`, `links[0].url`. */
  prop?: string
  rules?: FormRule | FormRule[]
  required?: boolean
  /** Helper text under the control. An error or warning takes its place while it shows. */
  help?: string
  width?: FormItemWidth
  showMessage?: boolean
  inline?: boolean
  /** `false` keeps the field out of the form's draft, as a secret would be. */
  persist?: boolean
}

export interface FormItemEmits {
  (e: 'validate', valid: boolean): void
}

export interface FormRowProps {
  /** Names the row as a group. In side layout it sits in the label column. */
  label?: string
  /** Lets each item shrink to 110px instead of 220px before the row wraps. */
  condensed?: boolean
}

export interface FormErrorSummaryProps {
  /** Defaults to `messages.summaryTitle`. */
  title?: string
}

export interface TxFormHost {
  /** Built-in text in the host's language. A ref or getter follows locale switches. */
  messages?: MaybeRefOrGetter<Partial<FormMessages> | undefined>
  /**
   * Whose drafts these are: `user:42`. A ref or getter follows sign-in changes.
   * `null` while that is not known yet, as before the session has loaded: the
   * forms keep no draft until it is.
   */
  namespace?: MaybeRefOrGetter<string | null | undefined>
  /** Where drafts go when `persist.storage` does not say. */
  storage?: FormDraftStorage
  /** Asks before leaving, for every form below that has no `leaveConfirm` of its own. */
  leaveConfirm?: FormLeaveConfirm
}
