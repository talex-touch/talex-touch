import type { Token } from 'marked'
import type { BlockItem } from './block-view'
import type { CaretPoint, RichSurface } from './rich-surface'
import { CALLOUT_MARKER, CALLOUT_TITLE_CLASS } from './markdown-callout'
import { highlightColorOf } from './markdown-highlight'
import { REVEAL_ATTRIBUTE } from './source-map'

/**
 * Typora's live preview: the formatted text the caret is in, or touches,
 * shows its Markdown and is edited as Markdown.
 *
 * The element is swapped for a span holding exactly its slice of the source,
 * coloured piece by piece from marked's inline lexer: delimiters muted, the
 * text between them still bold, linked or code. The serializer writes the
 * span's text back verbatim and the source map matches it character for
 * character, so whatever is typed into it (a deleted `*`, a retyped URL,
 * plain text after the closing delimiter) is an edit of the source like any
 * other, and the colouring follows as the span is lexed again. When the caret
 * leaves, the element returns: the very one that was there if nothing
 * changed, a fresh render of the new source otherwise.
 */

const REVEALABLE = `strong, b, em, i, del, s, strike, code, a[href], mark, .tx-markdown-editor__math:not(.is-block), .tx-markdown-editor__emoji, .${CALLOUT_TITLE_CLASS}`

/** Content a line of source cannot stand in for: it would vanish while the span shows. */
const RENDERED_ONLY = 'img, br, input, [data-upload-id], .tx-markdown-editor__html'

/** What starts another line: formatting on the far side of one is not beside the caret. */
const LINE_BREAKS = 'br, p, li, dt, dd, h1, h2, h3, h4, h5, h6, blockquote, pre, table, tr, td, th, ul, ol, hr, div'

/** Token types with delimiters, and the class their pieces carry. */
const FORMATS: Record<string, string> = {
  strong: 'strong',
  em: 'em',
  del: 'del',
  mark: 'mark',
  link: 'link',
  codespan: 'code',
  mathInline: 'math',
  emoji: 'emoji',
}

/** Inline HTML tags, and the format of the text they wrap. */
const HTML_FORMATS: Record<string, string> = {
  b: 'strong',
  strong: 'strong',
  em: 'em',
  i: 'em',
  del: 'del',
  s: 'del',
  strike: 'del',
  mark: 'mark',
}

const HTML_TAG = /^<(\/?)([a-z]+)\b[^>]*>$/i

/** Formats whose content is literal text rather than more tokens. */
const LITERAL = new Set(['code', 'math', 'emoji'])

/** The token each revealable tag is rendered from. */
const TOKEN_TYPES: Record<string, string> = {
  STRONG: 'strong',
  B: 'strong',
  EM: 'em',
  I: 'em',
  DEL: 'del',
  S: 'del',
  STRIKE: 'del',
  CODE: 'codespan',
  A: 'link',
  MARK: 'mark',
}

/** Piece classes and the toolbar states they press. */
const PRESSED: Record<string, string> = {
  'is-strong': 'bold',
  'is-em': 'italic',
  'is-del': 'strike',
  'is-mark': 'highlight',
  'is-code': 'code',
  'is-link': 'link',
}

interface Piece {
  text: string
  className: string
}

interface Revealed {
  span: HTMLElement
  /** The element the span stands in for, put back when nothing changed. */
  original: HTMLElement
  source: string
}

interface Candidate {
  el: HTMLElement
  item: BlockItem
  /** Source range of the element in its block. */
  from: number
  to: number
  /** The caret, in the same coordinates. */
  pos: number
  tokens: Token[]
}

function isElement(node: Node | null | undefined): node is HTMLElement {
  return !!node && node.nodeType === 1
}

/** A revealed span's text as source: no step-out spaces, non-breaking spaces as spaces. */
export function revealedText(node: Node): string {
  return (node.textContent ?? '').replace(/\u200B/g, '').replace(/\u00A0/g, ' ')
}

