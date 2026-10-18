// SPDX-License-Identifier: MPL-2.0
// Derived from Satty (https://github.com/Satty-org/Satty) at commit
// 1c198c65c251aadc74d4f138f03bc2741b4655b2: src/femtovg_area/imp.rs (HistoryEntry,
// undo/redo stack, hit_test top-to-bottom, object mutation).
// Copyright (c) Matthias Gabriel and Satty contributors.
// Adaptations for Tuff: pure TypeScript object document model without GTK. See ./NOTICE.

import {
  hitTestPolyline,
  hitTestRectangle,
  polylineBounds,
  distanceToSegment,
  type AnnotationPoint,
  type AnnotationRect
} from './geometry'
import type { AnnotationObject, HistoryEntry } from './types'

export class AnnotationDocument {
  private _objects: AnnotationObject[] = []
  private _undoStack: HistoryEntry[] = []
  private _redoStack: HistoryEntry[] = []
  private _selectedIndex: number | null = null
  private _revision = 0

  get objects(): readonly AnnotationObject[] {
    return this._objects
  }

  get selectedIndex(): number | null {
    return this._selectedIndex
  }

  set selectedIndex(index: number | null) {
    if (index !== null && (index < 0 || index >= this._objects.length)) {
      this._selectedIndex = null
    } else {
      this._selectedIndex = index
    }
  }

  get selectedObject(): AnnotationObject | null {
    if (this._selectedIndex === null) return null
    return this._objects[this._selectedIndex] ?? null
  }

  get revision(): number {
    return this._revision
  }

  get canUndo(): boolean {
    return this._undoStack.length > 0
  }

  get canRedo(): boolean {
    return this._redoStack.length > 0
  }

  /**
   * Commits a new annotation object. Pushes to undo stack and clears redo stack.
   */
  add(object: AnnotationObject): void {
    this._objects.push(object)
    this._undoStack.push({ type: 'add', object })
    this._redoStack = []
    this._revision += 1
    this._selectedIndex = this._objects.length - 1
  }

  /**
   * Replaces an object at `index` (e.g. after move/resize/style change).
   */
  replace(index: number, next: AnnotationObject): void {
    if (index < 0 || index >= this._objects.length) return
    const old = this._objects[index]
    this._undoStack.push({ type: 'replace', index, old, new: next })
    this._objects[index] = next
    this._redoStack = []
    this._revision += 1
  }

  /**
   * Removes an object at `index`.
   */
  remove(index: number): void {
    if (index < 0 || index >= this._objects.length) return
    const old = this._objects.splice(index, 1)[0]
    this._undoStack.push({ type: 'remove', index, old })
    this._redoStack = []
    this._revision += 1
    if (this._selectedIndex === index) {
      this._selectedIndex = null
    } else if (this._selectedIndex !== null && this._selectedIndex > index) {
      this._selectedIndex -= 1
    }
  }

  /**
   * Clears all objects.
   */
  clearAll(): void {
    if (this._objects.length === 0) return
    this._undoStack.push({ type: 'clear-all', objects: [...this._objects] })
    this._objects = []
    this._redoStack = []
    this._selectedIndex = null
    this._revision += 1
  }

  /**
   * Performs undo according to Satty's HistoryEntry state machine.
   */
  undo(): boolean {
    const entry = this._undoStack.pop()
    if (!entry) return false
    switch (entry.type) {
      case 'add': {
        const removed = this._objects.pop()
        if (removed) {
          this._redoStack.push({ type: 'add', object: removed })
        }
        break
      }
      case 'remove': {
        this._objects.splice(entry.index, 0, entry.old)
        this._redoStack.push({ type: 'remove', index: entry.index, old: entry.old })
        break
      }
      case 'replace': {
        const current = this._objects[entry.index]
        if (current) {
          this._objects[entry.index] = entry.old
          this._redoStack.push({
            type: 'replace',
            index: entry.index,
            old: entry.old,
            new: current
          })
        }
        break
      }
      case 'update-index': {
        const obj = this._objects.splice(entry.newIndex, 1)[0]
        if (obj) {
          this._objects.splice(entry.index, 0, obj)
          this._redoStack.push({
            type: 'update-index',
            index: entry.newIndex,
            newIndex: entry.index
          })
        }
        break
      }
      case 'clear-all': {
        this._objects = [...entry.objects]
        this._redoStack.push({ type: 'clear-all', objects: entry.objects })
        break
      }
    }
    this._selectedIndex = null
    this._revision += 1
    return true
  }

