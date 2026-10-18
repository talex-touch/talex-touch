// The pointer contract TxEChart lays over ECharts' own roam. ECharts zooms on
// any wheel over a roam area and keeps the page from scrolling; here a plain
// wheel stays the page's and only ⌘/Ctrl + wheel (how a trackpad pinch arrives)
// zooms. Inside dataZooms also offer a grab only once there is somewhere to pan.

import type { EChartsOption } from 'echarts'
import { wheelZoomFactor } from '../../../../../../../utils/gesture'

/** What a decorated option asks of the pointer. */
export interface EChartInteraction {
  /** Every enabled inside dataZoom, by id; TxEChart assigns ids the option left out. */
  zoomIds: string[]
  /** Inside dataZooms whose cursor and move handling TxEChart drives; the option set neither. */
  managedZoomIds: string[]
  /** Inside dataZooms that open on a narrowed window. */
  zoomedIds: string[]
  /** Something zooms on the wheel: an inside dataZoom or a zooming `roam`. */
  wheelZoom: boolean
  /** Series indexes of treemaps that roam, which a double-click lays out afresh. */
  treemaps: number[]
}

/** Cursor and move handling for inside dataZooms, before and after zooming in. */
export interface EChartPanState {
  cursorGrab: string
  cursorGrabbing: string
  preventDefaultMouseMove: boolean
}

/**
 * At the full range a drag has nothing to move, so the plot keeps the read
 * cursor and lets a touch drag scroll the page; zoomed in, it can be grabbed.
 */
export function panState(zoomed: boolean): EChartPanState {
  return zoomed
    ? { cursorGrab: 'grab', cursorGrabbing: 'grabbing', preventDefaultMouseMove: true }
    : { cursorGrab: 'crosshair', cursorGrabbing: 'crosshair', preventDefaultMouseMove: false }
}

const ZOOM_EPSILON = 1e-6

/** Whether a dataZoom window, in percent, is narrower than the full range. */
export function isZoomedWindow(start: number | undefined, end: number | undefined): boolean {
  return (start ?? 0) > ZOOM_EPSILON || (end ?? 100) < 100 - ZOOM_EPSILON
}