/** The toolbar states a piece of a revealed span presses. */
export function revealedFormats(piece: Element): string[] {
  return Array.from(piece.classList, name => PRESSED[name]).filter((format): format is string => !!format)
}

/**
 * Whether `tokens`, lexed from an element's slice of the source, are that
 * element and nothing else: its own token, or its HTML tags around their
 * content. A slice the source map got wrong is never shown, nor written back.
 */
function isWhole(el: HTMLElement, tokens: Token[]): boolean {
  const first = tokens[0]
  const last = tokens[tokens.length - 1]
  if (!first || !last)
    return false
  if (tokens.length === 1) {
    const classes = el.classList
    // A callout's marker is text to the inline lexer.
    if (classes.contains(CALLOUT_TITLE_CLASS))
      return first.type === 'text' && CALLOUT_MARKER.test(first.raw)
    const type = classes.contains('tx-markdown-editor__math') ? 'mathInline' : classes.contains('tx-markdown-editor__emoji') ? 'emoji' : TOKEN_TYPES[el.tagName]
    return first.type === type
  }
  const tag = el.tagName.toLowerCase()
  return first.type === 'html' && last.type === 'html' && new RegExp(`^<${tag}\\b`, 'i').test(first.raw) && new RegExp(`^</${tag}\\s*>$`, 'i').test(last.raw)
}

/** `source` cut into styled pieces along its inline tokens; one plain piece when they do not add up. */
function piecesOf(source: string, tokens: Token[]): Piece[] {
  const marker = CALLOUT_MARKER.test(source) ? /^(\s*\[!)(\w+)(\]\s*)$/.exec(source) : null
  if (marker)
    return [{ text: marker[1]!, className: 'is-syntax' }, { text: marker[2]!, className: 'is-callout' }, { text: marker[3]!, className: 'is-syntax' }]
  const out: Piece[] = []
  const push = (text: string, formats: readonly string[], syntax: boolean) => {
    if (!text)
      return
    const className = [...formats.map(format => `is-${format}`), ...(syntax ? ['is-syntax'] : [])].join(' ')
    const last = out[out.length - 1]
    if (last && last.className === className)
      last.text += text
    else
      out.push({ text, className })
  }
  const walk = (list: Token[], outer: readonly string[]): void => {
    // `<mark data-color>` and friends format the tokens between their tags.
    const tags: string[][] = []
    let formats = outer
    for (const token of list) {
      const raw = token.raw
      const format = FORMATS[token.type]
      if (!format) {
        const tag = token.type === 'html' ? HTML_TAG.exec(raw) : null
        const tagFormat = tag ? HTML_FORMATS[tag[2]!.toLowerCase()] : undefined
        if (tag && tagFormat && !tag[1]) {
          const color = tagFormat === 'mark' ? highlightColorOf(raw) : 'yellow'
          tags.push(color === 'yellow' ? [tagFormat] : [tagFormat, `color-${color}`])
          formats = [...outer, ...tags.flat()]
        }
        if (token.type === 'escape') {
          push('\\', formats, true)
          push(raw.slice(1), formats, false)
        }
        else {
          push(raw, formats, token.type === 'html')
        }
        if (tag && tagFormat && tag[1]) {
          let index = tags.length - 1
          while (index >= 0 && tags[index]![0] !== tagFormat)
            index--
          if (index >= 0) {
            tags.splice(index, 1)
            formats = [...outer, ...tags.flat()]
          }
        }
        continue
      }
      const inner = [...formats, format]
      if (LITERAL.has(format)) {
        const open = format === 'code' ? /^`+/.exec(raw)?.[0].length ?? 0 : 1
        const close = Math.max(open, raw.length - (format === 'code' ? /`+$/.exec(raw)?.[0].length ?? 0 : 1))
        push(raw.slice(0, open), inner, true)
        push(raw.slice(open, close), inner, false)
        push(raw.slice(close), inner, true)
        continue
      }
      const children = (token as { tokens?: Token[] }).tokens
      const content = children?.map(child => child.raw).join('') ?? ''
      let open = 2
      if (format === 'link')
        open = raw[0] === '[' || raw[0] === '<' ? 1 : 0
      else if (format === 'em')
        open = 1
      else if (format === 'del')
        open = /^~+/.exec(raw)?.[0].length ?? 0
      if (!children || !open || !raw.startsWith(content, open)) {
        // A bare autolink, or a shape the pieces cannot follow: its text, unmarked.
        push(raw, inner, false)
        continue
      }
      push(raw.slice(0, open), inner, true)
      walk(children, inner)
      push(raw.slice(open + content.length), format === 'link' ? [...inner, 'url'] : inner, true)
    }
  }
  walk(tokens, [])
  return out.map(piece => piece.text).join('') === source ? out : [{ text: source, className: '' }]
}