  /**
   * Performs redo according to Satty's HistoryEntry state machine.
   */
  redo(): boolean {
    const entry = this._redoStack.pop()
    if (!entry) return false
    switch (entry.type) {
      case 'add': {
        this._objects.push(entry.object)
        this._undoStack.push({ type: 'add', object: entry.object })
        break
      }
      case 'remove': {
        this._objects.splice(entry.index, 1)
        this._undoStack.push({ type: 'remove', index: entry.index, old: entry.old })
        break
      }
      case 'replace': {
        const current = this._objects[entry.index]
        if (current) {
          this._objects[entry.index] = entry.new
          this._undoStack.push({
            type: 'replace',
            index: entry.index,
            old: current,
            new: entry.new
          })
        }
        break
      }
      case 'update-index': {
        const obj = this._objects.splice(entry.index, 1)[0]
        if (obj) {
          this._objects.splice(entry.newIndex, 0, obj)
          this._undoStack.push({
            type: 'update-index',
            index: entry.index,
            newIndex: entry.newIndex
          })
        }
        break
      }
      case 'clear-all': {
        this._objects = []
        this._undoStack.push({ type: 'clear-all', objects: entry.objects })
        break
      }
    }
    this._selectedIndex = null
    this._revision += 1
    return true
  }

  /**
   * Satty `hit_test`: walks drawables in reverse order (topmost first) and returns the first hit.
   */
  hitTest(point: AnnotationPoint, tolerance = 7): number | null {
    for (let index = this._objects.length - 1; index >= 0; index -= 1) {
      if (this.objectContainsPoint(this._objects[index], point, tolerance)) {
        return index
      }
    }
    return null
  }

  private objectContainsPoint(
    object: AnnotationObject,
    point: AnnotationPoint,
    tolerance: number
  ): boolean {
    switch (object.kind) {
      case 'rectangle':
      case 'pixelate':
        return hitTestRectangle(
          point,
          { x: object.x, y: object.y, width: object.width, height: object.height },
          tolerance,
          object.kind === 'pixelate' || (object.kind === 'rectangle' && object.filled)
        )
      case 'ellipse': {
        const rx = object.width / 2
        const ry = object.height / 2
        const cx = object.x + rx
        const cy = object.y + ry
        if (rx <= 0 || ry <= 0) return false
        const normalizedDist = ((point.x - cx) / rx) ** 2 + ((point.y - cy) / ry) ** 2
        if (object.filled) return normalizedDist <= 1.05
        return Math.abs(normalizedDist - 1.0) <= (tolerance / Math.min(rx, ry)) * 1.5
      }
      case 'line':
      case 'arrow':
        return distanceToSegment(point, object.start, object.end) <= tolerance
      case 'brush':
        return hitTestPolyline(point, object.points, tolerance)
      case 'text': {
        const width = object.text.length * object.fontSize * 0.65
        const height = object.fontSize * 1.2
        return hitTestRectangle(
          point,
          { x: object.x, y: object.y - height, width, height },
          tolerance,
          true
        )
      }
    }
  }

  static getBounds(object: AnnotationObject): AnnotationRect {
    switch (object.kind) {
      case 'rectangle':
      case 'pixelate':
      case 'ellipse':
        return { x: object.x, y: object.y, width: object.width, height: object.height }
      case 'line':
      case 'arrow':
        return polylineBounds([object.start, object.end])
      case 'brush':
        return polylineBounds(object.points)
      case 'text':
        return {
          x: object.x,
          y: object.y - object.fontSize * 1.2,
          width: object.text.length * object.fontSize * 0.65,
          height: object.fontSize * 1.2
        }
    }
  }

  static translate(object: AnnotationObject, deltaX: number, deltaY: number): AnnotationObject {
    switch (object.kind) {
      case 'rectangle':
      case 'ellipse':
      case 'pixelate':
        return { ...object, x: object.x + deltaX, y: object.y + deltaY }
      case 'line':
      case 'arrow':
        return {
          ...object,
          start: { x: object.start.x + deltaX, y: object.start.y + deltaY },
          end: { x: object.end.x + deltaX, y: object.end.y + deltaY }
        }
      case 'brush':
        return {
          ...object,
          points: object.points.map((p) => ({ x: p.x + deltaX, y: p.y + deltaY }))
        }
      case 'text':
        return { ...object, x: object.x + deltaX, y: object.y + deltaY }
    }
  }
}
