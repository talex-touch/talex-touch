<script setup lang="ts">
import type { BaseSurfaceMode } from '../../base-surface/src/types'
import type { PreviewPoint, PreviewSize, PreviewView } from './zoom'
import { computed, onBeforeUnmount, ref } from 'vue'
import { hasDocument } from '../../../../utils/env'
import TxBaseSurface from '../../base-surface/src/TxBaseSurface.vue'

// Internal: the minimap of TxImagePreview, in the corner while a picture is zoomed in. It shows
// the whole picture as turned and frames the part of it on the stage; a press moves the view
// there and a drag carries it along. Pointer only, and hidden from assistive technology: the
// arrow keys pan a zoomed picture. Not exported — the preview owns the view it moves.
defineOptions({ name: 'TxImagePreviewMinimap' })

const props = defineProps<{
  src: string
  /** The picture's own size, before it is turned. */
  size: PreviewSize
  /** Quarter turns clockwise it is turned by. */
  turns: number
  /** The picture as drawn, framing it as turned. */
  view: PreviewView
  /** The stage's size: the part of the picture inside it is framed. */
  stage: PreviewSize
  /** It takes the pointer; fading out, it does not. */
  shown: boolean
  /** The controls' surface. */
  material: { mode?: BaseSurfaceMode, color?: string, opacity?: number, blur?: number }
}>()

const emit = defineEmits<{
  /** Brings `point`, in the picture's own pixels as turned, to the middle of the stage; a drag's (`follow`) at once. */
  look: [point: PreviewPoint, follow: boolean]
  /** A press on it began or ended. */
  drag: [dragging: boolean]
}>()

const mapRef = ref<HTMLElement | null>(null)
const dragging = ref(false)

const sideways = computed(() => Math.abs(props.turns) % 2 === 1)
/** The picture's size as turned. */
const oriented = computed<PreviewSize>(() => (sideways.value ? { width: props.size.height, height: props.size.width } : props.size))

/** The picture's point in the middle of the stage. */
const centre = computed<PreviewPoint>(() => ({
  x: (props.stage.width / 2 - props.view.tx) / props.view.k,
  y: (props.stage.height / 2 - props.view.ty) / props.view.k,
}))

/** The part of the picture on the stage, in shares of it: where its middle is, and how big it is. */
const viewport = computed(() => {
  const { k, tx, ty } = props.view
  const span = (offset: number, extent: number, length: number): [number, number] => {
    const clip = (value: number): number => Math.min(Math.max(value / k, 0), length) / length
    return [clip(-offset), clip(extent - offset)]
  }
  const [left, right] = span(tx, props.stage.width, oriented.value.width)
  const [top, bottom] = span(ty, props.stage.height, oriented.value.height)
  return { x: (left + right) / 2, y: (top + bottom) / 2, width: right - left, height: bottom - top }
})

const mapStyle = computed(() => ({ '--tx-image-preview-minimap-ratio': `${oriented.value.width / oriented.value.height}` }))

// Upright in its own frame and turned about its middle: a quarter turn lays its sides across the map's.
const imageStyle = computed(() => {
  const { width, height } = props.size
  return {
    width: sideways.value ? `${(width / height) * 100}%` : '100%',
    height: sideways.value ? `${(height / width) * 100}%` : '100%',
    transform: `translate(-50%, -50%) rotate(${props.turns * 90}deg)`,
  }
})

// With how far each corner of the frame is from the map's, the larger of its two offsets, in shares
// of the map's width: the frame rounds a corner as the map does as it comes up to it.
const viewportStyle = computed(() => {
  const { x, y, width, height } = viewport.value
  const ratio = oriented.value.width / oriented.value.height
  const left = x - width / 2
  const right = 1 - x - width / 2
  const top = (y - height / 2) / ratio
  const bottom = (1 - y - height / 2) / ratio
  return {
    'left': `${x * 100}%`,
    'top': `${y * 100}%`,
    'width': `${width * 100}%`,
    'height': `${height * 100}%`,
    '--tx-image-preview-minimap-reach-tl': `${Math.max(0, left, top)}`,
    '--tx-image-preview-minimap-reach-tr': `${Math.max(0, right, top)}`,
    '--tx-image-preview-minimap-reach-br': `${Math.max(0, right, bottom)}`,
    '--tx-image-preview-minimap-reach-bl': `${Math.max(0, left, bottom)}`,
  }
})

