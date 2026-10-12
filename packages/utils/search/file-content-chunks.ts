import type { FileParserChunk } from '../electron/file-parsers/types'

/** Content-owned metadata; removed with the opt-in content index. */
export const FILE_CONTENT_CHUNKS_KEY = 'content_chunks'
export const FILE_CONTENT_MAX_CHUNKS = 4096
export const FILE_CONTENT_MAX_CHARS = 200_000

export function readFileContentChunks(serialized: string | null | undefined): FileParserChunk[] {
  if (!serialized || serialized.length > FILE_CONTENT_MAX_CHARS * 2) return []
  try {
    const values: unknown = JSON.parse(serialized)
    if (!Array.isArray(values) || values.length > FILE_CONTENT_MAX_CHUNKS) return []
    let chars = 0
    for (const value of values) {
      if (!value || typeof value !== 'object' || typeof value.text !== 'string') return []
      chars += value.text.length
      if (chars > FILE_CONTENT_MAX_CHARS) return []
      for (const key of ['pageNumber', 'startLine', 'endLine'] as const) {
        const number = value[key]
        if (number != null && (!Number.isSafeInteger(number) || number < 1)) return []
      }
      if (value.startLine != null && value.endLine != null && value.endLine < value.startLine) return []
    }
    return values as FileParserChunk[]
  } catch {
    return []
  }
}
