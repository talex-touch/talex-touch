import { fileFilterService } from '@talex-touch/utils/common/file-filter-service'
import { inArray, sql } from 'drizzle-orm'
import { scheduleDbWrite } from '../../../../../db/db-write'
import { fileIndexProgress, files as filesSchema } from '../../../../../db/schema'
import type { DbUtils } from '../../../../../db/utils'
import {
  searchIndexWriter,
  type FilePersistencePort
} from '../../../search-engine/search-index-writer'
import type { FileUpdateRecord } from '../file-provider-index-contracts'

type FileRecord = typeof filesSchema.$inferSelect
type FileInsertRecord = typeof filesSchema.$inferInsert

export interface FileProviderIndexRowStoreDeps {
  sourceId: string
  getDbUtils: () => DbUtils | null
  isSearchSplitEnabled: () => boolean
  /** Resolves `false` when the worker-owned persistence port is not ready. */
  ensurePortReady: (reason: string) => Promise<boolean>
  getPort: () => FilePersistencePort
  logDebug: (message: string, meta?: Record<string, unknown>) => void
}

/**
 * The `files` row writes of the watch path and the content clear. Under the search split the
 * worker is the sole writer of the file that holds `files`; otherwise they queue on the primary
 * lane. Never both.
 */
export class FileProviderIndexRowStore {
  constructor(private readonly deps: FileProviderIndexRowStoreDeps) {}

  async persistIncrementalRecords(records: FileInsertRecord[]): Promise<FileRecord[]> {
    const dbUtils = this.deps.getDbUtils()
    if (!dbUtils || records.length === 0) return []

    const acceptedRecords = records.filter(
      (record) =>
        fileFilterService.getManualIndexExclusionReason({
          path: record.path,
          name: record.name,
          extension: record.extension
        }) === null
    )
    if (acceptedRecords.length !== records.length) {
      this.deps.logDebug('Filtered incremental index records at commit boundary', {
        requested: records.length,
        accepted: acceptedRecords.length,
        filtered: records.length - acceptedRecords.length
      })
    }
    if (acceptedRecords.length === 0) return []

    if (this.deps.isSearchSplitEnabled()) {
      // Watch-event inserts target the worker-owned home. The persistence
      // port's upsertFiles returns the SEARCH-home rows (including their ids),
      // so downstream extension/indexing side effects are keyed by the ids of
      // the file the worker actually wrote — never primary ids (2d.3).
      // Deviation from the parked design's "forward exact SQL": the port's
      // conflict set additionally refreshes isDir/type, which is immaterial
      // here — the planner only routes paths without an existing row to
      // insert, and a same-path race writes an identical isDir/type shape.
      // displayName is untouched by both conflict sets.
      if (!(await this.deps.ensurePortReady('file-index.incremental.insert'))) {
        throw new Error('FILE_PERSISTENCE_PORT_UNAVAILABLE')
      }
      const persisted = (await this.deps.getPort().upsertFiles(
        acceptedRecords.map((record) => ({
          path: record.path,
          name: record.name,
          extension: record.extension ?? null,
          size: typeof record.size === 'number' ? record.size : null,
          mtime: record.mtime,
          ctime: record.ctime,
          // Optional-with-default columns: mirror the flag-off insert defaults.
          lastIndexedAt: record.lastIndexedAt ?? new Date(0),
          isDir: record.isDir === true,
          type: record.type ?? 'file'
        }))
      )) as unknown as FileRecord[]
      return persisted
    }

    const db = dbUtils.getDb()
    return await scheduleDbWrite('file-index.incremental.insert', () =>
      db.transaction(
        async (tx) => {
          const rows = await tx
            .insert(filesSchema)
            .values(acceptedRecords)
            .onConflictDoUpdate({
              target: filesSchema.path,
              set: {
                name: sql`excluded.name`,
                extension: sql`excluded.extension`,
                size: sql`excluded.size`,
                mtime: sql`excluded.mtime`,
                ctime: sql`excluded.ctime`,
                lastIndexedAt: sql`excluded.last_indexed_at`
              }
            })
            .returning()
          const fileIds = rows.filter((row) => row.type === 'file').map((row) => row.id)
          if (fileIds.length > 0) {
            await tx
              .update(fileIndexProgress)
              .set({ status: 'pending', progress: 0, lastError: null, updatedAt: new Date() })
              .where(inArray(fileIndexProgress.fileId, fileIds))
          }
          return rows
        },
        { behavior: 'immediate' }
      )
    )
  }

