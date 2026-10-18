export interface ScreenshotGeometryPoint {
  x: number
  y: number
}

export interface ScreenshotGeometryRect {
  x: number
  y: number
  width: number
  height: number
}

export type ScreenshotResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
export type ScreenshotNudgeDirection = 'left' | 'right' | 'up' | 'down'
/**
 * One of the nine points of a selection that stays fixed while its width/height change. This is
 * a sizing anchor, not a position: it never moves the selection to a desktop location.
 */
export type ScreenshotSelectionAnchor = ScreenshotResizeHandle | 'center'

export const SCREENSHOT_SELECTION_ANCHORS: readonly ScreenshotSelectionAnchor[] = [
  'nw',
  'n',
  'ne',
  'w',
  'center',
  'e',
  'sw',
  's',
  'se',
]

export interface ScreenshotResizeOptions {
  minSize?: number
  aspectRatio?: number
  /** Fixed point for manual and keyboard sizing; defaults to the top-left corner. */
  anchor?: ScreenshotSelectionAnchor
}

const DEFAULT_MIN_SIZE = 4

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function finiteRect(rect: ScreenshotGeometryRect): boolean {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  )
}

function normalizedMinSize(value: number | undefined): number {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.max(1, value!) : DEFAULT_MIN_SIZE
}

function normalizedRatio(value: number | undefined): number | undefined {
  return Number.isFinite(value) && (value ?? 0) > 0 ? value : undefined
}

function boundsEdges(bounds: ScreenshotGeometryRect): {
  left: number
  top: number
  right: number
  bottom: number
} {
  return {
    left: bounds.x,
    top: bounds.y,
    right: bounds.x + bounds.width,
    bottom: bounds.y + bounds.height,
  }
}

function clampedPoint(point: ScreenshotGeometryPoint, bounds: ScreenshotGeometryRect): ScreenshotGeometryPoint {
  const edges = boundsEdges(bounds)
  return {
    x: clamp(point.x, edges.left, edges.right),
    y: clamp(point.y, edges.top, edges.bottom),
  }
}

export function createScreenshotSelection(
  start: ScreenshotGeometryPoint,
  end: ScreenshotGeometryPoint,
  bounds: ScreenshotGeometryRect,
  minSize = DEFAULT_MIN_SIZE,
): ScreenshotGeometryRect | null {
  if (!finiteRect(bounds)) return null
  const from = clampedPoint(start, bounds)
  const to = clampedPoint(end, bounds)
  const rect = {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  }
  const minimum = normalizedMinSize(minSize)
  return rect.width >= minimum && rect.height >= minimum ? rect : null
}

export function moveScreenshotSelection(
  selection: ScreenshotGeometryRect,
  deltaX: number,
  deltaY: number,
  bounds: ScreenshotGeometryRect,
): ScreenshotGeometryRect {
  if (!finiteRect(selection) || !finiteRect(bounds)) return { ...selection }
  const edges = boundsEdges(bounds)
  const width = Math.min(selection.width, bounds.width)
  const height = Math.min(selection.height, bounds.height)
  return {
    x: clamp(selection.x + deltaX, edges.left, edges.right - width),
    y: clamp(selection.y + deltaY, edges.top, edges.bottom - height),
    width,
    height,
  }
}