function samePieces(span: HTMLElement, pieces: Piece[]): boolean {
  const children = span.childNodes
  return children.length === pieces.length && pieces.every((piece, index) => {
    const child = children[index]
    return isElement(child) && child.tagName === 'SPAN' && child.className === piece.className && child.textContent === piece.text
  })
}

/** The text offset of a DOM point inside `span`. */
function offsetIn(span: HTMLElement, node: Node, offset: number): number {
  const range = span.ownerDocument.createRange()
  range.setStart(span, 0)
  range.setEnd(node, offset)
  return range.toString().replace(/\u200B/g, '').length
}

/** The DOM point `offset` characters into `span`; a boundary is the end of the piece before it. */
function pointIn(span: HTMLElement, offset: number): CaretPoint {
  const walker = span.ownerDocument.createTreeWalker(span, NodeFilter.SHOW_TEXT)
  let left = offset
  let last: Text | null = null
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (left <= node.length)
      return { node, offset: left }
    left -= node.length
    last = node
  }
  return last ? { node: last, offset: last.length } : { node: span, offset: span.childNodes.length }
}

/**
 * Whether the caret is on `el`'s line: no line break or block between them.
 * Their source positions cannot tell. A line the source does not have yet,
 * a paragraph just split off or a line break with nothing after it, maps to
 * where the line before it ends.
 */
function onCaretLine(el: HTMLElement, node: Node, offset: number): boolean {
  if (el.contains(node))
    return true
  const range = el.ownerDocument.createRange()
  range.setStart(node, offset)
  if (range.comparePoint(el, 0) > 0)
    range.setEndBefore(el)
  else
    range.setStartAfter(el)
  return !range.cloneContents().querySelector(LINE_BREAKS)
}

/** Whether `el` sits inside another revealable element or an atom of its block. */
function isNested(el: HTMLElement, block: HTMLElement): boolean {
  for (let parent = el.parentElement; parent && parent !== block; parent = parent.parentElement) {
    if (parent.matches(REVEALABLE) || parent.hasAttribute('data-md-atom'))
      return true
  }
  return false
}

export class RichReveal {
  private readonly surface: RichSurface
  private current: Revealed | null = null
  private pointerDown = false
  /** After a typing-style toggle: nothing opens until the key or click the style is for. */
  private suspended = false
  private preview: HTMLElement | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(surface: RichSurface) {
    this.surface = surface
  }

  destroy(): void {
    if (this.timer)
      clearTimeout(this.timer)
    this.timer = null
    this.hidePreview()
    this.current = null
  }

  /** The revealed span, while it is still in the document. */
  private live(): Revealed | null {
    if (this.current && !this.current.span.isConnected) {
      this.current = null
      this.hidePreview()
    }
    return this.current
  }

  holds(node: Node | null): boolean {
    const span = this.live()?.span
    return !!span && !!node && span.contains(node)
  }

  /** The pointer went down in the surface: the layout holds still until it is released. */
  onPointerDown(event: MouseEvent): void {
    this.suspended = false
    this.pointerDown = true
    // A double click selects a word: it must find the text where it was clicked.
    if (event.detail >= 2)
      this.conceal()
  }

