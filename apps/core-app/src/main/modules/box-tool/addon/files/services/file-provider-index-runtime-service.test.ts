import { createClient } from '@libsql/client'
import type { IndexWorkerFileResult } from '../workers/file-index-worker-client'
import { FileProviderContentCapacityService } from './file-provider-content-capacity-service'
import type {
  PersistEntriesSummary,
  FilePersistenceEntry
} from '../../../search-engine/workers/search-index-worker-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileProviderIndexRuntimeServiceDeps } from './file-provider-index-runtime-service'
import { FileProviderIndexRuntimeService } from './file-provider-index-runtime-service'
import { indexMaintenanceContext } from '../../../search-engine/index-maintenance-context'
import {
  beginForegroundSearchActivity,
  endForegroundSearchActivity,
  getLastSearchActivityAt,
  markSearchActivity
} from '../../../search-engine/search-activity'

function createResult(fileId: number): IndexWorkerFileResult {
  return {
    type: 'file',
    taskId: `task-${fileId}`,
    fileId,
    progress: {
      status: 'completed',
      progress: 100,
      processedBytes: 1,
      totalBytes: 1,
      lastError: null,
      updatedAt: '2026-10-12T00:00:00.000Z'
    },
    fileUpdate: null,
    indexItem: {
      itemId: String(fileId),
      providerId: 'file-provider',
      type: 'file',
      name: `file-${fileId}`,
      content: `content-${fileId}`
    }
  }
}

function toPersistEntries(entries: IndexWorkerFileResult[]): FilePersistenceEntry[] {
  return entries.map((entry) => ({
    fileId: entry.fileId,
    fileUpdate: entry.fileUpdate
      ? { ...entry.fileUpdate, contentHash: entry.fileUpdate.contentHash ?? null }
      : null,
    progress: {
      status: entry.progress.status,
      progress: entry.progress.progress,
      processedBytes: entry.progress.processedBytes,
      totalBytes: entry.progress.totalBytes,
      lastError: entry.progress.lastError,
      startedAt: entry.progress.startedAt ?? null,
      updatedAt: entry.progress.updatedAt ?? null
    }
  }))
}

function createPersistSummary(entries: FilePersistenceEntry[]): PersistEntriesSummary {
  return {
    entries: entries.length,
    chunks: entries.length > 0 ? 1 : 0,
    persistedRows: entries.length,
    fileUpdates: 0,
    progressRows: entries.length,
    embeddings: 0
  }
}

function createService(options: {
  pending: Map<number, IndexWorkerFileResult>
  inflight: Map<number, IndexWorkerFileResult>
  ensureSearchIndexWorkerReady: (reason: string) => Promise<boolean>
  persistEntries?: (entries: FilePersistenceEntry[]) => Promise<PersistEntriesSummary>
  publishRecords?: (entries: IndexWorkerFileResult[]) => Promise<number>
  logWarn?: (message: string, error?: unknown, meta?: Record<string, unknown>) => void
  config?: FileProviderIndexRuntimeServiceDeps['config']
  checkContentCapacity?: FileProviderIndexRuntimeServiceDeps['checkContentCapacity']
  isContentAdmissionEnabled?: FileProviderIndexRuntimeServiceDeps['isContentAdmissionEnabled']
  recordStorageFailure?: FileProviderIndexRuntimeServiceDeps['recordStorageFailure']
  indexEmbeddings?: FileProviderIndexRuntimeServiceDeps['indexEmbeddings']
  resumeDeferredFlush?: FileProviderIndexRuntimeServiceDeps['resumeDeferredFlush']
  prepareDeferredEntries?: FileProviderIndexRuntimeServiceDeps['prepareDeferredEntries']
  isMutationLeaseCancelled?: FileProviderIndexRuntimeServiceDeps['isMutationLeaseCancelled']
}) {
  const persistEntries = vi.fn(
    options.persistEntries ?? (async (entries) => createPersistSummary(entries))
  )
  const logWarn = vi.fn(options.logWarn ?? (() => undefined))
  const publishRecords = vi.fn(options.publishRecords ?? (async (entries) => entries.length))

  return {
    persistEntries,
    publishRecords,
    logWarn,
    service: new FileProviderIndexRuntimeService({
      resumeDeferredFlush:
        options.resumeDeferredFlush ?? (async (operation) => operation('resumed-lease')),
      prepareDeferredEntries: options.prepareDeferredEntries ?? (async () => true),
      isMutationLeaseCancelled: options.isMutationLeaseCancelled,
      checkContentCapacity: options.checkContentCapacity,
      isContentAdmissionEnabled: options.isContentAdmissionEnabled,
      recordStorageFailure: options.recordStorageFailure,
      indexEmbeddings: options.indexEmbeddings,
      flushBatchScheduler: {
        currentSize: 10,
        recordDuration: vi.fn()
      },
      getDbUtils: () => ({}),
      getSearchIndex: () => ({}),
      getPendingResults: () => options.pending,
      getInflightResults: () => options.inflight,
      ensureSearchIndexWorkerReady: options.ensureSearchIndexWorkerReady,
      getSearchIndexWorker: () => ({ persistEntries }),
      buildPersistEntries: toPersistEntries,
      publishRecords,
      logDebug: vi.fn(),
      logWarn,
      config: {
        backlogDelayMs: 1_000,
        ...options.config
      }
    })
  }
}

