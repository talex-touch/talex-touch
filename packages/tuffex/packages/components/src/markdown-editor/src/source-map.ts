/**
 * Where each character of a rendered block came from in its Markdown source.
 *
 * The rich surface and the preview show DOM, while selections, comments,
 * peers' carets and every edit are source offsets. A BlockMap pairs one block
 * element with the source it was rendered from (or serialized to) and
 * translates between the two.
 *
 * It is built by walking the block in document order with a pointer into the
 * source. The syntax an element implies — a heading's `#`, a list marker,
 * emphasis delimiters, a link's `](url)` — is skipped on entering and leaving
 * it, and every character of text is matched forward: literally, as a
 * backslash escape, or as an entity. Atoms carry their source in
 * `data-md-src`. Whatever cannot be matched maps to a zero-width position, so
 * an unexpected shape degrades the map to "close" instead of breaking it.
 */

export interface SourceUnit {
  node: Node
  /** Code unit in a Text node; -1 for an element taken as a whole (atom, image, break, checkbox). */
  index: number
  start: number
  end: number
}

export interface DomPoint {
  node: Node
  offset: number
}

export interface SourceDomPoint extends DomPoint {
  /**
   * The outermost inline element the source position lies outside of while
   * the DOM point sits inside it — the caret after `**bold**` is still in the
   * `<strong>`. Typing there must first step out of `element`.
   */
  outside: { element: Element, side: 'before' | 'after' } | null
}

export interface SourceRect {
  left: number
  top: number
  width: number
  height: number
}

const MAX_SCAN = 256

/** Marks a span the rich surface shows an element's Markdown in; its text is that source verbatim. */
export const REVEAL_ATTRIBUTE = 'data-md-reveal'

const INLINE_ELEMENTS = new Set([
  'A', 'ABBR', 'B', 'CITE', 'CODE', 'DEL', 'DFN', 'EM', 'I', 'INS', 'KBD', 'MARK', 'Q', 'S', 'SAMP',
  'SMALL', 'SPAN', 'STRIKE', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR',
])

const BLOCK_ELEMENTS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'SUMMARY', 'TABLE', 'UL',
])

/** Elements whose own text children can only be the renderer's line breaks. */
const STRUCTURE_ELEMENTS = new Set(['BLOCKQUOTE', 'DL', 'OL', 'TABLE', 'TBODY', 'TFOOT', 'THEAD', 'TR', 'UL'])

const DELIMITERS: Record<string, RegExp> = {
  STRONG: /\*\*|__/y,
  B: /\*\*|__/y,
  EM: /[*_]/y,
  I: /[*_]/y,
  DEL: /~~?/y,
  S: /~~?/y,
  STRIKE: /~~?/y,
  MARK: /==/y,
}

