<script setup lang="ts">
import type { FormEmits, FormProps } from './types'
import { computed, provide } from 'vue'
import { TX_FORM_CONTEXT_KEY, TX_FORM_FIELD_KEY } from './context'
import { useFormStore } from './use-form'

defineOptions({ name: 'TxForm' })

const props = withDefaults(defineProps<FormProps>(), {
  requiredMark: 'asterisk',
  validateOn: 'blur',
  size: 'medium',
  disabled: false,
})

const emit = defineEmits<FormEmits>()

const store = useFormStore(props, emit)
const { formId, layout, labelAlign, announcement, summaryAttached, rootError } = store

provide(TX_FORM_CONTEXT_KEY, store.context)
// A control placed in the form but outside every item is not a field, yet it
// still takes the form's `disabled` and `size`.
provide(TX_FORM_FIELD_KEY, {
  controlId: undefined,
  labelId: undefined,
  messageId: undefined,
  label: '',
  labelledBy: 'for',
  invalid: false,
  required: false,
  get disabled() {
    return store.context.disabled.value
  },
  get size() {
    return store.context.size.value
  },
  claim: () => false,
  adopt: () => {},
  release: () => {},
})

const formStyle = computed(() => {
  const width = props.labelWidth
  if (width === undefined || width === '')
    return undefined
  return { '--tx-form-label-max': typeof width === 'number' ? `${width}px` : width }
})

const slotProps = computed(() => ({
  dirty: store.dirty.value,
  valid: store.valid.value,
  submitting: store.submitting.value,
  submitted: store.submitted.value,
  errors: store.errors.value,
  rootError: store.rootError.value,
}))

function onSubmit(event: Event) {
  void store.submit(event)
}

defineExpose({
  dirty: store.dirty,
  valid: store.valid,
  submitting: store.submitting,
  submitted: store.submitted,
  errors: store.errors,
  rootError: store.rootError,
  validate: store.validate,
  validateField: store.validateField,
  submit: store.submit,
  reset: store.reset,
  /** Older name of `reset()`. */
  resetFields: store.reset,
  setBaseline: store.setBaseline,
  setErrors: store.setErrors,
  setRootError: store.setRootError,
  clearValidate: store.clearValidate,
})
</script>

<template>
  <form
    :id="formId"
    class="tx-form"
    :class="[`tx-form--${layout}`, `tx-form--label-${labelAlign}`]"
    :style="formStyle"
    novalidate
    @submit.prevent="onSubmit"
    @reset.prevent="store.reset()"
  >
    <div class="tx-form__body">
      <slot v-bind="slotProps" />
    </div>
    <p v-if="rootError && !summaryAttached" class="tx-form__root-error" role="alert">
      {{ rootError }}
    </p>
    <div class="tx-form__status" role="status" aria-live="polite">
      {{ announcement }}
    </div>
  </form>
</template>

<style scoped lang="scss">
.tx-form {
  // The label column is as wide as the longest label, up to `labelWidth`.
  --tx-form-side-cols: [label] fit-content(min(40%, var(--tx-form-label-max, 16em))) [field] minmax(0, 1fr);

  min-width: 0;
}

// Only `auto` measures itself: a size container no longer takes its width
// from its content, so a form in a shrink-to-fit popover would collapse.
.tx-form--auto {
  container: tx-form / inline-size;
}

.tx-form__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  row-gap: var(--tx-form-gap, 20px);
}

.tx-form__body > :deep(*) {
  grid-column: 1 / -1;
}

.tx-form--side .tx-form__body {
  grid-template-columns: var(--tx-form-side-cols);
  column-gap: 12px;
}

// 520px: a 16em label column, the gap, and about 280px for the field. A
// container query cannot read a custom property, so the number lives here.
@container tx-form (inline-size >= 520px) {
  .tx-form--auto .tx-form__body {
    grid-template-columns: var(--tx-form-side-cols);
    column-gap: 12px;
  }
}

.tx-form--inline .tx-form__body {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px 16px;
}

.tx-form__root-error {
  margin: 12px 0 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--tx-color-danger, #f56c6c);
}

.tx-form__status {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
