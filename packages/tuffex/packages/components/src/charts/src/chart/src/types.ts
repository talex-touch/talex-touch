import type { ChartPadding, ScaleKind } from '../../core/types'

export interface ChartProps {
  /**
   * Chart height in pixels. Ignored when `aspectRatio` is set.
   * @default 350
   */
  height?: number
  /**
   * Container aspect ratio as width / height (e.g. `1.7` or `'16 / 9'`).
   * When set, height derives from the rendered width via CSS `aspect-ratio`.
   */
  aspectRatio?: number | string
  /**
   * Explicit chart width in pixels. When omitted the chart measures its
   * container (ResizeObserver). Useful for SSR and tests.
   */
  width?: number
  /** Uniform or per-side inner padding reserved for axes and labels. @default 24 */
  padding?: number | Partial<ChartPadding>
  /** Kind of x scale shared by all series. @default 'linear' */
  xType?: ScaleKind
  /**
   * Explicit x domain. Continuous scales take `[min, max]`; band scales take
   * the ordered band values. Omit to derive from the mounted series.
   */
  xDomain?: Array<string | number>
  /** Explicit y domain `[min, max]`. Omit to derive from the mounted series. */
  yDomain?: [number, number]
  /** Extend the derived y domain to rounded bounds. @default true */
  yNice?: boolean
  /**
   * Accessible description announced for the chart. See the W3C guidance on
   * complex images for writing a meaningful one.
   */
  ariaDescription?: string
  /**
   * Read values by hovering, press-dragging and the arrow keys. `false` leaves
   * a static picture: no focus stop, no reading. @default true
   */
  interactive?: boolean
  /**
   * Live-region text for a keyboard reading at an x value. Defaults to the
   * value formatted the way the x axis formats its ticks.
   */
  announce?: (x: string | number) => string
  /** Accessible name and keyboard instructions. English by default. */
  labels?: Partial<ChartLabels>
}

export interface ChartLabels {
  /** Name of the chart surface when `ariaDescription` is not set. */
  chart: string
  /** Keyboard instructions, read as the chart's description. */
  instructions: string
  /** Keyboard instructions for a chart that also zooms; read instead of `instructions` there. */
  zoomInstructions: string
}

export const CHART_DEFAULT_LABELS: ChartLabels = {
  chart: 'Chart',
  instructions: 'Use the left and right arrow keys to read values, Home and End to jump to the ends, and Escape to clear.',
  zoomInstructions: 'Use the left and right arrow keys to read values, plus and minus to zoom, Shift with the left and right arrow keys to pan, 0 to show everything, and Escape to clear.',
}