const HEADING_PREFIX = /[ \t]{0,3}#{1,6}(?:[ \t]+|(?=\n)|$)/y
const LIST_MARKER_HERE = /[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|(?=\n)|$)/y
const LIST_MARKER = /^(?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|(?=\n)|$)/gm
const QUOTE_PREFIX = /[ \t\n]*>[ \t]?/y
const FENCE_OPEN = /[ \t>\n]*?(?:`{3,}|~{3,})[^\n]*\n/y
const CODE_OPEN = /`+ ?/y
const CODE_CLOSE = / ?`+/y
const BREAK_HTML = /<br\s*\/?>/iy
const BREAK_LINE = /[ \t]*\\?\n/y
const CHECKBOX = /[ \t]*\[[ xX]\]/y
/** The rest of a block that is only a line's quote markers: an empty last line. */
const EMPTY_LINE_REST = /(?:[ \t]*>)*[ \t]*$/y
/** What a table row's line holds before its first cell: a quote's `>`, a list's indent. */
const ROW_PREFIX = /(?:[ \t]*>)*[ \t]*/y
/** A cell's opening pipe, which the first cell of a row may go without. */
const CELL_OPEN = /[ \t]*\|?[ \t]*/y
const ENTITY = /&(?:#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/y

const tagPatterns = new Map<string, [RegExp, RegExp]>()

function htmlTagPatterns(tag: string): [RegExp, RegExp] {
  let patterns = tagPatterns.get(tag)
  if (!patterns) {
    const name = tag.toLowerCase()
    patterns = [new RegExp(`<${name}\\b[^>]*>`, 'iy'), new RegExp(`</${name}\\s*>`, 'iy')]
    tagPatterns.set(tag, patterns)
  }
  return patterns
}

const entityCache = new Map<string, string>()
let entityDecoder: HTMLTextAreaElement | null = null

function decodeEntity(entity: string, doc: Document): string {
  let value = entityCache.get(entity)
  if (value === undefined) {
    // A detached textarea parses its content as text: nothing executes.
    entityDecoder ??= doc.createElement('textarea')
    entityDecoder.innerHTML = entity
    value = entityDecoder.value
    entityCache.set(entity, value)
  }
  return value
}

function isElement(node: Node | null | undefined): node is Element {
  return !!node && node.nodeType === 1
}

function isText(node: Node | null | undefined): node is Text {
  return !!node && node.nodeType === 3
}

export function isMarkdownAtom(node: Node | null | undefined): node is HTMLElement {
  return isElement(node) && node.hasAttribute('data-md-atom')
}

/** An atom's exact Markdown, or null for an ordinary element. */
export function atomSource(node: Node): string | null {
  const encoded = isElement(node) ? node.getAttribute('data-md-src') : null
  if (encoded === null)
    return null
  try {
    return decodeURIComponent(encoded)
  }
  catch {
    return encoded
  }
}

/** The newlines marked puts between block tags: markup formatting, not content. */
export function isFormattingWhitespace(node: Text): boolean {
  if (/[^ \t\n\r]/.test(node.data))
    return false
  const parent = node.parentElement
  if (!parent)
    return false
  if (STRUCTURE_ELEMENTS.has(parent.tagName))
    return true
  const isBlock = (sibling: Node | null) => isElement(sibling) && BLOCK_ELEMENTS.has(sibling.tagName)
  return isBlock(node.previousSibling) || isBlock(node.nextSibling)
}

const LINE_CONTAINERS = new Set([...BLOCK_ELEMENTS, 'TD', 'TH'])

/** The block or cell whose line `node` is on. */
function lineOf(node: Node): Node | null {
  for (let current: Node | null = node; current; current = current.parentNode) {
    if (isElement(current) && LINE_CONTAINERS.has(current.tagName))
      return current
  }
  return null
}

/**
 * A `<br>` with nothing after it in its block draws no line: it only gives an
 * empty block its height, as the surface and the browser add to hold a caret.
 * It has no source.
 */
export function isPlaceholderBreak(br: Element): boolean {
  for (let current: Node = br; current.parentNode; current = current.parentNode) {
    for (let next = current.nextSibling; next; next = next.nextSibling) {
      if (isText(next) && !/[^\s\u200B]/.test(next.data))
        continue
      if (isElement(next) && LINE_CONTAINERS.has(next.tagName))
        break
      return false
    }
    const parent = current.parentNode
    if (!isElement(parent) || LINE_CONTAINERS.has(parent.tagName) || isMarkdownAtom(parent))
      return true
  }
  return true
}

function isWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\n'
}

function childIndex(node: Node): number {
  let index = 0
  let sibling = node.previousSibling
  while (sibling) {
    index++
    sibling = sibling.previousSibling
  }
  return index
}

export class BlockMap {
  readonly units: SourceUnit[] = []
  /** Source span of every element walked, opening syntax to closing syntax. */
  private readonly ranges = new Map<Element, [number, number]>()
  private readonly firstUnit = new Map<Node, number>()
  private p = 0
  /** Inside a revealed span: no element implies syntax, every character is itself. */
  private verbatim = 0
  /** Where the line of the table row being walked ends. */
  private rowEnd = -1
  readonly root: Element
  readonly raw: string

  constructor(root: Element, raw: string) {
    this.root = root
    this.raw = raw
    if (isMarkdownAtom(root) || root.tagName === 'HR') {
      this.push(root, -1, 0, raw.length)
      this.ranges.set(root, [0, raw.length])
    }
    else {
      this.walkElement(root)
    }
  }

  private push(node: Node, index: number, start: number, end: number): void {
    if (index <= 0 && !this.firstUnit.has(node))
      this.firstUnit.set(node, this.units.length)
    if (index < 0 && isElement(node))
      this.ranges.set(node, [start, end])
    this.units.push({ node, index, start, end })
  }

  private skip(pattern: RegExp): boolean {
    pattern.lastIndex = this.p
    const match = pattern.exec(this.raw)
    if (!match)
      return false
    this.p += match[0].length
    return true
  }

  private walkChildren(el: Element): void {
    for (let child = el.firstChild; child; child = child.nextSibling) {
      if (isText(child))
        this.walkText(child)
      else if (isElement(child))
        this.walkElement(child)
    }
  }

  private walkElement(el: Element): void {
    const start = this.p
    if (el !== this.root && isMarkdownAtom(el)) {
      this.walkAtom(el, atomSource(el) ?? '')
      return
    }
    if (this.verbatim || (el !== this.root && el.hasAttribute(REVEAL_ATTRIBUTE))) {
      this.verbatim++
      this.walkChildren(el)
      this.verbatim--
      this.ranges.set(el, [start, this.p])
      return
    }

    const tag = el.tagName
    switch (tag) {
      case 'BR':
        this.walkBreak(el)
        return
      case 'IMG':
        this.walkImage(el)
        return
      case 'INPUT': {
        const from = this.p
        if (this.skip(CHECKBOX))
          this.push(el, -1, from, this.p)
        else
          this.push(el, -1, from, from)
        return
      }
      default:
        break
    }

    let closing: (() => void) | null = null
    if (/^H[1-6]$/.test(tag)) {
      this.skip(HEADING_PREFIX)
    }
    else if (tag === 'LI') {
      // Right here for the first item (`> - a` has skipped its `> `), else
      // at the start of a later line.
      if (!this.skip(LIST_MARKER_HERE)) {
        LIST_MARKER.lastIndex = this.p
        const match = LIST_MARKER.exec(this.raw)
        if (match)
          this.p = match.index + match[0].length
      }
    }
    else if (tag === 'BLOCKQUOTE') {
      this.skip(QUOTE_PREFIX)
    }
    else if (tag === 'PRE') {
      this.skip(FENCE_OPEN)
    }
    else if (tag === 'TBODY') {
      // The header row ends at the next newline, the delimiter row at the one after.
      const headerEnd = this.raw.indexOf('\n', this.p)
      const delimiterEnd = headerEnd < 0 ? -1 : this.raw.indexOf('\n', headerEnd + 1)
      if (delimiterEnd >= 0)
        this.p = delimiterEnd + 1
    }
    else if (tag === 'TR') {
      // A row is a line: the first body row's is after the delimiter row, where
      // TBODY has put us; a later one's is the line after the row before it,
      // however much of that row its cells matched. Never back: the units
      // stay in source order.
      if (el.previousElementSibling && this.rowEnd >= 0)
        this.p = Math.max(this.p, this.rowEnd + 1)
      this.skip(ROW_PREFIX)
      const end = this.raw.indexOf('\n', this.p)
      this.rowEnd = end < 0 ? this.raw.length : end
    }
    else if (tag === 'TD' || tag === 'TH') {
      // So that formatting first in the cell starts at its own syntax.
      this.skip(CELL_OPEN)
    }
    else if (INLINE_ELEMENTS.has(tag)) {
      closing = this.openInline(el)
    }

    this.walkChildren(el)
    closing?.()
    this.ranges.set(el, [start, this.p])
  }

  /** Skips the opening syntax of an inline element; returns the skip for its closing syntax. */
  private openInline(el: Element): (() => void) | null {
    const tag = el.tagName
    const [open, close] = htmlTagPatterns(tag)
    if (this.skip(open))
      return () => void this.skip(close)

    if (tag === 'CODE') {
      if (el.parentElement?.tagName === 'PRE')
        return null
      return this.skip(CODE_OPEN) ? () => void this.skip(CODE_CLOSE) : null
    }
    if (tag === 'A') {
      if (this.raw[this.p] === '[') {
        this.p++
        return () => this.closeBracketLink()
      }
      if (this.raw[this.p] === '<') {
        this.p++
        return () => {
          if (this.raw[this.p] === '>')
            this.p++
        }
      }
      // A bare autolink is its own text.
      return null
    }
    const delimiter = DELIMITERS[tag]
    if (delimiter && this.skip(delimiter))
      return () => void this.skip(delimiter)
    return null
  }

  /** `](destination "title")`, `][label]` or a lone `]`. */
  private closeBracketLink(): void {
    const raw = this.raw
    if (raw[this.p] !== ']')
      return
    this.p++
    if (raw[this.p] === '(') {
      let depth = 0
      for (let q = this.p; q < raw.length; q++) {
        const char = raw[q]
        if (char === '\\') {
          q++
          continue
        }
        if (char === '<') {
          const end = raw.indexOf('>', q)
          if (end > q) {
            q = end
            continue
          }
        }
        if (char === '"' || char === '\'') {
          const end = raw.indexOf(char, q + 1)
          if (end > q) {
            q = end
            continue
          }
        }
        if (char === '(') {
          depth++
        }
        else if (char === ')') {
          depth--
          if (depth === 0) {
            this.p = q + 1
            return
          }
        }
      }
      return
    }
    if (raw[this.p] === '[') {
      const end = raw.indexOf(']', this.p)
      if (end >= 0)
        this.p = end + 1
    }
  }

  private walkAtom(el: Element, source: string): void {
    let found = source ? this.raw.indexOf(source, this.p) : -1
    if (found < 0 && source.includes('|') && el.closest('td, th')) {
      // A cell's `\|` reach the inline lexer unescaped.
      source = source.replace(/\|/g, '\\|')
      found = this.raw.indexOf(source, this.p)
    }
    if (found < 0) {
      this.push(el, -1, this.p, this.p)
      this.ranges.set(el, [this.p, this.p])
      return
    }
    this.push(el, -1, found, found + source.length)
    this.p = found + source.length
    this.ranges.set(el, [found, this.p])
  }

  private walkBreak(el: Element): void {
    const from = this.p
    if (this.skip(BREAK_HTML) || this.skip(BREAK_LINE)) {
      this.push(el, -1, from, this.p)
      return
    }
    if (isPlaceholderBreak(el)) {
      // On an empty last line, as a callout's `> ` body, the caret is after its markers.
      this.skip(EMPTY_LINE_REST)
      this.push(el, -1, this.p, this.p)
      return
    }
    const newline = this.raw.indexOf('\n', this.p)
    if (newline >= 0 && newline - this.p < MAX_SCAN) {
      this.push(el, -1, newline, newline + 1)
      this.p = newline + 1
      return
    }
    this.push(el, -1, from, from)
  }

  /** Rendered images are atoms; this covers an `<img>` that arrived without its source. */
  private walkImage(el: Element): void {
    const raw = this.raw
    const at = raw.indexOf('![', this.p)
    let close = -1
    if (at >= 0 && at - this.p <= MAX_SCAN) {
      let depth = 0
      for (let q = at + 1; q < raw.length; q++) {
        const char = raw[q]
        if (char === '\\') {
          q++
        }
        else if (char === '[') {
          depth++
        }
        else if (char === ']' && --depth === 0) {
          close = q
          break
        }
      }
    }
    if (close < 0) {
      this.push(el, -1, this.p, this.p)
      return
    }
    this.p = close
    this.closeBracketLink()
    this.push(el, -1, at, this.p)
  }

  private inCode(node: Node): boolean {
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (el.tagName === 'CODE' || el.tagName === 'PRE')
        return true
      if (el === this.root)
        break
    }
    return false
  }

  private walkText(node: Text): void {
    const data = node.data
    if (isFormattingWhitespace(node)) {
      for (let k = 0; k < data.length; k++)
        this.push(node, k, this.p, this.p)
      return
    }
    const raw = this.raw
    const doc = node.ownerDocument
    // Code is verbatim: a backslash or an ampersand there is the character itself.
    const verbatim = this.verbatim > 0 || this.inCode(node)
    for (let k = 0; k < data.length; k++) {
      const char = data[k]!
      if (char === '\u200B') {
        this.push(node, k, this.p, this.p)
        continue
      }
      if (/\s/.test(char)) {
        if (isWhitespace(raw[this.p])) {
          this.push(node, k, this.p, this.p + 1)
          this.p++
        }
        else {
          this.push(node, k, this.p, this.p)
        }
        continue
      }

      let matched = false
      const limit = Math.min(raw.length, this.p + MAX_SCAN)
      for (let q = this.p; q < limit; q++) {
        const at = raw[q]
        if (verbatim) {
          if (at === char) {
            this.push(node, k, q, q + 1)
            this.p = q + 1
            matched = true
            break
          }
          continue
        }
        // The escape first: the `\\` of an escaped backslash is one character.
        if (at === '\\' && raw[q + 1] === char) {
          this.push(node, k, q, q + 2)
          this.p = q + 2
          matched = true
          break
        }
        if (at === '&') {
          ENTITY.lastIndex = q
          const entity = ENTITY.exec(raw)
          if (entity) {
            const value = decodeEntity(entity[0], doc)
            if (value && data.startsWith(value, k)) {
              const end = q + entity[0].length
              this.push(node, k, q, end)
              // An astral character is two code units from one entity.
              for (let extra = 1; extra < value.length; extra++)
                this.push(node, k + extra, end, end)
              k += value.length - 1
              this.p = end
              matched = true
              break
            }
          }
        }
        if (at === char) {
          this.push(node, k, q, q + 1)
          this.p = q + 1
          matched = true
          break
        }
      }
      if (!matched)
        this.push(node, k, this.p, this.p)
    }
  }

  /** The source span of an element unit (checkbox, atom, image) or a walked element. */
  rangeOf(el: Element): [number, number] | null {
    return this.ranges.get(el) ?? null
  }

  unitOf(el: Element): SourceUnit | null {
    const index = this.firstUnit.get(el)
    return index === undefined ? null : this.units[index] ?? null
  }

  private enclosingAtom(node: Node): Element | null {
    for (let current: Node | null = node; current && current !== this.root; current = current.parentNode) {
      if (isMarkdownAtom(current))
        return current
    }
    return isMarkdownAtom(this.root) ? this.root : null
  }

  /**
   * The source offset of a DOM point. Between two characters with syntax in
   * between (a code block's indent, a closing `**`), `bias` 1 takes the
   * position before the next character — where typing lands — and -1 the one
   * after the previous character, which is what a selection's end wants.
   */
  domToSource(node: Node, offset: number, bias: -1 | 1 = 1): number {
    const atom = this.enclosingAtom(node)
    if (atom) {
      const unit = this.unitOf(atom)
      if (unit) {
        const range = (atom.ownerDocument ?? document).createRange()
        range.selectNodeContents(atom)
        range.collapse(true)
        return range.comparePoint(node, offset) <= 0 ? unit.start : unit.end
      }
    }

    if (isText(node)) {
      const first = this.firstUnit.get(node)
      if (first !== undefined && node.length > 0) {
        if (offset <= 0)
          return this.units[first]!.start
        if (offset >= node.length)
          return this.units[first + node.length - 1]?.end ?? this.units[first]!.end
        const next = this.units[first + offset]
        const prev = this.units[first + offset - 1]
        return (bias > 0 ? next?.start : prev?.end) ?? prev?.end ?? this.units[first]!.end
      }
    }
    else if (isElement(node)) {
      const before = node.childNodes[offset - 1]
      const after = node.childNodes[offset]
      const end = before ? this.endOf(before) : null
      const start = after ? this.startOf(after) : null
      const found = bias > 0 ? start ?? end : end ?? start
      if (found !== null)
        return found
    }
    return this.byOrder(node, offset)
  }

  private startOf(node: Node): number | null {
    if (isText(node)) {
      const first = this.firstUnit.get(node)
      return first === undefined || !node.length ? null : this.units[first]!.start
    }
    return isElement(node) ? this.ranges.get(node)?.[0] ?? null : null
  }

  private endOf(node: Node): number | null {
    if (isText(node)) {
      const first = this.firstUnit.get(node)
      return first === undefined || !node.length ? null : this.units[first + node.length - 1]?.end ?? null
    }
    return isElement(node) ? this.ranges.get(node)?.[1] ?? null : null
  }

  /** Locates an unmapped DOM point between the units around it. */
  private byOrder(node: Node, offset: number): number {
    const units = this.units
    if (!units.length)
      return 0
    const doc = this.root.ownerDocument ?? document
    const range = doc.createRange()
    try {
      range.setStart(node, offset)
    }
    catch {
      return 0
    }
    range.collapse(true)
    // Count the units whose position is before the point.
    let low = 0
    let high = units.length
    while (low < high) {
      const mid = (low + high) >> 1
      const unit = units[mid]!
      const point = this.unitPoint(unit)
      if (range.comparePoint(point.node, point.offset) < 0)
        low = mid + 1
      else
        high = mid
    }
    if (low > 0 && (offset > 0 || low >= units.length))
      return units[low - 1]!.end
    return units[low]?.start ?? units[units.length - 1]!.end
  }

  private unitPoint(unit: SourceUnit): DomPoint {
    if (unit.index >= 0)
      return { node: unit.node, offset: unit.index }
    const parent = unit.node.parentNode ?? unit.node
    return { node: parent, offset: unit.node.parentNode ? childIndex(unit.node) : 0 }
  }

  private before(unit: SourceUnit): DomPoint {
    return this.unitPoint(unit)
  }

  private after(unit: SourceUnit): DomPoint {
    if (unit.index >= 0)
      return { node: unit.node, offset: unit.index + 1 }
    const parent = unit.node.parentNode ?? unit.node
    return { node: parent, offset: unit.node.parentNode ? childIndex(unit.node) + 1 : 0 }
  }

  private outside(unit: SourceUnit, pos: number, side: 'before' | 'after'): SourceDomPoint['outside'] {
    let found: Element | null = null
    for (let current = unit.node.parentNode; current && current !== this.root; current = current.parentNode) {
      if (!isElement(current) || !INLINE_ELEMENTS.has(current.tagName))
        continue
      const range = this.ranges.get(current)
      if (!range)
        continue
      if (side === 'after' ? range[1] <= pos : range[0] >= pos)
        found = current
    }
    return found ? { element: found, side } : null
  }

  /**
   * Whether `pos`, between units on two lines (list items, a quote's
   * paragraphs, table cells), comes before the break between them. A closing
   * `**` there ends the line it is on; it is not the start of the next one.
   */
  private endsLine(previous: SourceUnit, next: SourceUnit, pos: number): boolean {
    if (lineOf(previous.node) === lineOf(next.node))
      return false
    const gap = this.raw.slice(previous.end, next.start).search(/[\n|]/)
    return gap >= 0 && pos <= previous.end + gap
  }

  sourceToDom(pos: number): SourceDomPoint {
    const units = this.units
    const target = Math.max(0, Math.min(pos, this.raw.length))
    if (!units.length) {
      const empty = isMarkdownAtom(this.root) ? this.root.parentNode ?? this.root : this.root
      return { node: empty, offset: 0, outside: null }
    }

    // The last unit starting at or before the position.
    let low = 0
    let high = units.length - 1
    let index = -1
    while (low <= high) {
      const mid = (low + high) >> 1
      if (units[mid]!.start <= target) {
        index = mid
        low = mid + 1
      }
      else {
        high = mid - 1
      }
    }

    const at = index >= 0 ? units[index]! : null
    if (at && at.start < target && target < at.end) {
      const nearStart = target - at.start < at.end - target
      return { ...(nearStart ? this.before(at) : this.after(at)), outside: null }
    }

    // `index` is the last unit starting at or before `target`; every unit up
    // to it ends at or before `target` unless it starts exactly there.
    let prev = index
    while (prev >= 0 && units[prev]!.end > target)
      prev--
    // Prefer the last of several zero-width units at the position: it is the
    // one the caret was last put after (a step-out space).
    const previous = prev >= 0 ? units[prev]! : null
    const next = units[prev + 1]
    if (previous && (previous.end === target || (next && this.endsLine(previous, next, target)))) {
      // Never after a placeholder break: text typed there would start a second line.
      const placeholder = previous.index < 0 && previous.start === previous.end && isElement(previous.node) && previous.node.tagName === 'BR'
      return { ...(placeholder ? this.before(previous) : this.after(previous)), outside: previous.end < target ? this.outside(previous, target, 'after') : null }
    }

    if (next) {
      const point = this.before(next)
      return { ...point, outside: target < next.start ? this.outside(next, target, 'before') : null }
    }
    const last = units[units.length - 1]!
    return { ...this.after(last), outside: target > last.end ? this.outside(last, target, 'after') : null }
  }

  /** Client rects of the source range, one per text run or element, never the whole block. */
  rangeRects(from: number, to: number): SourceRect[] {
    if (to <= from)
      return []
    const doc = this.root.ownerDocument ?? document
    const rects: SourceRect[] = []
    const add = (list: ArrayLike<DOMRect>) => {
      for (let i = 0; i < list.length; i++) {
        const rect = list[i]!
        if (rect.width > 0 || rect.height > 0)
          rects.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
      }
    }
    let runNode: Text | null = null
    let runStart = 0
    let runEnd = 0
    const flush = () => {
      if (!runNode)
        return
      const range = doc.createRange()
      range.setStart(runNode, runStart)
      range.setEnd(runNode, runEnd)
      add(range.getClientRects())
      runNode = null
    }
    for (const unit of this.units) {
      if (unit.end <= from || unit.start >= to || unit.end === unit.start)
        continue
      if (unit.index >= 0 && isText(unit.node)) {
        if (runNode === unit.node && runEnd === unit.index) {
          runEnd = unit.index + 1
          continue
        }
        flush()
        runNode = unit.node
        runStart = unit.index
        runEnd = unit.index + 1
        continue
      }
      flush()
      if (isElement(unit.node) && unit.node.tagName !== 'BR' && typeof unit.node.getClientRects === 'function')
        add(unit.node.getClientRects())
    }
    flush()
    return rects
  }

  /** A zero-width rect where the caret for `pos` would be drawn. */
  caretRect(pos: number): SourceRect | null {
    const doc = this.root.ownerDocument ?? document
    const point = this.sourceToDom(pos)
    const range = doc.createRange()
    try {
      range.setStart(point.node, point.offset)
      range.collapse(true)
    }
    catch {
      return null
    }
    const rect = range.getClientRects()[0]
    if (rect && rect.height > 0)
      return { left: rect.left, top: rect.top, width: 0, height: rect.height }

    // Collapsed ranges at element boundaries have no rect; lean on a neighbour.
    const neighbour = this.units.find(unit => unit.end > unit.start && unit.start >= pos)
    const before = [...this.units].reverse().find(unit => unit.end > unit.start && unit.end <= pos)
    const pick = (unit: SourceUnit | undefined, edge: 'left' | 'right'): SourceRect | null => {
      if (!unit)
        return null
      let list: ArrayLike<DOMRect>
      if (unit.index >= 0) {
        const charRange = doc.createRange()
        charRange.setStart(unit.node, unit.index)
        charRange.setEnd(unit.node, unit.index + 1)
        list = charRange.getClientRects()
      }
      else if (isElement(unit.node)) {
        list = unit.node.getClientRects()
      }
      else {
        return null
      }
      const box = edge === 'left' ? list[0] : list[list.length - 1]
      if (!box || box.height <= 0)
        return null
      return { left: edge === 'left' ? box.left : box.right, top: box.top, width: 0, height: box.height }
    }
    return pick(before, 'right') ?? pick(neighbour, 'left')
  }
}
