import type { Component } from 'vue'
import type { OverlayBox } from './editor-overlay'
import type { RichSurface } from './rich-surface'
import type { MarkdownAiOptions } from './use-markdown-ai'
import type { MarkdownBox } from './use-markdown-overlay'
import { hasDocument } from '@talex-touch/utils/env'
import { markRaw, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { useMarkdownAi } from './use-markdown-ai'
import { boxIn, virtualReference } from './use-markdown-overlay'

/**
 * The bar over text selected on the rich surface: formats, a comment and the
 * AI. It shows once the selection settles, the pointer released or the keys
 * still for a moment, and not in code or a formula, where formatting does not
 * apply. The AI's panel, loaded on first use, opens under the text it
 * rewrites and follows that text's highlight.
 */

export interface MarkdownBubbleOptions extends Omit<MarkdownAiOptions, 'blockEnd'> {
  /** The rich surface, while the bar applies to it: active, editable, the bar on. */
  surface: () => RichSurface | null
  /** The element the bar is anchored in. */
  page: () => HTMLElement | null
  /** Something else has the selection's attention: a prompt, a menu. */
  busy: () => boolean
  /** The overlay's boxes, in the page: the AI panel goes under the text's. */
  boxes: () => OverlayBox[]
}

/** How long keys must be still before a selection made with them gets the bar. */
const SETTLE_MS = 220

export function useMarkdownBubble(options: MarkdownBubbleOptions) {
  const box = shallowRef<MarkdownBox | null>(null)
  const reference = virtualReference(options.page, () => box.value)
  const aiBox = shallowRef<MarkdownBox | null>(null)
  const aiReference = virtualReference(options.page, () => aiBox.value)
  /** The AI panel, once loaded. */
  const panel = shallowRef<Component | null>(null)
  let requested = false
  /** The primary button is down in the surface: a selection is being drawn. */
  let dragging = false
  /** It has just come up; the bar is measured right away rather than waiting. */
  let released = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const ai = useMarkdownAi({
    ...options,
    blockEnd: (pos) => {
      const view = options.surface()?.view
      const item = view?.sourceToDom(pos).item
      return view && item ? Math.max(pos, view.startOf(item) + item.raw.length) : pos
    },
  })

  function hide(): void {
    clearTimeout(timer)
    released = false
    box.value = null
  }

  /** Everything off: the bar and any AI session, without taking focus back. */
  function dismiss(): void {
    hide()
    ai.close()
  }

  function measure(): void {
    released = false
    const surface = options.surface()
    const page = options.page()
    const selection = surface?.root.ownerDocument.getSelection()
    const range = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0) : null
    const container = range?.commonAncestorContainer
    const element = container && (container.nodeType === 1 ? container as Element : container.parentElement)
    const rect = range && surface?.selectionRect()
    if (!surface || !page || !range || !element || !rect || ai.session.value || options.busy()
      || !surface.root.contains(element) || element.closest('pre, [data-md-atom]') || !range.toString().trim()) {
      hide()
      return
    }
    box.value = boxIn(page, rect)
  }

  function schedule(delay: number): void {
    clearTimeout(timer)
    timer = setTimeout(measure, delay)
  }

  /** The selection moved: shown, the bar follows it; hidden, it waits for the selection to settle. */
  function update(): void {
    if (!dragging && !released)
      schedule(box.value ? 0 : SETTLE_MS)
  }

  function onPointerDown(event: Event): void {
    if ((event as PointerEvent).button === 0 && options.surface()?.root.contains(event.target as Node)) {
      dragging = true
      hide()
    }
  }

  function onPointerUp(): void {
    if (!dragging)
      return
    dragging = false
    released = true
    schedule(0)
  }

  function listen(on: boolean): void {
    if (!hasDocument())
      return
    const method = on ? 'addEventListener' : 'removeEventListener'
    document[method]('pointerdown', onPointerDown, true)
    document[method]('pointerup', onPointerUp, true)
  }

  /** The surface's keydown; Escape puts the bar away. */
  function keydown(event: KeyboardEvent): boolean {
    if (event.key !== 'Escape' || !box.value)
      return false
    hide()
    return true
  }

  function load(): void {
    if (requested)
      return
    requested = true
    import('./MarkdownEditorAi.vue')
      .then((mod) => {
        panel.value = markRaw(mod.default)
      })
      // Without it the session has nothing to show: it goes, and the selection comes back.
      .catch(() => {
        requested = false
        ai.discard()
      })
  }

  /** The bar's AI button: the panel opens on the selected text. */
  function ask(): void {
    const surface = options.surface()
    surface?.flush()
    const selection = surface?.getSelection()
    load()
    if (selection && ai.open(selection))
      hide()
  }

  /** The text's highlight, across the text column: where the panel goes. */
  function layoutPanel(): MarkdownBox | null {
    const page = options.page()
    const root = options.surface()?.root
    const marks = options.boxes().filter(mark => mark.kind === 'ai')
    if (!page || !root || !marks.length || !ai.session.value)
      return null
    const column = boxIn(page, root.getBoundingClientRect())
    const style = getComputedStyle(root)
    const left = Number.parseFloat(style.paddingLeft) || 0
    const right = Number.parseFloat(style.paddingRight) || 0
    const top = Math.min(...marks.map(mark => mark.top))
    const bottom = Math.max(...marks.map(mark => mark.top + mark.height))
    return { left: column.left + left, top, width: Math.max(0, column.width - left - right), height: bottom - top }
  }

  watch(options.boxes, () => {
    aiBox.value = layoutPanel()
  })
  // Fetched ahead, so the panel is there by the time the bar's AI button is pressed.
  watch(() => !!box.value && !!options.ai(), (wanted) => {
    if (wanted)
      load()
  })

  onMounted(() => listen(true))
  onBeforeUnmount(() => {
    listen(false)
    clearTimeout(timer)
  })

  return { box, reference, aiBox, aiReference, panel, ai, update, hide, dismiss, keydown, ask, marks: ai.marks }
}

export type MarkdownBubble = ReturnType<typeof useMarkdownBubble>
