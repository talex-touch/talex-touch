import type { Client } from '@libsql/client'
import type { SQL } from 'drizzle-orm'
import { rm, stat, statfs } from 'node:fs/promises'
import { sql } from 'drizzle-orm'

/**
 * How large `search-index.db` may grow: 8 GiB, or 2% of the volume it lives on when that is less
 * (user decision, 2026-10-20). Nothing bounded it before. One machine reached 47.2 GB with 3.8 GB
 * of its disk left, and clearing the index there did not help, because the pages that a deletion
 * frees stay in the file.
 *
 * Every connection that writes the file sets `PRAGMA max_page_count` from this, so SQLite itself
 * refuses the page that would cross the cap: new files stop being indexed, while updates and
 * deletions keep reusing freed pages. The pragma cannot shrink a file that is already past the
 * cap, so such a file is deleted before anything opens it and rebuilt; it holds only derived data.
 */
export const SEARCH_INDEX_MAX_BYTES = 8 * 1024 ** 3
export const SEARCH_INDEX_MAX_VOLUME_SHARE = 0.02

/** An unreadable volume size falls back to the fixed cap. */
export function resolveSearchIndexMaxBytes(volumeBytes: number | null): number {
  if (volumeBytes === null || !Number.isFinite(volumeBytes) || volumeBytes <= 0) {
    return SEARCH_INDEX_MAX_BYTES
  }
  return Math.min(SEARCH_INDEX_MAX_BYTES, Math.floor(volumeBytes * SEARCH_INDEX_MAX_VOLUME_SHARE))
}

export async function readSearchIndexMaxBytes(directory: string): Promise<number> {
  try {
    const volume = await statfs(directory)
    return resolveSearchIndexMaxBytes(Number(volume.blocks) * Number(volume.bsize))
  } catch {
    return resolveSearchIndexMaxBytes(null)
  }
}

/** What the index occupies on disk: the database file plus its WAL. */
export async function measureSearchIndexFileBytes(dbPath: string): Promise<number> {
  let total = 0
  for (const target of [dbPath, `${dbPath}-wal`]) {
    try {
      total += (await stat(target)).size
    } catch {
      // absent
    }
  }
  return total
}

/**
 * Deletes the index and its sidecar files when the database file exceeds `maxBytes`. Call it
 * before anything opens the file. Returns the size it found, or `null` when the index was within
 * the cap.
 *
 * Only the database file counts. A full index sits exactly at the cap, and a crash or a forced
 * quit leaves its WAL beside it; counting that WAL would delete a full index at the next launch.
 */
export async function deleteSearchIndexOverCap(
  dbPath: string,
  maxBytes: number
): Promise<number | null> {
  let fileBytes: number
  try {
    fileBytes = (await stat(dbPath)).size
  } catch {
    return null
  }
  if (fileBytes <= maxBytes) return null
  await deleteSearchIndexFiles(dbPath)
  return fileBytes
}

/** Deletes the index file and its sidecars. */
export async function deleteSearchIndexFiles(dbPath: string): Promise<void> {
  for (const target of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
    await rm(target, { force: true })
  }
}

export function resolveSearchIndexMaxPageCount(maxBytes: number, pageSize: number): number {
  return Math.max(1, Math.floor(maxBytes / Math.max(1, pageSize)))
}

/**
 * Sets the cap on one connection; SQLite keeps `max_page_count` per connection, not in the file.
 * Returns the page count it set, which SQLite raises to the current size when the file is larger.
 */
export async function applySearchIndexSizeCap(
  client: Pick<Client, 'execute'>,
  maxBytes: number
): Promise<number> {
  const pageSizeResult = await client.execute('PRAGMA page_size')
  const pageSize = Number(
    (pageSizeResult.rows?.[0] as Record<string, unknown> | undefined)?.page_size ?? 4096
  )
  const maxPages = resolveSearchIndexMaxPageCount(maxBytes, pageSize)
  const capResult = await client.execute(`PRAGMA max_page_count = ${maxPages}`)
  return Number(
    (capResult.rows?.[0] as Record<string, unknown> | undefined)?.max_page_count ?? maxPages
  )
}

