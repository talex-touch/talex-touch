import { isSqliteBusyError, isSqliteStorageFullError } from '../../../../../db/sqlite-retry'

export const FILE_INDEX_STORAGE_FULL = 'FILE_INDEX_STORAGE_FULL'

export interface FileIndexRunFailure {
  code: string
  retryable: boolean
  /**
   * Whether the file source stops. Its health turns `error`, and the indexing runtime then skips
   * every watch event and scan for it until the next successful run.
   */
  halts: boolean
}

/**
 * A run that filled the index to its size cap (or filled the disk) leaves the index full, not
 * broken: watch deltas must keep applying, because deletions free the pages new files need.
 */
export function classifyRunFailure(error: unknown): FileIndexRunFailure {
  if (isSqliteStorageFullError(error)) {
    return { code: FILE_INDEX_STORAGE_FULL, retryable: false, halts: false }
  }
  const busy = isSqliteBusyError(error)
  return {
    code: busy ? 'FILE_INDEX_DATABASE_BUSY' : 'FILE_INDEX_SCAN_FAILED',
    retryable: busy,
    halts: true
  }
}

/** A full index stays full until deletions free pages, so rescanning it walks every root for nothing. */
export function isIndexFullFailure(failure: { code: string } | null): boolean {
  return failure?.code === FILE_INDEX_STORAGE_FULL
}
