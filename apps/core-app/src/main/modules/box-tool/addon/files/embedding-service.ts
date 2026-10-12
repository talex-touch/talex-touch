import type { BatchItem } from 'drizzle-orm/batch'
import { tuffIntelligence } from '../../../ai/intelligence-sdk'
import { getLocalEmbeddingRuntime } from '../../../ai/local-embedding-runtime'
import { LOCAL_EMBEDDING_MODEL_KEY } from '../../../ai/local-embedding-model'
import type { FileParserChunk } from '@talex-touch/utils/electron/file-parsers'
import { hashFileContentChunk } from './services/file-content-match'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import type * as schema from '../../../../db/schema'
import { performance } from 'node:perf_hooks'
import { eq, and, gt, sql } from 'drizzle-orm'
import { getLogger } from '@talex-touch/utils/common/logger'
import { embeddings as embeddingsSchema, files as filesSchema } from '../../../../db/schema'
import { scheduleDbWrite } from '../../../../db/db-write'
import { onUsageLimitsChanged, readUsageLimitInfo } from '../../../ai/usage-ledger/usage-limits'
import { enterPerfContext } from '../../../../utils/perf-context'

const logger = getLogger('EmbeddingService')

const SOURCE_TYPE = 'file'
const MAX_TEXT_LENGTH = 8000
const EMBEDDING_CACHE_TTL = 30 * 60 * 1000 // 30 min
const SEMANTIC_SEARCH_PAGE_SIZE = 128
/**
 * Stable usage-ledger caller for every file-content embedding, the availability probe included
 * (audit rebuild design §1.4). A fresh object per call: options travel by reference.
 */
function filesEmbeddingOptions(): { metadata: { caller: string; localEmbeddingRuntime?: string } } {
  return {
    metadata: {
      caller: 'core.files.embedding',
      ...(getLocalEmbeddingRuntime().isReady() ? { localEmbeddingRuntime: 'llama.cpp' } : {})
    }
  }
}

interface EmbeddingSearchResult {
  sourceId: string
  score: number
  contentHash?: string | null
}

interface CachedEmbedding {
  vector: number[]
  model: string
  timestamp: number
}

/**
 * Split-aware database routing for embeddings, mirroring the dbUtils split
 * context (db/utils.ts, issue #295): embeddings are a split-routed table, so
 * they must have exactly ONE home — the worker-owned search file when the
 * split is on, the primary file when it is off. Every member is resolved PER
 * CALL, never captured at construction, so late fallbacks (the aux
 * resolver-timing trap class) cannot leave this service writing a stale file.
 */
export interface EmbeddingDbRouting {
  /** Call-time split decision — mirrors DbUtilsSplitContext.enabled. */
  isSplitEnabled(): boolean
  /** Read connection: the search file when the split is on (falls back to primary until ready). */
  getReadDb(): LibSQLDatabase<typeof schema>
  /** Primary connection: builds compiled statements and runs split-off scheduled writes. */
  getPrimaryDb(): LibSQLDatabase<typeof schema>
  /** Split-on writes: forward compiled statements to the worker — the sole writer of its file. */
  execWrite(
    statements: Array<{ sql: string; args: unknown[] }>,
    mode?: 'single' | 'transaction'
  ): Promise<unknown>
}

type CompilableQuery = BatchItem<'sqlite'> & {
  toSQL(): { sql: string; params: unknown[] }
}

/**
 * File embedding is paused because the user's global AI usage limit is reached (usage-limits task
 * C5). Until `pausedUntil` nothing is sent: batches stop, the availability probe is skipped, and
 * semantic search answers without a query embedding. Read by the file-index diagnostics.
 */
export interface EmbeddingUsageLimitPause {
  reason: 'USAGE_LIMIT_REACHED'
  /** Which limit (`requestsPerDay`, `costUsdPerMonth`, …). */
  limitKey: string
  /** The limit's local reset time; embedding resumes with the first call after it. */
  pausedUntil: number
}

/** What one `indexFileOutcome` call did; `paused` files count as skipped. */
type IndexFileOutcome = 'done' | 'paused' | 'skipped' | 'failed'

export interface EmbeddingFileInput {
  fileId: string
  content: string
  chunks?: FileParserChunk[]
  fileVersion?: number
  fileSize?: number | null
}

export type FileEmbeddingGenerator = (text: string) => Promise<{ vector: number[]; model: string }>

async function generateFileEmbedding(text: string): Promise<{ vector: number[]; model: string }> {
  const result = await tuffIntelligence.embedding.generate({ text }, filesEmbeddingOptions())
  return { vector: result.result, model: result.model || 'unknown' }
}

