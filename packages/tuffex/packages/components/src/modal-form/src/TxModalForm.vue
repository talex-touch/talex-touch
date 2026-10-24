<script setup lang="ts">
import type { FormValues } from '../../form/src/types'
import type { ModalFormEmits, ModalFormProps } from './types'
import { computed } from 'vue'
import TxButton from '../../button/src/button.vue'
import TxForm from '../../form/src/TxForm.vue'
import { useOverlayForm } from '../../form/src/use-overlay-form'
import TxModal from '../../modal/src/TxModal.vue'

defineOptions({ name: 'TxModalForm' })

const props = withDefaults(defineProps<ModalFormProps>(), {
  title: '',
  width: '480px',
  submitText: 'Save',
  cancelText: 'Cancel',
  disabled: false,
  readonly: false,
  // Its type includes `false`, so without a default Vue reads a form that
  // leaves it out as `false`: never ask.
  leaveConfirm: undefined,
})

const emit = defineEmits<ModalFormEmits>()

const { formRef, model, formId, submitting, mayLeave, cancel } = useOverlayForm({
  open: () => props.modelValue,
  initialValues: () => props.initialValues,
  close: () => emit('update:modelValue', false),
})

const formProps = computed(() => {
  const { modelValue, title, width, initialValues, submitText, cancelText, modalProps, leaveConfirm, ...form } = props
  return form
})

function onSubmitSuccess(values: FormValues) {
  emit('submit-success', values)
  emit('update:modelValue', false)
}

defineExpose({
  /** The form inside while the dialog is open, with every `TxForm` method; `null` while it is closed. */
  form: formRef,
  /** Closes as Cancel does: the form first asks about changes it would lose. */
  cancel,
})
</script>

<template>
  <TxModal
    v-bind="modalProps"
    :model-value="modelValue"
    :title="title"
    :width="width"
    :before-close="mayLeave"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <TxForm
      ref="formRef"
      v-bind="formProps"
      :model="model"
      :leave-confirm="modelValue ? leaveConfirm : false"
      @validate="emit('validate', $event)"
      @submit-success="onSubmitSuccess"
      @persist-error="emit('persist-error', $event)"
    >
      <template #default="state">
        <slot v-bind="state" :model="model" />
      </template>
    </TxForm>
    <template #footer>
      <slot name="footer" :form-id="formId" :submitting="submitting" :cancel="cancel">
        <TxButton :disabled="submitting" @click="cancel">
          {{ cancelText }}
        </TxButton>
        <TxButton variant="primary" native-type="submit" :form="formId" :loading="submitting">
          {{ submitText }}
        </TxButton>
      </slot>
    </template>
  </TxModal>
</template>
