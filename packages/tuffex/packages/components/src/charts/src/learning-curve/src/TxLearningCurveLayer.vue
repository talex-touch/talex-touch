<script setup lang="ts">
// TxLearningCurve's drawing: every run's ± std band, its faint values as
// logged and its smoothed line, then the reading's crosshair and dots. Paths
// are drawn straight from the scales, with no morph, so a pan, a zoom and a
// growing stream all land on the frame they happen.

import type { SeriesExtent } from '../../core/types'
import type { CurveReadout, DrawnRun } from './types'
import { area, line } from 'd3-shape'
import { computed, onBeforeUnmount } from 'vue'
import { easings, ENTER_DURATION, useEnterProgress } from '../../core/animate'
import { useChartContext } from '../../core/context'
import { isBandScale, xPosition } from '../../core/scales'
import { nextSeriesUid } from '../../series/src/use-series'
import { drawnIndices, lowerBound } from './smoothing'

defineOptions({ name: 'TxLearningCurveLayer' })

const props = defineProps<{
  runs: DrawnRun[]
  showRaw: boolean
  showBand: boolean
  /** The run every other run dims behind, if any. */
  emphasized: string | null
  readout: CurveReadout | null
}>()

const ctx = useChartContext('TxLearningCurve')

/** Opacity of a run while another one is emphasized. */
const DIM_OPACITY = 0.25

/** First index a run draws from: a log axis has no place for step 0 or below. */
function firstDrawable(steps: readonly number[]): number {
  return ctx.xType.value === 'log' ? lowerBound(steps, Number.MIN_VALUE) : 0
}

const extent = computed<SeriesExtent | null>(() => {
  let lo = Infinity
  let hi = -Infinity
  const values: number[] = []
  for (const run of props.runs) {
    const steps = run.curve.steps
    const first = firstDrawable(steps)
    if (first >= steps.length)
      continue
    lo = Math.min(lo, steps[first]!)
    hi = Math.max(hi, steps[steps.length - 1]!)
    for (let index = first; index < steps.length; index++)
      values.push(steps[index]!)
  }
  // The component fits the value axis itself, to the steps in view.
  return lo <= hi ? { x: [lo, hi], xValues: values, y: null } : null
})
const unregister = ctx.registerSeries(extent)
onBeforeUnmount(unregister)

/** Each run's band edges, kept apart from the paths so a pan does not recompute them. */
const bands = computed(() => props.runs.map((run) => {
  const { smoothed, spread } = run.curve
  if (!spread)
    return null
  return {
    low: smoothed.map((value, index) => value - spread[index]!),
    high: smoothed.map((value, index) => value + spread[index]!),
  }
}))

interface RunPaths {
  key: string
  color: string
  band: string
  raw: string
  smoothed: string
}

const paths = computed<RunPaths[]>(() => {
  const xs = ctx.xScale.value
  const ys = ctx.yScale.value
  if (!xs || !ys || isBandScale(xs))
    return []
  const [d0, d1] = xs.domain().map(Number) as [number, number]
  const from = Math.min(d0, d1)
  const to = Math.max(d0, d1)
  const width = Math.max(1, ctx.plot.value.width)

  return props.runs.map((run, runIndex) => {
    const { steps, raw, smoothed } = run.curve
    const band = props.showBand ? bands.value[runIndex] : null
    // The points in view, plus one past each edge so the lines run off the plot.
    const start = Math.max(firstDrawable(steps), lowerBound(steps, from) - 1)
    const end = Math.min(steps.length - 1, lowerBound(steps, to))
    const px = (index: number): number => xPosition(xs, steps[index]!)
    const arrays: Array<readonly number[]> = [smoothed]
    if (props.showRaw)
      arrays.push(raw)
    if (band)
      arrays.push(band.low, band.high)
    const indices = drawnIndices(start, end, px, arrays, width)

    const trace = (values: readonly number[]): string => line<number>()
      .defined(index => Number.isFinite(values[index]!))
      .x(px)
      .y(index => ys(values[index]!))(indices) ?? ''

    return {
      key: run.key,
      color: run.color,
      band: band
        ? area<number>()
          .defined(index => Number.isFinite(band.low[index]!) && Number.isFinite(band.high[index]!))
          .x(px)
          .y0(index => ys(band.low[index]!))
          .y1(index => ys(band.high[index]!))(indices) ?? ''
        : '',
      raw: props.showRaw ? trace(raw) : '',
      smoothed: trace(smoothed),
    }
  })
})

