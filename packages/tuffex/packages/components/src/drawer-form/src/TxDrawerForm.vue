<script setup lang="ts">
import type { FormValues } from '../../form/src/types'
import type { DrawerFormEmits, DrawerFormProps } from './types'
import { computed } from 'vue'
import TxButton from '../../button/src/button.vue'
import TxDrawer from '../../drawer/src/TxDrawer.vue'
import TxForm from '../../form/src/TxForm.vue'
import { useOverlayForm } from '../../form/src/use-overlay-form'

defineOptions({ name: 'TxDrawerForm' })

const props = withDefaults(defineProps<DrawerFormProps>(), {
  // Without one, TxDrawer would show its own English 'Drawer'.
  title: '',
  submitText: 'Save',
  cancelText: 'Cancel',
  disabled: false,
  readonly: false,
  // Its type includes `false`, so without a default Vue reads a form that
  // leaves it out as `false`: never ask.
  leaveConfirm: undefined,
})

const emit = defineEmits<DrawerFormEmits>()

const { formRef, model, formId, submitting, mayLeave, cancel } = useOverlayForm({
  open: () => props.visible,
  initialValues: () => props.initialValues,
  close: () => emit('update:visible', false),
})

const formProps = computed(() => {
  const { visible, title, initialValues, submitText, cancelText, drawerProps, leaveConfirm, ...form } = props
  return form
})

function onSubmitSuccess(values: FormValues) {
  emit('submit-success', values)
  emit('update:visible', false)
}

defineExpose({
  /** The form inside, with every `TxForm` method; `null` until the drawer first opens. */
  form: formRef,
  /** Closes as Cancel does: the form first asks about changes it would lose. */
  cancel,
})
</script>

<template>
  <TxDrawer
    v-bind="drawerProps"
    :visible="visible"
    :title="title"
    :before-close="mayLeave"
    @update:visible="emit('update:visible', $event)"
  >
    <!-- The drawer keeps its content after the first open, so the form stays
         too. Closed, it has nothing left to lose: the user has been asked, or
         the parent closed it. -->
    <TxForm
      ref="formRef"
      v-bind="formProps"
      :model="model"
      :leave-confirm="visible ? leaveConfirm : false"
      @validate="emit('validate', $event)"
      @submit-success="onSubmitSuccess"
      @persist-error="emit('persist-error', $event)"
    >
      <template #default="state">
        <slot v-bind="state" :model="model" />
      </template>
    </TxForm>
    <template #footer>
      <div class="tx-drawer-form__actions">
        <slot name="footer" :form-id="formId" :submitting="submitting" :cancel="cancel">
          <TxButton :disabled="submitting" @click="cancel">
            {{ cancelText }}
          </TxButton>
          <TxButton variant="primary" native-type="submit" :form="formId" :loading="submitting">
            {{ submitText }}
          </TxButton>
        </slot>
      </div>
    </template>
  </TxDrawer>
</template>

<style scoped lang="scss">
.tx-drawer-form__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}
</style>
