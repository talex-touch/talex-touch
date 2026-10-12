import type {
  FileParser,
  FileParserChunk,
  FileParserContext,
  FileParserProgress,
  FileParserResult,
} from '../types'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const PDF_EXTENSIONS = new Set(['.pdf'])
const PDF_TIMEOUT_MS = 5000

/**
 * Lightweight stream-based plain text extractor from PDF buffer
 * Extracts text between BT (begin text) and ET (end text) operators,
 * and splits by page markers.
 */
function extractTextFromPdfBuffer(buffer: Buffer): { fullText: string; pages: FileParserChunk[] } {
  const text = buffer.toString('latin1')
  // Split roughly by page objects
  const pageDelimiters = text.split(/\/Type\s*\/Page[^s]/g)
  const pages: FileParserChunk[] = []
  const allTexts: string[] = []

  const parseTextStream = (rawBlock: string): string => {
    const extracted: string[] = []
    // Match literal strings: (text) Tj or [(text)] TJ
    const tjRegex = /\(([^)]+)\)\s*(?:Tj|'|")/g
    let match = tjRegex.exec(rawBlock)
    while (match !== null) {
      if (match[1]) {
        // Decode common PDF escape sequences
        const decoded = match[1]
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\\(/g, '(')
          .replace(/\\\)/g, ')')
          .replace(/\\\\/g, '\\')
        extracted.push(decoded)
      }
      match = tjRegex.exec(rawBlock)
    }
    return extracted.join(' ').trim()
  }

  if (pageDelimiters.length > 1) {
    for (let i = 1; i < pageDelimiters.length; i++) {
      const pageContent = parseTextStream(pageDelimiters[i] || '')
      if (pageContent) {
        pages.push({
          pageNumber: i,
          text: pageContent,
        })
        allTexts.push(pageContent)
      }
    }
  } else {
    const singleContent = parseTextStream(text)
    if (singleContent) {
      pages.push({ pageNumber: 1, text: singleContent })
      allTexts.push(singleContent)
    }
  }

  return {
    fullText: allTexts.join('\n\n'),
    pages,
  }
}

export class PdfFileParser implements FileParser {
  readonly id = 'pdf-file-parser'
  readonly priority = 120
  readonly supportedExtensions = PDF_EXTENSIONS

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

    if (!PDF_EXTENSIONS.has(extension.toLowerCase())) {
      return {
        status: 'skipped',
        reason: 'unsupported-extension',
      }
    }

    // Try macOS native mdimport/mdls text extraction first if on Darwin
    if (process.platform === 'darwin') {
      try {
        const { stdout } = await execFileAsync(
          '/usr/bin/mdls',
          ['-raw', '-name', 'kMDItemTextContent', filePath],
          { timeout: PDF_TIMEOUT_MS },
        )
        const trimmed = stdout.trim()
        if (trimmed && trimmed !== '(null)') {
          if (onProgress) {
            onProgress({ processedBytes: size, totalBytes: size, percentage: 1 })
          }
          return {
            status: 'success',
            content: trimmed,
            chunks: [{ pageNumber: 1, text: trimmed.slice(0, 4000) }],
            metadata: {
              source: 'mdls',
              length: trimmed.length,
              basename: path.basename(filePath),
            },
            processedBytes: size,
            totalBytes: size,
          }
        }
      } catch {
        // Fall back to buffer extraction
      }
    }

    try {
      const buffer = await fs.readFile(filePath)
      if (onProgress) {
        onProgress({ processedBytes: size, totalBytes: size, percentage: 1 })
      }

      const { fullText, pages } = extractTextFromPdfBuffer(buffer)
      if (!fullText) {
        return {
          status: 'skipped',
          reason: 'empty-or-scanned-pdf',
          processedBytes: size,
          totalBytes: size,
        }
      }

      return {
        status: 'success',
        content: fullText,
        chunks: pages,
        metadata: {
          pageCount: pages.length,
          basename: path.basename(filePath),
        },
        processedBytes: size,
        totalBytes: size,
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code
      return {
        status: 'failed',
        reason: error instanceof Error ? error.message : 'unknown-error',
        ...(typeof code === 'string' ? { errorCode: code } : {}),
      }
    }
  }
}

export const pdfFileParser = new PdfFileParser()
