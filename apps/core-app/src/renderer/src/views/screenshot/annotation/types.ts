// SPDX-License-Identifier: MPL-2.0
// Derived from Satty (https://github.com/Satty-org/Satty) at commit
// 1c198c65c251aadc74d4f138f03bc2741b4655b2: src/tools/mod.rs and src/femtovg_area/imp.rs.
// Copyright (c) Matthias Gabriel and Satty contributors.
// Adaptations for Tuff: TypeScript interfaces, Canvas-based styling. See ./NOTICE.

import type { AnnotationPoint } from './geometry'

export type AnnotationTool =
  | 'select'
  | 'rectangle'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'brush'
  | 'text'
  | 'pixelate'

export interface AnnotationStyle {
  color: string
  strokeWidth: number
  fontSize: number
  filled: boolean
}

export const DEFAULT_ANNOTATION_STYLE: AnnotationStyle = {
  color: '#ff3b30',
  strokeWidth: 4,
  fontSize: 18,
  filled: false
}

export const PRESET_COLORS = [
  '#ff3b30', // Red
  '#ff9500', // Orange
  '#ffcc00', // Yellow
  '#34c759', // Green
  '#007aff', // Blue
  '#af52de', // Purple
  '#ffffff', // White
  '#000000' // Black
] as const

export const PRESET_STROKE_WIDTHS = [2, 4, 8, 14] as const

export interface BaseAnnotationObject {
  id: string
  color: string
  strokeWidth: number
}

export interface RectangleObject extends BaseAnnotationObject {
  kind: 'rectangle'
  x: number
  y: number
  width: number
  height: number
  filled: boolean
  cornerRadius?: number
}

export interface EllipseObject extends BaseAnnotationObject {
  kind: 'ellipse'
  x: number
  y: number
  width: number
  height: number
  filled: boolean
}

export interface ArrowObject extends BaseAnnotationObject {
  kind: 'arrow'
  start: AnnotationPoint
  end: AnnotationPoint
}

export interface LineObject extends BaseAnnotationObject {
  kind: 'line'
  start: AnnotationPoint
  end: AnnotationPoint
}

export interface BrushObject extends BaseAnnotationObject {
  kind: 'brush'
  points: AnnotationPoint[]
}

export interface TextObject extends BaseAnnotationObject {
  kind: 'text'
  x: number
  y: number
  text: string
  fontSize: number
}

export interface PixelateObject extends BaseAnnotationObject {
  kind: 'pixelate'
  x: number
  y: number
  width: number
  height: number
  blockSize: number
}

export type AnnotationObject =
  | RectangleObject
  | EllipseObject
  | ArrowObject
  | LineObject
  | BrushObject
  | TextObject
  | PixelateObject

export type HistoryEntry =
  | { type: 'add'; object: AnnotationObject }
  | { type: 'remove'; index: number; old: AnnotationObject }
  | { type: 'replace'; index: number; old: AnnotationObject; new: AnnotationObject }
  | { type: 'update-index'; index: number; newIndex: number }
  | { type: 'clear-all'; objects: AnnotationObject[] }
