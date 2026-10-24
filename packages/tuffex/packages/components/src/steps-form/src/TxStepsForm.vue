<script setup lang="ts">
import type { FormContext } from '../../form/src/context'
import type { StepsFormEmits, StepsFormProps, StepsFormStep } from './types'
import { computed, nextTick, provide, ref, shallowRef, watch } from 'vue'
import TxButton from '../../button/src/button.vue'
import { TX_FORM_SHELL_KEY } from '../../form/src/context'
import TxForm from '../../form/src/TxForm.vue'
import TxStep from '../../steps/src/TxStep.vue'
import TxSteps from '../../steps/src/TxSteps.vue'
import { TX_STEPS_FORM_KEY } from './types'

defineOptions({ name: 'TxStepsForm' })

const props = withDefaults(defineProps<StepsFormProps>(), {
  active: undefined,
  prevText: 'Back',
  nextText: 'Next',
  submitText: 'Submit',
  disabled: false,
  readonly: false,
  // Its type includes `false`, so without a default Vue reads a form that
  // leaves it out as `false`: never ask.
  leaveConfirm: undefined,
})

const emit = defineEmits<StepsFormEmits>()

const formRef = ref<InstanceType<typeof TxForm> | null>(null)
const formContext = shallowRef<FormContext | null>(null)

// Steps register as they set up, which is after this renders: on the server
// the header and the button label are drawn before any step is known, and the
// first render in the browser draws them the same way.
const steps = shallowRef<StepsFormStep[]>([])
let nextKey = 0

const active = ref(props.active ?? 0)
watch(() => props.active, (step) => {
  if (step !== undefined)
    active.value = step
})

const isLast = computed(() => active.value >= steps.value.length - 1)

function go(step: number, moveFocus: boolean): void {
  const next = Math.min(Math.max(step, 0), Math.max(steps.value.length - 1, 0))
  if (next === active.value)
    return
  active.value = next
  emit('update:active', next)
  // The step is read out by its name, and Tab goes on to its first field.
  if (moveFocus)
    void nextTick(() => steps.value[next]?.panel()?.focus())
}

function back(): void {
  go(active.value - 1, true)
}

// A step removed from under the user leaves them on the last one there is.
watch(() => steps.value.length, (count) => {
  if (count && active.value > count - 1)
    go(count - 1, false)
})

provide(TX_STEPS_FORM_KEY, {
  register(step) {
    const entry: StepsFormStep = { ...step, key: nextKey++ }
    steps.value = [...steps.value, entry]
    return {
      active: computed(() => steps.value.indexOf(entry) === active.value),
      dispose() {
        steps.value = steps.value.filter(item => item !== entry)
      },
    }
  },
  arrange() {
    steps.value = [...steps.value].sort((left, right) => {
      const a = left.panel()
      const b = right.panel()
      if (!a || !b)
        return 0
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    })
  },
})

let advancing = false

provide(TX_FORM_SHELL_KEY, {
  connect(context) {
    formContext.value = context
    return () => {
      if (formContext.value === context)
        formContext.value = null
    }
  },
  reveal(element) {
    const index = steps.value.findIndex(step => step.panel()?.contains(element))
    if (index >= 0)
      go(index, false)
  },
  // Every step but the last checks its own fields and moves on; the last
  // submits, and an error in an earlier step brings that step back.
  async beforeSubmit() {
    if (isLast.value)
      return true
    const context = formContext.value
    if (advancing || !context)
      return false
    advancing = true
    try {
      const panel = steps.value[active.value]?.panel()
      if (!panel || await context.validateWithin(panel))
        go(active.value + 1, true)
    }
    finally {
      advancing = false
    }
    return false
  },
  step: {
    read: () => active.value,
    restore: step => go(step, false),
  },
})

const formProps = computed(() => {
  const { active: _active, prevText, nextText, submitText, ...rest } = props
  return rest
})

defineExpose({
  /** The form inside, with every `TxForm` method. */
  form: formRef,
  /** Goes to the step before, as Back does. */
  back,
})
</script>

<template>
  <TxForm
    ref="formRef"
    v-bind="formProps"
    class="tx-steps-form"
    @validate="emit('validate', $event)"
    @submit-success="emit('submit-success', $event)"
    @persist-error="emit('persist-error', $event)"
  >
    <template #default="state">
      <TxSteps class="tx-steps-form__header" :active="active">
        <TxStep
          v-for="(step, index) in steps"
          :key="step.key"
          :step="index"
          :title="step.title()"
          :description="step.description()"
          :clickable="false"
        />
      </TxSteps>
      <slot v-bind="state" :active="active" />
      <div class="tx-steps-form__actions">
        <slot name="actions" :active="active" :last="isLast" :back="back" :submitting="state.submitting">
          <TxButton v-if="active > 0" :disabled="state.submitting" @click="back">
            {{ prevText }}
          </TxButton>
          <TxButton variant="primary" native-type="submit" :loading="state.submitting">
            {{ isLast ? submitText : nextText }}
          </TxButton>
        </slot>
      </div>
    </template>
  </TxForm>
</template>

<style scoped lang="scss">
.tx-steps-form__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}
</style>
