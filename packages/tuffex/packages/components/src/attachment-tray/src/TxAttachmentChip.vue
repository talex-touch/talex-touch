<script setup lang="ts">
import type { AttachmentChipProps } from './types'
import { computed } from 'vue'
import { formatSize } from './format-size'

defineOptions({ name: 'TxAttachmentChip' })

const props = withDefaults(defineProps<AttachmentChipProps>(), {
  removable: false,
  removeLabel: 'Remove attachment',
  cancelLabel: 'Cancel upload',
})

const emit = defineEmits<{
  remove: [id: string]
  cancel: [id: string]
  open: [attachment: AttachmentChipProps['attachment']]
}>()

const sizeText = computed(() => {
  if (props.attachment.size === undefined)
    return ''
  return (props.sizeFormatter ?? formatSize)(props.attachment.size)
})

const percent = computed(() => Math.round(Math.min(1, Math.max(0, props.attachment.progress ?? 0)) * 100))

const progressText = computed(() =>
  props.attachment.progress === undefined ? '' : `${percent.value}%`,
)

// One button for both, so focus on it survives an upload finishing in removable mode.
function onAction(): void {
  if (props.attachment.uploading)
    emit('cancel', props.attachment.id)
  else
    emit('remove', props.attachment.id)
}
</script>

<template>
  <span
    class="tx-attachment-chip"
    :class="{ 'is-uploading': attachment.uploading }"
    :data-id="attachment.id"
  >
    <button
      type="button"
      class="tx-attachment-chip__body"
      :title="attachment.name"
      @click="emit('open', attachment)"
    >
      <span class="tx-attachment-chip__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
      </span>
      <span class="tx-attachment-chip__name">{{ attachment.name }}</span>
      <span v-if="attachment.uploading" class="tx-attachment-chip__meta">{{ progressText }}</span>
      <span v-else-if="sizeText" class="tx-attachment-chip__meta">{{ sizeText }}</span>
      <span
        v-if="attachment.uploading"
        class="tx-attachment-chip__progress"
        aria-hidden="true"
        :style="{ backgroundSize: `${percent}% 100%` }"
      />
    </button>

    <button
      v-if="attachment.uploading || removable"
      type="button"
      class="tx-attachment-chip__action"
      :aria-label="attachment.uploading ? cancelLabel : removeLabel"
      @click="onAction"
    >
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  </span>
</template>

<style lang="scss">
.tx-attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 100%;
  border: 1px solid var(--tx-border-color-lighter, #e5e7eb);
  border-radius: 999px;
  background: var(--tx-fill-color-blank, #fff);
  font-size: 12px;
  line-height: 1;

  &.is-uploading {
    border-style: dashed;
  }
}

.tx-attachment-chip__body {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 6px 4px 6px 10px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--tx-text-color-primary, #111827);
  font: inherit;
  cursor: pointer;
}

.tx-attachment-chip__icon {
  display: inline-flex;
  color: var(--tx-text-color-secondary, #6b7280);
}

.tx-attachment-chip__name {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tx-attachment-chip__meta {
  color: var(--tx-text-color-secondary, #6b7280);
  font-variant-numeric: tabular-nums;
}

// Concentric with the pill's round end: 3px clear of it on every side.
.tx-attachment-chip__action {
  display: grid;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-right: 3px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--tx-text-color-secondary, #6b7280);
  cursor: pointer;

  &:hover {
    background: var(--tx-fill-color, #f0f2f5);
    color: var(--tx-color-danger, #f56c6c);
  }
}

:is(.tx-attachment-chip__body, .tx-attachment-chip__action):focus-visible {
  outline: 2px solid var(--tx-color-primary, #409eff);
  outline-offset: -2px;
}

// A hairline under the label, inset from the pill's round ends. The fill is a gradient
// layer whose width the template sets.
.tx-attachment-chip__progress {
  position: absolute;
  inset: auto 4px 2px 10px;
  height: 2px;
  background: linear-gradient(var(--tx-color-primary, #409eff) 0 0) no-repeat
    color-mix(in srgb, var(--tx-color-primary, #409eff) 18%, transparent);
}
</style>
