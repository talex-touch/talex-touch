<script setup lang="ts">
// A drag across the plot selects a block of cells. The box is drawn over the
// canvas and snaps to whole cells; ECharts keeps its hover, tooltip and click
// everywhere outside a drag, and a drag never ends in a click on a cell. The
// overlay sits beside the chart, not inside it: zrender empties its container.

import type { ECharts } from 'echarts/core'
import type { HeatmapChartEmits, HeatmapChartProps, HeatmapSelection } from './options/heatmap'
import { computed, onBeforeUnmount, shallowRef, useId, watch } from 'vue'
import TxEChart from './TxEChart.vue'
import { buildHeatmapChartOption, HEATMAP_DEFAULT_LABELS, heatmapSelection } from './options/heatmap'
import { mergeChartOption } from './core/shared'

defineOptions({ name: 'TxHeatmapChart' })

const props = withDefaults(defineProps<HeatmapChartProps>(), {
  xAxisName: undefined,
  yAxisName: undefined,
  visualMap: true,
  min: undefined,
  max: undefined,
  showLabel: false,
  unit: undefined,
  selectable: true,
  labels: undefined,
  option: undefined,
  height: 320,
  theme: 'auto',
  ariaLabel: undefined,
  loading: false,
})

const emit = defineEmits<HeatmapChartEmits>()

const chartOption = computed(() => mergeChartOption(buildHeatmapChartOption(props), props.option))
const text = computed(() => ({ ...HEATMAP_DEFAULT_LABELS, ...props.labels }))
const instructionsId = useId()

/** Movement past which a press selects instead of clicking. */
const DRAG_SLOP = 4

interface Cell {
  row: number
  column: number
}

