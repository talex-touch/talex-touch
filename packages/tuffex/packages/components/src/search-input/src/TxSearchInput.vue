<script setup lang="ts">
import type { SearchInputEmits, SearchInputProps } from './types'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import TuffInput from '../../input/src/TxInput.vue'

defineOptions({ name: 'TxSearchInput' })

const props = withDefaults(defineProps<SearchInputProps>(), {
  modelValue: '',
  placeholder: 'Search',
  disabled: false,
  clearable: true,
  remote: false,
  searchDebounce: 200,
})

const emit = defineEmits<SearchInputEmits>()

const inputRef = ref<InstanceType<typeof TuffInput> | null>(null)

const value = computed({
  get: () => props.modelValue ?? '',
  set: (v: string) => {
    emit('update:modelValue', v)
    emit('input', v)
  },
})

const searchTimer = ref<ReturnType<typeof setTimeout> | null>(null)

function emitRemoteSearch(v: string) {
  if (!props.remote)
    return
  if (props.disabled)
    return
  emit('search', v)
}

function onEnter() {
  emit('search', value.value)
}

watch(
  value,
  (v) => {
    if (!props.remote)
      return
    if (searchTimer.value) {
      clearTimeout(searchTimer.value)
      searchTimer.value = null
    }
    const delay = Math.max(0, props.searchDebounce ?? 0)
    searchTimer.value = setTimeout(() => {
      searchTimer.value = null
      emitRemoteSearch(v)
    }, delay)
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  if (searchTimer.value) {
    clearTimeout(searchTimer.value)
    searchTimer.value = null
  }
})

defineExpose({
  focus: () => inputRef.value?.focus(),
  blur: () => inputRef.value?.blur(),
  clear: () => inputRef.value?.clear(),
  setValue: (v: string) => inputRef.value?.setValue(v),
  // TxSearchInput's own modelValue is typed `string`, so the inner TuffInput only
  // ever holds a string here. String() narrows TuffInput's wider `string | number`
  // getValue return to match our documented `() => string` contract; it is a no-op
  // on every real path, not a mask over a runtime number.
  getValue: (): string => String(inputRef.value?.getValue() ?? ''),
})
</script>

<template>
  <TuffInput
    ref="inputRef"
    v-model="value"
    class="tx-search-input"
    :disabled="disabled"
    :placeholder="placeholder"
    :clearable="clearable"
    @keydown.enter="onEnter"
    @focus="(e) => emit('focus', e)"
    @blur="(e) => emit('blur', e)"
    @clear="() => emit('clear')"
  >
    <template #prefix>
      <span class="tx-search-input__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16">
          <path
            fill="currentColor"
            d="M10 2a8 8 0 105.293 14.293l4.207 4.207 1.414-1.414-4.207-4.207A8 8 0 0010 2zm0 2a6 6 0 110 12 6 6 0 010-12z"
          />
        </svg>
      </span>
    </template>
  </TuffInput>
</template>

<style lang="scss" scoped>
@use '../../../style/mixins.scss' as *;

// One focus indicator, on the field's rounded box. Under high contrast the
// global `*:focus-visible` rule (style/index.scss) also gives the inner
// `<input>` its focus shadow, a rectangle inside the frame TxInput draws on
// `:focus-within`; and that frame's own ring (`--tx-color-primary-light-9`) is
// nearly invisible on the high-contrast page. Move the high-contrast ring onto
// the wrapper and take it off the input. `is-focused` is TxInput's flag for its
// own input, so a focused clear button keeps its own ring and adds none here.
.tx-search-input.is-focused:not(.is-disabled) {
  @include tx-when-high-contrast {
    outline: 2px solid var(--tx-focus-ring-color, var(--tx-color-primary, #409eff));
    outline-offset: 0;
    box-shadow: var(--tx-focus-ring-shadow);
  }
}

.tx-search-input :deep(.tx-input__inner:focus-visible) {
  @include tx-when-high-contrast {
    outline: none;
    box-shadow: none;
  }
}

.tx-search-input__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 6px;
  color: var(--tx-text-color-secondary, #909399);
}
</style>