  /**
   * Route a bounded metadata-update chunk through the worker-owned
   * FilePersistencePort. The worker is the single writer of the `files` table;
   * the main process must never issue `UPDATE files` on its own connection
   * (issue #476 SQLITE_BUSY root cause). Rows are located strictly by
   * `files.id`; missing ids are skipped by the repository. Those ids MUST be
   * home-stable: they come from split-aware reads (`getFileIndexReadDb()` in
   * getExistingRows / the reconciliation readers), so under the split they are
   * the SEARCH file's own row ids — a primary row id must never reach this
   * port or a watch-modify could update the wrong search-home row (2d.3).
   */
  async updateFileMetadataChunk(records: FileUpdateRecord[]): Promise<void> {
    if (records.length === 0) return
    if (!(await this.deps.ensurePortReady('file-index.file-update.chunk'))) {
      throw new Error('FILE_PERSISTENCE_PORT_UNAVAILABLE')
    }
    const lastIndexedAt = new Date()
    await this.deps.getPort().updateFileMetadata(
      records.map((file) => ({
        id: file.id,
        name: file.name,
        extension: file.extension ?? null,
        size: file.size ?? null,
        ctime: file.ctime,
        mtime: file.mtime,
        lastIndexedAt,
        isDir: file.isDir,
        type: file.type
      }))
    )
  }

  async refreshFileUpdateRecords(files: FileUpdateRecord[]): Promise<FileRecord[]> {
    const dbUtils = this.deps.getDbUtils()
    if (!dbUtils || files.length === 0) return []
    const ids = files.map((file) => file.id)
    // Read back the rows the worker just updated — from the worker's home.
    return await dbUtils
      .getFileIndexReadDb()
      .select()
      .from(filesSchema)
      .where(inArray(filesSchema.id, ids))
  }

  /** Clears every derived content artifact; returns how many search documents it blanked. */
  async clearContentIndexingData(): Promise<number> {
    const dbUtils = this.deps.getDbUtils()
    if (!dbUtils) return 0
    const statements = [
      {
        sql: "UPDATE files SET content = NULL, embedding_status = 'none' WHERE type = 'file'",
        args: []
      },
      { sql: "DELETE FROM embeddings WHERE source_type = 'file'", args: [] },
      { sql: 'DELETE FROM file_index_progress', args: [] },
      {
        sql: "UPDATE search_index SET content = '' WHERE provider = ?",
        args: [this.deps.sourceId]
      },
      { sql: "DELETE FROM file_extensions WHERE key = 'content_chunks'", args: [] }
    ]

    if (this.deps.isSearchSplitEnabled()) {
      const results = await searchIndexWriter.execWrite(statements, 'transaction')
      return Number(results[3]?.rowsAffected ?? results[0]?.rowsAffected ?? 0)
    }

    const db = dbUtils.getFileIndexReadDb()
    return await scheduleDbWrite('file-index.content.clear', async () => {
      return await db.transaction(async (tx) => {
        await tx.run(sql.raw(statements[0]!.sql))
        await tx.run(sql.raw(statements[1]!.sql))
        await tx.run(sql.raw(statements[2]!.sql))
        const result = await tx.run(
          sql`UPDATE search_index SET content = '' WHERE provider = ${this.deps.sourceId}`
        )
        await tx.run(sql.raw(statements[4]!.sql))
        return Number(result.rowsAffected ?? 0)
      })
    })
  }
}
