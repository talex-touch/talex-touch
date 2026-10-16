<script lang="ts" setup>
import TxModal from './TxModal.vue'

defineOptions({
  name: 'TModal',
})

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    title?: string
    width?: string
    fullscreen?: boolean
    closeLabel?: string
  }>(),
  {
    title: '',
    width: '480px',
    fullscreen: false,
    closeLabel: 'Close',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'close': []
}>()
</script>

<template>
  <TxModal
    v-bind="$attrs"
    :model-value="props.modelValue"
    :title="props.title"
    :width="props.width"
    :fullscreen="props.fullscreen"
    :close-label="props.closeLabel"
    @update:model-value="v => emit('update:modelValue', v)"
    @close="() => emit('close')"
  >
    <template v-if="$slots.header" #header>
      <slot name="header" />
    </template>

    <slot />

    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </TxModal>
</template>
