<script setup lang="ts">
import type { FormRowProps } from './types'
import { computed, inject, provide, useId } from 'vue'
import { TX_FORM_CONTEXT_KEY, TX_FORM_ROW_KEY } from './context'

defineOptions({ name: 'TxFormRow' })

const props = withDefaults(defineProps<FormRowProps>(), {
  label: '',
  condensed: false,
})

const form = inject(TX_FORM_CONTEXT_KEY, null)
provide(TX_FORM_ROW_KEY, true)

const labelId = useId()
const layout = computed(() => form?.layout.value ?? 'stacked')
const labelAlign = computed(() => form?.labelAlign.value ?? 'end')
</script>

<template>
  <div
    class="tx-form-row"
    :class="[`tx-form-row--${layout}`, `tx-form-row--label-${labelAlign}`, { 'tx-form-row--condensed': condensed }]"
    :role="props.label ? 'group' : undefined"
    :aria-labelledby="props.label ? labelId : undefined"
  >
    <div v-if="props.label" :id="labelId" class="tx-form-row__label">
      {{ props.label }}
    </div>
    <div class="tx-form-row__items">
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
.tx-form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.tx-form-row__label {
  font-size: 13px;
  line-height: 20px;
  color: var(--tx-text-color-regular, #606266);
  overflow-wrap: anywhere;
}

// Each item keeps at least 220px (110px condensed) and the row wraps rather
// than squeeze it further.
.tx-form-row__items {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(var(--tx-form-item-min, 220px), 100%), 1fr));
  gap: 12px 16px;
  min-width: 0;
}

.tx-form-row--condensed {
  --tx-form-item-min: 110px;
}

@mixin side {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: subgrid;
  align-items: start;
  gap: normal;

  .tx-form-row__label {
    grid-column: label;
    padding-block: calc((var(--tx-form-control-height, 32px) - 20px) / 2);
  }

  .tx-form-row__items {
    grid-column: field;
  }

  &.tx-form-row--label-end .tx-form-row__label {
    text-align: end;
  }
}

.tx-form-row--side {
  @include side;
}

@container tx-form (inline-size >= 520px) {
  .tx-form-row--auto {
    @include side;
  }
}

.tx-form-row--inline {
  flex: 1 1 100%;
}
</style>
