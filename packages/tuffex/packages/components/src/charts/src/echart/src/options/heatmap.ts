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
  /**
   * The text printed inside a cell under `showLabel` — a value with fixed
   * decimals, say. Announcements speak it as `{value}` in `labels.cell`.
   * Without it a cell prints its value as is. Define it once in script: a new
   * function is a new option, which redraws the chart.
   */
  cellLabel?: (cell: HeatmapCell) => string
  /** Suffix appended to tooltip values, e.g. `'次'`. */
  unit?: string
  /**
   * Drag across the plot to select a block of cells, emitted through `select`
   * and `v-model:selection`; a click or Escape clears it, and so does the
   * exposed `clearSelection()`. @default true
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
  /**
   * Announced after a selection. `{count}` and `{total}` are cell counts;
   * `{first}` and `{last}` name the block's corner cells — its first row and
   * column, and its last — as `cell` puts them.
   */
  selected: string
  /** Announced when the selection is cleared. */
  cleared: string
  /**
   * How `{first}` and `{last}` name a cell: `{column}` and `{row}` are its
   * labels, `{value}` its printed text (see `cellLabel`), empty where the
   * matrix has no value.
   */
  cell: string
}

export const HEATMAP_DEFAULT_LABELS: HeatmapLabels = {
  instructions: 'Drag across the cells to select a block of them. Click or press Escape to clear the selection.',
  selected: 'Selected {count} of {total} cells.',
  cleared: 'Selection cleared.',
  cell: '{column} {row}',
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
      const cell = heatmapCell(props, row, column)
      if (cell)
        cells.push(cell)
    }
  }
  return { rows: rowRange, columns: columnRange, cells }
}

/** The cell at one position, with its labels; `null` where the matrix has no value. */
export function heatmapCell(
  props: Pick<HeatmapChartProps, 'values' | 'rows' | 'columns'>,
  row: number,
  column: number,
): HeatmapCell | null {
  const value = props.values[row]?.[column]
  if (typeof value !== 'number')
    return null
  return { row, column, rowLabel: props.rows[row] ?? '', columnLabel: props.columns[column] ?? '', value }
}

/** What a cell prints under `showLabel`: `cellLabel`'s text, else the value as is. */
export function heatmapCellText(props: Pick<HeatmapChartProps, 'cellLabel'>, cell: HeatmapCell): string {
  return props.cellLabel ? props.cellLabel(cell) : String(cell.value)
}

function orderedRange([a, b]: [number, number], count: number): [number, number] {
  const last = Math.max(0, count - 1)
  const clamp = (index: number) => Math.min(last, Math.max(0, Math.round(index)))
  return [clamp(Math.min(a, b)), clamp(Math.max(a, b))]
}

/** Pure option builder — colours, axes and grid chrome come from TxEChart. */
export function buildHeatmapChartOption(props: HeatmapChartProps): EChartsOption {
  const { values, rows, columns, xAxisName, yAxisName, unit, cellLabel } = props
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
        label: {
          show: showLabel,
          // ECharts hands the formatter the plotted `[column, row, value]` triple.
          ...(cellLabel
            ? {
                formatter: ({ value }: { value?: unknown }) => {
                  const [column, row] = Array.isArray(value) ? value : []
                  const cell = typeof column === 'number' && typeof row === 'number' ? heatmapCell(props, row, column) : null
                  return cell ? heatmapCellText(props, cell) : ''
                },
              }
            : {}),
        },
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
