import { segmentWords } from '../../stream-text/src/segment'

/**
 * A word diff of an AI answer against the text it rewrites, both as they
 * read, for the panel's changes view. Words come from the stream's own
 * segmentation, so Chinese is compared word by word rather than character by
 * character, and the spaces after a word are tokens of their own.
 */

export interface WordDiffPart {
  kind: 'same' | 'removed' | 'added'
  text: string
}

/** Past this many word pairs the answer is shown without its changes. */
const MAX_CELLS = 1_000_000

/** Below this share of the original's words kept, the answer reads better by itself. */
const MIN_KEPT = 0.3

/** What a part says: its letters and digits. */
function weight(text: string): number {
  return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0
}

/** Words, with the punctuation the segmenter keeps on them split off: "planned" → "planned." adds only the stop. */
function tokens(text: string): string[] {
  return segmentWords(text).flatMap((unit) => {
    const [, lead = '', word = '', trail = ''] = /^(\p{P}*)(.*?)(\p{P}*)$/su.exec(unit.text) ?? []
    return [lead, word, trail, unit.ws].filter(Boolean)
  })
}

/**
 * Removals before additions within a run of changes, with the spaces between
 * two changes folded into both: "the ~~old~~ ~~words~~" reads as one edit.
 */
function tidy(parts: WordDiffPart[]): WordDiffPart[] {
  const tidied: WordDiffPart[] = []
  let removed = ''
  let added = ''
  const flush = (): void => {
    if (removed)
      tidied.push({ kind: 'removed', text: removed })
    if (added)
      tidied.push({ kind: 'added', text: added })
    removed = ''
    added = ''
  }
  parts.forEach((part, index) => {
    if (part.kind === 'removed') {
      removed += part.text
    }
    else if (part.kind === 'added') {
      added += part.text
    }
    // Runs of the same kind are merged, so what follows a kept part is a change.
    else if ((removed || added) && !part.text.trim() && index + 1 < parts.length) {
      removed += part.text
      added += part.text
    }
    else {
      flush()
      tidied.push(part)
    }
  })
  flush()
  return tidied
}

/** `after` against `before`, or null when the two have too little in common to compare. */
export function diffWords(before: string, after: string): WordDiffPart[] | null {
  const a = tokens(before)
  const b = tokens(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start])
    start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const n = endA - start
  const m = endB - start
  if (n * m > MAX_CELLS)
    return null

  // The longest common subsequence of the middles, from the end.
  const width = m + 1
  const table = new Uint32Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = a[start + i] === b[start + j]
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!)
    }
  }

  const parts: WordDiffPart[] = []
  const push = (kind: WordDiffPart['kind'], text: string): void => {
    const last = parts[parts.length - 1]
    if (last?.kind === kind)
      last.text += text
    else
      parts.push({ kind, text })
  }
  for (let k = 0; k < start; k++)
    push('same', a[k]!)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[start + i] === b[start + j]) {
      push('same', a[start + i]!)
      i++
      j++
    }
    else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      push('removed', a[start + i++]!)
    }
    else {
      push('added', b[start + j++]!)
    }
  }
  while (i < n)
    push('removed', a[start + i++]!)
  while (j < m)
    push('added', b[start + j++]!)
  for (let k = endA; k < a.length; k++)
    push('same', a[k]!)

  const tidied = tidy(parts)
  const kept = tidied.reduce((sum, part) => sum + (part.kind === 'same' ? weight(part.text) : 0), 0)
  return kept >= weight(before) * MIN_KEPT ? tidied : null
}
