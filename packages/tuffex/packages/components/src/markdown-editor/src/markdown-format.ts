import type { MarkdownHighlight } from './markdown-highlight'
import type { MarkdownEditorCalloutType, MarkdownEditorHighlightColor, MarkdownEditorSelection, MarkdownTextChange } from './types'
import { markdownHighlightAt, markdownHighlightsOnLine, opaqueAt } from './markdown-highlight'
import { codeSpan, linkDestination } from './markdown-serializer'
import { mapMarkdownPosition, normalizeChanges } from './text-changes'

/**
 * Toolbar commands and editing shortcuts as source edits.
 *
 * Every surface, the history and the collaboration transport work in Markdown
 * offsets, so a command is computed once from the document and the selection
 * and then applied wherever the user is: the rich surface re-renders the
 * blocks it touched, the source editor dispatches it, and a peer receives the
 * same change set.
 */

export interface MarkdownEdit {
  changes: MarkdownTextChange[]
  selection: MarkdownEditorSelection
}

export type MarkdownInlineFormat = 'bold' | 'italic' | 'strike' | 'code'
export type MarkdownLineFormat = 'quote' | 'bulletList' | 'orderedList' | 'taskList'

export type MarkdownFormatAction =
  | { type: MarkdownInlineFormat }
  /**
   * Highlights the selection in `color`; null takes the highlight off. With
   * `toggle`, a selection that is highlighted all through loses it instead.
   */
  | { type: 'highlight', color: MarkdownEditorHighlightColor | null, toggle?: boolean }
  | { type: MarkdownLineFormat }
  /** The selected lines as a callout; in a quote, the quote becomes one. */
  | { type: 'callout', callout: MarkdownEditorCalloutType }
  /** Without `level`, toggles a level-2 heading. 0 turns headings back into paragraphs. */
  | { type: 'heading', level?: number }
  /** An empty `href` removes the link around the selection. */
  | { type: 'link', href: string }
  | { type: 'image', src: string, alt?: string, title?: string }
  | { type: 'table', columns?: number, rows?: number, header?: string }
  | { type: 'codeBlock', language?: string }
  | { type: 'math', tex?: string, display?: boolean }
  | { type: 'divider' }
  | { type: 'insert', text: string, block?: boolean }

interface Line {
  start: number
  end: number
  text: string
}

interface LinePrefix {
  /** `> ` markers, nested quotes included. */
  quote: string
  indent: string
  /** `- `, `1. ` with the spaces after it; '' when the line is not a list item. */
  marker: string
  /** `[ ] ` or `[x] `. */
  task: string
  /** `## ` */
  heading: string
  /** Offset of the text after all of the above. */
  content: number
}

const DELIMITERS: Record<MarkdownInlineFormat, string> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  code: '`',
}

function caret(pos: number): MarkdownEditorSelection {
  return { anchor: pos, head: pos }
}

function lineAt(doc: string, pos: number): Line {
  // Not `lastIndexOf('\n', -1)`: that looks at the first character, a newline at 0.
  const start = pos > 0 ? doc.lastIndexOf('\n', pos - 1) + 1 : 0
  let end = doc.indexOf('\n', pos)
  if (end < 0)
    end = doc.length
  return { start, end, text: doc.slice(start, end) }
}

/** The lines a selection touches; a range ending at a line start leaves that line out. */
function linesOf(doc: string, from: number, to: number): Line[] {
  const last = to > from && doc[to - 1] === '\n' ? to - 1 : to
  const lines: Line[] = []
  let line = lineAt(doc, from)
  for (;;) {
    lines.push(line)
    if (line.end >= last || line.end >= doc.length)
      break
    line = lineAt(doc, line.end + 1)
  }
  return lines
}

function parseLine(text: string): LinePrefix {
  const quote = /^(?:[ \t]{0,3}>[ \t]?)*/.exec(text)![0]
  let rest = text.slice(quote.length)
  const indent = /^[ \t]*/.exec(rest)![0]
  rest = rest.slice(indent.length)
  const marker = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/.exec(rest)?.[0] ?? ''
  rest = rest.slice(marker.length)
  const task = marker ? /^\[[ xX]\](?:[ \t]+|$)/.exec(rest)?.[0] ?? '' : ''
  rest = rest.slice(task.length)
  const heading = /^#{1,6}(?:[ \t]+|$)/.exec(rest)?.[0] ?? ''
  return { quote, indent, marker, task, heading, content: quote.length + indent.length + marker.length + task.length + heading.length }
}

