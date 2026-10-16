import type { StreamParser, StringStream } from '@codemirror/language'
import type { MarkdownEditorHighlightColor } from './types'
import { highlightColorOf, highlightEnd } from './markdown-highlight'

/**
 * Markdown highlighting for the source mode, as a CodeMirror stream parser.
 *
 * The package ships no Markdown grammar, and the source view only needs to
 * show structure, not parse it: markers are dimmed, headings, emphasis, code,
 * links and formulas are styled, and code blocks and `$$` blocks are tracked
 * across lines so their content is never read as Markdown. Inline state
 * (emphasis, a link being read) ends with the line.
 */

interface MarkdownStreamState {
  /** The fence that opened the code block the line is in. */
  fence: string | null
  mathBlock: boolean
  htmlComment: boolean
  /** Whether a block marker can still start here: line start, after `>` or a list marker. */
  lineStart: boolean
  heading: number
  quote: boolean
  /** The line before was quoted: a `>` here continues that quote. */
  quoteAbove: boolean
  /** A top-level quote starts on this line, so a callout's marker can follow its `>`. */
  calloutLine: boolean
  /** A list marker was read on this line, so `[ ]` is a task box. */
  item: boolean
  /** The line starts with `|`: its pipes are cell borders. */
  table: boolean
  strong: boolean
  emphasis: boolean
  strike: boolean
  /** Inside `==text==`: where on the line its closing `==` is; -1 outside. */
  markEnd: number
  /** Inside `<mark>`: its colour. */
  htmlMark: MarkdownEditorHighlightColor | null
  /** 1 inside a link's `[label]`, 2 inside its `(destination)`. */
  link: 0 | 1 | 2
}

export interface MarkdownStreamOptions {
  math: boolean
  highlight: boolean
  callouts: boolean
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/
const TASK_BOX = /^\[[ xX]\](?=[ \t]|$)/
const DEFINITION = /^ {0,3}\[(?:\\.|[^\]\\])+\]:/
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/
const PLAIN = /[^\\`$<!\[\]()*_~:|=\s]/
const CALLOUT_MARKER = /^\[!(note|tip|important|warning|caution)\](?=[ \t]*$)/i

function styleOf(state: MarkdownStreamState, ...extra: string[]): string | null {
  const names = extra.filter(Boolean)
  if (state.heading)
    names.push(`heading${state.heading}`)
  if (state.quote)
    names.push('quote')
  if (state.strong)
    names.push('strong')
  if (state.emphasis)
    names.push('emphasis')
  if (state.strike)
    names.push('strikethrough')
  // The token names `sourceLanguage` maps to the highlighter's tags.
  const color = state.htmlMark ?? (state.markEnd >= 0 ? 'yellow' : null)
  if (color)
    names.push(color === 'yellow' ? 'highlight' : `highlight-${color}`)
  return names.length ? names.join(' ') : null
}

/** Whether `line` closes a block opened by `fence`: the same character, at least as long. */
export function closesFence(line: string, fence: string): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
  return !!match && match[1]![0] === fence[0] && match[1]!.length >= fence.length
}

/**
 * Whether the line starting at `lineStart` is inside a fenced code block (or
 * a `$$` block), counted from the top of `doc`: the keys that continue lists
 * must leave code alone.
 */
export function isInsideMarkdownFence(doc: string, lineStart: number, math: boolean): boolean {
  let fence: string | null = null
  let mathBlock = false
  let pos = 0
  while (pos < lineStart) {
    let end = doc.indexOf('\n', pos)
    if (end < 0 || end > lineStart)
      end = lineStart
    const line = doc.slice(pos, end)
    if (fence) {
      if (closesFence(line, fence))
        fence = null
    }
    else if (mathBlock) {
      if (/^\s*\$\$\s*$/.test(line))
        mathBlock = false
    }
    else {
      const open = FENCE_OPEN.exec(line)
      if (open && !(open[1]![0] === '`' && open[2]!.includes('`')))
        fence = open[1]!
      else if (math && /^ {0,3}\$\$\s*$/.test(line))
        mathBlock = true
    }
    pos = end + 1
  }
  return fence !== null || mathBlock
}

function lineStartToken(stream: StringStream, state: MarkdownStreamState, options: MarkdownStreamOptions): string | null | undefined {
  if (stream.sol()) {
    const open = stream.match(FENCE_OPEN, false) as RegExpMatchArray | null
    if (open && !(open[1]![0] === '`' && open[2]!.includes('`'))) {
      stream.skipToEnd()
      state.fence = open[1]!
      return 'processingInstruction'
    }
    if (options.math && stream.match(/^ {0,3}\$\$\s*$/)) {
      state.mathBlock = true
      return 'processingInstruction'
    }
    if (stream.match(RULE)) {
      // `---` under a paragraph makes it a heading; either way it is a marker line.
      return 'contentSeparator'
    }
    if (stream.match(/^ {0,3}=+[ \t]*$/) || stream.match(TABLE_DELIMITER))
      return 'processingInstruction'
    state.table = /^ {0,3}\|/.test(stream.string)
    if (stream.match(DEFINITION)) {
      state.lineStart = false
      stream.eatSpace()
      return 'labelName'
    }
  }
  if (stream.eatSpace())
    return styleOf(state)
  if (state.calloutLine) {
    state.calloutLine = false
    const marker = options.callouts ? stream.match(CALLOUT_MARKER) as RegExpMatchArray | null : null
    if (marker) {
      state.lineStart = false
      // The token names `sourceLanguage` maps to the callouts' tags.
      return styleOf(state, `callout-${marker[1]!.toLowerCase()}`)
    }
  }
  const heading = stream.match(/^#{1,6}(?=[ \t]|$)/) as RegExpMatchArray | null
  if (heading) {
    state.heading = heading[0].length
    state.lineStart = false
    return styleOf(state, 'processingInstruction')
  }
  if (stream.match(/^>[ \t]?/)) {
    state.calloutLine = !state.quote && !state.quoteAbove && !state.item && stream.start <= 3
    state.quote = true
    return styleOf(state, 'processingInstruction')
  }
  if (stream.match(LIST_MARKER)) {
    state.item = true
    return styleOf(state, 'list')
  }
  if (state.item && stream.match(TASK_BOX)) {
    state.lineStart = false
    return styleOf(state, 'atom')
  }
  return undefined
}

/** The end of the backtick run closing a code span that opens with `length` backticks, or -1. */
function closingTicks(text: string, from: number, length: number): number {
  const ticks = /`+/g
  ticks.lastIndex = from
  for (let match = ticks.exec(text); match; match = ticks.exec(text)) {
    if (match[0].length === length)
      return match.index + length
  }
  return -1
}