function usableVector(vector: number[]): boolean {
  return (
    Array.isArray(vector) &&
    vector.length > 0 &&
    vector.every(Number.isFinite) &&
    vector.some((value) => value !== 0)
  )
}

export class EmbeddingService {
  private available: boolean | null = null
  private queryCache = new Map<string, CachedEmbedding>()
  private usageLimitPause: EmbeddingUsageLimitPause | null = null

  constructor(
    private readonly routing: EmbeddingDbRouting,
    private readonly generate: FileEmbeddingGenerator = generateFileEmbedding
  ) {
    // Raising or clearing the limit is the user saying "go on": the pause lifts now, not at the
    // reset time. If a limit still binds, the next call is refused before any provider work and
    // pauses again — one refusal, no loop.
    onUsageLimitsChanged(() => this.liftUsageLimitPause())
  }

  /** Lifts a usage-limit pause because the limits changed; a no-op when none is held. */
  private liftUsageLimitPause(): void {
    if (!this.usageLimitPause) return
    this.usageLimitPause = null
    logger.info('File embedding resumes: the AI usage limits changed')
  }

  /** The usage-limit pause in force, or null; a pause whose reset time has passed is lifted here. */
  getUsageLimitPause(now: number = Date.now()): EmbeddingUsageLimitPause | null {
    const pause = this.usageLimitPause
    if (!pause) return null
    if (now >= pause.pausedUntil) {
      this.usageLimitPause = null
      logger.info('File embedding resumes: the AI usage limit has reset')
      return null
    }
    return { ...pause }
  }

  /**
   * True when `error` is the usage-limit refusal, which pauses embedding until the limit resets:
   * logged once per pause, never retried. Any other failure is left to the caller.
   */
  private pauseOnUsageLimit(error: unknown): boolean {
    const info = readUsageLimitInfo(error)
    if (!info) return false
    const current = this.usageLimitPause
    this.usageLimitPause = {
      reason: 'USAGE_LIMIT_REACHED',
      limitKey: info.key,
      pausedUntil: Math.max(current?.pausedUntil ?? 0, info.resetsAt)
    }
    if (!current) {
      logger.warn(
        `File embedding paused: AI usage limit ${info.key} reached; resumes after ${new Date(
          this.usageLimitPause.pausedUntil
        ).toISOString()}`
      )
    }
    return true
  }

  /**
   * Mirror of dbUtils' split-aware runWrite (db/utils.ts): split on → compile
   * the drizzle builders and forward them to the worker; split off → await the
   * builders on the primary db under the shared write scheduler
   * (scheduleDbWrite keeps the existing labels and busy-retry semantics).
   */
  private async runWrite(
    label: string,
    queries: CompilableQuery[],
    mode: 'single' | 'transaction' = 'single'
  ): Promise<number> {
    if (queries.length === 0) return 0

    if (this.routing.isSplitEnabled()) {
      const statements = queries.map((query) => {
        const compiled = query.toSQL()
        return { sql: compiled.sql, args: compiled.params }
      })
      return this.lastWriteCount(await this.routing.execWrite(statements, mode))
    }

    return await scheduleDbWrite(label, async () => {
      const [first, ...rest] = queries
      if (!first) return 0
      if (mode === 'transaction') {
        return this.lastWriteCount(await this.routing.getPrimaryDb().batch([first, ...rest]))
      }
      const results = []
      for (const query of queries) results.push(await query)
      return this.lastWriteCount(results)
    })
  }

  private lastWriteCount(result: unknown): number {
    if (!Array.isArray(result) || result.length === 0) return 0
    const last: unknown = result[result.length - 1]
    if (!last || typeof last !== 'object' || !('rowsAffected' in last)) return 0
    return typeof last.rowsAffected === 'number' ? last.rowsAffected : 0
  }

  /**
   * Check if the embedding capability is available.
   * Caches the result to avoid repeated probing.
   */
  async isAvailable(): Promise<boolean> {
    // Paused by the usage limit: unavailable until the reset, without probing (a probe is a call).
    if (this.getUsageLimitPause()) return false
    if (this.available !== null) return this.available

    try {
      const disposeCheck = enterPerfContext('Embedding.isAvailable', { textLength: 4 })
      try {
        const result = await this.generate('test')
        this.available = usableVector(result.vector)
      } finally {
        disposeCheck()
      }
    } catch (error) {
      // Not cached: the limit says nothing about whether embedding works once it resets.
      if (this.pauseOnUsageLimit(error)) return false
      this.available = false
    }

    logger.info(`Embedding capability available: ${this.available}`)
    return this.available
  }

  /** Reset availability cache (e.g. after config change). */
  resetAvailability(): void {
    this.available = null
    this.queryCache.clear()
  }