function indentWidth(indent: string): number {
  return indent.replace(/\t/g, '    ').length
}

function isBlank(text: string): boolean {
  return !text.trim()
}

/** Maps a selection through a change set; carets at an insert point end up after it. */
function mapSelection(selection: MarkdownEditorSelection, changes: MarkdownTextChange[]): MarkdownEditorSelection {
  return {
    anchor: mapMarkdownPosition(selection.anchor, changes, 1),
    head: mapMarkdownPosition(selection.head, changes, 1),
  }
}

function edit(changes: MarkdownTextChange[], selection: MarkdownEditorSelection): MarkdownEdit {
  return { changes: normalizeChanges(changes), selection }
}

/**
 * Pads a block onto lines of its own, a blank line from its neighbours.
 * Returns the text to insert and where the block starts inside it.
 */
function padBlock(doc: string, from: number, to: number, block: string): { insert: string, offset: number } {
  const before = doc.slice(0, from)
  const after = doc.slice(to)
  let lead = ''
  if (before && !/\n[ \t]*\n[ \t]*$/.test(before))
    lead = /\n[ \t]*$/.test(before) ? '\n' : '\n\n'
  let trail = ''
  if (after && !/^[ \t]*\n[ \t]*\n/.test(after))
    trail = /^[ \t]*\n/.test(after) ? '\n' : '\n\n'
  return { insert: lead + block + trail, offset: lead.length }
}

// ---------------------------------------------------------------------------
// Inline formats
// ---------------------------------------------------------------------------

/** Length of the run of `char` ending at `end` / starting at `start`. */
function runBefore(doc: string, end: number, char: string): number {
  let count = 0
  while (end - count > 0 && doc[end - count - 1] === char)
    count++
  return count
}

function runAfter(doc: string, start: number, char: string): number {
  let count = 0
  while (start + count < doc.length && doc[start + count] === char)
    count++
  return count
}

/** Whether a run of delimiter characters holds this format: `*` in `***` yes, in `**` no. */
function runHolds(format: MarkdownInlineFormat, run: number): boolean {
  switch (format) {
    case 'italic':
      return run % 2 === 1
    case 'bold':
      return run >= 2
    case 'strike':
      return run === 2 || run === 1
    case 'code':
      return run >= 1
  }
}

interface Segment {
  from: number
  to: number
}

/** The selection per line, whitespace and block prefixes trimmed away. */
function inlineSegments(doc: string, from: number, to: number): Segment[] {
  const segments: Segment[] = []
  for (const line of linesOf(doc, from, to)) {
    const prefix = parseLine(line.text)
    let start = Math.max(from, line.start + prefix.content)
    let end = Math.min(to, line.end)
    while (start < end && /\s/.test(doc[start]!))
      start++
    while (end > start && /\s/.test(doc[end - 1]!))
      end--
    if (end > start)
      segments.push({ from: start, to: end })
  }
  return segments
}