  onPointerUp(): void {
    if (!this.pointerDown)
      return
    this.pointerDown = false
    // After the click, which may follow a link with Mod held: the link must still be there.
    if (this.timer)
      clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.update()
    })
  }

  onKeydown(): void {
    this.suspended = false
  }

  /** A typing style is about to be toggled: it needs the rendered text, and the caret where it is. */
  suspend(): void {
    this.conceal()
    this.suspended = true
  }

  /** The selection changed: reveal what the caret touches, put back what it left. */
  update(): void {
    const surface = this.surface
    const current = this.live()
    if (this.pointerDown || this.suspended || surface.isComposing)
      return
    const selection = surface.root.ownerDocument.getSelection()
    const anchor = selection?.anchorNode ?? null
    if (!selection || !anchor || !surface.editable || !surface.root.contains(anchor) || !surface.hasFocus()) {
      this.conceal()
      return
    }
    if (!selection.isCollapsed) {
      // A range starting or ending in the span keeps it: the text must not move under it.
      if (current && !current.span.contains(anchor) && !current.span.contains(selection.focusNode))
        this.conceal()
      return
    }
    if (current) {
      if (current.span.contains(anchor) || this.touches(current.span, anchor, selection.anchorOffset))
        return
      this.conceal()
    }
    const caret = surface.caretPoint()
    const found = caret ? this.find(caret.node, caret.offset) : null
    if (found)
      this.open(found)
  }

  /** A formula or a callout's title was clicked: its source, the caret before the closing `$` or `]`. */
  revealElement(el: HTMLElement): boolean {
    const surface = this.surface
    if (!surface.editable)
      return false
    this.conceal()
    // Putting back an edited span renders its block again; the update after the click takes over.
    if (!el.isConnected)
      return true
    const item = surface.view.itemAt(el)
    const range = item?.raw ? surface.view.mapOf(item).rangeOf(el) : null
    const tokens = item && range ? surface.renderer.inlineTokens(item.raw.slice(range[0], range[1])) : []
    if (!item || !range || range[1] - range[0] < 2 || !isWhole(el, tokens))
      return false
    this.open({ el, item, from: range[0], to: range[1], pos: range[1] - 1, tokens })
    return true
  }

  /** Puts the element back. A caret in the span keeps its place in the source. */
  conceal(): void {
    const current = this.live()
    this.current = null
    this.hidePreview()
    if (!current)
      return
    const surface = this.surface
    const { span, original, source } = current
    if (revealedText(span) !== source || span.querySelector(RENDERED_ONLY)) {
      surface.rerender(span)
      return
    }
    const selection = surface.root.ownerDocument.getSelection()
    const holdsCaret = !!selection && (span.contains(selection.anchorNode) || span.contains(selection.focusNode))
    const saved = holdsCaret && surface.hasFocus() ? surface.getSelection() : null
    surface.withoutObserver(() => span.replaceWith(original))
    this.invalidate(original)
    if (saved)
      surface.setSelection(saved)
  }

  /**
   * After an input: lexes the span again so its colouring follows the new
   * source. True when the caret is in it, where no typing rule applies.
   */
  restyle(): boolean {
    const current = this.live()
    if (!current)
      return false
    const span = current.span
    const selection = this.surface.root.ownerDocument.getSelection()
    const anchor = selection?.anchorNode ?? null
    const inside = !!anchor && span.contains(anchor)
    const text = revealedText(span)
    if (!text) {
      this.conceal()
      return inside
    }
    const pieces = this.piecesOf(text)
    if (!samePieces(span, pieces)) {
      const offset = inside ? offsetIn(span, anchor!, selection!.anchorOffset) : -1
      this.surface.withoutObserver(() => this.paint(span, pieces))
      this.invalidate(span)
      if (offset >= 0)
        this.collapse(pointIn(span, offset))
    }
    this.showPreview()
    return inside
  }

  private piecesOf(source: string): Piece[] {
    return piecesOf(source, this.surface.renderer.inlineTokens(source))
  }

  private paint(span: HTMLElement, pieces: Piece[]): void {
    const doc = span.ownerDocument
    span.replaceChildren(...pieces.map((piece) => {
      const el = doc.createElement('span')
      if (piece.className)
        el.className = piece.className
      el.textContent = piece.text
      return el
    }))
  }

  private invalidate(node: Node): void {
    const item = this.surface.view.itemAt(node)
    if (item)
      item.map = null
  }

  private collapse(point: CaretPoint): void {
    try {
      this.surface.root.ownerDocument.getSelection()?.collapse(point.node, point.offset)
    }
    catch {}
  }

  /** Whether a caret outside the span is still at one of its edges. */
  private touches(span: HTMLElement, node: Node, offset: number): boolean {
    const view = this.surface.view
    const item = view.itemAt(span)
    if (!item || view.itemAt(node) !== item || !onCaretLine(span, node, offset))
      return false
    const range = view.mapOf(item).rangeOf(span)
    const pos = view.domToSource(node, offset, 1) - view.startOf(item)
    return !!range && range[0] <= pos && pos <= range[1]
  }

  /** The outermost formatted element the caret is in, or else touches. */
  private find(node: Node, offset: number): Candidate | null {
    const view = this.surface.view
    const item = view.itemAt(node)
    if (!item?.raw)
      return null
    const pos = view.domToSource(node, offset, 1) - view.startOf(item)
    const map = view.mapOf(item)
    let left: Candidate | null = null
    let right: Candidate | null = null
    for (const el of Array.from(item.el.querySelectorAll<HTMLElement>(REVEALABLE))) {
      if (el.closest('pre') || isNested(el, item.el))
        continue
      const range = map.rangeOf(el)
      if (!range || range[0] > pos || range[1] < pos || !onCaretLine(el, node, offset))
        continue
      const source = item.raw.slice(range[0], range[1])
      // Nothing to show (a bare autolink), or more than one line of it.
      if (!source || source.includes('\n') || source === revealedText(el) || el.querySelector(RENDERED_ONLY))
        continue
      const tokens = this.surface.renderer.inlineTokens(source)
      if (!isWhole(el, tokens))
        continue
      const candidate = { el, item, from: range[0], to: range[1], pos, tokens }
      if (range[0] < pos && pos < range[1])
        return candidate
      if (range[1] === pos)
        left = candidate
      else
        right ??= candidate
    }
    return left ?? right
  }

  private open(found: Candidate): void {
    const { el, item, from, to, pos, tokens } = found
    const source = item.raw.slice(from, to)
    const span = el.ownerDocument.createElement('span')
    span.className = 'tx-markdown-editor__reveal'
    span.setAttribute(REVEAL_ATTRIBUTE, '')
    this.paint(span, piecesOf(source, tokens))
    this.surface.withoutObserver(() => el.replaceWith(span))
    item.map = null
    this.current = { span, original: el, source }
    this.collapse(pointIn(span, Math.max(0, Math.min(pos - from, source.length))))
    this.showPreview()
  }

  // ---------------------------------------------------------------------------
  // A formula being edited is typeset under it
  // ---------------------------------------------------------------------------

  private showPreview(): void {
    const span = this.current?.span
    const page = this.surface.root.parentElement
    const tokens = span ? this.surface.renderer.inlineTokens(revealedText(span)) : []
    const token = tokens.length === 1 && tokens[0]!.type === 'mathInline' ? tokens[0] as Token & { text: string } : null
    const html = token && page ? this.surface.renderer.typesetTex(token.text, false) : null
    if (!span || !page || html === null) {
      this.hidePreview()
      return
    }
    let preview = this.preview
    if (!preview) {
      preview = page.ownerDocument.createElement('div')
      preview.className = 'tx-markdown-editor__math-preview'
      preview.setAttribute('aria-hidden', 'true')
      this.preview = preview
    }
    if (preview.parentElement !== page)
      page.append(preview)
    preview.innerHTML = html
    const origin = page.getBoundingClientRect()
    const box = span.getBoundingClientRect()
    preview.style.left = `${Math.max(0, box.left - origin.left)}px`
    preview.style.top = `${box.bottom - origin.top + 6}px`
  }

  private hidePreview(): void {
    this.preview?.remove()
  }
}
