<script setup lang="ts">
import type { FormErrorSummaryProps } from './types'
import { computed, inject, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { TX_FORM_CONTEXT_KEY } from './context'

defineOptions({ name: 'TxFormErrorSummary' })

const props = defineProps<FormErrorSummaryProps>()

const form = inject(TX_FORM_CONTEXT_KEY, null)
if (!form)
  console.warn('[TxFormErrorSummary] Place it inside a TxForm; outside one it has nothing to list.')

const rootRef = ref<HTMLElement | null>(null)
const titleId = useId()
const title = computed(() => props.title || form?.messages.value.summaryTitle)
const visible = computed(() => !!form?.showSummary.value)

// While a summary is mounted, a failed submit focuses it instead of the
// first field, and the form leaves its own root error to it.
let detach: (() => void) | undefined
onMounted(() => {
  detach = form?.attachSummary(() => (visible.value ? rootRef.value : null))
})
onBeforeUnmount(() => detach?.())
</script>

<template>
  <div
    v-if="form && visible"
    ref="rootRef"
    class="tx-form-error-summary"
    tabindex="-1"
    :aria-labelledby="titleId"
  >
    <div role="alert">
      <h2 :id="titleId" class="tx-form-error-summary__title">
        {{ title }}
      </h2>
      <p v-if="form.rootError.value" class="tx-form-error-summary__root">
        {{ form.rootError.value }}
      </p>
      <ul v-if="form.summary.value.length" class="tx-form-error-summary__list">
        <li v-for="entry in form.summary.value" :key="entry.key">
          <a
            v-if="entry.target"
            class="tx-form-error-summary__link"
            :href="`#${entry.target}`"
            @click.prevent="entry.focus?.()"
          >{{ entry.message }}</a>
          <span v-else>{{ entry.message }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped lang="scss">
.tx-form-error-summary {
  padding: 12px 16px;
  border: 1px solid color-mix(in srgb, var(--tx-color-danger, #f56c6c) 45%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--tx-color-danger, #f56c6c) 6%, transparent);
  color: var(--tx-text-color-primary, #303133);

  &:focus-visible {
    outline: 2px solid var(--tx-color-danger, #f56c6c);
    outline-offset: 2px;
  }
}

.tx-form-error-summary__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
}

.tx-form-error-summary__root {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 20px;
}

.tx-form-error-summary__list {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 20px;
}

.tx-form-error-summary__link {
  color: var(--tx-color-danger, #f56c6c);
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