function toggleInline(doc: string, selection: MarkdownEditorSelection, format: MarkdownInlineFormat): MarkdownEdit {
  const from = Math.min(selection.anchor, selection.head)
  const to = Math.max(selection.anchor, selection.head)
  const delimiter = DELIMITERS[format]
  const char = delimiter[0]!

  if (from === to) {
    // Between an empty pair: take it out again.
    if (doc.slice(from - delimiter.length, from) === delimiter && doc.slice(to, to + delimiter.length) === delimiter)
      return edit([{ from: from - delimiter.length, to: to + delimiter.length, insert: '' }], caret(from - delimiter.length))
    return edit([{ from, to, insert: delimiter + delimiter }], caret(from + delimiter.length))
  }

  const segments = inlineSegments(doc, from, to)
  if (!segments.length)
    return edit([], selection)

  // Already formatted when every segment sits between delimiters or holds them.
  const outside = segments.every(({ from: start, to: end }) =>
    runHolds(format, runBefore(doc, start, char)) && runHolds(format, runAfter(doc, end, char))
    && (format !== 'code' || runBefore(doc, start, char) === runAfter(doc, end, char)))
  const inside = !outside && segments.every(({ from: start, to: end }) => {
    const text = doc.slice(start, end)
    return text.length > 2 * delimiter.length && text.startsWith(delimiter) && text.endsWith(delimiter)
      && runHolds(format, runAfter(doc, start, char)) && runHolds(format, runBefore(doc, end, char))
  })

  const changes: MarkdownTextChange[] = []
  if (outside || inside) {
    for (const { from: start, to: end } of segments) {
      const width = format === 'code' ? runBefore(doc, start, char) : delimiter.length
      if (outside) {
        changes.push({ from: start - width, to: start, insert: '' }, { from: end, to: end + width, insert: '' })
      }
      else {
        const innerWidth = format === 'code' ? runAfter(doc, start, char) : delimiter.length
        changes.push({ from: start, to: start + innerWidth, insert: '' }, { from: end - innerWidth, to: end, insert: '' })
      }
    }
  }
  else {
    for (const { from: start, to: end } of segments) {
      if (format === 'code') {
        changes.push({ from: start, to: end, insert: codeSpan(doc.slice(start, end)) })
        continue
      }
      changes.push({ from: start, to: start, insert: delimiter }, { from: end, to: end, insert: delimiter })
    }
  }

  const first = segments[0]!
  const last = segments[segments.length - 1]!
  if (format === 'code' && !outside && !inside && segments.length === 1) {
    const span = changes[0]!.insert
    const fence = /^`+ ?/.exec(span)![0].length
    return edit(changes, { anchor: first.from + fence, head: first.from + span.length - fence })
  }
  const start = mapMarkdownPosition(first.from, changes, outside ? -1 : 1)
  const end = mapMarkdownPosition(last.to, changes, -1)
  return edit(changes, { anchor: start, head: Math.max(start, end) })
}

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

type HighlightColor = MarkdownEditorHighlightColor | null

interface HighlightPiece {
  color: HighlightColor
  text: string
  /** The source offset of each character of `text`. */
  sources: number[]
}

/**
 * The characters of `text` from `from` to `to` to escape so that `==` pairs
 * up only where it is meant to, as the serializer escapes typed text: the
 * runs of `=` that could open a highlight, or close the one the text is
 * `inside`, and there an `=` or a lone backslash at either end, which would
 * reach into a delimiter. Escapes, code spans and tags stay as they are.
 */
function highlightEscapes(text: string, from: number, to: number, inside: boolean): Set<number> {
  const escapes = new Set<number>()
  let pos = from
  while (pos < to) {
    const skip = opaqueAt(text, pos, to)
    if (skip) {
      if (inside && skip === 1 && text[pos] === '\\')
        escapes.add(pos)
      pos += skip
      continue
    }
    if (text[pos] !== '=') {
      pos++
      continue
    }
    let run = 1
    while (pos + run < to && text[pos + run] === '=')
      run++
    const safe = inside
      ? run === 2 && /\s/.test(text[pos - 1] ?? '')
      : /\s/.test(text[pos + run] ?? '')
    if ((run > 1 && !safe) || (inside && (pos === from || pos + run === to))) {
      for (let index = pos; index < pos + run; index++)
        escapes.add(index)
    }
    pos += run
  }
  return escapes
}

/**
 * Rewrites the highlights a line's selection touches with every character
 * from `from` to `to` in `color`: a highlight around it is split, ones inside
 * it merge, and nothing is nested. `map` finds a source position in the
 * result: the start of the first character after it, or with -1 the end of
 * the last one before it.
 */
function rewriteHighlights(doc: string, spans: MarkdownHighlight[], from: number, to: number, color: HighlightColor): { change: MarkdownTextChange, map: (pos: number, bias: 1 | -1) => number } {
  const touched = spans.filter(span => span.from <= to && span.to >= from)
  const start = Math.min(from, ...touched.map(span => span.from))
  const end = Math.max(to, ...touched.map(span => span.to))
  const inside = spans.filter(span => span.from >= start && span.to <= end)

  const delimiter = new Set<number>()
  for (const span of inside) {
    for (let pos = span.from; pos < span.start; pos++)
      delimiter.add(pos)
    for (let pos = span.end; pos < span.to; pos++)
      delimiter.add(pos)
  }
  const colorAt = (pos: number): HighlightColor => {
    if (pos >= from && pos < to)
      return color
    let found: MarkdownHighlight | null = null
    for (const span of inside) {
      if (span.start <= pos && pos < span.end && (!found || span.end - span.start < found.end - found.start))
        found = span
    }
    return found?.color ?? null
  }

  const pieces: HighlightPiece[] = []
  for (let pos = start; pos < end; pos++) {
    if (delimiter.has(pos))
      continue
    const pieceColor = colorAt(pos)
    let piece = pieces[pieces.length - 1]
    if (!piece || piece.color !== pieceColor) {
      piece = { color: pieceColor, text: '', sources: [] }
      pieces.push(piece)
    }
    piece.text += doc[pos]
    piece.sources.push(pos)
  }

  let insert = ''
  const starts = new Map<number, number>()
  const ends = new Map<number, number>()
  for (const piece of pieces) {
    const lead = /^\s*/.exec(piece.text)![0].length
    const core = piece.text.length - /\s*$/.exec(piece.text.slice(lead))![0].length
    const wrapped = !!piece.color && core > lead
    const escapes = highlightEscapes(piece.text, lead, core, wrapped && piece.color === 'yellow')
    for (let index = 0; index < piece.text.length; index++) {
      if (wrapped && index === lead)
        insert += piece.color === 'yellow' ? '==' : `<mark data-color="${piece.color}">`
      if (wrapped && index === core)
        insert += piece.color === 'yellow' ? '==' : '</mark>'
      const source = piece.sources[index]!
      starts.set(source, start + insert.length)
      if (escapes.has(index))
        insert += '\\'
      insert += piece.text[index]
      ends.set(source, start + insert.length)
    }
    if (wrapped && core === piece.text.length)
      insert += piece.color === 'yellow' ? '==' : '</mark>'
  }

  const map = (pos: number, bias: 1 | -1): number => {
    if (bias > 0) {
      for (let at = pos; at < end; at++) {
        if (starts.has(at))
          return starts.get(at)!
      }
      return start + insert.length
    }
    for (let at = pos - 1; at >= start; at--) {
      if (ends.has(at))
        return ends.get(at)!
    }
    return start
  }
  return { change: { from: start, to: end, insert }, map }
}

function toggleHighlight(doc: string, selection: MarkdownEditorSelection, color: HighlightColor, toggle: boolean): MarkdownEdit {
  const from = Math.min(selection.anchor, selection.head)
  const to = Math.max(selection.anchor, selection.head)

  if (from === to) {
    const host = markdownHighlightAt(doc, from)
    if (host) {
      // A bare caret in a highlight acts on all of it.
      const target = toggle ? null : color
      if (target === host.color)
        return edit([], selection)
      const { change, map } = rewriteHighlights(doc, markdownHighlightsOnLine(doc, from), host.start, host.end, target)
      return edit([change], caret(map(from, from === host.start ? 1 : -1)))
    }
    if (!color)
      return edit([], selection)
    if (color !== 'yellow') {
      const open = `<mark data-color="${color}">`
      return edit([{ from, to, insert: `${open}</mark>` }], caret(from + open.length))
    }
    // Between an empty pair: take it out again.
    if (doc.slice(from - 2, from) === '==' && doc.slice(from, from + 2) === '==')
      return edit([{ from: from - 2, to: from + 2, insert: '' }], caret(from - 2))
    return edit([{ from, to, insert: '====' }], caret(from + 2))
  }

  const segments = inlineSegments(doc, from, to)
  if (!segments.length)
    return edit([], selection)
  const lines = segments.map(segment => ({ segment, spans: markdownHighlightsOnLine(doc, segment.from) }))
  const target = toggle && lines.every(({ segment, spans }) => spans.some(span => span.from <= segment.from && segment.to <= span.to))
    ? null
    : color

  const changes: MarkdownTextChange[] = []
  let anchor = from
  let head = to
  // Each line's result is in its own coordinates; the lines above shift it.
  let delta = 0
  lines.forEach(({ segment, spans }, index) => {
    const { change, map } = rewriteHighlights(doc, spans, segment.from, segment.to, target)
    const changed = change.insert !== doc.slice(change.from, change.to)
    if (index === 0 && changed)
      anchor = map(segment.from, 1)
    if (index === lines.length - 1)
      head = (changed ? map(segment.to, -1) : to) + delta
    if (changed) {
      changes.push(change)
      delta += change.insert.length - (change.to - change.from)
    }
  })
  if (!changes.length)
    return edit([], selection)
  return edit(changes, { anchor, head: Math.max(anchor, head) })
}

// ---------------------------------------------------------------------------
// Line formats
// ---------------------------------------------------------------------------

function setHeading(doc: string, selection: MarkdownEditorSelection, level?: number): MarkdownEdit {
  const from = Math.min(selection.anchor, selection.head)
  const to = Math.max(selection.anchor, selection.head)
  const lines = linesOf(doc, from, to)
  const current = parseLine(lines[0]!.text).heading.trim().length
  const target = level === undefined ? (current === 2 ? 0 : 2) : Math.max(0, Math.min(6, Math.round(level)))
  const changes: MarkdownTextChange[] = []
  for (const line of lines) {
    const prefix = parseLine(line.text)
    if (isBlank(line.text.slice(prefix.content)) && !prefix.heading && lines.length > 1)
      continue
    const start = line.start + prefix.content - prefix.heading.length
    const insert = target ? `${'#'.repeat(target)} ` : ''
    if (prefix.heading !== insert)
      changes.push({ from: start, to: start + prefix.heading.length, insert })
  }
  return edit(changes, mapSelection(selection, changes))
}

function isLineFormat(format: MarkdownLineFormat, prefix: LinePrefix): boolean {
  switch (format) {
    case 'quote':
      return !!prefix.quote
    case 'bulletList':
      return /^[-*+]/.test(prefix.marker) && !prefix.task
    case 'orderedList':
      return /^\d/.test(prefix.marker)
    case 'taskList':
      return !!prefix.task
  }
}

function toggleLines(doc: string, selection: MarkdownEditorSelection, format: MarkdownLineFormat): MarkdownEdit {
  const from = Math.min(selection.anchor, selection.head)
  const to = Math.max(selection.anchor, selection.head)
  const lines = linesOf(doc, from, to)
  const filled = lines.filter(line => !isBlank(line.text))
  const on = filled.length > 0 && filled.every(line => isLineFormat(format, parseLine(line.text)))
  const changes: MarkdownTextChange[] = []
  let number = 1

  for (const line of lines) {
    const prefix = parseLine(line.text)
    if (format === 'quote') {
      if (on) {
        const marker = /^[ \t]{0,3}>[ \t]?/.exec(line.text)
        if (marker)
          changes.push({ from: line.start, to: line.start + marker[0].length, insert: '' })
      }
      else if (lines.length === 1 || !isBlank(line.text) || line !== lines[lines.length - 1]) {
        changes.push({ from: line.start, to: line.start, insert: isBlank(line.text) ? '>' : '> ' })
      }
      continue
    }
    if (isBlank(line.text) && lines.length > 1)
      continue
    const start = line.start + prefix.quote.length + prefix.indent.length
    const end = start + prefix.marker.length + prefix.task.length
    let insert = ''
    if (!on) {
      if (format === 'bulletList')
        insert = '- '
      else if (format === 'orderedList')
        insert = `${number++}. `
      else
        insert = prefix.task ? `- ${prefix.task}` : '- [ ] '
    }
    if (doc.slice(start, end) !== insert)
      changes.push({ from: start, to: end, insert })
  }
  return edit(changes, mapSelection(selection, changes))
}

/**
 * A marker line over the selected lines, which are quoted. In a quote the
 * marker goes over its first line. On an empty line the body is an empty
 * `> `, where the caret goes.
 */
function setCallout(doc: string, selection: MarkdownEditorSelection, type: MarkdownEditorCalloutType): MarkdownEdit {
  const from = Math.min(selection.anchor, selection.head)
  const to = Math.max(selection.anchor, selection.head)
  const lines = linesOf(doc, from, to)
  let top = lines[0]!
  while (top.start > 0 && parseLine(top.text).quote) {
    const above = lineAt(doc, top.start - 1)
    if (!parseLine(above.text).quote)
      break
    top = above
  }
  const marker = `> [!${type.toUpperCase()}]\n`
  // One insert per position: the selection maps past each.
  const changes: MarkdownTextChange[] = top === lines[0] ? [] : [{ from: top.start, to: top.start, insert: marker }]
  lines.forEach((line, index) => {
    const lead = index === 0 && top === lines[0] ? marker : ''
    const quote = parseLine(line.text).quote ? '' : isBlank(line.text) && lines.length > 1 ? '>' : '> '
    if (lead || quote)
      changes.push({ from: line.start, to: line.start, insert: lead + quote })
  })
  return edit(changes, mapSelection(selection, changes))
}

// ---------------------------------------------------------------------------
// Lists: indent, outdent, continue
// ---------------------------------------------------------------------------

interface ListLine extends Line {
  prefix: LinePrefix
}

/** Scans upward from `line` for the nearest list item satisfying `accept`. */
function previousItem(doc: string, line: Line, quote: string, accept: (prefix: LinePrefix) => 'take' | 'skip' | 'stop'): ListLine | null {
  let start = line.start
  for (let guard = 0; start > 0 && guard < 500; guard++) {
    const previous = lineAt(doc, start - 1)
    start = previous.start
    if (isBlank(previous.text))
      continue
    const prefix = parseLine(previous.text)
    if (prefix.quote.replace(/\s/g, '') !== quote.replace(/\s/g, ''))
      return null
    if (!prefix.marker) {
      // A paragraph inside an item, or the paragraph before the list.
      if (indentWidth(prefix.indent) === 0 && !prefix.quote)
        return null
      continue
    }
    const verdict = accept(prefix)
    if (verdict === 'take')
      return { ...previous, prefix }
    if (verdict === 'stop')
      return null
  }
  return null
}

/** Tab and Shift+Tab on list items: nests under the item above, or moves up a level. */
export function indentMarkdownList(doc: string, selection: MarkdownEditorSelection, direction: 1 | -1): MarkdownEdit | null {
  const from = Math.min(selection.anchor, selection.head)
  const to = Math.max(selection.anchor, selection.head)
  const lines = linesOf(doc, from, to)
  const first = lines[0]!
  const prefix = parseLine(first.text)
  if (!prefix.marker)
    return null
  const indent = indentWidth(prefix.indent)

  let delta: number
  // A nested ordered list starts at its first number: `1.`, not wherever the outer one was.
  let renumber = false
  if (direction > 0) {
    let nestedAbove = false
    const sibling = previousItem(doc, first, prefix.quote, (candidate) => {
      const width = indentWidth(candidate.indent)
      if (width > indent)
        nestedAbove = true
      return width === indent ? 'take' : width < indent ? 'stop' : 'skip'
    })
    if (!sibling)
      return null
    delta = sibling.prefix.marker.trimEnd().length + 1
    renumber = !nestedAbove
  }
  else {
    if (indent === 0)
      return null
    const parent = previousItem(doc, first, prefix.quote, candidate => (indentWidth(candidate.indent) < indent ? 'take' : 'skip'))
    delta = (parent ? indentWidth(parent.prefix.indent) : 0) - indent
  }

  // The last item's own nested lines move with it.
  const last = lines[lines.length - 1]!
  const lastIndent = indentWidth(parseLine(last.text).indent)
  const moved = [...lines]
  for (let line = last; line.end < doc.length;) {
    const next = lineAt(doc, line.end + 1)
    if (!isBlank(next.text) && indentWidth(parseLine(next.text).indent) <= lastIndent)
      break
    moved.push(next)
    line = next
  }

  const changes: MarkdownTextChange[] = []
  for (const line of moved) {
    if (isBlank(line.text))
      continue
    const linePrefix = parseLine(line.text)
    const at = line.start + linePrefix.quote.length
    if (delta > 0) {
      changes.push({ from: at, to: at, insert: ' '.repeat(delta) })
    }
    else {
      const remove = Math.min(-delta, linePrefix.indent.length)
      if (remove)
        changes.push({ from: at, to: at + remove, insert: '' })
    }
  }
  const ordinal = /^\d{1,9}/.exec(prefix.marker)?.[0]
  if (renumber && ordinal && ordinal !== '1') {
    const at = first.start + prefix.quote.length + prefix.indent.length
    changes.push({ from: at, to: at + ordinal.length, insert: '1' })
  }
  // An empty `-` nested under text would underline it into a heading.
  if (delta > 0 && prefix.marker.startsWith('-') && !prefix.task && isBlank(first.text.slice(prefix.content))) {
    const at = first.start + prefix.quote.length + prefix.indent.length
    changes.push({ from: at, to: at + 1, insert: '*' })
  }
  if (!changes.length)
    return null
  return edit(changes, mapSelection(selection, changes))
}

/**
 * Enter in a list item or a quote: the next item, numbered and boxed like this
 * one. An empty item ends the list instead, one level at a time.
 */
export function continueMarkdownList(doc: string, selection: MarkdownEditorSelection): MarkdownEdit | null {
  if (selection.anchor !== selection.head)
    return null
  const pos = selection.head
  const line = lineAt(doc, pos)
  const prefix = parseLine(line.text)
  if (!prefix.marker && !prefix.quote)
    return null
  if (pos < line.start + prefix.content - prefix.heading.length)
    return null
  if (/^\s*(?:`{3,}|~{3,})/.test(line.text.slice(prefix.content)))
    return null

  if (isBlank(line.text.slice(prefix.content))) {
    if (prefix.marker && indentWidth(prefix.indent) > 0)
      return indentMarkdownList(doc, selection, -1)
    // The line after a list or a quote continues it lazily: leaving one takes a blank line.
    const blankBefore = line.start === 0 || isBlank(lineAt(doc, line.start - 1).text)
    const blankAfter = line.end >= doc.length || isBlank(lineAt(doc, line.end + 1).text)
    if (prefix.marker && prefix.quote) {
      // A list in a quote ends; the quote goes on.
      const quote = prefix.quote.trimEnd()
      const insert = `${blankBefore ? '' : `${quote}\n`}${quote} `
      return edit([{ from: line.start, to: line.end, insert }], caret(line.start + insert.length))
    }
    const insert = `${blankBefore ? '' : '\n'}${blankAfter ? '' : '\n'}`
    const at = line.start + (blankBefore ? 0 : 1)
    return edit([{ from: line.start, to: line.end, insert }], caret(at))
  }

  let marker = prefix.marker
  const ordinal = /^(\d{1,9})([.)])/.exec(marker)
  if (ordinal)
    marker = `${Number(ordinal[1]) + 1}${ordinal[2]} `
  else if (marker)
    marker = `${marker[0]} `
  const quote = prefix.quote && !/\s$/.test(prefix.quote) ? `${prefix.quote} ` : prefix.quote
  const insert = `\n${quote}${prefix.indent}${marker}${prefix.task ? '[ ] ' : ''}`
  const tail = doc.slice(pos, line.end)
  const spaces = tail.length - tail.trimStart().length
  return edit([{ from: pos, to: pos + spaces, insert }], caret(pos + insert.length))
}

