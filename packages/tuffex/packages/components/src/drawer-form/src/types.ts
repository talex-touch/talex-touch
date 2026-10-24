import type { FormProps, FormValues } from '../../form/src/types'

/**
 * Props for TxDrawerForm. Everything a `TxForm` takes, except `model`, which
 * the drawer builds from `initialValues` each time it opens, and `autosave`:
 * a drawer form saves when it is submitted.
 *
 * @public
 */
export interface DrawerFormProps extends Omit<FormProps, 'model' | 'autosave'> {
  /** Shows the drawer. Use with `v-model:visible`. */
  visible: boolean
  title?: string
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
  /**
   * Any other `TxDrawer` prop, such as `size` or `direction`. `size` goes
   * here because the form's own `size` sizes its controls. Closing is asked
   * of the form, not of `beforeClose`.
   */
  drawerProps?: Record<string, unknown>
}

/** @public */
export interface DrawerFormEmits {
  (e: 'update:visible', value: boolean): void
  (e: 'validate', valid: boolean): void
  /** The submit went through; the drawer closes. */
  (e: 'submit-success', values: FormValues): void
  (e: 'persist-error', error: unknown): void
}
