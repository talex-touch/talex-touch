import type { ComputedRef, InjectionKey, Ref } from 'vue'
import type { ChartXScale, ChartYScale } from './scales'
import type { ChartPadding, PlotArea, ScaleKind, SeriesExtent } from './types'
import { computed, inject, reactive, ref, shallowReactive } from 'vue'
import { ChartPalette } from '../palette'
import { createXScale, createYScale, isBandScale, xPosition } from './scales'

/**
 * The live reading position in container pixel coordinates. A mouse writes it
 * while it hovers; a press-drag (mouse, touch or pen) keeps writing it outside
 * the plot, clamped to the plot's edge; keyboard stepping writes the position
 * of the datum it lands on.
 */
export interface ChartPointer {
  x: number
  y: number
  /** A reading is showing. */
  inside: boolean
  /** A press-drag past the 4px slop holds the pointer. */
  pressed: boolean
  /** What placed the reading: a pointer, or keyboard stepping. */
  source: 'pointer' | 'keyboard'
}

/** A gesture that moves the chart's view; readings pause while it pans or pinches. */
export type ChartGesture = 'brush' | 'pan' | 'pinch' | null

/**
 * A layer that answers keys on the focused chart: a pie stepping its slices,
 * a viewport zooming. Layers are asked newest first, before the chart's own
 * stepping through x values.
 */
export interface ChartKeyLayer {
  /** Handle a key; return true when it was consumed. */
  key: (event: KeyboardEvent) => boolean
  /** Drop any reading the layer placed (the chart lost focus, or Escape). */
  clear?: () => void
}

/** A bar series registered for lane/stack layout. */
export interface BarSeriesEntry {
  uid: number
  stack: string | null
  /** x key → y value for the series' current data. */
  points: () => Map<string | number, number>
}

export interface BarLayout {
  /** Side-by-side lanes: each unstacked series is a lane, each stack shares one. */
  laneCount: number
  laneIndex: (uid: number) => number
  /** Cumulative baseline under `uid` at `xKey` (0 unless stacked above others). */
  baseline: (uid: number, xKey: string | number) => number
}

export interface TxChartContext {
  width: Readonly<Ref<number>>
  height: Readonly<Ref<number>>
  plot: ComputedRef<PlotArea>
  xType: Readonly<Ref<ScaleKind>>
  /** The full x domain the data spans, before any view window. */
  xDomainFull: ComputedRef<Array<string | number>>
  /**
   * The x window a view layer shows in place of the full domain, in data
   * units; `null` shows it all. Continuous scales only.
   */
  xView: Ref<[number, number] | null>
  xScale: ComputedRef<ChartXScale | null>
  yScale: ComputedRef<ChartYScale | null>
  /** id of the plot-area clipPath series should reference. */
  clipId: string
  pointer: ChartPointer
  container: Readonly<Ref<HTMLElement | null>>
  /** Report a series' data extent; returns an unregister function. */
  registerSeries: (extent: Ref<SeriesExtent | null>) => () => void
  /** Next categorical color slot as a theme-following var() reference. */
  allocateColor: () => string
  registerBar: (entry: BarSeriesEntry) => () => void
  barLayout: ComputedRef<BarLayout>
  /**
   * Every x a mounted series has a datum at, in axis order: the band domain on
   * band scales, sorted distinct values on continuous ones.
   */
  xStops: ComputedRef<Array<string | number>>
  /** The stop drawn nearest a container x inside the current x domain, or `null`. */
  nearestXStop: (px: number) => string | number | null
  /** Add a key layer; returns an unregister function. */
  registerKeyLayer: (layer: ChartKeyLayer) => () => void
  /** Registered key layers, newest last. */
  keyLayers: readonly ChartKeyLayer[]
  /**
   * While true, series draw the current scales on the same frame instead of
   * morphing towards them: a pan or zoom moves the scales every frame.
   */
  immediate: Ref<boolean>
  /** The view gesture in progress, if any. */
  gesture: Ref<ChartGesture>
  /** A view layer zooms this chart; its keyboard instructions say so. */
  zoomable: Ref<boolean>
  /** Text for the chart's polite live region; layers write their keyboard readings here. */
  announcement: Ref<string>
}