// ---------------------------------------------------------------------------
// Links and inserted blocks
// ---------------------------------------------------------------------------

const LINK = /\[((?:\\.|[^\\\]])*)\]\(((?:<[^>\n]*>|[^()\s]|\([^()\s]*\))*)(?:\s+"(?:\\.|[^"\\])*")?\)/g

/** The `[label](url)` whose label holds the selection, on the selection's line. */
function linkAround(doc: string, from: number, to: number): { start: number, end: number, label: [number, number] } | null {
  const line = lineAt(doc, from)
  if (to > line.end)
    return null
  LINK.lastIndex = 0
  for (const match of line.text.matchAll(LINK)) {
    const start = line.start + match.index
    const image = match.index > 0 && line.text[match.index - 1] === '!'
    const labelStart = start + 1
    const labelEnd = labelStart + match[1]!.length
    if (!image && labelStart <= from && to <= labelEnd)
      return { start, end: start + match[0].length, label: [labelStart, labelEnd] }
  }
  return null
}

/** The destination of the link whose label holds the selection, for editing it; null outside a link. */
export function markdownLinkAt(doc: string, selection: MarkdownEditorSelection): string | null {
  const link = linkAround(doc, Math.min(selection.anchor, selection.head), Math.max(selection.anchor, selection.head))
  if (!link)
    return null
  const destination = /^\]\(((?:<[^>\n]*>|[^()\s]|\([^()\s]*\))*)/.exec(doc.slice(link.label[1], link.end))?.[1] ?? ''
  return destination.startsWith('<') && destination.endsWith('>') ? destination.slice(1, -1) : destination
}