interface Press {
  pointerId: number
  x: number
  y: number
  from: Cell
  to: Cell
  /** Moved past the slop: the box follows the pointer. */
  active: boolean
  /** Escape gave the drag up; the release only ends it. */
  cancelled: boolean
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

let chart: ECharts | null = null
let press: Press | null = null
/** The click a drag ends with belongs to the drag, not to the cell under it. */
let suppressClick = false

const selection = shallowRef<HeatmapSelection | null>(null)
const box = shallowRef<Box | null>(null)
const announcement = shallowRef('')

const totalCells = computed(() => props.values.reduce(
  (count, row) => count + row.filter(value => typeof value === 'number').length,
  0,
))

// Only a selection gives the keyboard something to do (Escape clears it), so
// only then is the chart a tab stop; a press still focuses it.
const rootAttrs = computed(() => props.selectable
  ? { 'role': 'group', 'aria-label': props.ariaLabel, 'tabindex': selection.value ? 0 : -1, 'aria-describedby': instructionsId }
  : {})

const boxStyle = computed(() => box.value && {
  left: `${box.value.left}px`,
  top: `${box.value.top}px`,
  width: `${box.value.width}px`,
  height: `${box.value.height}px`,
})

function onReady(instance: ECharts): void {
  chart = instance
  emit('ready', instance)
  instance.on('finished', updateBox)
  instance.getZr().on('mousemove', onHover)
}

/** Over the plot nothing is picked up: the cells show a crosshair, not ECharts' hand. */
function onHover(event: { offsetX: number, offsetY: number }): void {
  if (props.selectable && chart?.containPixel({ gridIndex: 0 }, [event.offsetX, event.offsetY]))
    chart.getZr().setCursorStyle('crosshair')
}

function localPoint(event: PointerEvent): [number, number] | null {
  const viewport = chart?.getZr().painter.getViewportRoot()
  if (!viewport)
    return null
  const rect = viewport.getBoundingClientRect()
  return [event.clientX - rect.left, event.clientY - rect.top]
}

/** `convertFromPixel` runs on past either end of a category axis, and can give -0. */
function clampIndex(index: unknown, count: number): number {
  if (typeof index !== 'number' || Number.isNaN(index))
    return 0
  return Math.min(Math.max(count - 1, 0), Math.max(0, Math.round(index)))
}

function cellAt(instance: ECharts, point: [number, number]): Cell {
  const value = instance.convertFromPixel({ seriesIndex: 0 }, point)
  const [column, row] = Array.isArray(value) ? value : []
  return { row: clampIndex(row, props.rows.length), column: clampIndex(column, props.columns.length) }
}

/** The block the box shows: the drag in progress, else the selection. */
function shownRange(): Pick<HeatmapSelection, 'rows' | 'columns'> | null {
  if (press?.active && !press.cancelled)
    return { rows: [press.from.row, press.to.row], columns: [press.from.column, press.to.column] }
  return selection.value
}

/** A single category spans the whole plot, whose edges only `containPixel` gives away. */
function plotLength(instance: ECharts, center: [number, number], axis: 0 | 1): number {
  const edge = (outside: number): number => {
    let inside = center[axis]
    for (let step = 0; step < 16; step++) {
      const middle = (inside + outside) / 2
      const point: [number, number] = [center[0], center[1]]
      point[axis] = middle
      if (instance.containPixel({ gridIndex: 0 }, point))
        inside = middle
      else
        outside = middle
    }
    return inside
  }
  return edge((axis === 0 ? instance.getWidth() : instance.getHeight()) + 1) - edge(-1)
}

/** Places the box over whole cells; ECharts says where a cell's centre is, and how far apart they sit. */
function updateBox(): void {
  const instance = chart
  const range = props.selectable ? shownRange() : null
  const columns = props.columns.length
  const rows = props.rows.length
  if (!instance || !range || !columns || !rows) {
    box.value = null
    return
  }
  const center = (column: number, row: number): [number, number] => {
    const value = instance.convertToPixel({ seriesIndex: 0 }, [column, row])
    const [x = Number.NaN, y = Number.NaN] = Array.isArray(value) ? value : []
    return [x, y]
  }
  const start = center(range.columns[0], range.rows[0])
  const end = center(range.columns[1], range.rows[1])
  const origin = center(0, 0)
  const bandX = columns > 1 ? Math.abs(center(columns - 1, 0)[0] - origin[0]) / (columns - 1) : plotLength(instance, origin, 0)
  const bandY = rows > 1 ? Math.abs(center(0, rows - 1)[1] - origin[1]) / (rows - 1) : plotLength(instance, origin, 1)
  // The box is laid out in the wrapper, which may pad the chart in.
  const { offsetLeft, offsetTop } = instance.getDom()
  const next = {
    left: offsetLeft + Math.min(start[0], end[0]) - bandX / 2,
    top: offsetTop + Math.min(start[1], end[1]) - bandY / 2,
    width: Math.abs(end[0] - start[0]) + bandX,
    height: Math.abs(end[1] - start[1]) + bandY,
  }
  box.value = Object.values(next).every(Number.isFinite) ? next : null
}

function commit(next: HeatmapSelection): void {
  selection.value = next
  updateBox()
  announcement.value = text.value.selected
    .replace('{count}', String(next.cells.length))
    .replace('{total}', String(totalCells.value))
  emit('select', next)
}

function clear(announce: boolean): void {
  if (!selection.value)
    return
  selection.value = null
  updateBox()
  if (announce)
    announcement.value = text.value.cleared
  emit('select', null)
}

/** Gives up a drag in progress; the release then only ends it. */
function cancelDrag(): void {
  if (!press?.active || press.cancelled)
    return
  press.cancelled = true
  updateBox()
}

function onPointerDown(event: PointerEvent): void {
  suppressClick = false
  if (!props.selectable || !chart || !event.isPrimary || event.button !== 0)
    return
  // A press still under way lost its release (outside the window, say); this one replaces it.
  if (press) {
    press = null
    updateBox()
  }
  const point = localPoint(event)
  if (!point || !chart.containPixel({ gridIndex: 0 }, point))
    return
  const cell = cellAt(chart, point)
  press = { pointerId: event.pointerId, x: point[0], y: point[1], from: cell, to: cell, active: false, cancelled: false }
  // Captured on zrender's own element, so the release and the click still reach ECharts.
  chart.getZr().painter.getViewportRoot().setPointerCapture?.(event.pointerId)
}

function onPointerMove(event: PointerEvent): void {
  if (!chart || !press || event.pointerId !== press.pointerId || press.cancelled)
    return
  const point = localPoint(event)
  if (!point)
    return
  const starting = !press.active
  if (starting) {
    if (Math.hypot(point[0] - press.x, point[1] - press.y) <= DRAG_SLOP)
      return
    press.active = true
    // The drag has the plot now: no tooltip, and no cell left highlighted.
    chart.dispatchAction({ type: 'hideTip' })
    chart.dispatchAction({ type: 'downplay', seriesIndex: 0 })
  }
  const to = cellAt(chart, point)
  if (!starting && to.row === press.to.row && to.column === press.to.column)
    return
  press.to = to
  updateBox()
}

function onPointerUp(event: PointerEvent): void {
  if (!press || event.pointerId !== press.pointerId)
    return
  const ended = press
  press = null
  if (ended.active) {
    suppressClick = true
    if (!ended.cancelled)
      commit(heatmapSelection(props, [ended.from.row, ended.to.row], [ended.from.column, ended.to.column]))
    return
  }
  // A press that never moved is a click: it clears the selection and still reaches the cell.
  clear(true)
}

/** The pointer went away mid-press; the selection stays as it was. */
function onPointerCancel(event: PointerEvent): void {
  if (!press || event.pointerId !== press.pointerId)
    return
  press = null
  updateBox()
}

/**
 * The event bubbles, and a touch that the canvas captured implicitly hands that
 * capture to zrender's viewport on the first move: only the viewport's own counts.
 */
function onLostPointerCapture(event: PointerEvent): void {
  if (event.target === chart?.getZr().painter.getViewportRoot())
    onPointerCancel(event)
}

/** zrender would go on hovering under a held button; a press here belongs to the selection. */
function onMoveCapture(event: Event): void {
  if (press)
    event.stopPropagation()
}

function onClickCapture(event: MouseEvent): void {
  if (!suppressClick)
    return
  suppressClick = false
  event.stopPropagation()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !props.selectable)
    return
  if (press?.active && !press.cancelled)
    cancelDrag()
  else if (selection.value)
    clear(true)
  else
    return
  event.preventDefault()
}

