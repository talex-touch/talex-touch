import type { filesSchema } from '../../../../../db/schema'
import type { DbUtils } from '../../../../../db/utils'
import path from 'node:path'
import { timingLogger } from '../../../../../core/timing-logger'
import { scheduleDbWrite } from '../../../../../db/sqlite-retry'
import { FILE_TIMING_BASE_OPTIONS, KEYWORD_MAP } from '../constants'

export const FILE_EXTENSION_WRITE_MAX_QUEUE = 12

export interface FileProviderExtensionServiceDeps {
  getDbUtils: () => DbUtils | null
  isSearchSplitEnabledNow: () => boolean
  waitForCacheWriteCapacity: (maxQueue: number, label: string) => Promise<boolean>
}

export class FileProviderExtensionService {
  constructor(private readonly deps: FileProviderExtensionServiceDeps) {}

  async processFileExtensions(files: (typeof filesSchema.$inferSelect)[]): Promise<void> {
    const dbUtils = this.deps.getDbUtils()
    if (!dbUtils || files.length === 0) return

    const timingToken = timingLogger.start(
      'FileProvider:ProcessExtensions',
      {
        stage: 'ProcessFileExtensions',
        message: 'Processing file extensions',
        files: files.length
      },
      FILE_TIMING_BASE_OPTIONS
    )

    const extensionsToAdd: { fileId: number; key: string; value: string }[] = []
    let status: 'success' | 'failed' = 'success'

    try {
      const desiredKeywordExtensions = new Map<number, string>()

      for (const file of files) {
        const fileId = typeof file.id === 'number' ? file.id : null
        const fileExtension = file.extension || path.extname(file.name).toLowerCase()
        const keywords = KEYWORD_MAP[fileExtension]
        if (keywords && fileId) {
          desiredKeywordExtensions.set(fileId, JSON.stringify(keywords))
        }
      }

      if (desiredKeywordExtensions.size > 0) {
        const fileIds = Array.from(desiredKeywordExtensions.keys())
        const existingKeywordRows = await dbUtils.getFileExtensionsByFileIds(fileIds, ['keywords'])
        const existingKeywordMap = new Map<number, string>()
        for (const row of existingKeywordRows) {
          if (row.key === 'keywords' && typeof row.value === 'string') {
            existingKeywordMap.set(row.fileId, row.value)
          }
        }

        for (const [fileId, value] of desiredKeywordExtensions.entries()) {
          if (existingKeywordMap.get(fileId) === value) {
            continue
          }
          extensionsToAdd.push({ fileId, key: 'keywords', value })
        }
      }

      if (extensionsToAdd.length > 0) {
        const hasCapacity = await this.deps.waitForCacheWriteCapacity(
          FILE_EXTENSION_WRITE_MAX_QUEUE,
          'file-index.extensions.upsert'
        )
        if (!hasCapacity) {
          return
        }

        if (this.deps.isSearchSplitEnabledNow()) {
          await dbUtils.addFileExtensions(extensionsToAdd)
        } else {
          await scheduleDbWrite('file-index.extensions.upsert', () =>
            dbUtils.addFileExtensions(extensionsToAdd)
          )
        }
      }
    } catch (error) {
      status = 'failed'
      throw error
    } finally {
      timingLogger.finish(
        timingToken,
        {
          stage: 'ProcessFileExtensions',
          message:
            status === 'success'
              ? 'Processed file extensions'
              : 'Failed to process file extensions',
          files: files.length,
          extensions: extensionsToAdd.length,
          status
        },
        FILE_TIMING_BASE_OPTIONS
      )
    }
  }
}