function applyAspectRatio(
  selection: ScreenshotGeometryRect,
  handle: ScreenshotResizeHandle,
  rawWidth: number,
  rawHeight: number,
  ratio: number,
  minimum: number,
  bounds: ScreenshotGeometryRect,
): ScreenshotGeometryRect {
  const horizontal = handle.includes('e') || handle.includes('w')
  const vertical = handle.includes('n') || handle.includes('s')
  let width = Math.max(minimum, rawWidth)
  let height = Math.max(minimum, rawHeight)

  if (horizontal && vertical) {
    if (width / height >= ratio) height = width / ratio
    else width = height * ratio
  } else if (horizontal) {
    height = width / ratio
  } else {
    width = height * ratio
  }

  const anchorX = handle.includes('w')
    ? selection.x + selection.width
    : handle.includes('e')
      ? selection.x
      : selection.x + selection.width / 2
  const anchorY = handle.includes('n')
    ? selection.y + selection.height
    : handle.includes('s')
      ? selection.y
      : selection.y + selection.height / 2
  const availableWidth = handle.includes('w')
    ? anchorX - bounds.x
    : handle.includes('e')
      ? bounds.x + bounds.width - anchorX
      : Math.min(anchorX - bounds.x, bounds.x + bounds.width - anchorX) * 2
  const availableHeight = handle.includes('n')
    ? anchorY - bounds.y
    : handle.includes('s')
      ? bounds.y + bounds.height - anchorY
      : Math.min(anchorY - bounds.y, bounds.y + bounds.height - anchorY) * 2
  const scale = Math.min(1, availableWidth / width, availableHeight / height)
  width *= scale
  height *= scale

  return {
    x: handle.includes('w') ? anchorX - width : handle.includes('e') ? anchorX : anchorX - width / 2,
    y: handle.includes('n') ? anchorY - height : handle.includes('s') ? anchorY : anchorY - height / 2,
    width,
    height,
  }
}