const PAN_KEYS = ['cursorGrab', 'cursorGrabbing', 'preventDefaultMouseMove'] as const
type PreparedDataZoom = { entry: Record<string, unknown>, managed: true } | { entry: unknown, managed: false }
const ZOOMING_ROAMS = new Set<unknown>([true, 'scale', 'zoom'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asList(value: unknown): unknown[] {
  if (value === undefined || value === null)
    return []
  return Array.isArray(value) ? value : [value]
}

const WINDOW_KEYS = ['start', 'end', 'startValue', 'endValue'] as const

/** The narrowed windows, in percent, of the dataZooms as a chart reports them, by id. */
function narrowedWindows(reported: unknown): Map<string, { start: number, end: number }> {
  const windows = new Map<string, { start: number, end: number }>()
  for (const item of asList(reported)) {
    if (!isRecord(item) || (typeof item.id !== 'string' && typeof item.id !== 'number'))
      continue
    const start = numberOrUndefined(item.start)
    const end = numberOrUndefined(item.end)
    if (start !== undefined && end !== undefined && isZoomedWindow(start, end))
      windows.set(String(item.id), { start, end })
  }
  return windows
}

/**
 * Gives every inside dataZoom an id, so a reset can address it, and the pan
 * state matching the window it opens on. A dataZoom that sets its own cursor
 * or move handling is left as the option wrote it. One that sets no window
 * keeps the one `reported` (the chart's dataZooms before this option) has
 * narrowed it to: applying an option starts the components over.
 */
export function prepareInteraction(
  option: EChartsOption,
  reported?: unknown,
): { option: EChartsOption, interaction: EChartInteraction } {
  const interaction: EChartInteraction = { zoomIds: [], managedZoomIds: [], zoomedIds: [], wheelZoom: false, treemaps: [] }
  const carried = narrowedWindows(reported)

  const identified = asList(option.dataZoom).map((item, index): PreparedDataZoom => {
    if (!isRecord(item) || item.type !== 'inside' || item.disabled === true)
      return { entry: item, managed: false }
    const id = typeof item.id === 'string' || typeof item.id === 'number' ? String(item.id) : `tx-dz-${index}`
    const kept = WINDOW_KEYS.some(key => item[key] !== undefined) ? undefined : carried.get(id)
    const entry = kept ? { ...item, ...kept } : item
    interaction.zoomIds.push(id)
    if (entry.startValue !== undefined || entry.endValue !== undefined
      || isZoomedWindow(numberOrUndefined(entry.start), numberOrUndefined(entry.end))) {
      interaction.zoomedIds.push(id)
    }
    if (entry.zoomLock !== true)
      interaction.wheelZoom = true
    if (PAN_KEYS.some(key => entry[key] !== undefined))
      return { entry: { ...entry, id }, managed: false }
    interaction.managedZoomIds.push(id)
    return { entry: { ...entry, id }, managed: true }
  })
  // One grid merges the cursors of all its dataZooms, so they share one state.
  const pan = panState(interaction.managedZoomIds.some(id => interaction.zoomedIds.includes(id)))
  const dataZooms = identified.map(item => item.managed ? { ...item.entry, ...pan } : item.entry)

  asList(option.series).forEach((series, index) => {
    if (!isRecord(series))
      return
    if (ZOOMING_ROAMS.has(series.roam))
      interaction.wheelZoom = true
    if (series.type === 'treemap' && series.roam !== undefined && series.roam !== false)
      interaction.treemaps.push(index)
  })
  if (asList(option.geo).some(geo => isRecord(geo) && ZOOMING_ROAMS.has(geo.roam)))
    interaction.wheelZoom = true

  if (!dataZooms.length)
    return { option, interaction }
  return { option: { ...option, dataZoom: dataZooms as EChartsOption['dataZoom'] }, interaction }
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** One dataZoom window a `datazoom` event reports. */
export interface DataZoomWindow {
  /** Absent when the action addressed every dataZoom at once. */
  dataZoomId?: string
  start?: number
  end?: number
  /** True when the window was given in data values, so its percent is unknown here. */
  byValue: boolean
}

/** The windows a `datazoom` event carries: one per batch item, or the event itself. */
export function readDataZoomEvent(params: unknown): DataZoomWindow[] {
  if (!isRecord(params))
    return []
  const items = Array.isArray(params.batch) ? params.batch : [params]
  return items.filter(isRecord).map(item => ({
    ...(typeof item.dataZoomId === 'string' ? { dataZoomId: item.dataZoomId } : {}),
    start: numberOrUndefined(item.start),
    end: numberOrUndefined(item.end),
    byValue: item.startValue !== undefined || item.endValue !== undefined,
  }))
}

/** ECharts' own zoom for one wheel event: the `zrDelta` magnitude it reads, and the factor it applies. */
const ECHARTS_WHEEL_STEPS: ReadonlyArray<readonly [delta: number, factor: number]> = [[4, 1.4], [2, 1.2], [0.5, 1.1]]

/**
 * Turns zoom-wheel pixels into the `zrDelta` ECharts reads, so its roam zooms
 * by the same amount as the rest of the suite (√2 per mouse notch, a pinch's
 * small deltas adding up to the same). ECharts zooms by a fixed 1.1, 1.2 or 1.4
 * per event; the remainder carries to the next event and is dropped after a pause.
 */
export function createWheelZoomStepper(idleMs = 250): (pixels: number, time: number) => number {
  let carry = 0
  let last = Number.NEGATIVE_INFINITY
  return (pixels, time) => {
    if (!(time - last <= idleMs))
      carry = 0
    last = time
    carry += Math.log(wheelZoomFactor(pixels))
    for (const [delta, factor] of ECHARTS_WHEEL_STEPS) {
      const step = Math.log(factor)
      if (Math.abs(carry) >= step) {
        const sign = Math.sign(carry)
        carry -= sign * step
        return sign * delta
      }
    }
    return 0
  }
}
