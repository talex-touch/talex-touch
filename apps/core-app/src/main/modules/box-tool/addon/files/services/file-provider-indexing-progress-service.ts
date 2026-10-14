import type { DbUtils } from '../../../../../db/utils'
import { desc, eq, inArray, sql } from 'drizzle-orm'
import { fileIndexProgress, filesSchema } from '../../../../../db/schema'

export interface FileProviderIndexingProgressEntry {
  path: string
  status: string | null
  progress: number | null
  processedBytes: number | null
  totalBytes: number | null
  updatedAt: Date | null
  lastError: string | null
}

export interface FileProviderIndexingProgressResult {
  summary: Record<string, number>
  entries: FileProviderIndexingProgressEntry[]
}

export class FileProviderIndexingProgressService {
  constructor(private readonly getDbUtils: () => DbUtils | null) {}

  async getIndexingProgress(paths?: string[]): Promise<FileProviderIndexingProgressResult> {
    const dbUtils = this.getDbUtils()
    if (!dbUtils) {
      return { summary: {}, entries: [] }
    }

    const db = dbUtils.getFileIndexReadDb()
    const limit = paths && paths.length > 0 ? undefined : 50

    const rows = await db
      .select({
        path: filesSchema.path,
        status: fileIndexProgress.status,
        progress: fileIndexProgress.progress,
        processedBytes: fileIndexProgress.processedBytes,
        totalBytes: fileIndexProgress.totalBytes,
        updatedAt: fileIndexProgress.updatedAt,
        lastError: fileIndexProgress.lastError
      })
      .from(fileIndexProgress)
      .innerJoin(filesSchema, eq(fileIndexProgress.fileId, filesSchema.id))
      .where(paths && paths.length > 0 ? inArray(filesSchema.path, paths) : sql`1 = 1`)
      .orderBy(desc(fileIndexProgress.updatedAt))
      .limit(limit ?? Number.MAX_SAFE_INTEGER)

    const entries: FileProviderIndexingProgressEntry[] = rows.map((row) => ({
      path: row.path,
      status: row.status,
      progress: row.progress,
      processedBytes: row.processedBytes,
      totalBytes: row.totalBytes,
      updatedAt: row.updatedAt,
      lastError: row.lastError
    }))

    let summary: Record<string, number> = {}

    if (paths && paths.length > 0) {
      summary = entries.reduce<Record<string, number>>((acc, entry) => {
        const key = entry.status ?? 'unknown'
        acc[key] = (acc[key] ?? 0) + 1
        return acc
      }, {})
    } else {
      const summaryRows = await db.all<{ status: string; total: number }>(
        sql`SELECT status, COUNT(*) as total FROM file_index_progress GROUP BY status`
      )
      summary = summaryRows.reduce<Record<string, number>>((acc, row) => {
        acc[row.status ?? 'unknown'] = row.total
        return acc
      }, {})
    }

    return { summary, entries }
  }
}
