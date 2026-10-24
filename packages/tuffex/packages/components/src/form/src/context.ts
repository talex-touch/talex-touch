import type { App, ComputedRef, InjectionKey, Ref } from 'vue'
import type { FormControlSize } from '../../../../utils/form-field'
import type {
  FormLabelAlign,
  FormLayout,
  FormMessages,
  FormRequiredMark,
  FormRule,
  TxFormHost,
} from './types'
import { provide } from 'vue'

export type { FormControlSize, FormFieldSource } from '../../../../utils/form-field'
export { TX_FORM_FIELD_KEY, useTxFormField } from '../../../../utils/form-field'

export interface FieldMessage {
  kind: 'error' | 'warning' | 'validating'
  text: string
}

/** What an item tells its form about the path it shows. */
export interface FormFieldRegistration {
  path: string
  /** Names the field inside built-in messages. */
  label: () => string
  /** The item's own rules; `undefined` falls back to the form's `rules[path]`. */
  rules: () => FormRule | FormRule[] | undefined
  required: () => boolean
  root: () => HTMLElement | null
  controlId: () => string
  labelId: () => string | undefined
  /** A check finished: focus left the field changed, or the form validated it. */
  validated?: (valid: boolean) => void
  /** The value stays out of drafts: the item opted out, or a control inside holds a secret. */
  sensitive?: () => boolean
}

export interface FormFieldHandle {
  /** The message the item shows, already timed: `null` until the field may speak. */
  message: ComputedRef<FieldMessage | null>
  required: ComputedRef<boolean>
  /** Focus left the item. */
  commit: () => void
  dispose: () => void
}

export interface FormSummaryEntry {
  key: string
  message: string
  /** Id of the control the entry links to; absent for errors no item shows. */
  target?: string
  focus?: () => void
}

export interface FormContext {
  id: ComputedRef<string>
  layout: ComputedRef<FormLayout>
  labelAlign: ComputedRef<FormLabelAlign>
  requiredMark: ComputedRef<FormRequiredMark>
  messages: ComputedRef<FormMessages>
  size: ComputedRef<FormControlSize>
  disabled: ComputedRef<boolean>
  register: (registration: FormFieldRegistration) => FormFieldHandle
  rootError: Ref<string>
  summary: ComputedRef<FormSummaryEntry[]>
  showSummary: ComputedRef<boolean>
  /** A mounted `TxFormErrorSummary`: it takes focus when submit fails. */
  attachSummary: (element: () => HTMLElement | null) => () => void
}

export const TX_FORM_CONTEXT_KEY: InjectionKey<FormContext> = Symbol('TxFormContext')

/** Items inside a `TxFormRow` stack their labels, whatever the form's layout. */
export const TX_FORM_ROW_KEY: InjectionKey<boolean> = Symbol('TxFormRow')

export const TX_FORM_HOST_KEY: InjectionKey<TxFormHost> = Symbol('TxFormHost')

/**
 * Hands every form below — or in the whole app, given `app` — the host's
 * language for built-in messages. Call it in a component's `setup`.
 */
export function provideTxFormHost(host: TxFormHost, app?: App): void {
  if (app)
    app.provide(TX_FORM_HOST_KEY, host)
  else
    provide(TX_FORM_HOST_KEY, host)
}
