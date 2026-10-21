import type { Client } from '@libsql/client'
import { rm, stat, statfs } from 'node:fs/promises'

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
