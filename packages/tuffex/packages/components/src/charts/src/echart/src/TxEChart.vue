<script setup lang="ts">
// Adapted from Cloudflare kumo (https://github.com/cloudflare/kumo), © Cloudflare, Inc.,
// MIT — packages/kumo/src/components/chart/EChart.tsx.
//
// The lifecycle is the same one kumo proved out: init into a measured box,
// apply the theme and then the caller's option, bind a fixed event set, resize
// with the container, dispose on unmount. The differences are Vue-shaped —
// the option is a prop instead of a render input, the theme is read from the
// tuffex chart tokens instead of an `isDarkMode` flag, and a host without
// `echarts` installed gets a visible note instead of a blank rectangle. On
// top of ECharts' own roam sits the suite's pointer contract: a plain wheel
// scrolls the page, ⌘/Ctrl + wheel zooms, and a double-click resets.

import type { ECharts } from 'echarts/core'
import type { EChartInteraction } from './core/interaction'
import type { EChartEmits, EChartEventParams, EChartProps } from './core/types'
import type { EChartsRuntime } from './core/loader'
import type { EChartMode, EChartThemeTokens } from './core/theme'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { isZoomWheel, wheelPixels } from '../../../../../../utils/gesture'
import { useReducedMotion } from '../../../../../../utils/use-reduced-motion'
import { useAutoTheme } from '../../../../stream-markdown/src/use-auto-theme'
import {
  createWheelZoomStepper,
  isZoomedWindow,
  panState,
  prepareInteraction,
  readDataZoomEvent,
} from './core/interaction'
import { loadECharts } from './core/loader'
import { decorateChartOption } from './core/shared'
import { echartThemeOption, readEChartThemeTokens } from './core/theme'

defineOptions({ name: 'TxEChart' })

const props = withDefaults(defineProps<EChartProps>(), {
  height: 320,
  theme: 'auto',
  update: 'replace',
  ariaLabel: undefined,
  loading: false,
  cooperativeWheel: true,
})

const emit = defineEmits<EChartEmits>()

const rootRef = ref<HTMLElement | null>(null)
const instance = shallowRef<ECharts | null>(null)
const tokens = ref<EChartThemeTokens | null>(null)
const missingRuntime = ref(false)

const mode = useAutoTheme(() => props.theme)
const heightStyle = computed(() => typeof props.height === 'number' ? `${props.height}px` : props.height)
const reducedMotion = useReducedMotion()

/** The animated return to the full range; ECharts eases it, it has no springs. */
const RESET_DURATION_MS = 350

let interaction: EChartInteraction = prepareInteraction({}).interaction
/** Inside dataZooms whose window is narrower than the full range. */
const zoomed = new Set<string>()
/** Whether the managed dataZooms currently offer a grab. */
let panReady = false
const stepWheelZoom = createWheelZoomStepper()

const emitters: Record<string, (params: EChartEventParams) => void> = {
  click: params => emit('click', params),
  dblclick: params => emit('dblclick', params),
  mouseover: params => emit('mouseover', params),
  mouseout: params => emit('mouseout', params),
  legendselectchanged: params => emit('legendselectchanged', params),
  datazoom: params => emit('datazoom', params),
}

const bound = new Map<string, (...args: unknown[]) => void>()

/**
 * ECharts hands the handler one event object whose fields mirror
 * `EChartEventParams`; anything else carries no field this family exposes.
 */
function toEventParams(payload: unknown): EChartEventParams {
  return typeof payload === 'object' && payload !== null ? payload as EChartEventParams : {}
}
let observer: ResizeObserver | null = null

/**
 * A host without `echarts`, or one whose runtime cannot paint, gets the note
 * and a console line instead of an empty box. Called from the mount path only —
 * the loading promise is the one place a rejection is expected.
 */
function reportUnavailable(error: unknown): void {
  missingRuntime.value = true
  console.error('[tuffex/charts] TxEChart could not start the ECharts runtime. Install `echarts` in the host application.', error)
}

function applyOption(): void {
  const chart = instance.value
  if (!chart || !tokens.value)
    return

  // The theme step below starts the components over, which would put a zoomed
  // window back to the full range. `getOption` copies the series, so ask only when one is.
  const reported = interaction.zoomIds.some(id => zoomed.has(id)) ? chart.getOption()?.dataZoom : undefined
  const prepared = prepareInteraction(decorateChartOption(props.option, tokens.value), reported)
  interaction = prepared.interaction
  zoomed.clear()
  for (const id of interaction.zoomedIds)
    zoomed.add(id)
  panReady = interaction.managedZoomIds.some(id => zoomed.has(id))

  chart.setOption(echartThemeOption(tokens.value), { notMerge: true })
  chart.setOption(prepared.option, {
    notMerge: false,
    lazyUpdate: true,
    ...(props.update === 'replace' ? { replaceMerge: ['series'] } : {}),
  })
}

/** Tracks which windows are narrowed, and offers the grab only while one is. */
function onDataZoom(params: unknown): void {
  for (const window of readDataZoomEvent(params)) {
    for (const id of window.dataZoomId === undefined ? interaction.zoomIds : [window.dataZoomId]) {
      if (window.byValue || isZoomedWindow(window.start, window.end))
        zoomed.add(id)
      else
        zoomed.delete(id)
    }
  }
  const chart = instance.value
  const ready = interaction.managedZoomIds.some(id => zoomed.has(id))
  if (!chart || ready === panReady)
    return
  panReady = ready
  chart.setOption({ dataZoom: interaction.managedZoomIds.map(id => ({ id, ...panState(ready) })) }, { lazyUpdate: true })
}