function escapeLabel(text: string): string {
  return text.replace(/([[\]\\])/g, '\\$1')
}

function setLink(doc: string, selection: MarkdownEditorSelection, href: string): MarkdownEdit {
  const from = Math.min(selection.anchor, selection.head)
  const to = Math.max(selection.anchor, selection.head)
  const existing = linkAround(doc, from, to)
  if (existing) {
    const [labelStart, labelEnd] = existing.label
    const label = doc.slice(labelStart, labelEnd)
    if (!href) {
      const changes = [{ from: existing.start, to: existing.end, insert: label }]
      return edit(changes, { anchor: existing.start, head: existing.start + label.length })
    }
    const changes = [{ from: labelEnd, to: existing.end, insert: `](${linkDestination(href)})` }]
    return edit(changes, { anchor: labelStart, head: labelEnd })
  }
  if (!href)
    return edit([], selection)
  const text = doc.slice(from, to)
  if (!text || text.includes('\n')) {
    const label = escapeLabel(text.replace(/\s+/g, ' ').trim() || href)
    const insert = `[${label}](${linkDestination(href)})`
    return edit([{ from, to, insert }], { anchor: from + 1, head: from + 1 + label.length })
  }
  const insert = `[${text}](${linkDestination(href)})`
  return edit([{ from, to, insert }], { anchor: from + 1, head: from + 1 + text.length })
}

