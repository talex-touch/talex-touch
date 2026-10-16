import type { MarkdownEditorHighlightColor } from './types'
import { MARKDOWN_EDITOR_HIGHLIGHT_COLORS } from './types'

/**
 * The highlighter in the source: `==text==` for the default colour, and
 * `<mark data-color>` for the others, which Markdown has no syntax for.
 *
 * A line is read the way the renderer reads it, so `==` in an escape, a code
 * span, a tag or a bare URL opens nothing.
 */

export interface MarkdownHighlight {
  /** Where the opening `==` or `<mark>` starts. */
  from: number
  /** The content, between the delimiters. */
  start: number
  end: number
  /** Where the closing delimiter ends. */
  to: number
  color: MarkdownEditorHighlightColor
}

const COLORS = new Set<string>(MARKDOWN_EDITOR_HIGHLIGHT_COLORS)
const TAG = /<(\/?)([a-z][a-z0-9-]*)\b[^>]*>/iy
const AUTOLINK = /<(?:[a-z][a-z0-9+.-]{1,31}:[^\s<>]*|[^\s<>@]+@[^\s<>]+)>/iy
// marked's GFM text stops before an address wherever it starts.
const BARE_URL = /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<]*/iy
const COLOR_ATTRIBUTE = /\bdata-color\s*=\s*["']?([a-z]+)/i

function stickyAt(pattern: RegExp, text: string, pos: number): RegExpExecArray | null {
  pattern.lastIndex = pos
  return pattern.exec(text)
}

/** A `<mark>` without a colour of the palette is the default one. */
export function highlightColorOf(tag: string): MarkdownEditorHighlightColor {
  const name = COLOR_ATTRIBUTE.exec(tag)?.[1]?.toLowerCase()
  return name && COLORS.has(name) ? name as MarkdownEditorHighlightColor : 'yellow'
}

/**
 * How much of `text` at `pos` hides `==` from the highlighter, ending by `to`:
 * an escape, a code span, a tag or a URL. 0 for plain text.
 */
export function opaqueAt(text: string, pos: number, to: number): number {
  const char = text[pos]
  if (char === '\\')
    return Math.min(2, to - pos)
  if (char === '`') {
    let open = 1
    while (text[pos + open] === '`')
      open++
    for (let q = pos + open; q < to; q++) {
      if (text[q] !== '`')
        continue
      let close = 1
      while (text[q + close] === '`')
        close++
      if (close === open && q + close <= to)
        return q + close - pos
      q += close - 1
    }
    return open
  }
  if (char === '<') {
    const tag = stickyAt(TAG, text, pos) ?? stickyAt(AUTOLINK, text, pos)
    return tag && pos + tag[0].length <= to ? tag[0].length : 0
  }
  if (char === 'h' || char === 'H' || char === 'f' || char === 'F' || char === 'w' || char === 'W') {
    const url = stickyAt(BARE_URL, text, pos)
    return url ? Math.min(url[0].length, to - pos) : 0
  }
  return 0
}

/**
 * `==text==` at `pos`, on one line: where its content ends, or -1. The content
 * starts with neither a space nor another `=`, and ends at the first `==`
 * after a character that is not a space; one in an escape, a code span or a
 * tag does not count. That first `==` is why the serializer escapes `=`.
 */
export function highlightEnd(text: string, pos: number, to = text.length): number {
  const first = text[pos + 2]
  if (text[pos] !== '=' || text[pos + 1] !== '=' || pos + 2 >= to || !first || first === '=' || /\s/.test(first))
    return -1
  let at = pos + 2
  while (at < to) {
    const char = text[at]!
    if (char === '\n')
      return -1
    if (char === '=' && text[at + 1] === '=' && at + 1 < to && !/\s/.test(text[at - 1]!))
      return at
    // A bare URL is not skipped: `==see https://example.com==` ends at the `==`.
    const skip = char === '\\' || char === '`' || char === '<' ? opaqueAt(text, at, to) : 0
    at += skip || 1
  }
  return -1
}

function scan(text: string, from: number, to: number, base: number, out: MarkdownHighlight[]): void {
  const open: Array<{ from: number, start: number, color: MarkdownEditorHighlightColor }> = []
  let pos = from
  while (pos < to) {
    if (text[pos] === '=') {
      const end = highlightEnd(text, pos, to)
      if (end >= 0) {
        out.push({ from: base + pos, start: base + pos + 2, end: base + end, to: base + end + 2, color: 'yellow' })
        // Its content is lexed on its own: tags in it pair up inside it.
        scan(text, pos + 2, end, base, out)
        pos = end + 2
        continue
      }
    }
    const skip = opaqueAt(text, pos, to)
    if (skip && text[pos] === '<') {
      const tag = stickyAt(TAG, text, pos)
      if (tag && tag[2]!.toLowerCase() === 'mark') {
        if (!tag[1]) {
          open.push({ from: base + pos, start: base + pos + skip, color: highlightColorOf(tag[0]) })
        }
        else {
          const opened = open.pop()
          if (opened)
            out.push({ ...opened, end: base + pos, to: base + pos + skip })
        }
      }
    }
    pos += skip || 1
  }
}

/** The highlights on the line holding `pos`, nested ones included, by where they open. */
export function markdownHighlightsOnLine(doc: string, pos: number): MarkdownHighlight[] {
  const start = doc.lastIndexOf('\n', pos - 1) + 1
  let end = doc.indexOf('\n', pos)
  if (end < 0)
    end = doc.length
  const out: MarkdownHighlight[] = []
  scan(doc.slice(start, end), 0, end - start, start, out)
  return out.sort((a, b) => a.from - b.from || b.to - a.to)
}

/** The innermost highlight whose content holds `pos`, its edges included. */
export function markdownHighlightAt(doc: string, pos: number): MarkdownHighlight | null {
  let found: MarkdownHighlight | null = null
  for (const span of markdownHighlightsOnLine(doc, pos)) {
    if (span.start <= pos && pos <= span.end && (!found || span.end - span.start < found.end - found.start))
      found = span
  }
  return found
}
