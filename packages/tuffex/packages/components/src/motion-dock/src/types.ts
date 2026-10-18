// Adapted from Amicro. MIT License. Copyright (c) 2026 SYED  SUBHAN UDDIN.
import type { BaseSurfaceMode } from '../../base-surface/src/types'

export type MotionDockId = string | number

export interface MotionDockItem {
  id: MotionDockId
  label: string
  disabled?: boolean
  /** An item remains a native link when an href is provided. */
  href?: string
}

export interface MotionDockLabels {
  dock: string
  instructions: string
  /** Placeholders: {label}, {position}, {total}. */
  reordered: string
}

export const MOTION_DOCK_DEFAULT_LABELS: MotionDockLabels = {
  dock: 'Application dock',
  instructions: 'Use Left and Right to move focus, Home and End to reach the first and last item. Use Alt with these keys to reorder. Enter or Space activates an item. Escape cancels a pointer drag.',
  reordered: 'Moved {label} to position {position} of {total}.',
}

export interface MotionDockProps {
  /** Stable, unique IDs and caller-owned item objects. */
  items: readonly MotionDockItem[]
  activeId?: MotionDockId
  reorderable?: boolean
  disabled?: boolean
  paused?: boolean
  size?: 'xs' | 'sm' | 'md' | 'lg'
  itemSize?: number
  magnifiedSize?: number
  /** Pointer influence radius, in pixels. Defaults to itemSize × 80 / 28: the source's 80 at `md`. */
  distance?: number
  /** Labels under the shelf instead of a bubble over the hovered or focused icon. */
  showLabels?: boolean
  /** Material of the shelf. @default 'refraction' */
  surface?: BaseSurfaceMode
  labels?: Partial<MotionDockLabels>
}

export interface MotionDockReorder {
  id: MotionDockId
  from: number
  to: number
  source: 'pointer' | 'keyboard'
}

export interface MotionDockEmits {
  (event: 'update:items', items: MotionDockItem[]): void
  (event: 'reorder', items: MotionDockItem[], detail: MotionDockReorder): void
  (event: 'update:activeId', id: MotionDockId): void
  (event: 'select', item: MotionDockItem, index: number): void
}
