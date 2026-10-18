// SPDX-License-Identifier: MPL-2.0
// Derived from Satty (https://github.com/Satty-org/Satty) at commit
// 1c198c65c251aadc74d4f138f03bc2741b4655b2: src/math.rs (Vec2D::snapped_vector_15deg,
// Vec2D::distance_to_segment, rect_ensure_positive_size, rect_ensure_in_bounds) and
// src/tools/mod.rs (hit_test_rectangle, hit_test_line, calculate_line_bounds).
// Copyright (c) Matthias Gabriel and Satty contributors.
// Modifications for Tuff: translated from Rust to TypeScript over plain {x, y} records, rect
// helpers take {x, y, width, height}, and the snapping helper guards its zero-vector
// precondition itself. See ./NOTICE.

export interface AnnotationPoint {
  x: number
  y: number
}

export interface AnnotationRect {
  x: number
  y: number
  width: number
  height: number
}

/** Satty's HIT_BORDER_TOLERANCE, in screen DIP; callers scale it into source pixels. */
export const HIT_BORDER_TOLERANCE_DIP = 7

const SNAP_STEP_RADIANS = 0.261_799_4

function isZeroVector(vector: AnnotationPoint): boolean {
  return Math.abs(vector.x) < Number.EPSILON && Math.abs(vector.y) < Number.EPSILON
}

/**
 * Satty `Vec2D::snapped_vector_15deg`: the vector rotated to the nearest 15° step with its length
 * kept and rounded to whole pixels. A zero vector is returned unchanged (upstream callers guard
 * `is_zero` before calling).
 */
export function snapVector15deg(vector: AnnotationPoint): AnnotationPoint {
  if (isZeroVector(vector)) return { x: vector.x, y: vector.y }
  const currentAngle = Math.atan(vector.y / vector.x)
  const norm2 = vector.x * vector.x + vector.y * vector.y
  const nextAngle = Math.round(currentAngle / SNAP_STEP_RADIANS) * SNAP_STEP_RADIANS
  let a: number
  let b: number
  if (Math.abs(nextAngle) < Math.PI / 4) {
    b = Math.sqrt(norm2 / (Math.tan(Math.PI / 2 - nextAngle) ** 2 + 1))
    a = Math.sqrt(norm2 - b * b)
  } else {
    a = Math.sqrt(norm2 / (Math.tan(nextAngle) ** 2 + 1))
    b = Math.sqrt(norm2 - a * a)
  }
  a = Math.round(a)
  b = Math.round(b)
  return { x: vector.x >= 0 ? a : -a, y: vector.y >= 0 ? b : -b }
}

/** Satty `Vec2D::distance_to_segment`. */
export function distanceToSegment(
  point: AnnotationPoint,
  start: AnnotationPoint,
  end: AnnotationPoint
): number {
  const abX = end.x - start.x
  const abY = end.y - start.y
  if (isZeroVector({ x: abX, y: abY })) return Math.hypot(point.x - start.x, point.y - start.y)
  const factor = Math.min(
    1,
    Math.max(0, ((point.x - start.x) * abX + (point.y - start.y) * abY) / (abX * abX + abY * abY))
  )
  return Math.hypot(point.x - (start.x + abX * factor), point.y - (start.y + abY * factor))
}

/** Satty `rect_ensure_positive_size`: a reversed drag becomes a positive rectangle. */
export function rectFromPoints(start: AnnotationPoint, end: AnnotationPoint): AnnotationRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  }
}

/**
 * Satty `rect_ensure_in_bounds` against `(0, 0)-(width, height)`: the part of `rect` inside the
 * image, or a zero rectangle when it lies entirely outside.
 */
export function clipRectToImage(
  rect: AnnotationRect,
  width: number,
  height: number
): AnnotationRect {
  let { x, y, width: rectWidth, height: rectHeight } = rect
  if (x + rectWidth < 0 || y + rectHeight < 0 || x > width || y > height) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  if (x < 0) {
    rectWidth = Math.max(0, rectWidth + x)
    x = 0
  }
  if (y < 0) {
    rectHeight = Math.max(0, rectHeight + y)
    y = 0
  }
  if (x + rectWidth > width) rectWidth = width - x
  if (y + rectHeight > height) rectHeight = height - y
  return { x, y, width: rectWidth, height: rectHeight }
}

/** Satty `hit_test_rectangle`: border-only unless `filled`. */
export function hitTestRectangle(
  point: AnnotationPoint,
  rect: AnnotationRect,
  tolerance: number,
  filled: boolean
): boolean {
  const left = Math.min(rect.x, rect.x + rect.width)
  const top = Math.min(rect.y, rect.y + rect.height)
  const right = Math.max(rect.x, rect.x + rect.width)
  const bottom = Math.max(rect.y, rect.y + rect.height)
  if (
    point.x < left - tolerance ||
    point.x > right + tolerance ||
    point.y < top - tolerance ||
    point.y > bottom + tolerance
  ) {
    return false
  }
  if (filled) return true
  return (
    point.x < left + tolerance ||
    point.x > right - tolerance ||
    point.y < top + tolerance ||
    point.y > bottom - tolerance
  )
}

/** Satty `hit_test_line` over absolute points. */
export function hitTestPolyline(
  point: AnnotationPoint,
  points: readonly AnnotationPoint[],
  tolerance: number
): boolean {
  if (points.length === 1)
    return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= tolerance
  for (let index = 1; index < points.length; index += 1) {
    if (distanceToSegment(point, points[index - 1], points[index]) <= tolerance) return true
  }
  return false
}

/** Satty `calculate_line_bounds` over absolute points. */
export function polylineBounds(points: readonly AnnotationPoint[]): AnnotationRect {
  let left = points[0]?.x ?? 0
  let top = points[0]?.y ?? 0
  let right = left
  let bottom = top
  for (const point of points) {
    left = Math.min(left, point.x)
    top = Math.min(top, point.y)
    right = Math.max(right, point.x)
    bottom = Math.max(bottom, point.y)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}
