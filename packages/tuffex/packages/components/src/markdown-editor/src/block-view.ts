import type { MarkdownHydrateOptions, MarkdownRenderer, MarkdownSegment } from './markdown-render'
import type { SourceDomPoint, SourceRect } from './source-map'
import { BlockMap } from './source-map'

/**
 * A document rendered as one element per top-level block, for the rich
 * surface and the preview.
 *
 * `patch` re-renders only the blocks whose source changed, so a remote edit
 * three paragraphs away leaves the caret's block — and the caret — alone. The
 * rich surface also holds paragraphs that exist only in the DOM: the empty
 * line Enter just made has no Markdown of its own until something is typed
 * into it. Those carry an empty `raw` and sit at the end of the block before.
 */

export interface BlockItem {
  el: HTMLElement
  /** The block's source; '' for an empty paragraph that exists only in the DOM. */
  raw: string
  type: string
  /** Source between the previous non-empty block and this one; '' for empty items. */
  gapBefore: string
  map: BlockMap | null
}

export interface BlockViewOptions {
  hydrate: () => MarkdownHydrateOptions
  /** Called on every element the view creates, after hydration. */
  decorate?: (el: HTMLElement, item: BlockItem) => void
}

export interface BlockPoint extends SourceDomPoint {
  item: BlockItem | null
}

const BLOCK_WRAPPER = 'tx-markdown-editor__block'

export class BlockView {
  readonly root: HTMLElement
  readonly renderer: MarkdownRenderer
  readonly options: BlockViewOptions
  items: BlockItem[] = []
  trailing = ''
  private starts: number[] | null = null
  private docCache: string | null = null
  private readonly byElement = new WeakMap<Element, BlockItem>()
  private rendererVersion = -1

  constructor(root: HTMLElement, renderer: MarkdownRenderer, options: BlockViewOptions) {
    this.root = root
    this.renderer = renderer
    this.options = options
  }

  get doc(): string {
    if (this.docCache === null) {
      let doc = ''
      for (const item of this.items)
        doc += item.gapBefore + item.raw
      this.docCache = doc + this.trailing
    }
    return this.docCache
  }

  /** Whether reference definitions or the emoji set changed since the blocks were rendered. */
  private rendererChanged(): boolean {
    if (this.renderer.version === this.rendererVersion)
      return false
    this.rendererVersion = this.renderer.version
    return true
  }

  createItem(segment: MarkdownSegment, gapBefore: string): BlockItem {
    const doc = this.root.ownerDocument
    const template = doc.createElement('template')
    template.innerHTML = this.renderer.blockHtml(segment)
    const nodes = Array.from(template.content.childNodes)
      .filter(node => node.nodeType === 1 || (node.nodeType === 3 && /\S/.test(node.textContent ?? '')))
    let el: HTMLElement
    if (nodes.length === 1 && nodes[0]!.nodeType === 1) {
      el = nodes[0] as HTMLElement
    }
    else {
      el = doc.createElement('div')
      el.className = BLOCK_WRAPPER
      el.append(...nodes)
    }
    const item: BlockItem = { el, raw: segment.raw, type: segment.type, gapBefore, map: null }
    this.prepare(item)
    return item
  }

  /** Hydrates a freshly rendered element and indexes it. */
  prepare(item: BlockItem): void {
    this.renderer.hydrate(item.el, this.options.hydrate())
    this.byElement.set(item.el, item)
    this.options.decorate?.(item.el, item)
  }

  register(item: BlockItem): void {
    this.byElement.set(item.el, item)
  }

  render(doc: string): void {
    const { segments, gaps } = this.renderer.segment(doc)
    this.rendererChanged()
    this.items = segments.map((segment, index) => this.createItem(segment, gaps[index] ?? ''))
    this.trailing = gaps[segments.length] ?? ''
    this.root.replaceChildren(...this.items.map(item => item.el))
    this.invalidate()
  }

  /**
   * Brings the view to `doc`, keeping every block whose source is unchanged.
   * Returns the items that were created.
   */
  patch(doc: string): BlockItem[] {
    if (doc === this.doc)
      return []
    const { segments, gaps } = this.renderer.segment(doc)
    if (this.rendererChanged()) {
      this.render(doc)
      return this.items
    }

    const old = this.items
    // Common prefix, letting empty DOM-only paragraphs ride along.
    let head = 0
    let seg = 0
    while (head < old.length) {
      const item = old[head]!
      if (!item.raw) {
        head++
        continue
      }
      if (seg < segments.length && segments[seg]!.raw === item.raw) {
        head++
        seg++
        continue
      }
      break
    }
    // Common suffix, never crossing the prefix.
    let tail = old.length
    let segTail = segments.length
    while (tail > head) {
      const item = old[tail - 1]!
      if (!item.raw) {
        tail--
        continue
      }
      if (segTail > seg && segments[segTail - 1]!.raw === item.raw) {
        tail--
        segTail--
        continue
      }
      break
    }
    const created = segments.slice(seg, segTail).map(segment => this.createItem(segment, ''))
    const removed = old.slice(head, tail)
    const anchor = old[tail]?.el ?? null
    for (const item of removed)
      item.el.remove()
    for (const item of created)
      this.root.insertBefore(item.el, anchor)

    this.items = [...old.slice(0, head), ...created, ...old.slice(tail)]
    // Gaps can change while every block stays (a blank line added between two).
    let index = 0
    for (const item of this.items) {
      if (!item.raw) {
        item.gapBefore = ''
        continue
      }
      const segment = segments[index]
      item.gapBefore = gaps[index] ?? ''
      if (segment)
        item.type = segment.type
      index++
    }
    this.trailing = gaps[segments.length] ?? ''
    this.invalidate()
    return created
  }