function insertBlock(doc: string, selection: MarkdownEditorSelection, block: string, select: (start: number) => MarkdownEditorSelection): MarkdownEdit {
  const from = Math.min(selection.anchor, selection.head)
  const to = Math.max(selection.anchor, selection.head)
  const { insert, offset } = padBlock(doc, from, to, block)
  return edit([{ from, to, insert }], select(from + offset))
}

function fenceFor(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/^[ \t]*(`{3,})/gm), match => match[1]!.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

function codeBlock(doc: string, selection: MarkdownEditorSelection, language = ''): MarkdownEdit {
  const from = Math.min(selection.anchor, selection.head)
  const to = Math.max(selection.anchor, selection.head)
  if (from === to) {
    const block = `\`\`\`${language}\n\n\`\`\``
    return insertBlock(doc, selection, block, start => caret(start + 4 + language.length))
  }
  const lines = linesOf(doc, from, to)
  const start = lines[0]!.start
  const end = lines[lines.length - 1]!.end
  const text = doc.slice(start, end)
  const fence = fenceFor(text)
  const block = `${fence}${language}\n${text}\n${fence}`
  const { insert, offset } = padBlock(doc, start, end, block)
  const inner = start + offset + fence.length + language.length + 1
  return edit([{ from: start, to: end, insert }], { anchor: inner, head: inner + text.length })
}