  /**
   * Generate and store embedding for a single file.
   * Skips if content hash hasn't changed.
   */
  async indexFile(fileId: string, content: string): Promise<void> {
    const outcome = await this.indexFileOutcome({ fileId, content })
    if (outcome === 'failed') throw new Error('FILE_EMBEDDING_INDEX_FAILED')
  }

  private async indexFileOutcome(input: EmbeddingFileInput): Promise<IndexFileOutcome> {
    if (!(await this.isAvailable())) return this.usageLimitPause ? 'paused' : 'skipped'
    if (!input.content?.trim()) return 'skipped'
    const { fileId, content } = input
    const chunks = input.chunks?.length
      ? input.chunks
      : [{ text: content.slice(0, MAX_TEXT_LENGTH) }]
    const hashes = chunks.map(hashFileContentChunk)
    try {
      const first = await this.generate(chunks[0].text)
      if (!usableVector(first.vector) || !first.model)
        throw new Error('FILE_EMBEDDING_INVALID_VECTOR')
      const existing = await this.routing
        .getReadDb()
        .select({
          contentHash: embeddingsSchema.contentHash,
          model: embeddingsSchema.model
        })
        .from(embeddingsSchema)
        .where(
          and(eq(embeddingsSchema.sourceId, fileId), eq(embeddingsSchema.sourceType, SOURCE_TYPE))
        )
      if (
        existing.length === hashes.length &&
        existing.every(
          (row, index) => row.model === first.model && row.contentHash === hashes[index]
        )
      )
        return 'done'

      const generated = [first]
      for (let index = 1; index < chunks.length; index++) {
        if (this.getUsageLimitPause()) return 'paused'
        const result = await this.generate(chunks[index].text)
        if (
          !usableVector(result.vector) ||
          result.model !== first.model ||
          result.vector.length !== first.vector.length
        ) {
          throw new Error('FILE_EMBEDDING_MODEL_CHANGED')
        }
        generated.push(result)
      }

      const fileFence = and(
        eq(filesSchema.id, Number(fileId)),
        eq(filesSchema.content, content),
        input.fileVersion == null ? undefined : eq(filesSchema.mtime, new Date(input.fileVersion)),
        input.fileSize == null ? undefined : eq(filesSchema.size, input.fileSize)
      )
      const current = await this.routing
        .getReadDb()
        .select({ id: filesSchema.id })
        .from(filesSchema)
        .where(fileFence)
        .limit(1)
      if (current.length === 0) return 'skipped'
      const writeDb = this.routing.getPrimaryDb()
      const exists = sql`EXISTS (SELECT 1 FROM ${filesSchema} WHERE ${fileFence})`
      // SQL SELECT follows the embeddings schema column order, including its
      // generated id and created_at. Each insert checks the fence in the writer,
      // not just in the earlier read, so queued cleanup cannot be undone.
      const written = await this.runWrite(
        'embedding.index',
        [
          writeDb
            .delete(embeddingsSchema)
            .where(
              and(
                eq(embeddingsSchema.sourceId, fileId),
                eq(embeddingsSchema.sourceType, SOURCE_TYPE),
                exists
              )
            ),
          ...generated.map((result, index) =>
            writeDb.insert(embeddingsSchema).select(sql`
          SELECT NULL, ${fileId}, ${SOURCE_TYPE}, ${JSON.stringify(result.vector)},
            ${result.model}, ${hashes[index]}, strftime('%s', 'now')
          FROM ${filesSchema} WHERE ${fileFence}
        `)
          ),
          writeDb.update(filesSchema).set({ embeddingStatus: 'completed' }).where(fileFence)
        ],
        'transaction'
      )
      return written > 0 ? 'done' : 'skipped'
    } catch (error) {
      if (this.pauseOnUsageLimit(error)) return 'paused'
      const code =
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'FILE_EMBEDDING_INDEX_FAILED'
      logger.warn('File embedding failed', { code })
      return 'failed'
    }
  }

  /**
   * Batch index multiple files. Processes in chunks to avoid overloading.
   */
  async indexFiles(
    files: EmbeddingFileInput[]
  ): Promise<{ indexed: number; skipped: number; failed: number }> {
    if (!(await this.isAvailable())) return { indexed: 0, skipped: files.length, failed: 0 }
    const start = performance.now()
    let indexed = 0
    let failed = 0
    // One file's vectors at a time; chunks must commit atomically, not multiply
    // the retained model buffers by concurrent files.
    for (const file of files) {
      if (this.getUsageLimitPause()) break
      const outcome = await this.indexFileOutcome(file)
      if (outcome === 'done') indexed++
      if (outcome === 'failed') failed++
    }
    const skipped = files.length - indexed - failed
    logger.info('Batch embedding finished', {
      indexed,
      skipped,
      failed,
      durationMs: Math.round(performance.now() - start)
    })
    return { indexed, skipped, failed }
  }

