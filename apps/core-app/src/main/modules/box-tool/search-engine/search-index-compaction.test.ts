import { describe, expect, it } from 'vitest'
import {
  SEARCH_INDEX_COMPACTION_DISK_MARGIN_BYTES,
  SEARCH_INDEX_COMPACTION_MIN_FREE_BYTES,
  SEARCH_INDEX_INCREMENTAL_MIN_FREE_BYTES,
  SEARCH_INDEX_INCREMENTAL_STEP_BYTES,
  resolveIncrementalVacuumPages,
  resolveSearchIndexCompactionDecision
} from './search-index-compaction'

const GB = 1024 * 1024 * 1024
const NONE = 0
const INCREMENTAL = 2

describe('resolveSearchIndexCompactionDecision', () => {
  it('runs a full VACUUM when the freelist is a real share of the file and the disk has headroom', () => {
    expect(
      resolveSearchIndexCompactionDecision({
        fileBytes: 5 * GB,
        freelistBytes: 0.85 * GB,
        freeDiskBytes: 30 * GB,
        autoVacuum: NONE
      })
    ).toEqual({ run: true, mode: 'vacuum' })
  })

  it('skips a file with little to reclaim, in bytes or as a ratio', () => {
    expect(
      resolveSearchIndexCompactionDecision({
        fileBytes: 5 * GB,
        freelistBytes: SEARCH_INDEX_COMPACTION_MIN_FREE_BYTES - 1,
        freeDiskBytes: 30 * GB,
        autoVacuum: NONE
      })
    ).toEqual({ run: false, reason: 'nothing-to-reclaim' })
    expect(
      resolveSearchIndexCompactionDecision({
        fileBytes: 50 * GB,
        freelistBytes: 1 * GB,
        freeDiskBytes: 500 * GB,
        autoVacuum: NONE
      })
    ).toEqual({ run: false, reason: 'nothing-to-reclaim' })
  })

  it('needs twice the live data plus a margin free for the temp copy and the WAL', () => {
    // 47 GB with 42 GB free pages: 5 GB live, so 11 GB of disk is enough where the whole file
    // size would have asked for 118 GB.
    const input = { fileBytes: 47 * GB, freelistBytes: 42 * GB, autoVacuum: NONE }
    const needed = 2 * 5 * GB + SEARCH_INDEX_COMPACTION_DISK_MARGIN_BYTES
    expect(resolveSearchIndexCompactionDecision({ ...input, freeDiskBytes: needed })).toEqual({
      run: true,
      mode: 'vacuum'
    })
    expect(resolveSearchIndexCompactionDecision({ ...input, freeDiskBytes: needed - 1 })).toEqual({
      run: false,
      reason: 'insufficient-disk'
    })
    expect(resolveSearchIndexCompactionDecision({ ...input, freeDiskBytes: null })).toEqual({
      run: false,
      reason: 'disk-unknown'
    })
  })

  it('takes an incremental step on an incremental file without needing disk headroom', () => {
    expect(
      resolveSearchIndexCompactionDecision({
        fileBytes: 5 * GB,
        freelistBytes: SEARCH_INDEX_INCREMENTAL_MIN_FREE_BYTES,
        freeDiskBytes: null,
        autoVacuum: INCREMENTAL
      })
    ).toEqual({ run: true, mode: 'incremental' })
    expect(
      resolveSearchIndexCompactionDecision({
        fileBytes: 5 * GB,
        freelistBytes: SEARCH_INDEX_INCREMENTAL_MIN_FREE_BYTES - 1,
        freeDiskBytes: 30 * GB,
        autoVacuum: INCREMENTAL
      })
    ).toEqual({ run: false, reason: 'nothing-to-reclaim' })
  })
})

describe('resolveIncrementalVacuumPages', () => {
  it('hands back at most one step of pages, and never zero', () => {
    const pageSize = 4096
    const stepPages = SEARCH_INDEX_INCREMENTAL_STEP_BYTES / pageSize
    expect(resolveIncrementalVacuumPages(10 * stepPages, pageSize)).toBe(stepPages)
    expect(resolveIncrementalVacuumPages(100, pageSize)).toBe(100)
    expect(resolveIncrementalVacuumPages(0, pageSize)).toBe(1)
  })
})