function mathEdit(doc: string, selection: MarkdownEditorSelection, tex: string | undefined, display: boolean | undefined): MarkdownEdit {
  const from = Math.min(selection.anchor, selection.head)
  const to = Math.max(selection.anchor, selection.head)
  const selected = doc.slice(from, to)
  const source = (tex ?? selected).trim()
  const block = display ?? (source.includes('\n') || (!source && from === to && isBlank(lineAt(doc, from).text)))
  if (block) {
    return insertBlock(doc, selection, `$$\n${source}\n$$`, start => (source
      ? caret(start + source.length + 6)
      : caret(start + 3)))
  }
  const insert = `$${source.replace(/\n+/g, ' ')}$`
  return edit([{ from, to, insert }], source ? caret(from + insert.length) : caret(from + 1))
}

function table(doc: string, selection: MarkdownEditorSelection, columns = 3, rows = 2, header = 'Column'): MarkdownEdit {
  const width = Math.max(1, Math.min(12, Math.round(columns)))
  const height = Math.max(1, Math.min(50, Math.round(rows)))
  const names = Array.from({ length: width }, (_, index) => `${header} ${index + 1}`)
  const lines = [
    `| ${names.join(' | ')} |`,
    `| ${names.map(() => '---').join(' | ')} |`,
    ...Array.from({ length: height }, () => `| ${names.map(() => ' ').join(' | ')} |`),
  ]
  return insertBlock(doc, selection, lines.join('\n'), start => ({ anchor: start + 2, head: start + 2 + names[0]!.length }))
}

