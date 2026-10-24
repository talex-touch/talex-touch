import type { FormContext } from './context'
import type { FormValues } from './types'
import type TxForm from './TxForm.vue'
import { computed, provide, reactive, ref, shallowRef, watch } from 'vue'
import { TX_FORM_SHELL_KEY } from './context'
import { cloneValue } from './path'

interface OverlayFormOptions {
  open: () => boolean
  initialValues: () => FormValues | undefined
  /** Closes the dialog or drawer. */
  close: () => void
}

/**
 * The form inside `TxModalForm` and `TxDrawerForm`. Each open edits a copy of
 * the values it was given, a submit that goes through closes, and closing
 * asks the form first. Call it in `setup`.
 */
export function useOverlayForm(options: OverlayFormOptions) {
  const formRef = ref<InstanceType<typeof TxForm> | null>(null)
  const form = shallowRef<FormContext | null>(null)
  const model = shallowRef<FormValues>(reactive({}))

  provide(TX_FORM_SHELL_KEY, {
    connect(context) {
      form.value = context
      return () => {
        if (form.value === context)
          form.value = null
      }
    },
  })

  // A copy, so closing without saving leaves the values the parent holds as they were.
  watch(options.open, (open) => {
    if (open)
      model.value = reactive(cloneValue(options.initialValues() ?? {}))
  }, { immediate: true })

  // Values arriving while open — a record that was still loading — are the
  // saved state. Fields the user has changed keep their edits.
  watch(options.initialValues, (values) => {
    if (options.open())
      formRef.value?.setBaseline(cloneValue(values ?? {}))
  }, { deep: true })

  /** The buttons sit outside the `<form>` and point at it with `form`. */
  const formId = computed(() => form.value?.id.value)
  const submitting = computed(() => !!formRef.value?.submitting)

  /** A submit still running decides on its own; otherwise the form asks about changes it would lose. */
  async function mayLeave(): Promise<boolean> {
    if (submitting.value)
      return false
    return (await formRef.value?.confirmLeave()) ?? true
  }

  let leaving = false
  async function cancel(): Promise<void> {
    if (leaving)
      return
    leaving = true
    try {
      if (await mayLeave())
        options.close()
    }
    finally {
      leaving = false
    }
  }

  return { formRef, model, formId, submitting, mayLeave, cancel }
}
