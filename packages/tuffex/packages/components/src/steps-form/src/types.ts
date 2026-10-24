import type { ComputedRef, InjectionKey } from 'vue'
import type { FormProps, FormValues } from '../../form/src/types'

/**
 * Props for TxStepsForm. Everything a `TxForm` takes except `autosave`: a
 * form in steps is submitted at the end.
 *
 * @public
 */
export interface StepsFormProps extends Omit<FormProps, 'autosave'> {
  /** The step shown, counted from 0. Use with `v-model:active`, or leave it to the form. */
  active?: number
  /** @default 'Back' */
  prevText?: string
  /** @default 'Next' */
  nextText?: string
  /** @default 'Submit' */
  submitText?: string
}

/** @public */
export interface StepsFormEmits {
  (e: 'update:active', step: number): void
  (e: 'validate', valid: boolean): void
  /** The last step was submitted and went through. */
  (e: 'submit-success', values: FormValues): void
  (e: 'persist-error', error: unknown): void
}

/** @public */
export interface FormStepProps {
  /** Names the step in the header, and the group its fields are in. */
  title: string
  description?: string
}

/** What a `TxFormStep` tells the steps form about itself. */
export interface StepsFormStep {
  key: number
  title: () => string
  description: () => string | undefined
  panel: () => HTMLElement | null
}

export interface StepsFormStepHandle {
  active: ComputedRef<boolean>
  dispose: () => void
}

export interface StepsFormContext {
  register: (step: Omit<StepsFormStep, 'key'>) => StepsFormStepHandle
  /** A step has mounted: the steps are put back in the order they appear. */
  arrange: () => void
}

export const TX_STEPS_FORM_KEY: InjectionKey<StepsFormContext> = Symbol('TxStepsForm')
