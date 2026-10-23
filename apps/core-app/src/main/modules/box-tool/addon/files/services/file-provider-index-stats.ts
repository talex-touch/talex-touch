import type { FileIndexStats } from '@talex-touch/utils/transport/events/types'
import type { SearchIndexService } from '../../../search-engine/search-index-service'
import { enterPerfContext } from '../../../../../utils/perf-context'

/**
 * The file index's health numbers. Callers go through `FileProvider.getIndexStats()`, which serves
 * one snapshot per second to every reader; this is the uncached read underneath it, answered by the
 * search index's read worker so the main thread never executes it. Lives beside file-provider.ts
 * rather than in it because that file is on the module size ratchet (#343).
 */
export async function computeFileIndexStats(
  searchIndex: Pick<SearchIndexService, 'readFileIndexStats'> | null,
  sourceId: string
): Promise<FileIndexStats> {
  if (!searchIndex) {
    return {
      totalFiles: 0,
      failedFiles: 0,
      skippedFiles: 0,
      completedFiles: 0,
      embeddingCompletedFiles: 0,
      embeddingRows: 0
    }
  }

  // `duration`, not `blocking`: the wait is a worker round trip, so a slow one is not a stall.
  const disposeStats = enterPerfContext('FileProvider.computeIndexStats', {
    sourceId,
    queryCount: 1,
    readHome: 'read-worker'
  })
  try {
    return await searchIndex.readFileIndexStats()
  } finally {
    disposeStats()
  }
}
