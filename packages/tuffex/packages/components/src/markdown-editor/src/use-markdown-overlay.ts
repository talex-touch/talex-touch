import type { CSSProperties } from 'vue'
import type { EditorCommentMark, EditorOverlay, EditorPeerMark, EditorRangeMark, OverlayBox } from './editor-overlay'
import type { RichSurface } from './rich-surface'
import { computed, markRaw, onBeforeUnmount, shallowRef } from 'vue'
import { layoutOverlay } from './editor-overlay'

/**
 * Comment highlights and peers' carets over whichever view shows the
 * document: decorations in the source mode, boxes over the rendered blocks
 * otherwise.
 *
 * Boxes are measured, so they are laid out once per frame however many
 * changes, selections and loaded images asked for it.
 */

export interface MarkdownOverlayOptions {
  /** The rich surface or the preview, when one of them is the active view. */
  surface: () => RichSurface | null
  /** The element the boxes are positioned in; it scrolls with the text. */
  page: () => HTMLElement | null
  /** The source view, when it is the active one. */
  source: () => { setOverlay: (overlay: EditorOverlay) => void } | null
  comments: () => EditorCommentMark[]
  peers: () => EditorPeerMark[]
  /** Marks for the rich surface alone. */
  marks: () => EditorRangeMark[]
}

export interface MarkdownBox {
  left: number
  top: number
  width: number
  height: number
}

export function useMarkdownOverlay(options: MarkdownOverlayOptions) {
  const boxes = shallowRef<OverlayBox[]>([])
  /** Highlights, drawn under the text. */
  const under = computed(() => boxes.value.filter(box => box.kind !== 'caret'))
  /** Carets, drawn over it. */
  const carets = computed(() => boxes.value.filter(box => box.kind === 'caret'))
  let frame = 0

  function clear(): void {
    if (boxes.value.length)
      boxes.value = []
  }

  function paint(): void {
    frame = 0
    const overlay: EditorOverlay = { comments: options.comments(), peers: options.peers() }
    const source = options.source()
    if (source) {
      clear()
      source.setOverlay(overlay)
      return
    }
    const surface = options.surface()
    const page = options.page()
    const next = surface && page ? layoutOverlay(surface.view, page, { ...overlay, marks: options.marks() }) : []
    if (next.length || boxes.value.length)
      boxes.value = next
  }

  function schedule(): void {
    if (frame)
      return
    if (typeof requestAnimationFrame !== 'function') {
      paint()
      return
    }
    frame = requestAnimationFrame(paint)
  }

  onBeforeUnmount(() => {
    if (frame && typeof cancelAnimationFrame === 'function')
      cancelAnimationFrame(frame)
    frame = 0
  })

  return { under, carets, schedule, clear }
}

export function boxStyle(box: OverlayBox): CSSProperties {
  return {
    'left': `${box.left}px`,
    'top': `${box.top}px`,
    'width': `${box.width}px`,
    'height': `${box.height}px`,
    '--tx-markdown-editor-peer': box.color,
    '--tx-markdown-editor-mark-order': box.order,
  } as CSSProperties
}

/** A client rect in the coordinates of `page`, so it moves when the page scrolls. */
export function boxIn(page: HTMLElement, rect: { left: number, top: number, right: number, bottom: number }): MarkdownBox {
  const origin = page.getBoundingClientRect()
  return {
    left: rect.left - origin.left,
    top: rect.top - origin.top,
    width: Math.max(0, rect.right - rect.left),
    height: Math.max(0, rect.bottom - rect.top),
  }
}

/** A floating panel's reference: `box` in `page`, measured again whenever the panel repositions. */
export function virtualReference(page: () => HTMLElement | null, box: () => MarkdownBox | null) {
  return markRaw({
    getBoundingClientRect: () => {
      const origin = page()?.getBoundingClientRect()
      const current = box()
      const left = (origin?.left ?? 0) + (current?.left ?? 0)
      const top = (origin?.top ?? 0) + (current?.top ?? 0)
      const width = current?.width ?? 0
      const height = current?.height ?? 0
      return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height } as DOMRect
    },
  })
}
