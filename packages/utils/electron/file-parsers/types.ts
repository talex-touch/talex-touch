export type FileParserStatus = 'success' | 'skipped' | 'failed'

export interface FileParserContext {
  filePath: string
  extension: string
  size: number
  maxBytes?: number
  /** Maximum combined UTF-8 bytes of returned content and chunk text (default: 8 MiB). */
  maxOutputBytes?: number
  /** Maximum number of returned chunks (default: 4096). */
  maxChunks?: number
  metadata?: Record<string, any>
  signal?: AbortSignal
}

export interface FileParserProgress {
  processedBytes?: number
  totalBytes?: number
  percentage?: number
  message?: string
}

export interface FileParserEmbedding {
  provider: string
  model: string
  vector: number[]
  metadata?: Record<string, any>
}

export interface FileParserChunk {
  text: string
  pageNumber?: number
  startLine?: number
  endLine?: number
}

export interface FileParserResult {
  status: FileParserStatus
  content?: string
  chunks?: FileParserChunk[]
  tags?: string[]
  metadata?: Record<string, any>
  warnings?: string[]
  processedBytes?: number
  totalBytes?: number
  reason?: string
  /**
   * Node errno code (`ENOENT`, `EACCES`, …) when a `failed` result came from a
   * filesystem read. `reason` keeps the human-readable message.
   */
  errorCode?: string
  embeddings?: FileParserEmbedding[]
  durationMs?: number
}

export interface FileParser {
  readonly id: string
  /** Higher priority parsers win when multiple support the same extension */
  readonly priority?: number
  readonly supportedExtensions: string[] | Set<string>
  canParse?: (context: FileParserContext) => boolean | Promise<boolean>
  parse: (
    context: FileParserContext,
    onProgress?: (progress: FileParserProgress) => void,
  ) => Promise<FileParserResult>
}

export interface FileParserSelectionOptions {
  allowFallback?: boolean
}

export interface FileParserRegistryOptions {
  /** When true, registry falls back to lower priority parsers if the preferred one skips */
  enableFallback?: boolean
}
