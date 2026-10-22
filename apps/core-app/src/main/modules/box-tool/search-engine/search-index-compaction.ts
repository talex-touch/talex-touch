/**
 * Whether reclaiming the search index file's free pages is worth running right now, and how.
 *
 * Pages freed by deletes (a cleanup, an eviction, the content-index switch, a keyword rule change)
 * stay in the file as free pages. A file in `auto_vacuum = INCREMENTAL` (every file created since
 * 2026-10-21, and every older file after its first full VACUUM) hands them back in place with a
 * bounded `PRAGMA incremental_vacuum(n)`, which moves at most `n` pages through the WAL and needs
 * no headroom. An older file in `auto_vacuum = NONE` only shrinks through a full VACUUM, which
 * also switches it to incremental. VACUUM copies the live pages to a temp file and back through
 * the WAL, so it needs about twice the live data free on the disk, plus a margin so it never fills
 * the disk, and is only worth its minutes of I/O when the freelist is a real share of the file.
 */
export const SEARCH_INDEX_COMPACTION_MIN_FREE_BYTES = 256 * 1024 * 1024
export const SEARCH_INDEX_COMPACTION_MIN_FREE_RATIO = 0.1
export const SEARCH_INDEX_COMPACTION_DISK_MARGIN_BYTES = 1024 * 1024 * 1024
export const SEARCH_INDEX_INCREMENTAL_MIN_FREE_BYTES = 32 * 1024 * 1024
export const SEARCH_INDEX_INCREMENTAL_STEP_BYTES = 64 * 1024 * 1024

/** `PRAGMA auto_vacuum` values. */
export const SQLITE_AUTO_VACUUM_INCREMENTAL = 2

export interface SearchIndexCompactionInput {
  fileBytes: number
  freelistBytes: number
  /** `null` when the free space could not be read; a full VACUUM then stays off. */
  freeDiskBytes: number | null
  /** `PRAGMA auto_vacuum`: 0 none, 1 full, 2 incremental. */
  autoVacuum: number
}

export type SearchIndexCompactionDecision =
  | { run: true; mode: 'incremental' | 'vacuum' }
  | { run: false; reason: 'nothing-to-reclaim' | 'insufficient-disk' | 'disk-unknown' }

export function resolveSearchIndexCompactionDecision(
  input: SearchIndexCompactionInput
): SearchIndexCompactionDecision {
  const fileBytes = Math.max(0, input.fileBytes)
  const freelistBytes = Math.max(0, input.freelistBytes)
  if (input.autoVacuum === SQLITE_AUTO_VACUUM_INCREMENTAL) {
    return freelistBytes >= SEARCH_INDEX_INCREMENTAL_MIN_FREE_BYTES
      ? { run: true, mode: 'incremental' }
      : { run: false, reason: 'nothing-to-reclaim' }
  }
  if (
    freelistBytes < SEARCH_INDEX_COMPACTION_MIN_FREE_BYTES ||
    freelistBytes < fileBytes * SEARCH_INDEX_COMPACTION_MIN_FREE_RATIO
  ) {
    return { run: false, reason: 'nothing-to-reclaim' }
  }
  if (input.freeDiskBytes === null || !Number.isFinite(input.freeDiskBytes)) {
    return { run: false, reason: 'disk-unknown' }
  }
  const liveBytes = Math.max(0, fileBytes - freelistBytes)
  if (input.freeDiskBytes < 2 * liveBytes + SEARCH_INDEX_COMPACTION_DISK_MARGIN_BYTES) {
    return { run: false, reason: 'insufficient-disk' }
  }
  return { run: true, mode: 'vacuum' }
}

/** How many pages one incremental step hands back. */
export function resolveIncrementalVacuumPages(freelistPages: number, pageSize: number): number {
  const stepPages = Math.floor(SEARCH_INDEX_INCREMENTAL_STEP_BYTES / Math.max(1, pageSize))
  return Math.max(1, Math.min(Math.max(0, freelistPages), stepPages))
}
