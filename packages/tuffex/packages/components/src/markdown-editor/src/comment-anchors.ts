import type { MarkdownEditorComment, MarkdownTextChange } from './types'
import { mapMarkdownPosition } from './text-changes'

/**
 * Comment threads hold a source range and the text it covered.
 *
 * Every edit maps the ranges: text typed at either edge stays outside the
 * thread, text typed inside it joins it, and the quote follows the edited
 * text. A range whose text was deleted collapses; it is then detached until
 * `anchorMarkdownComments` finds its quote again (the text was moved, or an
 * undo brought it back).
 */

/** The threads after `changes`, or null when none changed. `doc` is the document after them. */
export function mapMarkdownComments(
  comments: readonly MarkdownEditorComment[],
  changes: readonly MarkdownTextChange[],
  doc: string,
): MarkdownEditorComment[] | null {
  if (!comments.length || !changes.length)
    return null
  let moved = false
  const next = comments.map((comment) => {
    const from = mapMarkdownPosition(comment.from, changes, 1)
    const to = Math.max(from, mapMarkdownPosition(comment.to, changes, -1))
    // A collapsed range keeps the old quote: it is what re-anchoring looks for.
    // A range that stayed put can still have had its text replaced.
    const quote = to > from ? doc.slice(from, to) : comment.quote
    if (from === comment.from && to === comment.to && quote === comment.quote)
      return comment
    moved = true
    return { ...comment, from, to, quote }
  })
  return moved ? next : null
}

/** Whether the thread no longer covers any text. */
export function isCommentDetached(comment: Pick<MarkdownEditorComment, 'from' | 'to'>): boolean {
  return comment.to <= comment.from
}

/**
 * Checks stored ranges against `doc`, e.g. after the document was replaced
 * or threads were loaded: a range that no longer holds its quote moves to the
 * nearest copy of it, or collapses (detached). Null when nothing changed.
 */
export function anchorMarkdownComments(comments: readonly MarkdownEditorComment[], doc: string): MarkdownEditorComment[] | null {
  let moved = false
  const next = comments.map((comment) => {
    const from = Math.max(0, Math.min(comment.from, doc.length))
    const to = Math.max(from, Math.min(comment.to, doc.length))
    if (to > from && doc.slice(from, to) === comment.quote) {
      if (from === comment.from && to === comment.to)
        return comment
      moved = true
      return { ...comment, from, to }
    }
    const found = comment.quote ? nearest(doc, comment.quote, from) : -1
    const range = found < 0 ? [from, from] : [found, found + comment.quote.length]
    if (range[0] === comment.from && range[1] === comment.to)
      return comment
    moved = true
    return { ...comment, from: range[0]!, to: range[1]! }
  })
  return moved ? next : null
}

function nearest(doc: string, quote: string, around: number): number {
  let best = -1
  for (let at = doc.indexOf(quote); at >= 0; at = doc.indexOf(quote, at + 1)) {
    if (best < 0 || Math.abs(at - around) < Math.abs(best - around))
      best = at
    if (at > around)
      break
  }
  return best
}
