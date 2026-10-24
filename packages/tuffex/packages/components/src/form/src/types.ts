import type { MaybeRefOrGetter } from 'vue'

export type { FormControlKind, TxFormField } from '../../../../utils/form-field'

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

/** Where incoming values came from. `baseline` is `setBaseline()`: data the host fetched. */
export type FormReconcileSource = 'baseline'

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
  /** TxForm's default: `incoming`, with every field in `dirtyPaths` kept as the user left it. */
  merged: FormValues
}

/**
 * Decides what the model holds when values arrive for fields the user has
 * changed. Return the values to write, or nothing to take `merged`. Each
 * argument is a copy, free to change. It is not called when nothing conflicts.
 */
export type FormReconcile = (context: FormReconcileContext) => FormValues | void

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
  reconcile?: FormReconcile
  /**
   * Called with a copy of the values once every check passes. A returned
   * promise is awaited, and while it runs `submitting` is true. Resolving
   * makes the submitted values the baseline; resolving `false`, rejecting, or
   * calling `setErrors()` / `setRootError()` on the way counts as a failure.
   */
  onSubmit?: (values: FormValues, event?: Event) => unknown
}

export interface FormEmits {
  (e: 'validate', valid: boolean): void
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
}
