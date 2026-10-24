import type { FormProps, FormValues } from '../../form/src/types'

/**
 * Props for TxModalForm. Everything a `TxForm` takes, except `model`, which
 * the dialog builds from `initialValues` each time it opens, and `autosave`:
 * a dialog saves when it is submitted.
 *
 * @public
 */
export interface ModalFormProps extends Omit<FormProps, 'model' | 'autosave'> {
  /** Shows the dialog. Use with `v-model`. */
  modelValue: boolean
  title?: string
  /** @default '480px' */
  width?: string
  /**
   * The values the form opens with. Each open edits a copy, so they change
   * only when the parent changes them. A change while open becomes the saved
   * state; fields the user has changed keep their edits.
   */
  initialValues?: FormValues
  /** @default 'Save' */
  submitText?: string
  /** @default 'Cancel' */
  cancelText?: string
  /** Any other `TxModal` prop, such as `surface` or `fullscreen`. Closing is asked of the form, not of `beforeClose`. */
  modalProps?: Record<string, unknown>
}

/** @public */
export interface ModalFormEmits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'validate', valid: boolean): void
  /** The submit went through; the dialog closes. */
  (e: 'submit-success', values: FormValues): void
  (e: 'persist-error', error: unknown): void
}