/** A press: where it holds the picture from its middle, and the middle the press found. */
let press: { id: number, offset: PreviewPoint, origin: PreviewPoint } | null = null

/** Where `event` is over the picture, in its own pixels as turned; off the map, at its edge. */
function pointOf(event: PointerEvent): PreviewPoint {
  const rect = mapRef.value?.getBoundingClientRect()
  if (!rect || !(rect.width > 0) || !(rect.height > 0))
    return centre.value
  return {
    x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1) * oriented.value.width,
    y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1) * oriented.value.height,
  }
}

function onPointerDown(event: PointerEvent): void {
  // ⌃-click is the secondary click on macOS.
  if (!props.shown || !event.isPrimary || (event.pointerType === 'mouse' && (event.button !== 0 || event.ctrlKey)))
    return
  event.preventDefault()
  release()
  const point = pointOf(event)
  const at = centre.value
  const { x, y, width, height } = viewport.value
  const framed = Math.abs(point.x / oriented.value.width - x) <= width / 2 && Math.abs(point.y / oriented.value.height - y) <= height / 2
  // Taken by the frame, the view is held where it was taken; anywhere else it glides there, and
  // the press holds its middle.
  press = { id: event.pointerId, offset: framed ? { x: point.x - at.x, y: point.y - at.y } : { x: 0, y: 0 }, origin: at }
  if (!framed)
    emit('look', point, false)
  try {
    mapRef.value?.setPointerCapture?.(event.pointerId)
  }
  catch {}
  dragging.value = true
  emit('drag', true)
  if (hasDocument())
    window.addEventListener('keydown', onKeydown, true)
}

function onPointerMove(event: PointerEvent): void {
  if (!press || event.pointerId !== press.id)
    return
  // A mouse let go where the page never heard of it: moving on without the button is hover.
  if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
    release()
    return
  }
  const point = pointOf(event)
  emit('look', { x: point.x - press.offset.x, y: point.y - press.offset.y }, true)
}

function onPointerEnd(event: PointerEvent): void {
  if (press?.id === event.pointerId)
    release()
}

// Escape takes the view back to where the press found it, and leaves the preview open.
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !press)
    return
  event.preventDefault()
  event.stopPropagation()
  const { origin } = press
  release()
  emit('look', origin, false)
}

function release(): void {
  const current = press
  press = null
  if (!current)
    return
  if (hasDocument())
    window.removeEventListener('keydown', onKeydown, true)
  try {
    if (mapRef.value?.hasPointerCapture?.(current.id))
      mapRef.value.releasePointerCapture(current.id)
  }
  catch {}
  dragging.value = false
  emit('drag', false)
}

onBeforeUnmount(release)
</script>

<template>
  <div class="tx-image-preview__minimap" :class="{ 'is-shown': shown }" aria-hidden="true">
    <TxBaseSurface class="tx-image-preview__surface tx-image-preview__control-surface" fake v-bind="material" />
    <div
      ref="mapRef"
      class="tx-image-preview__minimap-map"
      :class="{ 'is-dragging': dragging }"
      :style="mapStyle"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerEnd"
      @pointercancel="onPointerEnd"
      @lostpointercapture="onPointerEnd"
    >
      <img class="tx-image-preview__minimap-image tx-image-preview__part" :src="src" alt="" draggable="false" :style="imageStyle">
      <span class="tx-image-preview__minimap-viewport tx-image-preview__part" :style="viewportStyle" />
    </div>
  </div>
</template>