export function resizeScreenshotSelection(
  selection: ScreenshotGeometryRect,
  handle: ScreenshotResizeHandle,
  deltaX: number,
  deltaY: number,
  bounds: ScreenshotGeometryRect,
  options: ScreenshotResizeOptions = {},
): ScreenshotGeometryRect {
  if (!finiteRect(selection) || !finiteRect(bounds)) return { ...selection }
  const minimum = normalizedMinSize(options.minSize)
  const edges = boundsEdges(bounds)
  let left = selection.x
  let top = selection.y
  let right = selection.x + selection.width
  let bottom = selection.y + selection.height

  if (handle.includes('w')) left = clamp(left + deltaX, edges.left, right - minimum)
  if (handle.includes('e')) right = clamp(right + deltaX, left + minimum, edges.right)
  if (handle.includes('n')) top = clamp(top + deltaY, edges.top, bottom - minimum)
  if (handle.includes('s')) bottom = clamp(bottom + deltaY, top + minimum, edges.bottom)

  const ratio = normalizedRatio(options.aspectRatio)
  if (ratio) {
    return applyAspectRatio(selection, handle, right - left, bottom - top, ratio, minimum, bounds)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function anchorFactors(anchor: ScreenshotSelectionAnchor): { x: number, y: number } {
  if (anchor === 'center') return { x: 0.5, y: 0.5 }
  return {
    x: anchor.includes('w') ? 0 : anchor.includes('e') ? 1 : 0.5,
    y: anchor.includes('n') ? 0 : anchor.includes('s') ? 1 : 0.5,
  }
}

/** Room for an edge that grows away from an anchor at `factor` (0 start, 0.5 centre, 1 end). */
function availableExtent(anchor: number, factor: number, start: number, end: number): number {
  if (factor === 0) return end - anchor
  if (factor === 1) return anchor - start
  return 2 * Math.min(anchor - start, end - anchor)
}

export function screenshotSelectionAnchorPoint(
  selection: ScreenshotGeometryRect,
  anchor: ScreenshotSelectionAnchor,
): ScreenshotGeometryPoint {
  const factors = anchorFactors(anchor)
  return {
    x: selection.x + selection.width * factors.x,
    y: selection.y + selection.height * factors.y,
  }
}

/**
 * Sets width/height while the chosen anchor point stays where it is. When the requested size does
 * not fit inside `bounds` around that anchor, the size shrinks; the anchor never moves.
 */
export function setScreenshotSelectionSize(
  selection: ScreenshotGeometryRect,
  width: number,
  height: number,
  bounds: ScreenshotGeometryRect,
  options: ScreenshotResizeOptions = {},
): ScreenshotGeometryRect {
  if (!finiteRect(selection) || !finiteRect(bounds)) return { ...selection }
  const minimum = normalizedMinSize(options.minSize)
  const ratio = normalizedRatio(options.aspectRatio)
  const factors = anchorFactors(options.anchor ?? 'nw')
  const anchor = screenshotSelectionAnchorPoint(selection, options.anchor ?? 'nw')
  let nextWidth = Math.max(minimum, Number.isFinite(width) ? width : selection.width)
  let nextHeight = Math.max(minimum, Number.isFinite(height) ? height : selection.height)
  if (ratio) nextHeight = nextWidth / ratio
  nextWidth = Math.min(
    nextWidth,
    Math.max(0, availableExtent(anchor.x, factors.x, bounds.x, bounds.x + bounds.width)),
  )
  nextHeight = Math.min(
    nextHeight,
    Math.max(0, availableExtent(anchor.y, factors.y, bounds.y, bounds.y + bounds.height)),
  )
  if (ratio && nextWidth / nextHeight !== ratio) {
    nextWidth = Math.min(nextWidth, nextHeight * ratio)
    nextHeight = nextWidth / ratio
  }
  return {
    x: anchor.x - nextWidth * factors.x,
    y: anchor.y - nextHeight * factors.y,
    width: nextWidth,
    height: nextHeight,
  }
}

/**
 * Arrow keys move the selection; with `resize`, they change its size. When `options.anchor` is
 * set, right/down grow and left/up shrink around that fixed anchor; otherwise the edge facing the
 * arrow moves.
 */
export function nudgeScreenshotSelection(
  selection: ScreenshotGeometryRect,
  direction: ScreenshotNudgeDirection,
  resize: boolean,
  bounds: ScreenshotGeometryRect,
  amount = 1,
  options: ScreenshotResizeOptions = {},
): ScreenshotGeometryRect {
  if (!resize) {
    return moveScreenshotSelection(
      selection,
      direction === 'left' ? -amount : direction === 'right' ? amount : 0,
      direction === 'up' ? -amount : direction === 'down' ? amount : 0,
      bounds,
    )
  }
  if (options.anchor) {
    const ratio = normalizedRatio(options.aspectRatio)
    const widthDelta = direction === 'left' ? -amount : direction === 'right' ? amount : 0
    const heightDelta = direction === 'up' ? -amount : direction === 'down' ? amount : 0
    const nextHeight = selection.height + heightDelta
    const nextWidth = ratio && heightDelta !== 0 ? nextHeight * ratio : selection.width + widthDelta
    return setScreenshotSelectionSize(selection, nextWidth, nextHeight, bounds, options)
  }
  const handle: ScreenshotResizeHandle =
    direction === 'left' ? 'w' : direction === 'right' ? 'e' : direction === 'up' ? 'n' : 's'
  return resizeScreenshotSelection(
    selection,
    handle,
    direction === 'left' ? -amount : direction === 'right' ? amount : 0,
    direction === 'up' ? -amount : direction === 'down' ? amount : 0,
    bounds,
    options,
  )
}

/**
 * One cell of a 3×3 grid over `region`, in reading order (0 top-left … 8 bottom-right). This is
 * the keyboard navigation grid that narrows a region; it is unrelated to sizing anchors.
 */
export function screenshotGridCell(
  region: ScreenshotGeometryRect,
  index: number,
): ScreenshotGeometryRect | null {
  if (!finiteRect(region) || !Number.isInteger(index) || index < 0 || index > 8) return null
  const column = index % 3
  const row = Math.floor(index / 3)
  const left = region.x + (region.width * column) / 3
  const top = region.y + (region.height * row) / 3
  const right = region.x + (region.width * (column + 1)) / 3
  const bottom = region.y + (region.height * (row + 1)) / 3
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function snapshotScreenshotSelection(selection: ScreenshotGeometryRect): ScreenshotGeometryRect {
  return {
    x: selection.x,
    y: selection.y,
    width: selection.width,
    height: selection.height,
  }
}

export function projectScreenshotSelection(
  selection: ScreenshotGeometryRect,
  displayBounds: ScreenshotGeometryRect,
): ScreenshotGeometryRect | null {
  if (!finiteRect(selection) || !finiteRect(displayBounds)) return null
  const left = Math.max(selection.x, displayBounds.x)
  const top = Math.max(selection.y, displayBounds.y)
  const right = Math.min(selection.x + selection.width, displayBounds.x + displayBounds.width)
  const bottom = Math.min(selection.y + selection.height, displayBounds.y + displayBounds.height)
  if (right <= left || bottom <= top) return null
  return {
    x: left - displayBounds.x,
    y: top - displayBounds.y,
    width: right - left,
    height: bottom - top,
  }
}
