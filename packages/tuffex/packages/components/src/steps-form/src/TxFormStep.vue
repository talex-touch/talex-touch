<script setup lang="ts">
import type { FormStepProps } from './types'
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { TX_STEPS_FORM_KEY } from './types'

defineOptions({ name: 'TxFormStep' })

const props = defineProps<FormStepProps>()

const panel = ref<HTMLElement | null>(null)
const stepsForm = inject(TX_STEPS_FORM_KEY, null)
if (!stepsForm)
  console.warn('[TxFormStep] A step is shown only inside a TxStepsForm.')

// Every step stays mounted and only the current one is shown, so the fields
// of the others are still the form's: the last submit checks them all.
const handle = stepsForm?.register({
  title: () => props.title,
  description: () => props.description,
  panel: () => panel.value,
})
const active = computed(() => handle?.active.value ?? false)

onMounted(() => stepsForm?.arrange())
onBeforeUnmount(() => handle?.dispose())
</script>

<template>
  <div v-show="active" ref="panel" class="tx-form-step" role="group" :aria-label="title" tabindex="-1">
    <slot />
  </div>
</template>

<style scoped lang="scss">
// One row of the form's grid, passing its columns through, so the items
// inside line up with a side label column as if they sat in the form itself.
.tx-form-step {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  row-gap: var(--tx-form-gap, 20px);
  min-width: 0;

  // Focus lands here only so the step is read out by name.
  &:focus {
    outline: none;
  }
}
</style>
