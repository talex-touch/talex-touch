import type { FileIndexStats } from '@talex-touch/utils/transport/events/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => `/tmp/tuff-file-provider-index-stats-${name}`),
    getVersion: vi.fn(() => '0.0.0-test'),
    getAppPath: vi.fn(() => '/tmp/tuff-file-provider-index-stats-app'),
    isPackaged: false
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    getFocusedWindow: vi.fn(() => null)
  },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
    removeHandler: vi.fn()
  },
  shell: {
    openPath: vi.fn()
  }
}))

vi.mock('@sentry/electron/main', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
  setUser: vi.fn(),
  flush: vi.fn(async () => true)
}))

vi.mock('@talex-touch/utils/common/logger', () => ({
  loggerManager: {
    getLogger: vi.fn(() => ({
      setEnabled: vi.fn()
    }))
  },
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn()
  }))
}))

vi.mock('@talex-touch/utils/transport/main', () => ({
  getTuffTransportMain: vi.fn(() => ({
    on: vi.fn(),
    broadcast: vi.fn()
  }))
}))

vi.mock('./embedding-service', () => ({
  EmbeddingService: vi.fn(() => ({
    semanticSearch: vi.fn(async () => [])
  }))
}))

import { fileProvider } from './file-provider'

/**
 * `computeIndexStats()` is one read-worker round trip that answers six `COUNT(*)`s. Every
 * file-system watch event asks for diagnostics, so the interesting contract is how MANY of those
 * rounds a burst of callers costs.
 */
function countFor(round: number, index: number): number {
  return round * 100 + index + 1
}

/** The exact stats read number `round` is answered with. */
function expectedStatsForRound(round: number): FileIndexStats {
  return {
    totalFiles: countFor(round, 0),
    failedFiles: countFor(round, 1),
    skippedFiles: countFor(round, 2),
    completedFiles: countFor(round, 3),
    embeddingCompletedFiles: countFor(round, 4),
    embeddingRows: countFor(round, 5)
  }
}

interface IndexStatsReadRecorder {
  searchIndex: unknown
  readsIssued: () => number
}

/**
 * Stand-in for the search index's read worker. Every `readFileIndexStats()` is one round, answered
 * with round-specific numbers so a served snapshot is traceable to its round.
 */
function createIndexStatsReadRecorder(): IndexStatsReadRecorder {
  let reads = 0
  return {
    searchIndex: {
      readFileIndexStats: async () => expectedStatsForRound(reads++)
    },
    readsIssued: () => reads
  }
}

interface FileProviderIndexStatsTestApi {
  searchIndex: unknown
  indexStatsCache: { at: number; value: FileIndexStats } | null
  inflightIndexStats: Promise<FileIndexStats> | null
  getIndexStats: () => Promise<FileIndexStats>
}

const provider = fileProvider as unknown as FileProviderIndexStatsTestApi

describe('file provider index stats snapshot cache', () => {
  let recorder: IndexStatsReadRecorder

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-10T00:00:00.000Z'))
    recorder = createIndexStatsReadRecorder()
    provider.searchIndex = recorder.searchIndex
    provider.indexStatsCache = null
    provider.inflightIndexStats = null
  })

  afterEach(() => {
    provider.searchIndex = null
    provider.indexStatsCache = null
    provider.inflightIndexStats = null
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('answers three sequential callers from one query round inside the cache window', async () => {
    const first = await provider.getIndexStats()
    const second = await provider.getIndexStats()
    const third = await provider.getIndexStats()

    expect(recorder.readsIssued()).toBe(1)
    expect([first, second, third]).toEqual([
      expectedStatsForRound(0),
      expectedStatsForRound(0),
      expectedStatsForRound(0)
    ])
  })

  it('reuses the snapshot just inside the cache window and re-queries just past it', async () => {
    // Primes the cache; the value itself is asserted through `reused` below.
    await provider.getIndexStats()

    vi.advanceTimersByTime(999)
    const reused = await provider.getIndexStats()

    expect(reused).toEqual(expectedStatsForRound(0))
    expect(recorder.readsIssued()).toBe(1)

    vi.advanceTimersByTime(2)
    const refreshed = await provider.getIndexStats()

    expect(refreshed).toEqual(expectedStatsForRound(1))
    expect(recorder.readsIssued()).toBe(2)
  })

  it('shares one query round between overlapping callers', async () => {
    const [first, second, third] = await Promise.all([
      provider.getIndexStats(),
      provider.getIndexStats(),
      provider.getIndexStats()
    ])

    expect(recorder.readsIssued()).toBe(1)
    expect([first, second, third]).toEqual([
      expectedStatsForRound(0),
      expectedStatsForRound(0),
      expectedStatsForRound(0)
    ])
  })

  it('hands each caller a private copy of the snapshot', async () => {
    const served = await provider.getIndexStats()
    served.totalFiles = 9_999

    // Cache-hit path: the mutation above must not reach the next caller.
    const fromCache = await provider.getIndexStats()
    expect(fromCache).toEqual(expectedStatsForRound(0))

    // Shared in-flight path: two overlapping callers hold the same numbers, not the same object.
    vi.advanceTimersByTime(1_001)
    const [fromQueryA, fromQueryB] = await Promise.all([
      provider.getIndexStats(),
      provider.getIndexStats()
    ])
    fromQueryA.totalFiles = 8_888

    expect(fromQueryB).toEqual(expectedStatsForRound(1))
    // The mutation must not poison the snapshot later callers are served from.
    await expect(provider.getIndexStats()).resolves.toEqual(expectedStatsForRound(1))
  })
})
