import type {
  FileParser,
  FileParserChunk,
  FileParserContext,
  FileParserProgress,
  FileParserResult,
} from '../types'
import type { FileHandle } from 'node:fs/promises'
import fs from 'node:fs/promises'
import path from 'node:path'
import { setImmediate } from 'node:timers/promises'

const CODE_EXTENSIONS = [
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.cs',
  '.c',
  '.cpp',
  '.cc',
  '.m',
  '.mm',
  '.hpp',
  '.swift',
  '.php',
  '.rb',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.bat',
  '.ps1',
  '.sql',
]

const CHUNK_LINE_SIZE = 40
const CHUNK_LINE_OVERLAP = 10
const CHUNK_CHAR_SIZE = 4000
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_CHUNKS = 4096

function boundedLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.min(Math.floor(value), fallback)
    : fallback
}

function parserError(reason: string, code: string): Error {
  return Object.assign(new Error(reason), { code })
}

export class CodeFileParser implements FileParser {
  readonly id = 'code-file-parser'
  // Higher priority than plain text parser for code extensions
  readonly priority = 150
  readonly supportedExtensions = CODE_EXTENSIONS

  async parse(
    context: FileParserContext,
    onProgress?: (progress: FileParserProgress) => void,
  ): Promise<FileParserResult> {
    const { filePath, extension, signal } = context
    if (!CODE_EXTENSIONS.includes(extension.toLowerCase())) {
      return { status: 'skipped', reason: 'unsupported-extension' }
    }

    const maxBytes = boundedLimit(context.maxBytes, DEFAULT_MAX_BYTES)
    const maxOutputBytes = boundedLimit(context.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES)
    const maxChunks = boundedLimit(context.maxChunks, DEFAULT_MAX_CHUNKS)
    let totalBytes = context.size
    let processedBytes = 0
    let handle: FileHandle | undefined
    try {
      signal?.throwIfAborted()
      handle = await fs.open(filePath, 'r')
      const stat = await handle.stat()
      totalBytes = stat.size
      if (!stat.isFile()) throw parserError('not-a-regular-file', 'FILE_NOT_REGULAR')
      if (totalBytes > maxBytes) throw parserError('file-too-large', 'FILE_TOO_LARGE')

      // One extra byte detects growth without reading an unbounded replacement file.
      const buffer = Buffer.alloc(totalBytes + 1)
      while (processedBytes < buffer.length) {
        signal?.throwIfAborted()
        const { bytesRead } = await handle.read(
          buffer, processedBytes, Math.min(64 * 1024, buffer.length - processedBytes), null,
        )
        if (bytesRead === 0) break
        processedBytes += bytesRead
        if (processedBytes > totalBytes) throw parserError('file-changed-during-read', 'FILE_CHANGED')
        onProgress?.({ processedBytes, totalBytes, percentage: totalBytes ? processedBytes / totalBytes : 1 })
      }
      signal?.throwIfAborted()
      const finalStat = await handle.stat()
      if (processedBytes !== totalBytes || finalStat.size !== stat.size || finalStat.mtimeMs !== stat.mtimeMs) {
        throw parserError('file-changed-during-read', 'FILE_CHANGED')
      }
      const content = buffer.toString('utf8', 0, processedBytes)
      // A newline-dense file must not allocate millions of line entries: no more
      // lines than this fit in the allowed number of 40-line chunks.
      const maxLines = CHUNK_LINE_SIZE * maxChunks
      const lines = content.split(/\r\n|\r|\n/, maxLines + 1)
      const lineEnd = (offset: number): number =>
        content.startsWith('\r\n', offset) ? offset + 2 : offset < content.length ? offset + 1 : offset
      const chunks: FileParserChunk[] = []

      // Past either budget the file is truncated, not failed, as Elasticsearch's
      // `indexed_chars` and Tika's write limit do: `content` ends where the last
      // kept chunk does, and `outputBytes` counts it together with all chunk text.
      let outputBytes = 0
      let keptOffset = 0
      let keptLines = 0
      const keep = (text: string, startLine: number, endLine: number, grownBytes: number): boolean => {
        const bytes = Buffer.byteLength(text, 'utf8') + grownBytes
        if (chunks.length >= maxChunks || outputBytes + bytes > maxOutputBytes) return false
        outputBytes += bytes
        chunks.push({ text, startLine, endLine })
        return true
      }

      let currentLine = 0
      let previousEnd = 0
      while (currentLine < lines.length) {
        signal?.throwIfAborted()
        // Long generated/minified lines remain bounded, but every piece retains its actual line.
        const line = lines[currentLine]!
        if (line.length > CHUNK_CHAR_SIZE) {
          const lineStart = keptOffset
          let stopped = false
          let offset = 0
          while (offset < line.length) {
            signal?.throwIfAborted()
            let end = Math.min(offset + CHUNK_CHAR_SIZE, line.length)
            if (end < line.length && /[\uD800-\uDBFF]/.test(line[end - 1]!)) end--
            const piece = line.slice(offset, end)
            const pieceEnd = end < line.length ? lineStart + end : lineEnd(lineStart + end)
            const grownBytes = Buffer.byteLength(piece, 'utf8') + pieceEnd - (lineStart + end)
            if (!keep(piece, currentLine + 1, currentLine + 1, grownBytes)) {
              stopped = true
              break
            }
            keptOffset = pieceEnd
            offset = end
            if (chunks.length % 64 === 0) await setImmediate()
          }
          if (stopped) break
          keptLines = ++currentLine
          previousEnd = currentLine
          continue
        }

        let endLine = currentLine
        let length = 0
        while (endLine < lines.length && endLine - currentLine < CHUNK_LINE_SIZE) {
          const nextLength = lines[endLine]!.length + (endLine > currentLine ? 1 : 0)
          if (length + nextLength > CHUNK_CHAR_SIZE) break
          length += nextLength
          endLine++
        }
        // Only lines no earlier chunk reached grow the kept content.
        let nextOffset = keptOffset
        let grownBytes = 0
        for (let index = keptLines; index < endLine; index++) {
          const textEnd = nextOffset + lines[index]!.length
          nextOffset = lineEnd(textEnd)
          grownBytes += Buffer.byteLength(lines[index]!, 'utf8') + nextOffset - textEnd
        }
        if (!keep(lines.slice(currentLine, endLine).join('\n'), currentLine + 1, endLine, grownBytes)) break
        keptOffset = nextOffset
        keptLines = endLine
        if (endLine === lines.length) break
        // The overlap repeats at most a quarter of this chunk, and only lines this
        // chunk was first to reach, so no line lands in more than two chunks. It
        // shrinks until the next line still fits, so every chunk adds a line.
        const overlapLimit = Math.min(
          CHUNK_LINE_OVERLAP,
          Math.floor((endLine - currentLine) / 4),
          endLine - previousEnd,
        )
        let overlap = 0
        let nextLength = lines[endLine]!.length
        while (overlap < overlapLimit) {
          nextLength += lines[endLine - overlap - 1]!.length + 1
          if (nextLength > CHUNK_CHAR_SIZE) break
          overlap++
        }
        previousEnd = endLine
        currentLine = endLine - overlap
        if (chunks.length % 64 === 0) await setImmediate()
      }
      signal?.throwIfAborted()
      const truncated = keptOffset < content.length
      return {
        status: 'success',
        content: truncated ? content.slice(0, keptOffset) : content,
        chunks,
        ...(truncated ? { truncated } : {}),
        metadata: {
          lineCount: truncated ? keptLines : lines.length,
          chunkCount: chunks.length,
          basename: path.basename(filePath),
        },
        processedBytes,
        totalBytes,
      }
    }
    catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      return {
        status: 'failed',
        reason: signal?.aborted ? 'aborted' : error instanceof Error ? error.message : 'unknown-error',
        errorCode: signal?.aborted ? 'ABORT_ERR' : typeof code === 'string' ? code : undefined,
        processedBytes,
        totalBytes,
      }
    }
    finally {
      await handle?.close()
    }
  }
}

export const codeFileParser = new CodeFileParser()