describe('FileProviderIndexRuntimeService worker readiness', () => {
  beforeEach(() => {
    // Start every case from a clean timer/spy state: restore spies BEFORE dropping the clock, so
    // a stale setTimeout spy can never reinstall a dead fake clock into globalThis.
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  afterEach(() => {
    // Restore spies BEFORE dropping the fake clock: a `spyOn(globalThis, 'setTimeout')` captured
    // while fake timers were installed would otherwise be reinstalled into globalThis, leaving
    // every later real timer in this file permanently dead.
    vi.clearAllTimers()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('flush waits for the shared search index worker readiness gate', async () => {
    const pending = new Map<number, IndexWorkerFileResult>([[1, createResult(1)]])
    const inflight = new Map<number, IndexWorkerFileResult>()
    let resolveReady!: (ready: boolean) => void
    const ready = new Promise<boolean>((resolve) => {
      resolveReady = resolve
    })
    const ensureSearchIndexWorkerReady = vi.fn(() => ready)
    const { service, persistEntries } = createService({
      pending,
      inflight,
      ensureSearchIndexWorkerReady
    })

    const flush = service.doFlush()
    await Promise.resolve()

    expect(ensureSearchIndexWorkerReady).toHaveBeenCalledWith('index-runtime.flush')
    expect(persistEntries).not.toHaveBeenCalled()

    resolveReady(true)
    await flush

    expect(persistEntries).toHaveBeenCalledTimes(1)
    expect(pending.size).toBe(0)
    expect(inflight.size).toBe(0)
    expect(service.getFlushSnapshot()).toMatchObject({
      status: 'flushed',
      entries: 1,
      pending: 0,
      inflight: 0,
      reason: 'persisted',
      metadata: {
        withContent: 1,
        persistedRows: 1,
        indexedItems: 1,
        progressRows: 1,
        chunks: 1
      }
    })
  })

  it('records idle flush snapshot when no pending worker results exist', async () => {
    const pending = new Map<number, IndexWorkerFileResult>()
    const inflight = new Map<number, IndexWorkerFileResult>()
    const ensureSearchIndexWorkerReady = vi.fn(async () => true)
    const { service, persistEntries } = createService({
      pending,
      inflight,
      ensureSearchIndexWorkerReady
    })

    await service.flush()

    expect(ensureSearchIndexWorkerReady).not.toHaveBeenCalled()
    expect(persistEntries).not.toHaveBeenCalled()
    expect(service.getFlushSnapshot()).toMatchObject({
      status: 'idle',
      entries: 0,
      pending: 0,
      inflight: 0,
      reason: 'no-pending'
    })
  })

  it('rolls back the flush batch when worker readiness fails', async () => {
    vi.useFakeTimers()
    const pending = new Map<number, IndexWorkerFileResult>([[1, createResult(1)]])
    const inflight = new Map<number, IndexWorkerFileResult>()
    const { service, persistEntries, logWarn } = createService({
      pending,
      inflight,
      ensureSearchIndexWorkerReady: vi.fn(async () => false)
    })

    await service.doFlush()

    expect(persistEntries).not.toHaveBeenCalled()
    expect(pending.has(1)).toBe(true)
    expect(inflight.size).toBe(0)
    expect(logWarn).toHaveBeenCalledWith(
      'Index worker flush skipped: worker init unavailable',
      undefined,
      expect.objectContaining({ pending: 1, inflight: 0 })
    )
    expect(service.getFlushSnapshot()).toMatchObject({
      status: 'worker-not-ready',
      entries: 1,
      pending: 1,
      inflight: 0,
      reason: 'not-ready',
      metadata: {
        withContent: 1
      }
    })
  })

  it('retains the local batch for retry when runtime publication fails after persistence', async () => {
    vi.useFakeTimers()
    const pending = new Map<number, IndexWorkerFileResult>([[1, createResult(1)]])
    const inflight = new Map<number, IndexWorkerFileResult>()
    const { service, persistEntries, publishRecords, logWarn } = createService({
      pending,
      inflight,
      ensureSearchIndexWorkerReady: vi.fn(async () => true),
      publishRecords: async () => {
        throw new Error('runtime publish exploded')
      }
    })

    await service.flush()

    expect(persistEntries).toHaveBeenCalledTimes(1)
    expect(publishRecords).toHaveBeenCalledTimes(1)
    expect(pending.has(1)).toBe(false)
    expect(inflight.get(1)?.indexItem.content).toBe('content-1')
    expect(logWarn).toHaveBeenCalledWith(
      'Index worker flush failed, scheduling retry',
      expect.any(Error),
      expect.objectContaining({
        isBusy: false,
        pending: 0,
        inflight: 1
      })
    )
    expect(service.getFlushSnapshot()).toMatchObject({
      status: 'failed',
      entries: 1,
      pending: 0,
      inflight: 1,
      reason: 'persist-failed',
      error: 'runtime publish exploded',
      metadata: {
        withContent: 1,
        isBusy: false,
        retryReason: 'flush-failed'
      }
    })
  })

  it('keeps explicit flushes behind an active SQLite busy retry', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const pending = new Map<number, IndexWorkerFileResult>([[1, createResult(1)]])
    const inflight = new Map<number, IndexWorkerFileResult>()
    const busyError = Object.assign(new Error('database is locked'), {
      code: 'SQLITE_BUSY',
      rawCode: 5
    })
    const persistEntries = vi
      .fn<(entries: FilePersistenceEntry[]) => Promise<PersistEntriesSummary>>()
      .mockRejectedValueOnce(busyError)
      .mockImplementation(async (entries) => createPersistSummary(entries))
    const { service } = createService({
      pending,
      inflight,
      ensureSearchIndexWorkerReady: vi.fn(async () => true),
      persistEntries
    })

    await service.flush()
    await service.flush()
    await service.flush()

    expect(persistEntries).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(249)
    expect(persistEntries).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(persistEntries).toHaveBeenCalledTimes(2)
  })

  it('checks capacity after worker readiness and prevents body persistence and embeddings when space vanished', async () => {
    vi.useFakeTimers()
    let admitted = true
    const indexEmbeddings = vi.fn(async () => undefined)
    const { service, persistEntries, publishRecords } = createService({
      pending: new Map([[1, createResult(1)]]),
      inflight: new Map(),
      ensureSearchIndexWorkerReady: async () => {
        admitted = false
        return true
      },
      checkContentCapacity: async () => admitted,
      isContentAdmissionEnabled: () => admitted,
      indexEmbeddings
    })
    try {
      await service.flush()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(persistEntries).not.toHaveBeenCalled()
      expect(publishRecords).not.toHaveBeenCalled()
      expect(indexEmbeddings).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      service.dispose()
    }
  })

  it('stops publication and embeddings when capacity vanishes immediately after a committed body write', async () => {
    vi.useFakeTimers()
    let admitted = true
    const indexEmbeddings = vi.fn(async () => undefined)
    const { service, persistEntries, publishRecords } = createService({
      pending: new Map([[1, createResult(1)]]),
      inflight: new Map(),
      ensureSearchIndexWorkerReady: async () => true,
      checkContentCapacity: async () => admitted,
      isContentAdmissionEnabled: () => admitted,
      persistEntries: async (entries) => {
        admitted = false
        return createPersistSummary(entries)
      },
      indexEmbeddings
    })
    try {
      await service.flush()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(persistEntries).toHaveBeenCalledTimes(1)
      expect(publishRecords).not.toHaveBeenCalled()
      expect(indexEmbeddings).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      service.dispose()
    }
  })

  it('pauses on wrapped SQLITE_FULL and does not retry the same disk-full write every 250ms', async () => {
    vi.useFakeTimers()
    const capacity = new FileProviderContentCapacityService({
      getDirectory: () => '/synthetic/index',
      statfs: async () => ({ bavail: 4 * 1024 ** 3, bsize: 1 })
    })
    await capacity.check(true)
    const error = new Error('worker persistence failed', {
      cause: Object.assign(new Error('database or disk is full'), { code: 'SQLITE_FULL' })
    })
    const { service, persistEntries, publishRecords } = createService({
      pending: new Map([[1, createResult(1)]]),
      inflight: new Map(),
      ensureSearchIndexWorkerReady: async () => true,
      checkContentCapacity: () => capacity.check(),
      isContentAdmissionEnabled: () => capacity.isReady(),
      recordStorageFailure: (failure) => capacity.recordFailure(failure),
      persistEntries: async () => {
        throw error
      }
    })
    try {
      await service.flush()
      expect(capacity.isReady()).toBe(false)
      service.handleIndexWorkerFile(createResult(2))
      await vi.advanceTimersByTimeAsync(30_000)
      await service.flush()
      expect(persistEntries).toHaveBeenCalledTimes(1)
      expect(publishRecords).not.toHaveBeenCalled()
      expect(service.getBufferSnapshot()).toMatchObject({ pending: 0, inflight: 0 })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      service.dispose()
      capacity.dispose()
    }
  })

  it('accepts and persists a fresh scheduled result after a disk-full pause recovers', async () => {
    vi.useFakeTimers()
    const capacity = new FileProviderContentCapacityService({
      getDirectory: () => '/synthetic/index',
      checkIntervalMs: 1000,
      statfs: async () => ({ bavail: 4 * 1024 ** 3, bsize: 1 })
    })
    await capacity.check(true)
    const publishedIds: number[] = []
    let firstWrite = true
    const { service } = createService({
      pending: new Map([[1, createResult(1)]]),
      inflight: new Map(),
      ensureSearchIndexWorkerReady: async () => true,
      checkContentCapacity: () => capacity.check(),
      isContentAdmissionEnabled: () => capacity.isReady(),
      recordStorageFailure: (error) => capacity.recordFailure(error),
      config: { baseDelayMs: 1, backlogDelayMs: 1 },
      persistEntries: async (entries) => {
        if (firstWrite) {
          firstWrite = false
          throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
        }
        return createPersistSummary(entries)
      },
      publishRecords: async (entries) => {
        publishedIds.push(...entries.map((entry) => entry.fileId))
        return entries.length
      }
    })
    try {
      await service.flush()
      await vi.advanceTimersByTimeAsync(1000)
      await expect(capacity.check(true)).resolves.toBe(true)
      service.handleIndexWorkerFile(createResult(2))
      await vi.advanceTimersByTimeAsync(1)
      expect(publishedIds).toEqual([2])
      expect(service.getBufferSnapshot()).toMatchObject({ pending: 0, inflight: 0 })
    } finally {
      service.dispose()
      capacity.dispose()
    }
  })

  it('does not finalize completed progress or retry when a late embedding callback reports disk full', async () => {
    vi.useFakeTimers()
    const capacity = new FileProviderContentCapacityService({
      getDirectory: () => '/synthetic/index',
      statfs: async () => ({ bavail: 4 * 1024 ** 3, bsize: 1 })
    })
    await capacity.check(true)
    const progressWrites: string[] = []
    const embedded = vi.fn(async () => {
      throw new Error('embedding worker write failed', {
        cause: Object.assign(new Error('device full'), { code: 'ENOSPC' })
      })
    })
    const { service, persistEntries, publishRecords } = createService({
      pending: new Map([[1, createResult(1)]]),
      inflight: new Map(),
      ensureSearchIndexWorkerReady: async () => true,
      checkContentCapacity: () => capacity.check(),
      isContentAdmissionEnabled: () => capacity.isReady(),
      recordStorageFailure: (error) => capacity.recordFailure(error),
      persistEntries: async (entries) => {
        progressWrites.push(...entries.map((entry) => entry.progress.status))
        return createPersistSummary(entries)
      },
      indexEmbeddings: embedded
    })
    try {
      await service.flush()
      await vi.advanceTimersByTimeAsync(30_000)
      expect(capacity.isReady()).toBe(false)
      expect(progressWrites).toEqual(['pending'])
      expect(persistEntries).toHaveBeenCalledTimes(1)
      expect(publishRecords).toHaveBeenCalledTimes(1)
      expect(embedded).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      service.dispose()
      capacity.dispose()
    }
  })
})

describe('FileProviderIndexRuntimeService buffer byte ownership', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function resultWithContent(fileId: number, content: string): IndexWorkerFileResult {
    const base = createResult(fileId)
    return {
      ...base,
      fileUpdate: { content, embeddingStatus: 'completed', contentHash: null },
      indexItem: { ...base.indexItem, content }
    }
  }

  it('reports pending and inflight bytes and returns them to zero after commit', async () => {
    vi.useFakeTimers()
    const pending = new Map<number, IndexWorkerFileResult>()
    const inflight = new Map<number, IndexWorkerFileResult>()
    const persistGate = Promise.withResolvers<PersistEntriesSummary>()
    const { service } = createService({
      pending,
      inflight,
      ensureSearchIndexWorkerReady: vi.fn(async () => true),
      persistEntries: () => persistGate.promise
    })

    service.handleIndexWorkerFile(resultWithContent(1, 'a'.repeat(64)))
    const afterSmall = service.getBufferSnapshot()
    service.handleIndexWorkerFile(resultWithContent(2, 'b'.repeat(4_096)))
    const afterLarge = service.getBufferSnapshot()

    expect(afterSmall).toMatchObject({ pending: 1, inflight: 0 })
    expect(afterSmall.pendingBytes).toBeGreaterThanOrEqual(64)
    expect(afterLarge.pending).toBe(2)
    // Conservatively accounted ownership must include both retained UTF-8 payloads.
    expect(afterLarge.pendingBytes).toBeGreaterThanOrEqual(64 + 4_096)

    const flush = service.doFlush()
    const duringFlush = service.getBufferSnapshot()
    expect(duringFlush).toMatchObject({ pending: 0, inflight: 2, pendingBytes: 0 })
    expect(duringFlush.inflightBytes).toBe(afterLarge.pendingBytes)

    persistGate.resolve(createPersistSummary(toPersistEntries([...inflight.values()])))
    await flush
    expect(service.getBufferSnapshot()).toMatchObject({
      pending: 0,
      inflight: 0,
      pendingBytes: 0,
      inflightBytes: 0
    })
    service.dispose()
  })
})

describe('FileProviderIndexRuntimeService persist barrier', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('keeps the barrier open while a flush is still persisting', async () => {
    const pending = new Map<number, IndexWorkerFileResult>([[1, createResult(1)]])
    const inflight = new Map<number, IndexWorkerFileResult>()
    const persistGate = Promise.withResolvers<void>()
    const persistStarted = Promise.withResolvers<void>()
    const { service, persistEntries } = createService({
      pending,
      inflight,
      ensureSearchIndexWorkerReady: vi.fn(async () => true),
      persistEntries: async (entries) => {
        persistStarted.resolve()
        await persistGate.promise
        return createPersistSummary(entries)
      }
    })

    let settled = false
    const barrier = service.waitForPersisted(5_000).then(() => {
      settled = true
    })

    // A flush is genuinely in flight and its persistence has not completed yet.
    await vi.advanceTimersByTimeAsync(0)
    await persistStarted.promise
    expect(settled).toBe(false)

    persistGate.resolve(undefined)
    await vi.advanceTimersByTimeAsync(100)
    await barrier

    expect(settled).toBe(true)
    expect(persistEntries).toHaveBeenCalledTimes(1)
    expect(service.getBufferSnapshot()).toMatchObject({ pending: 0, inflight: 0 })
    service.dispose()
  })

  it('does not treat a cancelled flush as released while its publish is still pending', async () => {
    const pending = new Map<number, IndexWorkerFileResult>([[1, createResult(1)]])
    const inflight = new Map<number, IndexWorkerFileResult>()
    const publishGate = Promise.withResolvers<number>()
    const publicationStarted = Promise.withResolvers<void>()
    const { service } = createService({
      pending,
      inflight,
      ensureSearchIndexWorkerReady: vi.fn(async () => true),
      publishRecords: async () => {
        publicationStarted.resolve()
        return publishGate.promise
      }
    })

    // An explicit flush is already in flight: it owns the batch and is suspending in publish.
    const flush = service.doFlush()
    await publicationStarted.promise
    expect(inflight.size).toBe(1)

    // Cancellation clears local ownership while that publish is still outstanding.
    pending.clear()
    inflight.clear()
    expect(service.getBufferSnapshot()).toMatchObject({ pending: 0, inflight: 0 })

    let settled = false
    const barrier = service.waitForPersisted(5_000).then(() => {
      settled = true
    })

    // One tick is already enough for a barrier that only consulted pending/inflight to claim
    // completion, so the in-flight flush must be what keeps it closed.
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toBe(false)

    publishGate.resolve(1)
    await flush
    await vi.advanceTimersByTimeAsync(100)
    await barrier
    expect(service.getBufferSnapshot()).toMatchObject({ pending: 0, inflight: 0 })
    service.dispose()
  })
})

describe('FileProviderIndexRuntimeService foreground handoff', () => {
  const session = 'file-index-deferred-regression'
  let previousActivity = 0

  beforeEach(() => {
    previousActivity = getLastSearchActivityAt()
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    markSearchActivity(0)
  })

  afterEach(() => {
    endForegroundSearchActivity(session)
    markSearchActivity(previousActivity)
    vi.clearAllTimers()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function resumeGate() {
    const release = Promise.withResolvers<void>()
    const finished = Promise.withResolvers<void>()
    const ownership: string[] = []
    let attempts = 0
    const resume: FileProviderIndexRuntimeServiceDeps['resumeDeferredFlush'] = async (
      operation,
      signal
    ) => {
      await release.promise
      try {
        signal.throwIfAborted()
        const leaseId = ++attempts === 1 ? 'fresh-lease' : `fresh-lease-${attempts}`
        ownership.push(`acquire:${leaseId}`)
        try {
          await indexMaintenanceContext.run(true, () => operation(leaseId))
        } finally {
          ownership.push(`release:${leaseId}`)
        }
      } finally {
        finished.resolve()
      }
    }
    return { release, finished, ownership, resume }
  }

  function makeIdle() {
    endForegroundSearchActivity(session)
    markSearchActivity(0)
  }

  it('releases the old source lease without SQL retry spin or warning, then publishes the retained payload once under a fresh lease', async () => {
    const gate = resumeGate()
    const result = { ...createResult(1), mutationLeaseId: 'old-lease' }
    const durable: string[] = []
    const published: Array<{
      id: number
      lease: string | undefined
      content: IndexWorkerFileResult['indexItem']['content']
    }> = []
    const embeddings: number[] = []
    let oldLeaseCancelled = false
    const { service, logWarn } = createService({
      pending: new Map([[1, result]]),
      inflight: new Map(),
      ensureSearchIndexWorkerReady: async () => true,
      resumeDeferredFlush: gate.resume,
      checkContentCapacity: async () => true,
      isMutationLeaseCancelled: (leaseId) => oldLeaseCancelled && leaseId === 'old-lease',
      persistEntries: async (entries) => {
        durable.push(...entries.map((entry) => `${entry.fileId}:${entry.progress.status}`))
        return createPersistSummary(entries)
      },
      publishRecords: async (entries) => {
        published.push(
          ...entries.map((entry) => ({
            id: entry.fileId,
            lease: entry.mutationLeaseId,
            content: entry.indexItem.content
          }))
        )
        return entries.length
      },
      indexEmbeddings: async (entries) => {
        embeddings.push(...entries.map((entry) => entry.fileId))
      }
    })
    try {
      beginForegroundSearchActivity(session)
      await indexMaintenanceContext.run(true, () => service.flush())
      expect(await service.waitForPersisted()).toBe(false)
      expect(service.isMutationLeaseDetached('old-lease')).toBe(true)
      expect(service.getBufferSnapshot()).toMatchObject({ pending: 0, inflight: 1 })
      expect(service.getFlushSnapshot()).toMatchObject({
        status: 'foreground-deferred',
        reason: 'foreground-deferred'
      })
      await vi.advanceTimersByTimeAsync(30_000)
      expect(durable).toEqual([])
      expect(published).toEqual([])
      expect(logWarn).not.toHaveBeenCalled()
      expect(gate.ownership).toEqual([])
      // The source's afterBatch cancels the handed-off lease once its barrier returns false.
      oldLeaseCancelled = true
      makeIdle()
      gate.release.resolve()
      await gate.finished.promise
      expect(await service.waitForPersisted()).toBe(true)
      expect(durable).toEqual(['1:pending', '1:completed'])
      expect(published).toEqual([{ id: 1, lease: 'fresh-lease', content: 'content-1' }])
      expect(embeddings).toEqual([1])
      expect(gate.ownership).toEqual(['acquire:fresh-lease', 'release:fresh-lease'])
      expect(service.isMutationLeaseDetached('old-lease')).toBe(false)
      await service.flush()
      expect(durable).toEqual(['1:pending', '1:completed'])
    } finally {
      service.dispose()
      gate.release.resolve()
    }
  })

  it.each(['publication', 'embeddings', 'completion'] as const)(
    'does not repeat finished durable stages after foreground preempts late %s',
    async (preemptAt) => {
      const gate = resumeGate()
      const durable: string[] = []
      const published: number[] = []
      const embeddings: number[] = []
      let preempted = false
      const preempt = (stage: string) => {
        if (stage === preemptAt && !preempted) {
          preempted = true
          beginForegroundSearchActivity(session)
        }
      }
      const { service, logWarn } = createService({
        pending: new Map([[1, { ...createResult(1), mutationLeaseId: 'old-lease' }]]),
        inflight: new Map(),
        ensureSearchIndexWorkerReady: async () => true,
        resumeDeferredFlush: gate.resume,
        checkContentCapacity: async () => true,
        persistEntries: async (entries) => {
          durable.push(...entries.map((entry) => `${entry.fileId}:${entry.progress.status}`))
          if (entries.some((entry) => entry.progress.status === 'completed')) preempt('completion')
          return createPersistSummary(entries)
        },
        publishRecords: async (entries) => {
          published.push(...entries.map((entry) => entry.fileId))
          preempt('publication')
          return entries.length
        },
        indexEmbeddings: async (entries) => {
          embeddings.push(...entries.map((entry) => entry.fileId))
          preempt('embeddings')
        }
      })
      try {
        await indexMaintenanceContext.run(true, () => service.flush())
        expect(await service.waitForPersisted()).toBe(false)
        expect(service.getBufferSnapshot()).toMatchObject({ pending: 0, inflight: 1 })
        expect(service.isMutationLeaseDetached('old-lease')).toBe(true)
        expect(logWarn).not.toHaveBeenCalled()
        makeIdle()
        gate.release.resolve()
        await gate.finished.promise
        expect(await service.waitForPersisted()).toBe(true)
        expect(durable).toEqual(['1:pending', '1:completed'])
        expect(published).toEqual([1])
        expect(embeddings).toEqual([1])
      } finally {
        service.dispose()
        gate.release.resolve()
      }
    }
  )

  it.each(['reset', 'cancelled-lease', 'storage-pause', 'dispose'] as const)(
    'prevents retained late writes after %s and refuses cancelled producer results',
    async (action) => {
      const gate = resumeGate()
      let admission = true
      let cancelled = false
      const written: number[] = []
      const visible: number[] = []
      const { service } = createService({
        pending: new Map([[1, { ...createResult(1), mutationLeaseId: 'old-lease' }]]),
        inflight: new Map(),
        ensureSearchIndexWorkerReady: async () => true,
        resumeDeferredFlush: gate.resume,
        isContentAdmissionEnabled: () => admission,
        isMutationLeaseCancelled: () => cancelled,
        persistEntries: async (entries) => {
          written.push(...entries.map((entry) => entry.fileId))
          return createPersistSummary(entries)
        },
        publishRecords: async (entries) => {
          visible.push(...entries.map((entry) => entry.fileId))
          return entries.length
        }
      })
      try {
        beginForegroundSearchActivity(session)
        await indexMaintenanceContext.run(true, () => service.flush())
        if (action === 'reset') service.cancelDeferredFlush()
        if (action === 'cancelled-lease') cancelled = true
        if (action === 'storage-pause') admission = false
        if (action === 'dispose') service.dispose()
        makeIdle()
        gate.release.resolve()
        await gate.finished.promise
        service.handleIndexWorkerFile({ ...createResult(2), mutationLeaseId: 'old-lease' })
        await vi.advanceTimersByTimeAsync(30_000)
        expect(written).toEqual([])
        expect(visible).toEqual([])
        expect(service.getBufferSnapshot()).toMatchObject({ pending: 0, inflight: 0 })
      } finally {
        service.dispose()
        gate.release.resolve()
      }
    }
  )

  it('fences an active fresh-lease preparation invalidated by reset before its await returns', async () => {
    const gate = resumeGate()
    const preparing = Promise.withResolvers<void>()
    const preparation = Promise.withResolvers<boolean>()
    const committed: number[] = []
    const { service } = createService({
      pending: new Map([[1, { ...createResult(1), mutationLeaseId: 'old-lease' }]]),
      inflight: new Map(),
      ensureSearchIndexWorkerReady: async () => true,
      resumeDeferredFlush: gate.resume,
      prepareDeferredEntries: async () => {
        preparing.resolve()
        return preparation.promise
      },
      persistEntries: async (entries) => {
        committed.push(...entries.map((entry) => entry.fileId))
        return createPersistSummary(entries)
      }
    })
    try {
      beginForegroundSearchActivity(session)
      await indexMaintenanceContext.run(true, () => service.flush())
      makeIdle()
      gate.release.resolve()
      await preparing.promise
      service.cancelDeferredFlush()
      preparation.resolve(true)
      await gate.finished.promise
      expect(committed).toEqual([])
      expect(service.getBufferSnapshot()).toMatchObject({ pending: 0, inflight: 0 })
      expect(gate.ownership).toEqual(['acquire:fresh-lease', 'release:fresh-lease'])
    } finally {
      preparation.resolve(false)
      service.dispose()
      gate.release.resolve()
    }
  })

  it('releases a not-ready resume lease and rearms outside it before a new lease commits', async () => {
    const gate = resumeGate()
    const visible: Array<{ id: number; lease: string | undefined }> = []
    let readinessAttempts = 0
    const { service, persistEntries } = createService({
      pending: new Map([[1, { ...createResult(1), mutationLeaseId: 'old-lease' }]]),
      inflight: new Map(),
      resumeDeferredFlush: gate.resume,
      ensureSearchIndexWorkerReady: async () => ++readinessAttempts !== 2,
      config: { backlogDelayMs: 1_000 },
      publishRecords: async (entries) => {
        visible.push(
          ...entries.map((entry) => ({ id: entry.fileId, lease: entry.mutationLeaseId }))
        )
        return entries.length
      }
    })
    try {
      beginForegroundSearchActivity(session)
      await indexMaintenanceContext.run(true, () => service.flush())
      makeIdle()
      gate.release.resolve()
      await gate.finished.promise
      expect(gate.ownership).toEqual(['acquire:fresh-lease', 'release:fresh-lease'])
      expect(visible).toEqual([])
      expect(service.getBufferSnapshot()).toMatchObject({ pending: 0, inflight: 1 })
      await vi.advanceTimersByTimeAsync(999)
      expect(visible).toEqual([])
      expect(gate.ownership).toEqual(['acquire:fresh-lease', 'release:fresh-lease'])
      await vi.advanceTimersByTimeAsync(1)
      expect(await service.waitForPersisted()).toBe(true)
      expect(visible).toEqual([{ id: 1, lease: 'fresh-lease-2' }])
      expect(persistEntries).toHaveBeenCalledTimes(1)
      expect(gate.ownership).toEqual([
        'acquire:fresh-lease',
        'release:fresh-lease',
        'acquire:fresh-lease-2',
        'release:fresh-lease-2'
      ])
    } finally {
      service.dispose()
      gate.release.resolve()
    }
  })

  it('still reports real SQL errors and retries them only after releasing the resumed source lease', async () => {
    const client = createClient({ url: ':memory:' })
    const gate = resumeGate()
    const visible: number[] = []
    const { service, logWarn } = createService({
      pending: new Map([[1, { ...createResult(1), mutationLeaseId: 'old-lease' }]]),
      inflight: new Map(),
      ensureSearchIndexWorkerReady: async () => true,
      resumeDeferredFlush: gate.resume,
      config: { baseDelayMs: 10_000 },
      persistEntries: async (entries) => {
        for (const entry of entries)
          await client.execute({
            sql: 'INSERT INTO progress VALUES (?, ?)',
            args: [entry.fileId, entry.progress.status]
          })
        return createPersistSummary(entries)
      },
      publishRecords: async (entries) => {
        visible.push(...entries.map((entry) => entry.fileId))
        return entries.length
      }
    })
    try {
      beginForegroundSearchActivity(session)
      await indexMaintenanceContext.run(true, () => service.flush())
      makeIdle()
      gate.release.resolve()
      await gate.finished.promise
      await vi.advanceTimersByTimeAsync(0)
      expect(gate.ownership).toEqual(['acquire:fresh-lease', 'release:fresh-lease'])
      expect(visible).toEqual([])
      expect(logWarn).toHaveBeenCalledWith(
        'Index worker flush failed, scheduling retry',
        expect.objectContaining({ code: 'SQLITE_ERROR' }),
        expect.objectContaining({ isBusy: false, pending: 1, inflight: 0 })
      )
      await client.execute(
        'CREATE TABLE progress (file_id INTEGER PRIMARY KEY, status TEXT NOT NULL)'
      )
      await vi.advanceTimersByTimeAsync(9_999)
      expect(visible).toEqual([])
      expect(gate.ownership).toEqual(['acquire:fresh-lease', 'release:fresh-lease'])
      await vi.advanceTimersByTimeAsync(1)
      expect(await service.waitForPersisted()).toBe(true)
      expect((await client.execute('SELECT file_id, status FROM progress')).rows).toEqual([
        { file_id: 1, status: 'completed' }
      ])
      expect(visible).toEqual([1])
      expect(gate.ownership).toEqual([
        'acquire:fresh-lease',
        'release:fresh-lease',
        'acquire:fresh-lease-2',
        'release:fresh-lease-2'
      ])
    } finally {
      service.dispose()
      gate.release.resolve()
      client.close()
    }
  })

  it('rejects a cancelled producer lease on an ordinary flush rather than treating it as a fresh handoff', async () => {
    const visible: number[] = []
    const { service, persistEntries } = createService({
      pending: new Map([[1, { ...createResult(1), mutationLeaseId: 'cancelled-lease' }]]),
      inflight: new Map(),
      ensureSearchIndexWorkerReady: async () => true,
      isMutationLeaseCancelled: (leaseId) => leaseId === 'cancelled-lease',
      publishRecords: async (entries) => {
        visible.push(...entries.map((entry) => entry.fileId))
        return entries.length
      }
    })
    try {
      await service.flush()
      expect(visible).toEqual([])
      expect(persistEntries).not.toHaveBeenCalled()
      expect(service.getBufferSnapshot()).toMatchObject({ pending: 0, inflight: 0 })
    } finally {
      service.dispose()
    }
  })

  it.each([
    { action: 'reset', stage: 'publication' },
    { action: 'reset', stage: 'embeddings' },
    { action: 'dispose', stage: 'publication' },
    { action: 'dispose', stage: 'embeddings' },
    { action: 'storage-pause', stage: 'publication' },
    { action: 'storage-pause', stage: 'embeddings' }
  ])(
    'does not complete or repeat an admitted $stage continuation after $action',
    async ({ action, stage }) => {
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      let admitted = true
      const durable: string[] = []
      const visible: number[] = []
      const embedded: number[] = []
      const hold = async () => {
        entered.resolve()
        await release.promise
      }
      const { service, logWarn } = createService({
        pending: new Map([[1, { ...createResult(1), mutationLeaseId: 'old-lease' }]]),
        inflight: new Map(),
        ensureSearchIndexWorkerReady: async () => true,
        checkContentCapacity: async () => admitted,
        isContentAdmissionEnabled: () => admitted,
        persistEntries: async (entries) => {
          durable.push(...entries.map((entry) => `${entry.fileId}:${entry.progress.status}`))
          return createPersistSummary(entries)
        },
        publishRecords: async (entries) => {
          visible.push(...entries.map((entry) => entry.fileId))
          if (stage === 'publication') await hold()
          return entries.length
        },
        indexEmbeddings: async (entries) => {
          embedded.push(...entries.map((entry) => entry.fileId))
          if (stage === 'embeddings') await hold()
        }
      })
      try {
        const flushing = service.flush()
        await entered.promise
        if (action === 'reset') service.cancelDeferredFlush()
        else if (action === 'dispose') service.dispose()
        else admitted = false
        release.resolve()
        await flushing
        await vi.advanceTimersByTimeAsync(30_000)
        expect(durable).toEqual(['1:pending'])
        expect(visible).toEqual([1])
        expect(embedded).toEqual(stage === 'embeddings' ? [1] : [])
        expect(service.getBufferSnapshot()).toMatchObject({ pending: 0, inflight: 0 })
        expect(logWarn).not.toHaveBeenCalled()
      } finally {
        release.resolve()
        service.dispose()
      }
    }
  )
})
