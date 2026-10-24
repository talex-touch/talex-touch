<script setup lang="ts">
import type { BaseSurfaceMode } from '../../base-surface/src/types'
import type { ImagePreviewAction } from './types'
import TxBaseSurface from '../../base-surface/src/TxBaseSurface.vue'
import { ACTION_ICONS } from './use-preview-actions'

// Internal: the toolbar of TxImagePreview, the zoom controls and then the actions. Its buttons
// stay focusable at the ends (aria-disabled): a disabled button that held focus would drop it to
// <body>, outside the dialog. Not exported — the preview owns what each button does.
defineOptions({ name: 'TxImagePreviewToolbar' })

defineProps<{
  /** The scale, as the host formats it; empty while the picture has no size. */
  readout: string
  readoutLabel: string
  zoomInLabel: string
  zoomOutLabel: string
  canZoomIn: boolean
  canZoomOut: boolean
  actions: ImagePreviewAction[]
  actionLabel: (action: ImagePreviewAction) => string
  actionDisabled: (action: ImagePreviewAction) => boolean
  /** The controls' surface. */
  material: { mode?: BaseSurfaceMode, color?: string, opacity?: number, blur?: number }
}>()

const emit = defineEmits<{
  zoomIn: []
  zoomOut: []
  /** Back to the whole picture. */
  reset: []
  /** Inside the click that chose it; Shift asks for the reverse, a turn back. */
  action: [action: ImagePreviewAction, reverse: boolean]
}>()
</script>

<template>
  <div class="tx-image-preview__toolbar tx-image-preview__chrome">
    <TxBaseSurface class="tx-image-preview__surface tx-image-preview__control-surface" fake v-bind="material" />
    <div class="tx-image-preview__zoom">
      <button
        type="button"
        class="tx-image-preview__button"
        :aria-label="zoomOutLabel"
        :aria-disabled="!canZoomOut || undefined"
        @click="emit('zoomOut')"
      >
        <svg class="tx-image-preview__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <path d="M6 12h12" />
        </svg>
      </button>
      <button
        type="button"
        class="tx-image-preview__button tx-image-preview__readout"
        :aria-label="readoutLabel"
        :aria-disabled="!canZoomOut || undefined"
        @click="emit('reset')"
      >
        <span class="tx-image-preview__readout-text tx-image-preview__part">{{ readout }}</span>
      </button>
      <button
        type="button"
        class="tx-image-preview__button"
        :aria-label="zoomInLabel"
        :aria-disabled="!canZoomIn || undefined"
        @click="emit('zoomIn')"
      >
        <svg class="tx-image-preview__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <path d="M12 6v12M6 12h12" />
        </svg>
      </button>
    </div>
    <template v-if="actions.length > 0">
      <span class="tx-image-preview__divider tx-image-preview__part" aria-hidden="true" />
      <button
        v-for="action in actions"
        :key="action"
        type="button"
        class="tx-image-preview__button"
        :aria-label="actionLabel(action)"
        :aria-disabled="actionDisabled(action) || undefined"
        @click="emit('action', action, $event.shiftKey)"
      >
        <svg class="tx-image-preview__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path v-for="d in ACTION_ICONS[action]" :key="d" :d="d" />
        </svg>
      </button>
    </template>
  </div>
</template>