function opacity(key: string): number | undefined {
  return props.emphasized !== null && key !== props.emphasized ? DIM_OPACITY : undefined
}

const crosshair = computed(() => {
  const readout = props.readout
  const xs = ctx.xScale.value
  const ys = ctx.yScale.value
  if (!readout || !xs || !ys)
    return null
  const plot = ctx.plot.value
  const inPlot = (x: number): boolean => x >= plot.x - 0.5 && x <= plot.x + plot.width + 0.5
  const x = xPosition(xs, readout.step)
  if (!inPlot(x))
    return null
  const dots: Array<{ key: string, x: number, y: number, color: string }> = []
  for (const point of readout.points) {
    const run = props.runs.find(item => item.key === point.key)
    const step = run?.curve.steps[point.index]
    const value = run?.curve.smoothed[point.index]
    if (!run || step === undefined || value === undefined || !Number.isFinite(value))
      continue
    const dotX = xPosition(xs, step)
    if (inPlot(dotX))
      dots.push({ key: run.key, x: dotX, y: ys(value), color: run.color })
  }
  return { x, dots }
})

// Like a line series, the first render reveals left to right.
const enterClipId = `tx-learning-curve-enter-${nextSeriesUid()}`
const enterProgress = useEnterProgress({ duration: ENTER_DURATION, easing: easings.linear })
</script>

<template>
  <g class="tx-learning-curve-layer" aria-hidden="true">
    <defs>
      <clipPath :id="enterClipId">
        <rect
          :x="ctx.plot.value.x"
          :y="ctx.plot.value.y"
          :width="ctx.plot.value.width * enterProgress"
          :height="ctx.plot.value.height"
        />
      </clipPath>
    </defs>
    <g :clip-path="`url(#${ctx.clipId})`">
      <g :clip-path="`url(#${enterClipId})`">
        <!-- Bands under every line, raw lines under every smoothed one: where runs overlap, no run's band hides another's line. -->
        <template v-for="run in paths" :key="`band-${run.key}`">
          <path
            v-if="run.band"
            class="tx-learning-curve-layer__band"
            :d="run.band"
            :fill="run.color"
            :opacity="opacity(run.key)"
          />
        </template>
        <template v-for="run in paths" :key="`raw-${run.key}`">
          <path
            v-if="run.raw"
            class="tx-learning-curve-layer__raw"
            :d="run.raw"
            :stroke="run.color"
            :opacity="opacity(run.key)"
          />
        </template>
        <template v-for="run in paths" :key="`smoothed-${run.key}`">
          <path
            v-if="run.smoothed"
            class="tx-learning-curve-layer__smoothed"
            :d="run.smoothed"
            :stroke="run.color"
            :opacity="opacity(run.key)"
          />
        </template>
      </g>
    </g>
    <template v-if="crosshair">
      <line
        class="tx-learning-curve-layer__crosshair"
        :x1="crosshair.x"
        :y1="ctx.plot.value.y"
        :x2="crosshair.x"
        :y2="ctx.plot.value.y + ctx.plot.value.height"
      />
      <circle
        v-for="dot in crosshair.dots"
        :key="dot.key"
        class="tx-learning-curve-layer__dot"
        :cx="dot.x"
        :cy="dot.y"
        r="3.5"
        :fill="dot.color"
        :opacity="opacity(dot.key)"
      />
    </template>
  </g>
</template>

<style lang="scss" scoped>
.tx-learning-curve-layer {
  // The plot is read and dragged through the chart; nothing here is a target.
  pointer-events: none;

  &__band {
    fill-opacity: 0.16;
    stroke: none;
  }

  &__raw {
    fill: none;
    stroke-opacity: 0.28;
    stroke-width: 1;
    stroke-linejoin: round;
  }

  &__smoothed {
    fill: none;
    stroke-width: 2;
    stroke-linejoin: round;
    stroke-linecap: round;
  }

  &__crosshair {
    stroke: var(--tx-chart-grid-line, rgb(107 114 128 / 20%));
    stroke-width: 1;
  }

  &__dot {
    stroke: var(--tx-chart-tooltip-bg, canvas);
    stroke-width: 2;
  }
}
</style>