/**
 * Captured before zrender sees the wheel. zrender keeps an event it finds
 * already normalized, so ECharts' roam reads the delta written here: none for a
 * plain wheel, which then scrolls the page, and the suite's zoom for ⌘/Ctrl.
 */
function onWheelCapture(event: WheelEvent): void {
  const chart = instance.value
  if (!chart || !props.cooperativeWheel)
    return
  const target = event.target
  if (!(target instanceof Node) || !chart.getZr().painter.getViewportRoot().contains(target))
    return
  let delta = 0
  if (isZoomWheel(event)) {
    if (!interaction.wheelZoom)
      return
    event.preventDefault()
    delta = stepWheelZoom(wheelPixels(event).y, event.timeStamp)
  }
  Object.assign(event, { zrX: event.offsetX, zrY: event.offsetY, zrDelta: delta })
}

/** Double-click on the plot returns to the full range; on a treemap, to the fitted layout. */
function onDblClick(event: { offsetX: number, offsetY: number }): void {
  const chart = instance.value
  if (!chart)
    return
  if (interaction.zoomIds.some(id => zoomed.has(id))
    && chart.containPixel({ gridIndex: 'all' }, [event.offsetX, event.offsetY])) {
    chart.dispatchAction({
      type: 'dataZoom',
      batch: interaction.zoomIds.map(dataZoomId => ({ dataZoomId, start: 0, end: 100 })),
      animation: { duration: reducedMotion.value ? 0 : RESET_DURATION_MS, easing: 'cubicOut' },
    })
  }
  if (!interaction.treemaps.length)
    return
  // A treemap keeps its roam only until the next layout: an empty option lays
  // it out afresh through ECharts' own transition, `treemapRender` without a
  // rect does so at once.
  if (reducedMotion.value) {
    for (const seriesIndex of interaction.treemaps)
      chart.dispatchAction({ type: 'treemapRender', seriesIndex, rootRect: null })
  }
  else {
    chart.setOption({})
  }
}

function applyLoading(): void {
  const chart = instance.value
  const theme = tokens.value
  if (!chart || !theme)
    return
  if (props.loading)
    chart.showLoading('default', { text: '', color: theme.palette[0], maskColor: 'transparent', spinnerRadius: 9, lineWidth: 2 })
  else
    chart.hideLoading()
}

function bindEvents(): void {
  const chart = instance.value
  if (!chart)
    return
  for (const [name, emitter] of Object.entries(emitters)) {
    const handler = (...args: unknown[]) => emitter(toEventParams(args[0]))
    chart.on(name, handler)
    bound.set(name, handler)
  }
}

function unbindEvents(): void {
  const chart = instance.value
  if (!chart)
    return
  for (const [name, handler] of bound)
    chart.off(name, handler)
  bound.clear()
}

function resize(): void {
  instance.value?.resize()
}

function reapplyTheme(): void {
  tokens.value = readEChartThemeTokens(rootRef.value, mode.value as EChartMode)
  applyOption()
}

onMounted(async () => {
  let runtime: EChartsRuntime
  try {
    runtime = await loadECharts()
  }
  catch (error) {
    reportUnavailable(error)
    return
  }

  const el = rootRef.value
  if (!el)
    return

  try {
    tokens.value = readEChartThemeTokens(el, mode.value as EChartMode)
    const chart = runtime.init(el)
    instance.value = chart
    applyOption()
    bindEvents()
    chart.on('datazoom', onDataZoom)
    chart.getZr().on('dblclick', onDblClick)
    el.addEventListener('wheel', onWheelCapture, { capture: true, passive: false })
    emit('ready', chart)
  }
  catch (error) {
    reportUnavailable(error)
    return
  }

  if (typeof ResizeObserver !== 'undefined') {
    // The first observer callback fires for the initial layout, and resizing
    // there would cut the enter animation short.
    let initial = true
    observer = new ResizeObserver(() => {
      if (initial) {
        initial = false
        return
      }
      resize()
    })
    observer.observe(el)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  rootRef.value?.removeEventListener('wheel', onWheelCapture, { capture: true })
  unbindEvents()
  instance.value?.off('datazoom', onDataZoom)
  instance.value?.getZr().off('dblclick', onDblClick)
  instance.value?.dispose()
  instance.value = null
})

watch(() => props.option, applyOption)
watch(() => props.update, applyOption)
watch(mode, reapplyTheme)
watch(() => props.loading, applyLoading)

defineExpose({ instance, resize, redraw: applyOption })
</script>

<template>
  <div
    ref="rootRef"
    class="tx-echart"
    :style="{ height: heightStyle }"
    :role="ariaLabel ? 'img' : undefined"
    :aria-label="ariaLabel"
  >
    <p v-if="missingRuntime" class="tx-echart__note">
      ECharts is unavailable — install <code>echarts</code> in the host application.
    </p>
  </div>
</template>

<style lang="scss">
.tx-echart {
  position: relative;
  width: 100%;
  min-height: 0;

  &__note {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    margin: 0;
    font-size: 12px;
    color: var(--tx-chart-text-secondary, #9ca3af);
  }
}
</style>