  /**
   * Remove embeddings for given file IDs.
   */
  async removeFiles(fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) return

    const writeDb = this.routing.getPrimaryDb()
    await this.runWrite(
      'embedding.remove',
      fileIds.map((fileId) =>
        writeDb
          .delete(embeddingsSchema)
          .where(
            and(eq(embeddingsSchema.sourceId, fileId), eq(embeddingsSchema.sourceType, SOURCE_TYPE))
          )
      )
    )
  }

  /**
   * Semantic search: embed the query, then find top-K similar files
   * using cosine similarity computed in application code.
   */
  async semanticSearch(
    query: string,
    limit = 20,
    signal?: AbortSignal
  ): Promise<EmbeddingSearchResult[]> {
    const resultLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
    if (!query?.trim() || resultLimit === 0 || signal?.aborted) return []
    const disposeSearch = enterPerfContext('Embedding.semanticSearch', {
      queryLength: query.length,
      limit: resultLimit
    })
    try {
      if (!(await this.isAvailable())) return []
      const queryEmbedding = await this.getQueryEmbedding(query)
      if (!queryEmbedding || signal?.aborted) return []
      const bestByFile = new Map<string, EmbeddingSearchResult>()
      let cursor = 0
      // Keyset paging retains only one small vector page and top-K files. The old
      // first-1000 limit silently made all later documents unsearchable.
      for (;;) {
        if (signal?.aborted) return []
        const rows = await this.routing
          .getReadDb()
          .select({
            id: embeddingsSchema.id,
            sourceId: embeddingsSchema.sourceId,
            embedding: embeddingsSchema.embedding,
            contentHash: embeddingsSchema.contentHash
          })
          .from(embeddingsSchema)
          .where(
            and(
              eq(embeddingsSchema.sourceType, SOURCE_TYPE),
              eq(embeddingsSchema.model, queryEmbedding.model),
              gt(embeddingsSchema.id, cursor)
            )
          )
          .orderBy(embeddingsSchema.id)
          .limit(SEMANTIC_SEARCH_PAGE_SIZE)
        if (rows.length === 0) break
        for (const row of rows) {
          cursor = row.id
          const score = cosineSimilarity(queryEmbedding.vector, row.embedding)
          if (
            !Number.isFinite(score) ||
            score <= 0.3 ||
            score <= (bestByFile.get(row.sourceId)?.score ?? -1)
          )
            continue
          bestByFile.set(row.sourceId, {
            sourceId: row.sourceId,
            score,
            contentHash: row.contentHash
          })
          if (bestByFile.size > resultLimit) {
            let worst: EmbeddingSearchResult | undefined
            for (const entry of bestByFile.values())
              if (!worst || entry.score < worst.score) worst = entry
            if (worst) bestByFile.delete(worst.sourceId)
          }
        }
        if (rows.length < SEMANTIC_SEARCH_PAGE_SIZE) break
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      return [...bestByFile.values()].sort((left, right) => right.score - left.score)
    } finally {
      disposeSearch()
    }
  }

  /**
   * Get embedding count for monitoring.
   */
  async getEmbeddingCount(): Promise<number> {
    const result = await this.routing
      .getReadDb()
      .select({ count: sql<number>`count(*)` })
      .from(embeddingsSchema)
      .where(eq(embeddingsSchema.sourceType, SOURCE_TYPE))
    return result[0]?.count ?? 0
  }

  private async getQueryEmbedding(query: string): Promise<CachedEmbedding | null> {
    const localKey = getLocalEmbeddingRuntime().isReady()
      ? LOCAL_EMBEDDING_MODEL_KEY
      : 'configured-provider'
    const cacheKey = `${localKey}:${query.trim().toLowerCase()}`
    const cached = this.queryCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < EMBEDDING_CACHE_TTL) return cached
    try {
      const result = await this.generate(query)
      if (!usableVector(result.vector) || !result.model) return null
      const entry = { vector: result.vector, model: result.model, timestamp: Date.now() }
      this.queryCache.set(cacheKey, entry)
      if (this.queryCache.size > 100) {
        const oldest = this.queryCache.keys().next().value
        if (oldest != null) this.queryCache.delete(oldest)
      }
      return entry
    } catch (error) {
      if (this.pauseOnUsageLimit(error)) return null
      logger.warn('Query embedding failed')
      return null
    }
  }
}

/**
 * Cosine similarity between two vectors.
 * Returns value in [-1, 1], higher = more similar.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0

  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}
