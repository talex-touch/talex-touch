import type { IconPickerShape } from './types'
import { SHAPE_PATHS } from './generated/shapes'

/**
 * Plate outlines as path data on a 24-unit box, for a host that draws the
 * picked icon on the same plate outside the picker. Filled edge to edge: a
 * plate scaled to its box is the shape the user saw while choosing it.
 */
export const ICON_PICKER_SHAPE_PATHS = SHAPE_PATHS

/** Every plate shape, in the order the shape row offers them. */
export const ICON_PICKER_SHAPES: readonly IconPickerShape[] = Object.freeze(
  Object.keys(SHAPE_PATHS) as IconPickerShape[],
)

/** Whether a stored value is a shape this version can draw. */
export function isIconPickerShape(value: unknown): value is IconPickerShape {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SHAPE_PATHS, value)
}

/**
 * How large the icon may sit on each plate, as a fraction of the plate's edge,
 * and how far below center it sits.
 *
 * One size for every shape is right for the four rectangles and wrong for the
 * rest: a glyph sized for a square's interior pokes out past a diamond's
 * edges, and a heart's widest part is above its center, not at it. The
 * numbers keep a typical glyph inside the shape's interior; they are not
 * derived from any one glyph.
 */
export const SHAPE_CONTENT: Readonly<Record<IconPickerShape, { scale: number, offset: number }>> = {
  circle: { scale: 0.55, offset: 0 },
  squircle: { scale: 0.55, offset: 0 },
  rounded: { scale: 0.55, offset: 0 },
  square: { scale: 0.55, offset: 0 },
  diamond: { scale: 0.46, offset: 0 },
  pentagon: { scale: 0.5, offset: 0.03 },
  hexagon: { scale: 0.52, offset: 0 },
  arch: { scale: 0.52, offset: 0.03 },
  cookie: { scale: 0.5, offset: 0 },
  clover: { scale: 0.5, offset: 0 },
  burst: { scale: 0.46, offset: 0 },
  heart: { scale: 0.44, offset: -0.05 },
}

/** The outline a shape draws, falling back to `rounded` for a value this version does not know. */
export function shapePath(shape: string): string {
  return isIconPickerShape(shape) ? SHAPE_PATHS[shape] : SHAPE_PATHS.rounded
}
