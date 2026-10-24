<script setup lang="ts">
/**
 * TxBlockSlot Component
 *
 * A block container with icon, title, description, and a slot for custom content.
 * Ideal for settings rows with custom controls.
 */
import type { TxIconSource } from '../../icon'
import type { BlockSlotEmits, BlockSlotProps } from './types'
import { computed, getCurrentInstance, ref } from 'vue'
import { useFormItem } from '../../form/src/use-form-item'
import { TuffIcon } from '../../icon'

defineOptions({
  name: 'TxBlockSlot',
})

const props = withDefaults(defineProps<BlockSlotProps>(), {
  title: '',
  description: '',
  iconSize: 20,
  disabled: false,
  active: false,
  required: false,
})

const emit = defineEmits<BlockSlotEmits>()

type IconValue = TxIconSource | string | null | undefined

const rootRef = ref<HTMLElement | null>(null)

// With `prop`, the block is a form item: the title names the control and a
// message takes the description's place while it shows.
const {
  form,
  labelId,
  messageId,
  note,
  notePrefix,
  invalid,
  markRequired,
  onFocusout,
} = useFormItem({
  prop: () => props.prop,
  label: () => props.title,
  rules: () => props.rules,
  required: () => props.required,
  help: () => props.description,
  showMessage: () => true,
  root: rootRef,
  labelledBy: 'aria',
  offersField: () => !!props.prop,
})

const isDisabled = computed(() => props.disabled || !!form?.disabled.value)
/** A message, not the description. */
const fieldMessage = computed(() => (note.value && note.value.kind !== 'help' ? note.value : null))

function handleClick(event: MouseEvent): void {
  if (isDisabled.value)
    return
  emit('click', event)
}

// The row is keyboard-interactive whenever a click listener is attached, so its
// documented row/guidance action is reachable by keyboard, not only by mouse.
// `click` is a declared emit, so the listener is read from the component vnode.
const instance = getCurrentInstance()
const interactive = computed(() => !!instance?.vnode.props?.onClick)

function handleKeydown(event: KeyboardEvent): void {
  // Only the row itself activates; ignore Enter/Space bubbling up from controls
  // in the slot so their own keyboard handling is preserved.
  if (event.target !== event.currentTarget)
    return
  if (isDisabled.value || !interactive.value)
    return
  if (event.key !== 'Enter' && event.key !== ' ')
    return
  event.preventDefault()
  emit('click', event as unknown as MouseEvent)
}

function toIcon(icon?: IconValue): TxIconSource | null {
  if (!icon)
    return null
  if (typeof icon === 'string')
    return { type: 'class', value: icon }
  return icon
}

const defaultIcon = computed(() => {
  return toIcon(props.defaultIcon)
})

const activeIcon = computed(() => {
  if (props.activeIcon !== undefined)
    return toIcon(props.activeIcon)
  return null
})

const currentIcon = computed(() => {
  if (props.active)
    return activeIcon.value ?? defaultIcon.value
  return defaultIcon.value ?? activeIcon.value
})
</script>