/** One toolbar or shortcut command against the source; null when it does not apply. */
export function formatMarkdown(doc: string, selection: MarkdownEditorSelection, action: MarkdownFormatAction): MarkdownEdit | null {
  switch (action.type) {
    case 'bold':
    case 'italic':
    case 'strike':
    case 'code':
      return toggleInline(doc, selection, action.type)
    case 'highlight':
      return toggleHighlight(doc, selection, action.color, !!action.toggle)
    case 'heading':
      return setHeading(doc, selection, action.level)
    case 'quote':
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return toggleLines(doc, selection, action.type)
    case 'callout':
      return setCallout(doc, selection, action.callout)
    case 'link':
      return setLink(doc, selection, action.href.trim())
    case 'image': {
      const alt = escapeLabel(action.alt ?? '')
      const title = action.title ? ` "${action.title.replace(/"/g, '\\"')}"` : ''
      const image = `![${alt}](${linkDestination(action.src)}${title})`
      return insertBlock(doc, selection, image, start => caret(start + image.length))
    }
    case 'table':
      return table(doc, selection, action.columns, action.rows, action.header)
    case 'codeBlock':
      return codeBlock(doc, selection, action.language)
    case 'math':
      return mathEdit(doc, selection, action.tex, action.display)
    case 'divider':
      return insertBlock(doc, selection, '---', start => caret(start + 3))
    case 'insert': {
      const from = Math.min(selection.anchor, selection.head)
      const to = Math.max(selection.anchor, selection.head)
      if (action.block)
        return insertBlock(doc, selection, action.text, start => caret(start + action.text.length))
      return edit([{ from, to, insert: action.text }], caret(from + action.text.length))
    }
  }
}
