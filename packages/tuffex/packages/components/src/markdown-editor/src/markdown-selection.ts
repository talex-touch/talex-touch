import type { MarkdownEditorSelection } from './types'
import { markdownLinkAt } from './markdown-format'
import { markdownHighlightAt } from './markdown-highlight'
import { isInsideMarkdownFence } from './markdown-stream'

/**
 * What the source says about the selection: the formats the toolbar shows as
 * pressed in the source mode (the rich surface reads them off the DOM), and
 * the spans a command at a bare caret applies to.
 */

interface Line {
  start: number
  text: string
}

function lineAt(doc: string, pos: number): Line {
  const start = doc.lastIndexOf('\n', pos - 1) + 1
  const end = doc.indexOf('\n', pos)
  return { start, text: doc.slice(start, end < 0 ? doc.length : end) }
}

function spanAround(line: Line, pattern: RegExp, pos: number, group: number): MarkdownEditorSelection | null {
  for (const match of line.text.matchAll(pattern)) {
    const offset = match[0].indexOf(match[group]!)
    const from = line.start + match.index + offset
    const to = from + match[group]!.length
    if (from <= pos && pos <= to)
      return { anchor: from, head: to }
  }
  return null
}

const CODE_SPAN = /(`+)(?!`)(.+?)(?<!`)\1(?!`)/g
const BOLD = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g
const ITALIC = /(?<![*_\\])([*_])(?![*_\s])(.+?)(?<![*_\s\\])\1(?![*_])/g
const STRIKE = /~~(?=\S)(.+?)(?<=\S)~~/g

/** The text inside the code span holding `pos`. */
export function codeSpanAt(doc: string, pos: number): MarkdownEditorSelection | null {
  return spanAround(lineAt(doc, pos), CODE_SPAN, pos, 2)
}

/** The word holding or touching `pos`. */
export function wordAt(doc: string, pos: number): MarkdownEditorSelection | null {
  const before = /[\p{L}\p{N}_]*$/u.exec(doc.slice(Math.max(0, pos - 80), pos))![0].length
  const after = /^[\p{L}\p{N}_]*/u.exec(doc.slice(pos, pos + 80))![0].length
  return before || after ? { anchor: pos - before, head: pos + after } : null
}

/** Formats in effect at the selection's head, judged from the Markdown around it. */
export function sourceFormats(doc: string, selection: MarkdownEditorSelection): Set<string> {
  const formats = new Set<string>()
  const pos = selection.head
  const line = lineAt(doc, pos)
  if (isInsideMarkdownFence(doc, line.start, false)) {
    formats.add('codeBlock')
    return formats
  }
  const quote = /^(?:[ \t]{0,3}>[ \t]?)+/.exec(line.text)?.[0] ?? ''
  if (quote)
    formats.add('quote')
  const rest = line.text.slice(quote.length)
  const list = /^[ \t]*(?:([-*+])|\d{1,9}[.)])[ \t]+(\[[ xX]\][ \t]+)?/.exec(rest)
  if (list)
    formats.add(list[2] ? 'taskList' : list[1] ? 'bulletList' : 'orderedList')
  if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(list ? rest.slice(list[0].length) : rest))
    formats.add('heading')
  if (codeSpanAt(doc, pos))
    formats.add('code')
  else {
    if (spanAround(line, BOLD, pos, 2))
      formats.add('bold')
    if (spanAround(line, ITALIC, pos, 2))
      formats.add('italic')
    if (spanAround(line, STRIKE, pos, 1))
      formats.add('strike')
    if (markdownHighlightAt(doc, pos))
      formats.add('highlight')
  }
  if (markdownLinkAt(doc, selection) !== null)
    formats.add('link')
  return formats
}

// The source mode's completion rule, plus the zero-width space the rich
// surface keeps in an empty line.
const SHORTCODE_BEFORE = /(?:^|[\s(\u200B]):([a-z0-9_+-]{2,40})$/

/** The `:shortcode` being typed at the end of `text`, without its colon. */
export function shortcodeBefore(text: string): string | null {
  return SHORTCODE_BEFORE.exec(text)?.[1] ?? null
}
