<script setup lang="ts">
import type { ChartPadding } from '../../core/types'
import type { ChartProps } from './types'
import { computed, onBeforeUnmount, onMounted, provide, ref, toRef, useId } from 'vue'
import { chartContextKey, createChartContext } from '../../core/context'
import { defaultTickFormat, isBandScale, xPosition } from '../../core/scales'
import { CHART_DEFAULT_LABELS } from './types'

defineOptions({ name: 'TxChart' })

const props = withDefaults(defineProps<ChartProps>(), {
  height: 350,
  padding: 24,
  xType: 'linear',
  yNice: true,
  interactive: true,
})

defineSlots<{
  /** SVG layers: axes, grid, series. Rendered inside the chart's <svg>. */
  default?: () => unknown
  /** DOM overlay above the SVG (tooltips, annotations). */
  overlay?: () => unknown
}>()

/** Movement before a press becomes a drag that holds the pointer. */
const DRAG_SLOP = 4

const container = ref<HTMLElement | null>(null)
const measuredWidth = ref(0)
const measuredHeight = ref(0)
const instructionsId = useId()

// Measure the container, not the svg — the svg's own size follows the styles
// this component sets, so observing it reports back our writes, not layout.
let observer: ResizeObserver | null = null
onMounted(() => {
  if (!container.value)
    return
  measuredWidth.value = container.value.clientWidth
  measuredHeight.value = container.value.clientHeight
  observer = new ResizeObserver((entries) => {
    const rect = entries[0]?.contentRect
    if (!rect)
      return
    measuredWidth.value = rect.width
    measuredHeight.value = rect.height
  })
  observer.observe(container.value)
})
onBeforeUnmount(() => observer?.disconnect())

const width = computed(() => props.width ?? measuredWidth.value)
const height = computed(() =>
  props.aspectRatio !== undefined ? measuredHeight.value : props.height,
)
const ready = computed(() => width.value > 0 && height.value > 0)

const padding = computed<ChartPadding>(() => {
  const raw = props.padding
  if (typeof raw === 'number')
    return { top: raw, right: raw, bottom: raw, left: raw }
  return { top: raw.top ?? 24, right: raw.right ?? 24, bottom: raw.bottom ?? 24, left: raw.left ?? 24 }
})

const context = createChartContext({
  width,
  height,
  padding,
  xType: toRef(props, 'xType'),
  xDomain: toRef(props, 'xDomain'),
  yDomain: toRef(props, 'yDomain'),
  yNice: toRef(props, 'yNice'),
  container,
})
provide(chartContextKey, context)

const labels = computed(() => ({ ...CHART_DEFAULT_LABELS, ...props.labels }))

/** The chart takes focus when there is something to read: x values, or a layer that answers keys. */
const focusable = computed(() =>
  props.interactive && (context.xStops.value.length > 0 || context.keyLayers.length > 0),
)
/** Cartesian readings sweep across the plot, so the plot shows the readout cursor. */
const readsX = computed(() => props.interactive && context.xStops.value.length > 0)

// ── Pointer reading ──────────────────────────────────────────────────────────

let press: { id: number, x: number, y: number } | null = null

function localPoint(event: PointerEvent): { x: number, y: number } {
  const rect = container.value?.getBoundingClientRect()
  return rect
    ? { x: event.clientX - rect.left, y: event.clientY - rect.top }
    : { x: event.offsetX, y: event.offsetY }
}

function isOutside(event: PointerEvent): boolean {
  const rect = container.value?.getBoundingClientRect()
  if (!rect)
    return true
  return event.clientX < rect.left || event.clientX > rect.right
    || event.clientY < rect.top || event.clientY > rect.bottom
}

function readAt(event: PointerEvent): void {
  // A pan or pinch moves the data under the pointer; the reading waits for it to end.
  const gesture = context.gesture.value
  if (gesture === 'pan' || gesture === 'pinch') {
    context.pointer.inside = false
    return
  }
  let { x, y } = localPoint(event)
  if (context.pointer.pressed) {
    // Held outside the plot, the reading stays on the edge datum.
    const plot = context.plot.value
    x = Math.min(plot.x + plot.width, Math.max(plot.x, x))
    y = Math.min(plot.y + plot.height, Math.max(plot.y, y))
  }
  context.pointer.x = x
  context.pointer.y = y
  context.pointer.inside = true
  context.pointer.source = 'pointer'
}

function onPointerDown(event: PointerEvent): void {
  // Only the first finger reads; a second one belongs to a pinch.
  if (!props.interactive || event.isPrimary === false)
    return
  if (event.pointerType === 'mouse' && event.button !== 0)
    return
  press = { id: event.pointerId, x: event.clientX, y: event.clientY }
  // Touch and pen have no hover to have placed a reading: the press reads.
  readAt(event)
}

function onPointerMove(event: PointerEvent): void {
  if (!props.interactive)
    return
  if (
    press && event.pointerId === press.id && !context.pointer.pressed
    && Math.hypot(event.clientX - press.x, event.clientY - press.y) >= DRAG_SLOP
  ) {
    context.pointer.pressed = true
    // A layer that already took the pointer (a brush) owns the drag; the
    // reading only follows it.
    const target = event.target as Element | null
    if (!target?.hasPointerCapture?.(event.pointerId))
      container.value?.setPointerCapture?.(event.pointerId)
    armClickSwallow()
  }
  if (event.isPrimary !== false)
    readAt(event)
}

function endPress(event: PointerEvent): void {
  if (!press || event.pointerId !== press.id)
    return
  press = null
  context.pointer.pressed = false
  // A touch has no hover to fall back to; a press released off the chart leaves it.
  if (event.pointerType !== 'mouse' || isOutside(event))
    context.pointer.inside = false
}