const SEARCH_INDEX_RESERVE_SHARE = 0.02
const SEARCH_INDEX_RESERVE_MIN_PAGES = 256
const SEARCH_INDEX_RESERVE_MAX_PAGES = 16_384
/** SQLite's own limit, when a connection sets none, is at least this. */
const UNCAPPED_MAX_PAGE_COUNT = 1_073_741_823

/**
 * Pages that new data leaves free for deletions and updates: 2% of the cap, from 256 to 16,384
 * pages (1 to 64 MiB of 4 KiB pages), and at most a quarter of it.
 *
 * At the cap a deletion needs pages of its own. The rows of files that lie far apart share their
 * pages with rows that stay, so deleting them frees no whole page, while FTS5 writes a delete marker
 * for every document it removes. Measured with real libSQL on 2026-10-21: with no free page left,
 * batches of 64 scattered deletions failed, and they needed 32 free pages in an index of 4,000 files
 * and 64 in one of 20,000. Without this reserve, a file deleted from disk stayed in a full index.
 */
export function resolveSearchIndexReservePages(maxPages: number): number {
  const share = Math.round(maxPages * SEARCH_INDEX_RESERVE_SHARE)
  const bounded = Math.min(
    SEARCH_INDEX_RESERVE_MAX_PAGES,
    Math.max(SEARCH_INDEX_RESERVE_MIN_PAGES, share)
  )
  return Math.min(bounded, Math.floor(maxPages / 4))
}

export const SEARCH_INDEX_RESERVE_REACHED = 'SEARCH_INDEX_RESERVE_REACHED'

interface SqlRowsReader {
  all<T = unknown>(query: SQL): Promise<T[]>
}

/**
 * Whether the connection may add data: its live pages stay below the cap less the reserve. Run it
 * inside the write transaction, which counts the pages that transaction has already taken. A
 * connection without a cap always may; the legacy layout keeps the index in the main database.
 */
export async function hasSearchIndexRoomForNewData(tx: SqlRowsReader): Promise<boolean> {
  const rows = await tx.all<{ live: number; max: number }>(sql`SELECT
    (SELECT page_count FROM pragma_page_count()) -
      (SELECT freelist_count FROM pragma_freelist_count()) AS live,
    (SELECT max_page_count FROM pragma_max_page_count()) AS max`)
  const live = Number(rows[0]?.live)
  const max = Number(rows[0]?.max)
  if (!Number.isFinite(live) || !Number.isFinite(max) || max >= UNCAPPED_MAX_PAGE_COUNT) return true
  return max - live > resolveSearchIndexReservePages(max)
}

/**
 * Refuses data that would take the reserve. It reads as `SQLITE_FULL`, so every caller treats it as
 * the full index it stands for: a scan stops with `FILE_INDEX_STORAGE_FULL`, content waits.
 */
export function searchIndexReserveReachedError(): Error {
  return Object.assign(new Error(`SQLITE_FULL: ${SEARCH_INDEX_RESERVE_REACHED}`), {
    code: 'SQLITE_FULL'
  })
}

/**
 * Whether an error, or anything it wraps, is that refusal. Unlike `isSqliteStorageFullError` it
 * tells the cap from a full disk; the message is what survives the worker boundary.
 */
export function isSearchIndexReserveReachedError(error: unknown): boolean {
  const visited = new Set<unknown>()
  const pending: unknown[] = [error]
  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current === 'string') {
      if (current.includes(SEARCH_INDEX_RESERVE_REACHED)) return true
      continue
    }
    if (!current || typeof current !== 'object' || visited.has(current)) continue
    visited.add(current)
    if ('message' in current && typeof current.message === 'string') pending.push(current.message)
    if (current instanceof AggregateError) pending.push(...current.errors)
    if ('cause' in current) pending.push(current.cause)
    if ('original' in current) pending.push(current.original)
    if ('error' in current) pending.push(current.error)
  }
  return false
}
