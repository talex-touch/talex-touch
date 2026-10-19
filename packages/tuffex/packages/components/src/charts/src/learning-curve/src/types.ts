import type { ChartLabels } from '../../chart/src/types'
import type { RunCurve } from './smoothing'
import { CHART_DEFAULT_LABELS } from '../../chart/src/types'

/** One training run on a `TxLearningCurve`. */
export interface LearningCurveRun {
  /** Run name, shown in the tooltip. `hiddenRuns` and `highlightedRun` refer to runs by it. */
  name: string
  /** `[step, value]` pairs logged by a single seed. */
  data?: Array<[number, number]>
  /**
   * The same run under several seeds, each as `[step, value]` pairs. Drawn as
   * their mean with a ± one-standard-deviation band. Takes precedence over `data`.
   */
  seeds?: Array<Array<[number, number]>>
  /** Line color. Defaults to the categorical palette by run position. */
  color?: string
}

export interface LearningCurveLabels extends ChartLabels {
  /** Tooltip title and spoken reading for a step, given the formatted step. */
  step: (step: string) => string
  /** Tooltip label in front of the unsmoothed value. */
  raw: string
}

export const LEARNING_CURVE_DEFAULT_LABELS: LearningCurveLabels = {
  ...CHART_DEFAULT_LABELS,
  chart: 'Learning curve',
  step: step => `Step ${step}`,
  raw: 'raw',
}

export interface LearningCurveProps {
  /** Runs to compare. */
  runs: LearningCurveRun[]
  /**
   * Exponential-moving-average weight, `0` to `0.99`, debiased the way
   * TensorBoard smooths scalars. `0` draws the values as logged. @default 0.6
   */
  smoothing?: number
  /** Draw the unsmoothed values as a faint line under the smoothed one. @default true */
  showRaw?: boolean
  /** Draw the ± one-standard-deviation band of runs with several seeds. @default true */
  showBand?: boolean
  /** Step axis scale. `log` leaves out step 0 and below. @default 'linear' */
  xType?: 'linear' | 'log'
  /**
   * Zoom and pan the step axis on the chart: drag across a range to zoom into
   * it, drag a zoomed chart to pan, ⌘/Ctrl + wheel or a pinch to zoom around
   * the pointer, double-click to show every step. @default true
   */
  zoom?: boolean
  /**
   * Name of a run to emphasize: every other run dims. Drive it from legend
   * hover.
   */
  highlightedRun?: string | null
  /** Label for the step axis. */
  xAxisName?: string
  /** Label for the value axis. */
  yAxisName?: string
  /** Gap between the value axis and its name label in pixels. @default 56 */
  yAxisNameGap?: number
  /** Step-axis tick formatter. Defaults to SI prefixes: `200k`, `1.5M`. */
  xAxisTickFormat?: (step: number) => string
  /** Value-axis tick formatter. */
  yAxisTickFormat?: (value: number) => string
  /** Formats the step in the tooltip and the spoken reading. Defaults to grouped digits: `12,000`. */
  stepFormat?: (step: number) => string
  /** Formats values in the tooltip and the spoken reading. Defaults to four significant digits. */
  tooltipValueFormat?: (value: number) => string
  /** Chart height in pixels. @default 300 */
  height?: number
  /**
   * Explicit chart width in pixels. When omitted the chart measures its
   * container. Useful for SSR and tests.
   */
  width?: number
  /** Accessible description announced for the chart. */
  ariaDescription?: string
  /** Accessible name, keyboard instructions and tooltip wording. English by default. */
  labels?: Partial<LearningCurveLabels>
}

// ── Internal: what the component hands its drawing layer ────────────────────

/** A visible run, ready to draw. */
export interface DrawnRun {
  key: string
  color: string
  curve: RunCurve
}

/** The step being read, and the index each run reads it at. */
export interface CurveReadout {
  step: number
  points: Array<{ key: string, index: number }>
}
