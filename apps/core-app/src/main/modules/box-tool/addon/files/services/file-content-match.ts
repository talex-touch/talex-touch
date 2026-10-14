import type { TuffDeepMatch } from '@talex-touch/utils'
import type { FileParserChunk } from '@talex-touch/utils/electron/file-parsers'
import { createHash } from 'node:crypto'

export function hashFileContentChunk(chunk: FileParserChunk): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        chunk.text,
        chunk.pageNumber ?? null,
        chunk.startLine ?? null,
        chunk.endLine ?? null
      ])
    )
    .digest('hex')
    .slice(0, 16)
}

function literalMatches(text: string, query: string): Array<{ start: number; end: number }> {
  const terms = [...new Set(query.trim().split(/\s+/u).filter(Boolean))]
  const ranges: Array<{ start: number; end: number }> = []
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    for (const match of text.matchAll(new RegExp(escaped, 'giu'))) {
      ranges.push({ start: match.index, end: match.index + match[0].length })
      if (ranges.length >= 64) break
    }
    if (ranges.length >= 64) break
  }
  return ranges.sort((left, right) => left.start - right.start || left.end - right.end)
}

/** The snippet and location always come from the same persisted chunk. */
export function buildFileContentMatch(
  chunks: FileParserChunk[],
  query: string,
  contentHash?: string
): TuffDeepMatch | undefined {
  let chunk: FileParserChunk | undefined
  let ranges: Array<{ start: number; end: number }> = []
  if (contentHash) {
    chunk = chunks.find((entry) => hashFileContentChunk(entry) === contentHash)
    if (!chunk) return undefined
    ranges = literalMatches(chunk.text, query)
  } else {
    for (const entry of chunks) {
      const matches = literalMatches(entry.text, query)
      if (matches.length > ranges.length) {
        chunk = entry
        ranges = matches
      }
    }
    if (!chunk) return undefined
  }
  const hitOffset = ranges[0]?.start ?? 0
  let start = Math.max(0, hitOffset - 80)
  let end = Math.min(chunk.text.length, start + 480)
  // UTF-16 offsets must never cut an emoji into a lone surrogate.
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(chunk.text[start])) start--
  if (end < chunk.text.length && /[\uDC00-\uDFFF]/u.test(chunk.text[end])) end--
  const snippet = chunk.text.slice(start, end)
  const highlightRanges = ranges
    .filter((range) => range.start >= start && range.end <= end)
    .map((range) => ({ start: range.start - start, end: range.end - start }))
  const lineNumber =
    chunk.startLine == null
      ? undefined
      : chunk.startLine + (chunk.text.slice(0, hitOffset).match(/\n/g)?.length ?? 0)
  return {
    kind: contentHash ? 'semantic' : lineNumber != null ? 'code' : 'content',
    snippet,
    pageNumber: chunk.pageNumber,
    lineNumber,
    highlightRanges,
    matchTerm: ranges[0] ? chunk.text.slice(ranges[0].start, ranges[0].end) : undefined
  }
}
