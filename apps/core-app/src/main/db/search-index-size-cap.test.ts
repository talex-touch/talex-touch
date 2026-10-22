import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applySearchIndexSizeCap,
  deleteSearchIndexOverCap,
  hasSearchIndexRoomForNewData,
  isSearchIndexReserveReachedError,
  measureSearchIndexFileBytes,
  resolveSearchIndexMaxBytes,
  resolveSearchIndexReservePages,
  SEARCH_INDEX_MAX_BYTES,
  searchIndexReserveReachedError
} from './search-index-size-cap'
import { isSqliteStorageFullError } from './sqlite-retry'

const GiB = 1024 ** 3

let directory = ''
let client: Client | null = null

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'search-index-size-cap-'))
})

afterEach(async () => {
  client?.close()
  client = null
  await rm(directory, { recursive: true, force: true })
})

async function scalar(target: Client, sql: string): Promise<number> {
  const result = await target.execute(sql)
  return Number(Object.values(result.rows[0] as Record<string, unknown>)[0])
}

describe('search index size cap', () => {
  it('is 8 GiB, or 2% of the volume when that is less', () => {
    expect(resolveSearchIndexMaxBytes(1024 * GiB)).toBe(8 * GiB)
    expect(resolveSearchIndexMaxBytes(926 * GiB)).toBe(8 * GiB)
    expect(resolveSearchIndexMaxBytes(256 * GiB)).toBe(Math.floor(256 * GiB * 0.02))
    expect(resolveSearchIndexMaxBytes(null)).toBe(SEARCH_INDEX_MAX_BYTES)
    expect(resolveSearchIndexMaxBytes(Number.NaN)).toBe(SEARCH_INDEX_MAX_BYTES)
  })

  it('measures the database file together with its WAL', async () => {
    const dbPath = join(directory, 'search-index.db')
    expect(await measureSearchIndexFileBytes(dbPath)).toBe(0)
    await writeFile(dbPath, Buffer.alloc(3_000))
    await writeFile(`${dbPath}-wal`, Buffer.alloc(500))
    await writeFile(`${dbPath}-shm`, Buffer.alloc(32_768))
    expect(await measureSearchIndexFileBytes(dbPath)).toBe(3_500)
  })

  it('deletes an index whose database file is past the cap, with its sidecars', async () => {
    const dbPath = join(directory, 'search-index.db')
    const sidecars = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]
    await writeFile(dbPath, Buffer.alloc(4_000))
    await writeFile(`${dbPath}-wal`, Buffer.alloc(1_000))
    await writeFile(`${dbPath}-shm`, Buffer.alloc(100))

    // A full index sits at the cap; the WAL a crash leaves beside it must not tip it over.
    expect(await deleteSearchIndexOverCap(dbPath, 4_000)).toBeNull()
    expect(sidecars.every((target) => existsSync(target))).toBe(true)

    expect(await deleteSearchIndexOverCap(dbPath, 3_999)).toBe(4_000)
    expect(sidecars.some((target) => existsSync(target))).toBe(false)
    expect(await deleteSearchIndexOverCap(dbPath, 1)).toBeNull()
  })

  it('makes SQLite refuse the page past the cap while deletions keep reusing freed pages', async () => {
    const dbPath = join(directory, 'capped.db')
    client = createClient({ url: `file:${dbPath}` })
    await client.execute('PRAGMA journal_mode = WAL')
    await client.execute('CREATE TABLE rows (id INTEGER PRIMARY KEY, body TEXT)')
    const pageSize = await scalar(client, 'PRAGMA page_size')
    const maxPages = await applySearchIndexSizeCap(client, 64 * pageSize)
    expect(maxPages).toBe(64)

    let refused: unknown = null
    for (let index = 0; index < 400 && refused === null; index += 1) {
      try {
        await client.execute({
          sql: 'INSERT INTO rows (body) VALUES (?)',
          args: ['x'.repeat(1_000)]
        })
      } catch (error) {
        refused = error
      }
    }
    expect(isSqliteStorageFullError(refused)).toBe(true)
    expect(await scalar(client, 'PRAGMA page_count')).toBeLessThanOrEqual(64)
    // Full and with its WAL beside it, as a crash leaves it: a launch must keep it.
    expect(existsSync(`${dbPath}-wal`)).toBe(true)
    expect(await deleteSearchIndexOverCap(dbPath, 64 * pageSize)).toBeNull()

    await client.execute('DELETE FROM rows WHERE id % 2 = 0')
    await client.execute({ sql: 'INSERT INTO rows (body) VALUES (?)', args: ['y'.repeat(1_000)] })
    expect(await scalar(client, 'PRAGMA page_count')).toBeLessThanOrEqual(64)
  })

  it('cannot shrink a file already past the cap, only stop it growing', async () => {
    client = createClient({ url: `file:${join(directory, 'oversized.db')}` })
    await client.execute('CREATE TABLE rows (id INTEGER PRIMARY KEY, body TEXT)')
    for (let index = 0; index < 50; index += 1) {
      await client.execute({ sql: 'INSERT INTO rows (body) VALUES (?)', args: ['z'.repeat(2_000)] })
    }
    const pages = await scalar(client, 'PRAGMA page_count')
    const pageSize = await scalar(client, 'PRAGMA page_size')

    expect(await applySearchIndexSizeCap(client, 4 * pageSize)).toBe(pages)
    await expect(
      client.execute({ sql: 'INSERT INTO rows (body) VALUES (?)', args: ['z'.repeat(8_000)] })
    ).rejects.toSatisfy(isSqliteStorageFullError)
  })

  it('keeps 2% of the cap for deletions, from 256 to 16,384 pages and at most a quarter of it', () => {
    // 8 GiB, 1.28 GB (2% of a 64 GB volume) and 8 MB of 4 KiB pages.
    expect(resolveSearchIndexReservePages(2_097_152)).toBe(16_384)
    expect(resolveSearchIndexReservePages(312_500)).toBe(6_250)
    expect(resolveSearchIndexReservePages(2_000)).toBe(256)
    expect(resolveSearchIndexReservePages(100)).toBe(25)
  })

  it('has room for new data until the free pages under the cap shrink to the reserve', async () => {
    client = createClient({ url: `file:${join(directory, 'reserve.db')}` })
    await client.execute('CREATE TABLE rows (id INTEGER PRIMARY KEY, body TEXT)')
    const db = drizzle(client)
    // Without a cap, as the legacy layout's main database has.
    expect(await hasSearchIndexRoomForNewData(db)).toBe(true)

    const pageSize = await scalar(client, 'PRAGMA page_size')
    await applySearchIndexSizeCap(client, 1_000 * pageSize)
    const live = async () =>
      (await scalar(client!, 'PRAGMA page_count')) -
      (await scalar(client!, 'PRAGMA freelist_count'))
    // The reserve of a 1,000-page cap is a quarter of it: 250 pages.
    const answers: boolean[] = []
    for (;;) {
      const room = await hasSearchIndexRoomForNewData(db)
      expect(room).toBe(1_000 - (await live()) > 250)
      if (answers.at(-1) !== room) answers.push(room)
      if (!room) break
      await client.execute({ sql: 'INSERT INTO rows (body) VALUES (?)', args: ['r'.repeat(3_000)] })
    }
    expect(answers).toEqual([true, false])
    expect(isSqliteStorageFullError(searchIndexReserveReachedError())).toBe(true)
  })

  it('tells the refusal from a full disk, through whatever wraps it', () => {
    const refusal = searchIndexReserveReachedError()
    // Across the writer worker only the message survives.
    for (const wrapped of [
      refusal,
      new Error(refusal.message),
      new Error('scan stopped', { cause: new Error('batch failed', { cause: refusal }) }),
      new AggregateError([new Error('other'), refusal]),
      { original: refusal },
      { error: { message: refusal.message } },
      refusal.message
    ]) {
      expect(isSearchIndexReserveReachedError(wrapped)).toBe(true)
    }

    const diskFull = Object.assign(new Error('SQLITE_FULL: database or disk is full'), {
      code: 'SQLITE_FULL'
    })
    const loop: { message: string; cause?: unknown } = { message: 'SQLITE_BUSY' }
    loop.cause = loop
    for (const other of [diskFull, new Error('scan stopped', { cause: diskFull }), loop, null]) {
      expect(isSearchIndexReserveReachedError(other)).toBe(false)
    }
  })
})
