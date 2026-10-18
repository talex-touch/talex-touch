import type { EChartsOption } from 'echarts'
import type { EChartSharedProps } from '../core/types'
import { mergeChartOption } from '../core/shared'

export interface ScatterSeriesInput {
  name: string
  /** One `[x, y]` point per observation. */
  data: Array<[number, number]>
  color?: string
  /** Dot diameter in px; overrides the chart-level size. */
  symbolSize?: number
}

export interface ScatterChartProps extends EChartSharedProps {
  series: ScatterSeriesInput[]
  xAxisName?: string
  yAxisName?: string
  /** Dot diameter in px for every series. @default 8 */
  symbolSize?: number
  /** @default true when more than one series is passed */
  showLegend?: boolean
  /** Split lines behind the points. @default true */
  grid?: boolean
  xMin?: number
  xMax?: number
  yMin?: number
  yMax?: number
  /**
   * Zoom and pan both axes: ⌘/Ctrl + wheel or a pinch zooms around the pointer,
   * a drag pans once zoomed in, and a double-click returns to the full range.
   * @default true
   */
  zoom?: boolean
  /** Plain wheel scrolls the page; see `TxEChart`. @default true */
  cooperativeWheel?: boolean
}

/** Pure option builder — colours, axes and legend styling come from TxEChart. */
export function buildScatterChartOption(props: ScatterChartProps): EChartsOption {
  const { series, xAxisName, yAxisName, symbolSize = 8, grid = true, zoom = true } = props
  const showLegend = props.showLegend ?? series.length > 1

  return mergeChartOption<EChartsOption>({
    ...(showLegend ? { legend: {} } : {}),
    grid: {},
    tooltip: {
      trigger: 'item',
      axisPointer: { type: 'cross' },
    },
    ...(zoom
      ? {
          dataZoom: [
            { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
            { type: 'inside', yAxisIndex: 0, filterMode: 'none' },
          ],
        }
      : {}),
    xAxis: {
      type: 'value',
      ...(grid ? {} : { splitLine: { show: false } }),
      ...(xAxisName ? { name: xAxisName } : {}),
      ...bounds('min', props.xMin),
      ...bounds('max', props.xMax),
    },
    yAxis: {
      type: 'value',
      ...(grid ? {} : { splitLine: { show: false } }),
      ...(yAxisName ? { name: yAxisName } : {}),
      ...bounds('min', props.yMin),
      ...bounds('max', props.yMax),
    },
    series: series.map(entry => ({
      name: entry.name,
      type: 'scatter',
      data: entry.data,
      symbolSize: entry.symbolSize ?? symbolSize,
      itemStyle: {
        ...(entry.color ? { color: entry.color } : {}),
      },
      emphasis: { focus: 'series' as const },
    })),
  })
}

/** An axis bound is only declared when the caller passed one. */
function bounds(key: 'min' | 'max', value: number | undefined): Record<string, number> {
  return value === undefined ? {} : { [key]: value }
}
