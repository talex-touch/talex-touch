import type {
  FileParser,
  FileParserChunk,
  FileParserContext,
  FileParserProgress,
  FileParserResult,
} from '../types'
import fs from 'node:fs/promises'
import path from 'node:path'

const CODE_EXTENSIONS = new Set(
  [
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
    '.hpp',
    '.swift',
    '.php',
    '.rb',
    '.sh',
    '.bash',
    '.sql',
  ].map(ext => ext.toLowerCase()),
)

const CHUNK_LINE_SIZE = 40
const CHUNK_LINE_OVERLAP = 10

export class CodeFileParser implements FileParser {
  readonly id = 'code-file-parser'
  // Higher priority than plain text parser for code extensions
  readonly priority = 150
  readonly supportedExtensions = CODE_EXTENSIONS

  async parse(
    context: FileParserContext,
    onProgress?: (progress: FileParserProgress) => void,
  ): Promise<FileParserResult> {
    const { filePath, extension, size, maxBytes } = context
    if (maxBytes && size > maxBytes) {
      return {
        status: 'skipped',
        reason: 'file-too-large',
        totalBytes: size,
        processedBytes: 0,
        warnings: [
          `File size ${(size / (1024 * 1024)).toFixed(2)}MB exceeds limit ${(maxBytes / (1024 * 1024)).toFixed(2)}MB`,
        ],
      }
    }

    if (!CODE_EXTENSIONS.has(extension.toLowerCase())) {
      return {
        status: 'skipped',
        reason: 'unsupported-extension',
      }
    }

    try {
      const content = await fs.readFile(filePath, 'utf8')
      if (onProgress) {
        onProgress({ processedBytes: size, totalBytes: size, percentage: 1 })
      }

      const lines = content.split(/\r?\n/)
      const chunks: FileParserChunk[] = []

      if (lines.length <= CHUNK_LINE_SIZE) {
        chunks.push({
          text: content,
          startLine: 1,
          endLine: lines.length,
        })
      }
      else {
        let currentLine = 0
        while (currentLine < lines.length) {
          const slice = lines.slice(currentLine, currentLine + CHUNK_LINE_SIZE)
          const startLine = currentLine + 1
          const endLine = Math.min(lines.length, currentLine + slice.length)
          chunks.push({
            text: slice.join('\n'),
            startLine,
            endLine,
          })
          if (endLine >= lines.length) break
          currentLine += CHUNK_LINE_SIZE - CHUNK_LINE_OVERLAP
        }
      }

      return {
        status: 'success',
        content,
        chunks,
        metadata: {
          lineCount: lines.length,
          chunkCount: chunks.length,
          basename: path.basename(filePath),
        },
        processedBytes: size,
        totalBytes: size,
      }
    }
    catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code
      return {
        status: 'failed',
        reason: error instanceof Error ? error.message : 'unknown-error',
        ...(typeof code === 'string' ? { errorCode: code } : {}),
      }
    }
  }
}

export const codeFileParser = new CodeFileParser()