function onPointerLeave(): void {
  if (!context.pointer.pressed)
    context.pointer.inside = false
}

// A drag reads (or brushes, or pans); it is not a click. The click its release
// produces lands on the capturing element and bubbles to whatever holds the
// chart, so it is swallowed wherever it goes.
let swallowing = false

function swallowClick(event: MouseEvent): void {
  // Keyboard and programmatic clicks (detail 0) never end a drag.
  if (event.detail === 0)
    return
  event.preventDefault()
  event.stopImmediatePropagation()
  disarmClickSwallow()
}

function disarmClickSwallow(): void {
  if (!swallowing)
    return
  swallowing = false
  window.removeEventListener('click', swallowClick, true)
  window.removeEventListener('pointerdown', disarmClickSwallow, true)
}

function armClickSwallow(): void {
  if (swallowing)
    return
  swallowing = true
  window.addEventListener('click', swallowClick, true)
  // A drag that ends without a click (a touch drag) must not eat the next one.
  window.addEventListener('pointerdown', disarmClickSwallow, true)
}

onBeforeUnmount(disarmClickSwallow)

// ── Keyboard reading ─────────────────────────────────────────────────────────

function visibleStops(): Array<string | number> {
  const scale = context.xScale.value
  const stops = context.xStops.value
  if (!scale || isBandScale(scale))
    return stops
  const [d0, d1] = scale.domain().map(Number) as [number, number]
  const lo = Math.min(d0, d1)
  const hi = Math.max(d0, d1)
  return stops.filter(stop => (stop as number) >= lo && (stop as number) <= hi)
}

function describe(stop: string | number): string {
  if (props.announce)
    return props.announce(stop)
  const scale = context.xScale.value
  if (!scale)
    return String(stop)
  const value = context.xType.value === 'time' ? new Date(stop as number) : stop
  return defaultTickFormat(scale, 5)(value)
}

function clearReading(): void {
  for (const layer of context.keyLayers)
    layer.clear?.()
  context.pointer.inside = false
  context.pointer.source = 'pointer'
  context.announcement.value = ''
}

function step(event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return false
  if (event.key === 'Escape') {
    if (!context.pointer.inside)
      return false
    clearReading()
    return true
  }
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
    return false
  const scale = context.xScale.value
  const stops = visibleStops()
  if (!scale || stops.length === 0)
    return false

  const current = context.pointer.inside ? context.nearestXStop(context.pointer.x) : null
  const index = current === null ? -1 : stops.indexOf(current)
  const last = stops.length - 1
  const next = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? last
      : event.key === 'ArrowRight'
        ? (index < 0 ? 0 : Math.min(last, index + 1))
        : (index < 0 ? last : Math.max(0, index - 1))

  const stop = stops[next]!
  const plot = context.plot.value
  context.pointer.x = xPosition(scale, stop)
  context.pointer.y = plot.y + plot.height / 2
  context.pointer.inside = true
  context.pointer.source = 'keyboard'
  context.announcement.value = describe(stop)
  return true
}

function onKeydown(event: KeyboardEvent): void {
  if (!focusable.value)
    return
  for (let index = context.keyLayers.length - 1; index >= 0; index--) {
    if (context.keyLayers[index]!.key(event)) {
      event.preventDefault()
      return
    }
  }
  if (step(event))
    event.preventDefault()
}

function onBlur(): void {
  if (context.pointer.source === 'keyboard')
    clearReading()
}

defineExpose({
  /** The chart context, for advanced consumers building custom layers. */
  context,
})
</script>

<template>
  <div
    ref="container"
    class="tx-chart"
    :class="{ 'is-interactive': props.interactive }"
    :style="props.aspectRatio !== undefined
      ? { aspectRatio: String(props.aspectRatio) }
      : { height: `${props.height}px` }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="endPress"
    @pointercancel="endPress"
    @lostpointercapture="endPress"
    @pointerleave="onPointerLeave"
  >
    <svg
      v-if="ready"
      class="tx-chart__svg"
      :class="{ 'is-reading': readsX }"
      :viewBox="`0 0 ${width} ${height}`"
      :role="focusable ? 'group' : props.ariaDescription ? 'img' : undefined"
      :aria-label="focusable ? (props.ariaDescription ?? labels.chart) : props.ariaDescription"
      :aria-describedby="focusable ? instructionsId : undefined"
      :tabindex="focusable || props.ariaDescription ? 0 : undefined"
      @keydown="onKeydown"
      @blur="onBlur"
    >
      <defs>
        <clipPath :id="context.clipId">
          <rect
            :x="context.plot.value.x"
            :y="context.plot.value.y"
            :width="context.plot.value.width"
            :height="context.plot.value.height"
          />
        </clipPath>
      </defs>
      <slot />
    </svg>
    <div class="tx-chart__overlay">
      <slot name="overlay" />
    </div>
    <span v-if="focusable" :id="instructionsId" hidden>{{ context.zoomable.value ? labels.zoomInstructions : labels.instructions }}</span>
    <span v-if="props.interactive" class="tx-chart__announcement" aria-live="polite">{{ context.announcement.value }}</span>
  </div>
</template>

<style lang="scss" scoped>
.tx-chart {
  position: relative;
  width: 100%;

  // A horizontal drag reads values; a vertical swipe still scrolls the page.
  &.is-interactive {
    touch-action: pan-y;
  }

  &__svg {
    display: block;
    width: 100%;
    height: 100%;
    outline: none;

    // Nothing is picked up: sweeping the plot reads values off it.
    &.is-reading {
      cursor: crosshair;
    }

    &:focus-visible {
      outline: 2px solid var(--tx-color-primary, #409eff);
      outline-offset: 2px;
    }
  }

  &__overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  &__announcement {
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
}
</style>