<template>
  <div
    ref="rootRef"
    class="tx-block-slot fake-background index-fix"
    :class="{ 'tx-block-slot--disabled': isDisabled, 'disabled': isDisabled, 'is-error': invalid }"
    :role="interactive ? 'button' : undefined"
    :tabindex="interactive && !isDisabled ? 0 : undefined"
    :aria-disabled="interactive && isDisabled ? true : undefined"
    @click="handleClick"
    @keydown="handleKeydown"
    @focusout="onFocusout"
  >
    <div class="tx-block-slot__content">
      <slot name="icon" :active="active">
        <TuffIcon v-if="currentIcon" :icon="currentIcon" :size="iconSize" />
      </slot>
      <div class="tx-block-slot__label">
        <template v-if="$slots.label">
          <slot name="label" />
          <div v-if="$slots.tags" class="tx-block-slot__tags tx-block-slot__tags--after">
            <slot name="tags" />
          </div>
          <p
            v-if="fieldMessage"
            :id="messageId"
            class="tx-block-slot__description"
            :class="`tx-block-slot__description--${fieldMessage.kind}`"
          >
            <span class="tx-block-slot__sr-only">{{ notePrefix }}</span>{{ fieldMessage.text }}
          </p>
        </template>
        <template v-else>
          <div class="tx-block-slot__title-row">
            <h5 :id="prop && title ? labelId : undefined" class="tx-block-slot__title">
              {{ title }}<span v-if="markRequired" class="tx-block-slot__required" aria-hidden="true">*</span>
            </h5>
            <div v-if="$slots.tags" class="tx-block-slot__tags">
              <slot name="tags" />
            </div>
          </div>
          <p
            :id="prop && note ? messageId : undefined"
            class="tx-block-slot__description"
            :class="fieldMessage ? `tx-block-slot__description--${fieldMessage.kind}` : undefined"
          >
            <span v-if="notePrefix" class="tx-block-slot__sr-only">{{ notePrefix }}</span>{{ note?.text ?? description }}
          </p>
        </template>
      </div>
    </div>
    <div class="tx-block-slot__slot">
      <slot :active="active" />
    </div>
  </div>
</template>

<style lang="scss">
.tx-block-slot {
  position: relative;
  display: flex;
  gap: 16px;
  justify-content: flex-start;
  align-items: center;
  padding: 4px 16px;
  width: 100%;
  height: 56px;
  user-select: none;
  box-sizing: border-box;
  --fake-color: var(--tx-fill-color-dark, #e4e7ed);
  --fake-radius: 12px;
  --fake-opacity: 0.5;
  transition:
    transform 0.2s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.25s ease;

  // `--fake-radius` is for this row's own fake background (and the 0 a group
  // gives it). Custom properties inherit, so it stops at the row's wrappers: a
  // control in the slot — a TxSelect's input, say — keeps its own corners
  // instead of drawing its fake background square inside a group.
  > .tx-block-slot__content,
  > .tx-block-slot__slot {
    --fake-radius: initial;
  }

  &.disabled,
  &--disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .tx-block-slot__content {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
    height: 100%;
    box-sizing: border-box;
    cursor: pointer;

    > * {
      margin-right: 16px;
      font-size: 24px;
    }

    > .tx-block-slot__label {
      flex: 1;
      min-width: 0;
    }

    .tx-block-slot__title {
      margin: 0;
      font-size: 14px;
      font-weight: var(--tx-font-weight-medium, 500);
      color: var(--tx-text-color-primary, #303133);
    }

    .tx-block-slot__description {
      margin: 4px 0 0;
      font-size: 12px;
      font-weight: 400;
      line-height: 16px;
      opacity: 0.5;
      color: var(--tx-text-color-secondary, #909399);

      &--error {
        opacity: 1;
        color: var(--tx-color-danger, #f56c6c);
      }

      &--warning {
        opacity: 1;
        color: var(--tx-color-warning, #e6a23c);
      }
    }

    .tx-block-slot__required {
      margin-left: 4px;
      color: var(--tx-color-danger, #f56c6c);
    }
  }

  .tx-block-slot__sr-only {
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

  .tx-block-slot__title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    width: 100%;
  }

  .tx-block-slot__tags {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    flex: 0 0 auto;
    max-width: 100%;
    align-self: flex-start;
    height: auto;

    &--after {
      margin-top: 4px;
    }
  }

  .tx-block-slot__slot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    margin-left: auto;
    flex-shrink: 0;
    gap: 8px;
  }

  &:hover {
    --fake-color: var(--tx-fill-color, #f0f2f5);
  }

  &:active:not(.disabled):not(.tx-block-slot--disabled) {
    transform: scale(0.985);
  }

  &:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--tx-color-primary, #409eff) 60%, transparent);
    outline-offset: -2px;
  }
}

.touch-blur .tx-block-slot {
  --fake-color: var(--tx-fill-color, #f0f2f5);

  &:hover {
    --fake-color: var(--tx-fill-color-dark, #e4e7ed);
  }
}
</style>