function delimiterToken(stream: StringStream, state: MarkdownStreamState, run: string): string | null {
  const before = stream.string.charAt(stream.start - 1)
  const after = stream.string.charAt(stream.pos)
  const opens = !!after && !/\s/.test(after)
  const closes = !!before && !/\s/.test(before)
  if (run[0] === '_' && /\w/.test(before) && /\w/.test(after))
    return styleOf(state)
  if (run[0] === '~') {
    if (run.length !== 2 || !(state.strike ? closes : opens))
      return styleOf(state)
    const style = styleOf(state, 'processingInstruction')
    state.strike = !state.strike
    return style
  }
  const style = styleOf(state, 'processingInstruction')
  let changed = false
  if (run.length >= 2 && (state.strong ? closes : opens)) {
    state.strong = !state.strong
    changed = true
  }
  if (run.length % 2 === 1 && (state.emphasis ? closes : opens)) {
    state.emphasis = !state.emphasis
    changed = true
  }
  return changed ? style : styleOf(state)
}

/** `==`: the delimiters of a highlight the renderer would read here, or text. */
function highlightToken(stream: StringStream, state: MarkdownStreamState): string | null {
  if (stream.pos === state.markEnd) {
    stream.pos += 2
    state.markEnd = -1
    return styleOf(state, 'processingInstruction')
  }
  if (state.markEnd < 0) {
    const end = highlightEnd(stream.string, stream.pos)
    if (end >= 0) {
      const style = styleOf(state, 'processingInstruction')
      stream.pos += 2
      state.markEnd = end
      return style
    }
  }
  do
    stream.next()
  while (stream.peek() === '=' && stream.pos !== state.markEnd)
  return styleOf(state)
}