export const chartContextKey: InjectionKey<TxChartContext> = Symbol('tx-chart-context')

export function useChartContext(component: string): TxChartContext {
  const ctx = inject(chartContextKey, null)
  if (!ctx)
    throw new Error(`[tuffex/charts] <${component}> must be rendered inside <TxChart>`)
  return ctx
}

export interface CreateChartContextInput {
  width: Ref<number>
  height: Ref<number>
  padding: ComputedRef<ChartPadding>
  xType: Ref<ScaleKind>
  xDomain: Ref<Array<string | number> | undefined>
  yDomain: Ref<[number, number] | undefined>
  yNice: Ref<boolean>
  container: Ref<HTMLElement | null>
}

let contextUid = 0

export function createChartContext(input: CreateChartContextInput): TxChartContext {
  const clipId = `tx-chart-clip-${++contextUid}`

  interface ExtentEntry { source: Ref<SeriesExtent | null> }
  const extents = shallowReactive<ExtentEntry[]>([])
  const barEntries = shallowReactive<BarSeriesEntry[]>([])
  const keyLayers = shallowReactive<ChartKeyLayer[]>([])
  const pointer = reactive<ChartPointer>({ x: 0, y: 0, inside: false, pressed: false, source: 'pointer' })

  // Slots are assigned in registration order and not reclaimed on unregister —
  // remounting series keeps stable hues, transient removals don't reshuffle.
  let colorSlot = 0

  const plot = computed<PlotArea>(() => {
    const pad = input.padding.value
    return {
      x: pad.left,
      y: pad.top,
      width: Math.max(0, input.width.value - pad.left - pad.right),
      height: Math.max(0, input.height.value - pad.top - pad.bottom),
    }
  })

  const xDomainAuto = computed<Array<string | number>>(() => {
    if (input.xDomain.value !== undefined)
      return input.xDomain.value
    if (input.xType.value === 'band') {
      const seen = new Set<string | number>()
      const ordered: Array<string | number> = []
      for (const entry of extents) {
        for (const value of entry.source.value?.xBand ?? []) {
          if (!seen.has(value)) {
            seen.add(value)
            ordered.push(value)
          }
        }
      }
      return ordered
    }
    let lo = Infinity
    let hi = -Infinity
    for (const entry of extents) {
      const range = entry.source.value?.x
      if (!range)
        continue
      lo = Math.min(lo, range[0])
      hi = Math.max(hi, range[1])
    }
    return lo <= hi ? [lo, hi] : []
  })

  /** Per stack key: x key → summed value, for stacked y-domain and baselines. */
  const stackTotals = computed(() => {
    const totals = new Map<string, Map<string | number, number>>()
    for (const entry of barEntries) {
      if (entry.stack === null)
        continue
      let perX = totals.get(entry.stack)
      if (!perX) {
        perX = new Map()
        totals.set(entry.stack, perX)
      }
      for (const [key, value] of entry.points())
        perX.set(key, (perX.get(key) ?? 0) + value)
    }
    return totals
  })

  const yDomainAuto = computed<[number, number]>(() => {
    if (input.yDomain.value !== undefined)
      return input.yDomain.value
    let lo = Infinity
    let hi = -Infinity
    // Stacked bar series report y: null and contribute via their stack totals.
    for (const entry of extents) {
      const range = entry.source.value?.y
      if (!range)
        continue
      lo = Math.min(lo, range[0])
      hi = Math.max(hi, range[1])
    }
    for (const perX of stackTotals.value.values()) {
      for (const total of perX.values()) {
        lo = Math.min(lo, Math.min(0, total))
        hi = Math.max(hi, Math.max(0, total))
      }
    }
    if (lo > hi)
      return [0, 1]
    if (lo === hi)
      return lo === 0 ? [0, 1] : [Math.min(lo, 0), Math.max(hi, 0)]
    return [lo, hi]
  })

  const xView = ref<[number, number] | null>(null)

  const xScale = computed<ChartXScale | null>(() => {
    const area = plot.value
    if (area.width <= 0)
      return null
    const view = input.xType.value === 'band' ? null : xView.value
    const domain = view ?? xDomainAuto.value
    if (domain.length === 0)
      return null
    return createXScale(input.xType.value, domain, [area.x, area.x + area.width])
  })

  const yScale = computed<ChartYScale | null>(() => {
    const area = plot.value
    if (area.height <= 0)
      return null
    return createYScale(
      yDomainAuto.value,
      [area.y + area.height, area.y],
      input.yNice.value,
    )
  })

  const xStops = computed<Array<string | number>>(() => {
    if (input.xType.value === 'band')
      return xDomainAuto.value
    const values: number[] = []
    for (const entry of extents) {
      for (const value of entry.source.value?.xValues ?? [])
        values.push(value)
    }
    values.sort((a, b) => a - b)
    return values.filter((value, index) => index === 0 || value !== values[index - 1])
  })

  function nearestXStop(px: number): string | number | null {
    const scale = xScale.value
    const stops = xStops.value
    if (!scale || stops.length === 0)
      return null
    if (isBandScale(scale)) {
      let best: string | number | null = null
      let distance = Infinity
      for (const stop of stops) {
        const gap = Math.abs(xPosition(scale, stop) - px)
        if (gap < distance) {
          distance = gap
          best = stop
        }
      }
      return best
    }
    // Continuous stops are sorted: binary search the inverted x, then keep the
    // nearer neighbour by drawn distance, inside the current domain only.
    const [d0, d1] = scale.domain().map(Number) as [number, number]
    const lo = Math.min(d0, d1)
    const hi = Math.max(d0, d1)
    const numeric = stops as number[]
    let start = 0
    while (start < numeric.length && numeric[start]! < lo)
      start++
    let end = numeric.length - 1
    while (end >= start && numeric[end]! > hi)
      end--
    if (start > end)
      return null
    const inverted = Number(scale.invert(px))
    let left = start
    let right = end
    while (left < right) {
      const middle = (left + right) >> 1
      if (numeric[middle]! < inverted)
        left = middle + 1
      else
        right = middle
    }
    const after = numeric[left]!
    const before = left > start ? numeric[left - 1]! : after
    return Math.abs(xPosition(scale, before) - px) <= Math.abs(xPosition(scale, after) - px) ? before : after
  }

  const barLayout = computed<BarLayout>(() => {
    const laneByKey = new Map<string, number>()
    const laneByUid = new Map<number, number>()
    for (const entry of barEntries) {
      const key = entry.stack === null ? `series-${entry.uid}` : `stack-${entry.stack}`
      if (!laneByKey.has(key))
        laneByKey.set(key, laneByKey.size)
      laneByUid.set(entry.uid, laneByKey.get(key) as number)
    }
    return {
      laneCount: Math.max(1, laneByKey.size),
      laneIndex: uid => laneByUid.get(uid) ?? 0,
      baseline: (uid, xKey) => {
        const self = barEntries.find(entry => entry.uid === uid)
        if (!self || self.stack === null)
          return 0
        let sum = 0
        for (const entry of barEntries) {
          if (entry.uid === uid)
            break
          if (entry.stack !== self.stack)
            continue
          sum += entry.points().get(xKey) ?? 0
        }
        return sum
      },
    }
  })

  return {
    width: input.width,
    height: input.height,
    plot,
    xType: input.xType,
    xDomainFull: xDomainAuto,
    xView,
    xScale,
    yScale,
    clipId,
    pointer,
    container: input.container,
    registerSeries: (source) => {
      const entry: ExtentEntry = { source }
      extents.push(entry)
      return () => {
        const index = extents.indexOf(entry)
        if (index >= 0)
          extents.splice(index, 1)
      }
    },
    allocateColor: () => ChartPalette.categoricalVar(colorSlot++),
    registerBar: (entry) => {
      barEntries.push(entry)
      return () => {
        const index = barEntries.indexOf(entry)
        if (index >= 0)
          barEntries.splice(index, 1)
      }
    },
    barLayout,
    xStops,
    nearestXStop,
    registerKeyLayer: (layer) => {
      keyLayers.push(layer)
      return () => {
        const index = keyLayers.indexOf(layer)
        if (index >= 0)
          keyLayers.splice(index, 1)
      }
    },
    keyLayers,
    immediate: ref(false),
    gesture: ref<ChartGesture>(null),
    zoomable: ref(false),
    announcement: ref(''),
  }
}
