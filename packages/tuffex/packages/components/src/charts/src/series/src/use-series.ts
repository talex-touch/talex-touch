import type { ComputedRef } from 'vue'
import type { TxChartContext } from '../../core/context'
import type { SeriesExtent } from '../../core/types'
import type { CartesianSeriesProps } from './types'
import { computed, onBeforeUnmount } from 'vue'
import { resolveBand, resolveNumber } from '../../core/accessor'
import { useChartContext } from '../../core/context'

let seriesUid = 0

export function nextSeriesUid(): number {
  return ++seriesUid
}

export interface SeriesPoint {
  /** Raw x value: number for continuous scales, string|number for bands. */
  x: string | number
  y: number
  index: number
}

export interface UseCartesianSeriesOptions {
  component: string
  /** Extend the reported y extent to include zero (bars). @default false */
  includeZeroY?: boolean
  /** Skip y extent reporting (stacked bars contribute via stack totals). */
  reportY?: () => boolean
}

export interface CartesianSeries {
  ctx: TxChartContext
  color: ComputedRef<string>
  points: ComputedRef<SeriesPoint[]>
}

export function useCartesianSeries<T>(
  props: CartesianSeriesProps<T>,
  options: UseCartesianSeriesOptions,
): CartesianSeries {
  const ctx = useChartContext(options.component)

  const allocated = ctx.allocateColor()
  const color = computed(() => props.color ?? allocated)

  const points = computed<SeriesPoint[]>(() => {
    const list: SeriesPoint[] = []
    props.data.forEach((datum, index) => {
      const raw = resolveBand(datum, index, props.x)
      const x = ctx.xType.value === 'band' ? raw : Number(raw)
      // A log axis has no place for zero or below; such a datum is not drawn.
      if (ctx.xType.value === 'log' && !((x as number) > 0))
        return
      list.push({ x, y: resolveNumber(datum, index, props.y), index })
    })
    return list
  })

  const extent = computed<SeriesExtent | null>(() => {
    const list = points.value
    if (list.length === 0)
      return null

    const result: SeriesExtent = {}
    if (ctx.xType.value === 'band') {
      result.xBand = list.map(point => point.x)
    }
    else {
      let lo = Infinity
      let hi = -Infinity
      const values: number[] = []
      for (const point of list) {
        const value = Number(point.x)
        lo = Math.min(lo, value)
        hi = Math.max(hi, value)
        values.push(value)
      }
      result.x = lo <= hi ? [lo, hi] : null
      result.xValues = values
    }

    if (options.reportY?.() === false) {
      result.y = null
    }
    else {
      let lo = options.includeZeroY ? 0 : Infinity
      let hi = options.includeZeroY ? 0 : -Infinity
      for (const point of list) {
        lo = Math.min(lo, point.y)
        hi = Math.max(hi, point.y)
      }
      result.y = lo <= hi ? [lo, hi] : null
    }
    return result
  })

  const unregister = ctx.registerSeries(extent)
  onBeforeUnmount(unregister)

  return { ctx, color, points }
}