  /**
   * Swaps the given items' elements for fresh renders of their (unchanged)
   * source — the surface tidying blocks typed into. Blocks render against the
   * whole document's reference definitions, so this lexes all of it; when
   * that no longer splits into the same blocks, everything re-renders.
   * Returns false in that case.
   */
  refresh(targets: BlockItem[]): boolean {
    const doc = this.doc
    const { segments } = this.renderer.segment(doc)
    const filled = this.items.filter(item => item.raw)
    if (this.rendererChanged() || segments.length !== filled.length || segments.some((segment, index) => segment.raw !== filled[index]!.raw)) {
      this.render(doc)
      return false
    }
    for (const target of targets) {
      const index = filled.indexOf(target)
      if (index < 0)
        continue
      const fresh = this.createItem(segments[index]!, target.gapBefore)
      target.el.replaceWith(fresh.el)
      this.items[this.items.indexOf(target)] = fresh
    }
    return true
  }

  /** Re-runs hydration, e.g. once KaTeX has loaded. */
  rehydrate(): void {
    for (const item of this.items) {
      this.renderer.hydrate(item.el, this.options.hydrate())
      item.map = null
    }
  }

  setItems(items: BlockItem[], trailing = this.trailing): void {
    this.items = items
    this.trailing = trailing
    for (const item of items)
      this.byElement.set(item.el, item)
    this.invalidate()
  }

  invalidate(): void {
    this.starts = null
    this.docCache = null
  }

  itemFor(el: Element): BlockItem | null {
    return this.byElement.get(el) ?? null
  }

  /** The top-level element containing `node`, or null for the root and outside nodes. */
  topElement(node: Node | null): HTMLElement | null {
    let current: Node | null = node
    while (current && current.parentNode !== this.root)
      current = current.parentNode
    return current && current.nodeType === 1 ? current as HTMLElement : null
  }

  itemAt(node: Node | null): BlockItem | null {
    const el = this.topElement(node)
    const item = el ? this.byElement.get(el) ?? null : null
    return item && this.items.includes(item) ? item : null
  }

  startOf(item: BlockItem): number {
    const index = this.items.indexOf(item)
    return index < 0 ? 0 : this.positions()[index]!
  }

  private positions(): number[] {
    if (!this.starts) {
      const starts: number[] = []
      let pos = 0
      for (const item of this.items) {
        pos += item.gapBefore.length
        starts.push(pos)
        pos += item.raw.length
      }
      this.starts = starts
    }
    return this.starts
  }

  mapOf(item: BlockItem): BlockMap {
    item.map ??= new BlockMap(item.el, item.raw)
    return item.map
  }

  domToSource(node: Node, offset: number, bias: -1 | 1 = 1): number {
    const items = this.items
    if (node === this.root || !this.root.contains(node)) {
      if (node !== this.root || !items.length)
        return 0
      const starts = this.positions()
      if (offset >= items.length) {
        const last = items.length - 1
        return starts[last]! + items[last]!.raw.length
      }
      return starts[Math.max(0, offset)]!
    }
    const item = this.itemAt(node)
    if (!item)
      return 0
    const start = this.startOf(item)
    if (!item.raw)
      return start
    return start + this.mapOf(item).domToSource(node, offset, bias)
  }

  /** The item holding `pos`; a position between blocks belongs to the block before it. */
  private locate(pos: number): number {
    const starts = this.positions()
    let low = 0
    let high = this.items.length - 1
    let found = 0
    while (low <= high) {
      const mid = (low + high) >> 1
      if (starts[mid]! <= pos) {
        found = mid
        low = mid + 1
      }
      else {
        high = mid - 1
      }
    }
    // Prefer a non-empty block: empty items share the position of the block
    // before, and so does the rest of its last line, the spaces its source
    // leaves out (a list's `- [ ] `).
    const doc = this.doc
    while (found > 0 && !this.items[found]!.raw && !doc.slice(starts[found - 1]! + this.items[found - 1]!.raw.length, pos).includes('\n'))
      found--
    return found
  }

  sourceToDom(pos: number): BlockPoint {
    const items = this.items
    if (!items.length)
      return { node: this.root, offset: 0, outside: null, item: null }
    const index = this.locate(pos)
    const item = items[index]!
    const start = this.positions()[index]!
    if (!item.raw)
      return { node: item.el, offset: 0, outside: null, item }
    const local = Math.max(0, Math.min(pos - start, item.raw.length))
    return { ...this.mapOf(item).sourceToDom(local), item }
  }

  /** Client rects covering the source range, per text run and element. */
  rangeRects(from: number, to: number): SourceRect[] {
    const rects: SourceRect[] = []
    const starts = this.positions()
    this.items.forEach((item, index) => {
      const start = starts[index]!
      const end = start + item.raw.length
      if (!item.raw || end <= from || start >= to)
        return
      rects.push(...this.mapOf(item).rangeRects(Math.max(0, from - start), Math.min(item.raw.length, to - start)))
    })
    return rects
  }

  caretRect(pos: number): SourceRect | null {
    if (!this.items.length)
      return null
    const index = this.locate(pos)
    const item = this.items[index]!
    if (!item.raw) {
      const box = item.el.getBoundingClientRect()
      return { left: box.left, top: box.top, width: 0, height: box.height }
    }
    const start = this.positions()[index]!
    return this.mapOf(item).caretRect(Math.max(0, Math.min(pos - start, item.raw.length)))
  }
}
