import type { TuffDeepMatch } from '@talex-touch/utils/core-box/tuff'

export interface HighlightedTextSegment {
  text: string
  highlighted: boolean
}

/** Split original text before Vue escapes it; offsets always refer to UTF-16 source text. */
export function splitHighlightedText(
  text: string,
  term?: string,
  explicitRanges?: TuffDeepMatch['highlightRanges']
): HighlightedTextSegment[] {
  let ranges: Array<{ start: number; end: number }>
  if (explicitRanges !== undefined) {
    ranges = explicitRanges.filter(
      ({ start, end }) =>
        Number.isSafeInteger(start) &&
        Number.isSafeInteger(end) &&
        start >= 0 &&
        start < end &&
        end <= text.length
    )
  } else if (term) {
    const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
    ranges = Array.from(text.matchAll(pattern), (match) => ({
      start: match.index,
      end: match.index + match[0].length
    }))
  } else {
    return [{ text, highlighted: false }]
  }

  ranges.sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: Array<{ start: number; end: number }> = []
  for (const range of ranges) {
    const previous = merged[merged.length - 1]
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }

  const segments: HighlightedTextSegment[] = []
  let cursor = 0
  for (const { start, end } of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), highlighted: false })
    segments.push({ text: text.slice(start, end), highlighted: true })
    cursor = end
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false })
  return segments.length ? segments : [{ text, highlighted: false }]
}
