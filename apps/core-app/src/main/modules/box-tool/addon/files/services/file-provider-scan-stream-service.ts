import type { FileScanOptions } from '@talex-touch/utils/common/file-scan-constants'
import type { ScannedFileInfo } from '../types'
import { scanDirectoryBatches } from '../utils'
import type { FileScanRunStats, FileScanWorkerClient } from '../workers/file-scan-worker-client'

export type DirectoryBatchStream = (
  dirPath: string,
  excludePathsSet?: Set<string>,
  signal?: AbortSignal,
  onStats?: (stats: FileScanRunStats) => void,
  options?: FileScanOptions
) => AsyncIterable<ScannedFileInfo[]>

export interface FileProviderScanStreamServiceDeps {
  scanBatches: FileScanWorkerClient['scanBatches']
  waitForIdle: () => Promise<unknown>
  /** The direct walk to fall back to; FileProvider routes it through a member tests replace. */
  scanDirect: DirectoryBatchStream
  logInfo: (message: string, meta?: Record<string, unknown>) => void
  logWarn: (message: string, error?: unknown, meta?: Record<string, unknown>) => void
}

/** Streams a directory walk from the scan worker, falling back to a direct walk on this thread. */
export class FileProviderScanStreamService {
  private backendLogged = false
  private fallbackLogged = false

  constructor(private readonly deps: FileProviderScanStreamServiceDeps) {}

  async *scanWithWorker(
    dirPath: string,
    excludePathsSet?: Set<string>,
    signal?: AbortSignal,
    onStats?: (stats: FileScanRunStats) => void,
    options?: FileScanOptions
  ): AsyncIterable<ScannedFileInfo[]> {
    await this.deps.waitForIdle()
    let yielded = false
    try {
      for await (const batch of this.deps.scanBatches(
        [dirPath],
        excludePathsSet,
        500,
        signal,
        (stats) => {
          const meta = { backend: stats.backend ?? 'legacy' }
          if (stats.fdFallback && !this.fallbackLogged) {
            this.fallbackLogged = true
            this.deps.logWarn(
              'Bundled fd scan unavailable or failed; legacy walker completed',
              undefined,
              meta
            )
          }
          if (!this.backendLogged) {
            this.backendLogged = true
            if (!stats.fdFallback) this.deps.logInfo('File scan backend completed', meta)
          }
          onStats?.(stats)
        },
        options
      )) {
        yielded = true
        yield batch
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      if (yielded) throw error
      this.deps.logWarn(
        'File scan worker failed before its first batch; using direct scan',
        error,
        {
          path: dirPath
        }
      )
      yield* this.deps.scanDirect(dirPath, excludePathsSet, signal, onStats, options)
    }
  }
}

/**
 * Walks a directory on this thread and streams its batches. The walker may run at most two batches
 * ahead of the consumer, and closing the stream early aborts it.
 */
export async function* streamDirectoryBatchesDirect(
  dirPath: string,
  excludePathsSet?: Set<string>,
  signal?: AbortSignal,
  onStats?: (stats: FileScanRunStats) => void,
  options?: FileScanOptions
): AsyncIterable<ScannedFileInfo[]> {
  const controller = new AbortController()
  const abort = (): void => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const queued: ScannedFileInfo[][] = []
  const producerWaiters = new Set<() => void>()
  let consumerWake: (() => void) | null = null
  let producerDone = false
  let producerError: unknown = null
  let producerStats: FileScanRunStats | null = null
  const wakeAll = () => {
    for (const wake of producerWaiters) wake()
    producerWaiters.clear()
    consumerWake?.()
  }
  const producer = scanDirectoryBatches(
    dirPath,
    async (batch) => {
      while (queued.length >= 2) {
        controller.signal.throwIfAborted()
        await new Promise<void>((resolve) => producerWaiters.add(resolve))
      }
      controller.signal.throwIfAborted()
      queued.push(batch)
      consumerWake?.()
    },
    excludePathsSet,
    options,
    controller.signal,
    500
  )
    .then((stats) => {
      producerStats = stats
    })
    .catch((error) => {
      producerError = error
    })
    .finally(() => {
      producerDone = true
      wakeAll()
    })

  try {
    while (true) {
      const batch = queued.shift()
      if (batch) {
        for (const wake of producerWaiters) wake()
        producerWaiters.clear()
        yield batch
        continue
      }
      if (producerDone) {
        if (producerError) throw producerError
        if (producerStats) onStats?.(producerStats)
        return
      }
      await new Promise<void>((resolve) => {
        consumerWake = resolve
      })
      consumerWake = null
    }
  } finally {
    controller.abort(new Error('FILE_SCAN_STREAM_CONSUMER_CLOSED'))
    wakeAll()
    signal?.removeEventListener('abort', abort)
    await producer
  }
}