function sameLabels(next: readonly string[], previous: readonly string[] | undefined): boolean {
  return !!previous && next.length === previous.length && next.every((label, index) => label === previous[index])
}

// New rows or columns give the indexes new meanings. New values under the
// same labels keep the block; its `cells` stay as they were when emitted.
watch(() => [props.rows, props.columns] as const, ([rows, columns], [previousRows, previousColumns]) => {
  if (sameLabels(rows, previousRows) && sameLabels(columns, previousColumns))
    return
  cancelDrag()
  clear(false)
})

watch(() => props.selectable, (selectable) => {
  if (selectable)
    return
  cancelDrag()
  clear(false)
})

onBeforeUnmount(() => {
  chart?.off('finished', updateBox)
  chart?.getZr().off('mousemove', onHover)
  chart = null
})
</script>

<template>
  <div
    class="tx-heatmap-chart"
    :class="{ 'is-selectable': selectable }"
    v-bind="rootAttrs"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @lostpointercapture="onLostPointerCapture"
    @keydown="onKeydown"
    @click.capture="onClickCapture"
    @mousemove.capture="onMoveCapture"
    @touchmove.capture.passive="onMoveCapture"
  >
    <TxEChart
      :option="chartOption"
      :height="height"
      :theme="theme"
      :aria-label="ariaLabel"
      :loading="loading"
      @ready="onReady"
      @click="emit('click', $event)"
      @dblclick="emit('dblclick', $event)"
      @mouseover="emit('mouseover', $event)"
      @mouseout="emit('mouseout', $event)"
      @legendselectchanged="emit('legendselectchanged', $event)"
      @datazoom="emit('datazoom', $event)"
    />
    <template v-if="selectable">
      <span v-if="boxStyle" class="tx-heatmap-chart__brush" :style="boxStyle" aria-hidden="true" />
      <span :id="instructionsId" class="tx-heatmap-chart__instructions">{{ text.instructions }}</span>
      <span class="tx-heatmap-chart__announcement" aria-live="polite">{{ announcement }}</span>
    </template>
  </div>
</template>

<style lang="scss">
.tx-heatmap-chart {
  position: relative;
  width: 100%;

  // A drag here selects in two dimensions, so it cannot also scroll the page.
  &.is-selectable {
    touch-action: none;
  }

  &:focus-visible {
    outline: 2px solid var(--tx-color-primary, #409eff);
    outline-offset: 2px;
  }

  &__brush {
    position: absolute;
    z-index: 1;
    box-sizing: border-box;
    // The suite's brush (kumo's `brushStyle`), here snapped to whole cells.
    border: 1px solid rgba(120, 140, 180, 0.8);
    background: rgba(120, 140, 180, 0.3);
    pointer-events: none;
  }

  &__instructions,
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