function linkToken(stream: StringStream, state: MarkdownStreamState): string | null {
  if (state.link === 1) {
    if (stream.match('](')) {
      state.link = 2
      return 'processingInstruction'
    }
    if (stream.match(/^\\./) || stream.eatWhile(/[^\]\\]/))
      return styleOf(state, 'link')
    stream.next()
    state.link = 0
    return 'processingInstruction'
  }
  if (stream.eat(')')) {
    state.link = 0
    return 'processingInstruction'
  }
  if (stream.match(/^"(?:\\.|[^"\\])*"/))
    return 'string'
  if (!stream.eatWhile(/[^)\s"]/))
    stream.next()
  return 'url'
}

function inlineToken(stream: StringStream, state: MarkdownStreamState, options: MarkdownStreamOptions): string | null {
  if (state.link)
    return linkToken(stream, state)
  if (stream.eatSpace())
    return styleOf(state)
  if (state.table && stream.eat('|'))
    return 'processingInstruction'
  if (stream.match(/^\\[!-/:-@[-`{-~]/))
    return styleOf(state, 'escape')

  const ticks = stream.match(/^`+/) as RegExpMatchArray | null
  if (ticks) {
    const end = closingTicks(stream.string, stream.pos, ticks[0].length)
    if (end < 0)
      return styleOf(state)
    stream.pos = end
    return 'monospace'
  }
  if (options.math && stream.peek() === '$') {
    if (stream.match(/^\$\$(?:\\.|[^$\\])+\$\$/) || stream.match(/^\$(?=[^\s$])(?:\\.|[^$\\])*[^\s$\\]\$(?!\d)/))
      return 'string.special'
  }
  if (stream.match('<!--')) {
    if (stream.skipTo('-->'))
      stream.match('-->')
    else {
      stream.skipToEnd()
      state.htmlComment = true
    }
    return 'comment'
  }
  if (stream.match(/^<(?:https?:\/\/|mailto:)[^\s>]+>/))
    return 'url'
  const tag = stream.match(/^<(\/?)([A-Z][\w-]*)(?:\s[^<>]*)?\/?>/i) as RegExpMatchArray | null
  if (tag) {
    if (tag[2]!.toLowerCase() === 'mark')
      state.htmlMark = tag[1] ? null : highlightColorOf(tag[0])
    return 'meta'
  }
  if (stream.match(/^!?\[(?=(?:\\.|[^\]\\])*\]\()/)) {
    state.link = 1
    return 'processingInstruction'
  }
  if (stream.match(/^(?:https?:\/\/|www\.)[^\s<>]*[^\s<>.,:;"')\]]/))
    return styleOf(state, 'url')
  if (stream.peek() === ':') {
    const before = stream.string.charAt(stream.pos - 1)
    if ((!before || /[\s(]/.test(before)) && stream.match(/^:[a-z0-9_+-]{1,40}:/))
      return 'atom'
  }
  if (options.highlight && stream.peek() === '=')
    return highlightToken(stream, state)
  const run = stream.match(/^(?:\*+|_+|~+)/) as RegExpMatchArray | null
  if (run)
    return delimiterToken(stream, state, run[0])
  if (!stream.eatWhile(PLAIN))
    stream.next()
  return styleOf(state)
}

export function markdownStreamParser(options: MarkdownStreamOptions): StreamParser<MarkdownStreamState> {
  return {
    name: 'markdown',
    startState: () => ({
      fence: null,
      mathBlock: false,
      htmlComment: false,
      lineStart: true,
      heading: 0,
      quote: false,
      quoteAbove: false,
      calloutLine: false,
      item: false,
      table: false,
      strong: false,
      emphasis: false,
      strike: false,
      markEnd: -1,
      htmlMark: null,
      link: 0,
    }),
    blankLine: (state) => {
      state.heading = 0
      state.quote = false
      state.lineStart = true
    },
    token: (stream, state) => {
      if (stream.sol()) {
        state.lineStart = true
        state.heading = 0
        state.quoteAbove = state.quote
        state.quote = false
        state.calloutLine = false
        state.item = false
        state.table = false
        state.strong = false
        state.emphasis = false
        state.strike = false
        state.markEnd = -1
        state.htmlMark = null
        state.link = 0
      }
      if (state.fence) {
        if (stream.sol() && closesFence(stream.string, state.fence)) {
          stream.skipToEnd()
          state.fence = null
          return 'processingInstruction'
        }
        stream.skipToEnd()
        return 'monospace'
      }
      if (state.mathBlock) {
        if (stream.sol() && stream.match(/^\s*\$\$\s*$/)) {
          state.mathBlock = false
          return 'processingInstruction'
        }
        stream.skipToEnd()
        return 'string.special'
      }
      if (state.htmlComment) {
        if (stream.skipTo('-->')) {
          stream.match('-->')
          state.htmlComment = false
        }
        else {
          stream.skipToEnd()
        }
        return 'comment'
      }
      if (state.lineStart) {
        const token = lineStartToken(stream, state, options)
        if (token !== undefined)
          return token
        state.lineStart = false
      }
      const style = inlineToken(stream, state, options)
      // A token that reads on past a highlight's closing `==` stops at it.
      if (state.markEnd > stream.start && state.markEnd < stream.pos)
        stream.backUp(stream.pos - state.markEnd)
      return style
    },
  }
}
