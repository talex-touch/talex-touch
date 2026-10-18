import type { EChartsOption } from 'echarts'
import type { EChartEmits, EChartSharedProps } from '../core/types'
import { mergeChartOption } from '../core/shared'

export interface HeatmapChartProps extends EChartSharedProps {
  /**
   * Cell values as a row-major matrix: `values[row][column]`, so the outer
   * array follows `rows` and the inner array follows `columns`.
   */
  values: number[][]
  /**
   * Y-axis category labels, passed through untouched — ECharts plots the first
   * category on the bottom, so the first entry reads as the lowest row.
   */
  rows: string[]
  /** X-axis category labels, left to right. */
  columns: string[]
  xAxisName?: string
  yAxisName?: string
  /** Continuous colour scale under the plot. @default true */
  visualMap?: boolean
  /** Bottom of the colour scale; ECharts derives it from the data when omitted. */
  min?: number
  /** Top of the colour scale; ECharts derives it from the data when omitted. */
  max?: number
  /** Print each cell's value inside its cell. @default false */
  showLabel?: boolean
  /** Suffix appended to tooltip values, e.g. `'次'`. */
  unit?: string
  /**
   * Drag across the plot to select a block of cells, emitted through `select`;
   * a click or Escape clears it. @default true
   */
  selectable?: boolean
  /** Instructions and announcements for the selection. */
  labels?: Partial<HeatmapLabels>
}

/** One selected cell, with the labels it is drawn under. */
export interface HeatmapCell {
  row: number
  column: number
  rowLabel: string
  columnLabel: string
  value: number
}

/** A block of cells chosen by dragging across the plot. */
export interface HeatmapSelection {
  /** First and last selected row index, inclusive. */
  rows: [number, number]
  /** First and last selected column index, inclusive. */
  columns: [number, number]
  /** Every selected cell that has a value, row by row, left to right. */
  cells: HeatmapCell[]
}

export interface HeatmapLabels {
  /** Describes the selection to assistive technology. */
  instructions: string
  /** Announced after a selection; `{count}` and `{total}` are cell counts. */
  selected: string
  /** Announced when the selection is cleared. */
  cleared: string
}

export const HEATMAP_DEFAULT_LABELS: HeatmapLabels = {
  instructions: 'Drag across the cells to select a block of them. Click or press Escape to clear the selection.',
  selected: 'Selected {count} of {total} cells.',
  cleared: 'Selection cleared.',
}

/** The ECharts family's events, plus the selection. */
export type HeatmapChartEmits = EChartEmits & {
  /** A drag selected a block of cells; `null` once the selection is cleared. */
  (e: 'select', selection: HeatmapSelection | null): void
}

/**
 * The cells inside a block of rows and columns, given in either order. Indexes
 * are clamped to the matrix; positions the matrix leaves empty are skipped.
 */
export function heatmapSelection(
  props: Pick<HeatmapChartProps, 'values' | 'rows' | 'columns'>,
  rows: [number, number],
  columns: [number, number],
): HeatmapSelection {
  const rowRange = orderedRange(rows, props.rows.length)
  const columnRange = orderedRange(columns, props.columns.length)
  const cells: HeatmapCell[] = []
  for (let row = rowRange[0]; row <= rowRange[1]; row++) {
    for (let column = columnRange[0]; column <= columnRange[1]; column++) {
      const value = props.values[row]?.[column]
      if (typeof value !== 'number')
        continue
      cells.push({ row, column, rowLabel: props.rows[row] ?? '', columnLabel: props.columns[column] ?? '', value })
    }
  }
  return { rows: rowRange, columns: columnRange, cells }
}

function orderedRange([a, b]: [number, number], count: number): [number, number] {
  const last = Math.max(0, count - 1)
  const clamp = (index: number) => Math.min(last, Math.max(0, Math.round(index)))
  return [clamp(Math.min(a, b)), clamp(Math.max(a, b))]
}

/** Pure option builder — colours, axes and grid chrome come from TxEChart. */
export function buildHeatmapChartOption(props: HeatmapChartProps): EChartsOption {
  const { values, rows, columns, xAxisName, yAxisName, unit } = props
  const showVisualMap = props.visualMap ?? true
  const showLabel = props.showLabel ?? false

  return mergeChartOption<EChartsOption>({
    tooltip: {
      trigger: 'item',
      ...(unit ? { valueFormatter: (value: unknown) => valueText(value, unit) } : {}),
    },
    grid: {},
    ...(showVisualMap
      ? {
          visualMap: {
            type: 'continuous',
            orient: 'horizontal',
            left: 'center',
            bottom: 0,
            ...(props.min === undefined ? {} : { min: props.min }),
            ...(props.max === undefined ? {} : { max: props.max }),
          },
        }
      : {}),
    xAxis: {
      type: 'category',
      data: columns,
      ...(xAxisName ? { name: xAxisName } : {}),
    },
    yAxis: {
      type: 'category',
      data: rows,
      ...(yAxisName ? { name: yAxisName } : {}),
    },
    series: [
      {
        type: 'heatmap',
        data: heatmapCells(values),
        label: { show: showLabel },
        emphasis: { focus: 'self' },
      },
    ],
  })
}

/**
 * Flattens the matrix into the `[columnIndex, rowIndex, value]` triples ECharts
 * plots, in `values` order — row by row, left to right.
 */
function heatmapCells(values: number[][]): Array<[number, number, number]> {
  const cells: Array<[number, number, number]> = []
  values.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      cells.push([columnIndex, rowIndex, value])
    })
  })
  return cells
}

/** Tooltip text for one value: the raw value with the caller's unit appended. */
function valueText(value: unknown, unit: string): string {
  return value === undefined || value === null ? '' : `${String(value)}${unit}`
}
