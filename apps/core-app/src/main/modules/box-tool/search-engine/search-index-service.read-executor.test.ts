import { createClient, type Client, type Value } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import type { SQL } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileExtensions, files } from '../../../db/schema'
import { SearchIndexService, type SearchIndexReadExecutor } from './search-index-service'

const PROVIDER = 'read-worker-parity'
const dialect = new SQLiteSyncDialect()

interface CompiledRead {
  sql: string
  params: Value[]
}

async function withIsolatedIndex(
  run: (services: {
    direct: SearchIndexService
    reader: SearchIndexService
    readerClient: Client
    /** Compiled SQL of every read the reader sent through its executor, in order. */
    reads: CompiledRead[]
  }) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'tuff-search-read-parity-'))
  let writerClient: Client | undefined
  let readerClient: Client | undefined
  try {
    const databasePath = join(directory, 'search-index.sqlite')
    writerClient = createClient({ url: `file:${databasePath}` })
    await writerClient.execute(`
      CREATE TABLE keyword_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword TEXT NOT NULL,
        item_id TEXT NOT NULL,
        provider_id TEXT NOT NULL DEFAULT '',
        priority REAL NOT NULL DEFAULT 1.0
      )
    `)
    await writerClient.execute(`
      CREATE TABLE search_index_meta (
        provider_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        keyword_hash TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (provider_id, item_id)
      )
    `)
    await writerClient.execute(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        display_name TEXT,
        extension TEXT,
        size INTEGER,
        mtime INTEGER NOT NULL,
        ctime INTEGER NOT NULL,
        last_indexed_at INTEGER NOT NULL DEFAULT 0,
        is_dir INTEGER NOT NULL DEFAULT 0,
        type TEXT NOT NULL DEFAULT 'file',
        content TEXT,
        embedding_status TEXT NOT NULL DEFAULT 'none'
      )
    `)
    await writerClient.execute(`
      CREATE TABLE IF NOT EXISTS file_extensions (
        file_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (file_id, key)
      )
    `)
    await writerClient.execute({
      sql: `INSERT INTO files (id, path, name, display_name, extension, size, mtime, ctime, last_indexed_at, is_dir, type, content, embedding_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        1,
        '/tmp/test.txt',
        'test.txt',
        'Test Doc',
        '.txt',
        1234,
        // mtime, ctime, last_indexed_at: whole seconds, as drizzle's `mode: 'timestamp'` stores
        // them. These were once milliseconds, which made a hydration that skipped the * 1000 look
        // right here while it dated every real row January 1970.
        1700000000,
        1690000000,
        1710000000,
        0,
        'file',
        'content',
        'completed'
      ]
    })
    await writerClient.execute({
      sql: `INSERT INTO file_extensions (file_id, key, value) VALUES (?, ?, ?)`,
      args: [1, 'customKey', 'customValue']
    })

    const direct = new SearchIndexService(drizzle(writerClient) as never, {
      directMode: true,
      initializationMode: 'writer'
    })
    await direct.warmup()
    await writerClient.execute({
      sql: `INSERT INTO search_index (
        item_id, provider, type, title, title_compact, keywords, tags, path, content
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        'item:cafe',
        PROVIDER,
        'app',
        'Café 測試',
        'cafetest',
        'café unicode 測試',
        '',
        '/tmp/café',
        ''
      ]
    })
    await writerClient.execute({
      sql: `INSERT INTO search_index (
        item_id, provider, type, title, title_compact, keywords, tags, path, content
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        'item:network',
        PROVIDER,
        'app',
        'Netease Network',
        'neteasenetwork',
        'netease chrome',
        '',
        '/tmp/network',
        ''
      ]
    })
    const docIds: Record<string, number> = { 'item:cafe': 1, 'item:network': 2 }
    for (const [itemId, docId] of Object.entries(docIds)) {
      await writerClient.execute({
        sql: "INSERT INTO search_index_meta (provider_id, item_id, keyword_hash, doc_id) VALUES (?, ?, 'seed', ?)",
        args: [PROVIDER, itemId, docId]
      })
    }
    for (const [keyword, itemId, priority] of [
      ['café', 'item:cafe', 1.4],
      ['測試', 'item:cafe', 1.2],
      ['100% literal', 'item:cafe', 1.1],
      ['netease', 'item:network', 1.3],
      ['chrome', 'item:network', 1.0],
      ['ng:ch', 'item:network', 1.1],
      ['ng:hr', 'item:network', 1.1],
      ['ng:ro', 'item:network', 1.1],
      ['ng:om', 'item:network', 1.1],
      ['ng:me', 'item:network', 1.1]
    ] as const) {
      await writerClient.execute({
        sql: 'INSERT INTO search_keyword_postings (provider_id, keyword, doc_id, priority) VALUES (?, ?, ?, ?)',
        args: [PROVIDER, keyword, docIds[itemId], priority]
      })
    }
    // A crowded neighbour sharing two of the same ngram keywords: only the provider predicate
    // keeps these out of a lookup, and the index has to stay selective over them.
    await writerClient.execute(`
      INSERT INTO search_index_meta (provider_id, item_id, keyword_hash, doc_id)
      WITH RECURSIVE noise(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM noise WHERE n < 200)
      SELECT 'noise-provider', 'noise:item:' || n, 'seed', 1000 + n FROM noise
    `)
    await writerClient.execute(`
      INSERT INTO search_keyword_postings (provider_id, keyword, doc_id, priority)
      WITH RECURSIVE noise(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM noise WHERE n < 200)
      SELECT 'noise-provider', CASE n % 2 WHEN 0 THEN 'ng:ch' ELSE 'ng:me' END, 1000 + n, 1.0
      FROM noise
    `)

    readerClient = createClient({ url: `file:${databasePath}` })
    const readerDb = drizzle(readerClient!)
    const reads: CompiledRead[] = []
    let forbidDirectReads = false
    const schemaReaderDb = {
      all: async <T>(query: SQL): Promise<T[]> => {
        if (forbidDirectReads) throw new Error('READER_BYPASSED_EXECUTOR')
        return await readerDb.all<T>(query)
      }
    }
    const executor: SearchIndexReadExecutor = {
      all: async <T>(query: SQL): Promise<T[]> => {
        const compiled = dialect.sqlToQuery(query)
        // Drizzle erases the bound-parameter types; libSQL takes them as values.
        const params = compiled.params as Value[]
        reads.push({ sql: compiled.sql, params })
        return await readerDb.all<T>(query)
      }
    }
    const reader = new SearchIndexService(schemaReaderDb as never, {
      initializationMode: 'reader',
      readiness: { waitUntilReady: async () => undefined },
      readExecutor: executor
    })
    await reader.warmup()
    forbidDirectReads = true
    reads.length = 0

    await run({ direct, reader, readerClient, reads })
  } finally {
    readerClient?.close()
    writerClient?.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function keywordEntries(
  entries: Map<string, Array<{ itemId: string; priority: number }>>
): Array<[string, Array<{ itemId: string; priority: number }>]> {
  return [...entries.entries()].sort(([left], [right]) => left.localeCompare(right))
}

describe('SearchIndexService read executor parity', () => {
  it('preserves FTS and keyword lookup results through the isolated reader connection', async () => {
    await withIsolatedIndex(async ({ direct, reader }) => {
      const [directFts, readerFts] = await Promise.all([
        direct.search(PROVIDER, 'café'),
        reader.search(PROVIDER, 'café')
      ])
      expect(readerFts).toEqual(directFts)
      expect(readerFts.map((row) => row.itemId)).toEqual(['item:cafe'])

      const [directExact, readerExact] = await Promise.all([
        direct.lookupByKeywords(PROVIDER, ['café', '測試']),
        reader.lookupByKeywords(PROVIDER, ['café', '測試'])
      ])
      expect(keywordEntries(readerExact)).toEqual(keywordEntries(directExact))
      expect(keywordEntries(readerExact)).toEqual([
        ['café', [{ itemId: 'item:cafe', priority: 1.4 }]],
        ['測試', [{ itemId: 'item:cafe', priority: 1.2 }]]
      ])

      const [directPrefix, readerPrefix] = await Promise.all([
        direct.lookupByKeywordPrefix(PROVIDER, '100%'),
        reader.lookupByKeywordPrefix(PROVIDER, '100%')
      ])
      expect(readerPrefix).toEqual(directPrefix)
      expect(readerPrefix).toEqual([
        { itemId: 'item:cafe', keyword: '100% literal', priority: 1.1 }
      ])

      const [directSubsequence, readerSubsequence] = await Promise.all([
        direct.lookupBySubsequence(PROVIDER, 'nte'),
        reader.lookupBySubsequence(PROVIDER, 'nte')
      ])
      expect(readerSubsequence).toEqual(directSubsequence)
      expect(readerSubsequence).toEqual([
        { itemId: 'item:network', keyword: 'netease', priority: 1.3 }
      ])

      const [directNgrams, readerNgrams, directCount, readerCount] = await Promise.all([
        direct.lookupByNgrams(PROVIDER, 'chrome'),
        reader.lookupByNgrams(PROVIDER, 'chrome'),
        direct.countByProvider(PROVIDER),
        reader.countByProvider(PROVIDER)
      ])
      expect(readerNgrams).toEqual(directNgrams)
      expect(readerNgrams).toEqual([{ itemId: 'item:network', overlapCount: 5 }])
      expect(readerCount).toBe(directCount)
      expect(readerCount).toBe(2)
    })
  })

  it('keeps typo recall on the pinned ngram index without statistics', async () => {
    await withIsolatedIndex(async ({ reader, readerClient, reads }) => {
      // Nothing ever ran ANALYZE here, which is precisely the case where the equality probes
      // used to fall off the intended index.
      const stats = await readerClient.execute(
        `SELECT name FROM sqlite_master WHERE name = 'sqlite_stat1'`
      )
      expect(stats.rows).toEqual([])

      // 'chorme' shares only its first and last bigram with the indexed 'chrome' ngrams, so a
      // transposed query still finds the item through overlap alone.
      const results = await reader.lookupByNgrams(PROVIDER, 'chorme')

      expect(results).toEqual([{ itemId: 'item:network', overlapCount: 2 }])

      // Five bigrams, five probes: each one pinned to the provider+keyword index, scoped to the
      // caller's provider, and bounded by the caller's limit.
      expect(reads).toHaveLength(5)
      const seeds = reads.map((read) =>
        read.params.find(
          (param): param is string => typeof param === 'string' && param.startsWith('ng:')
        )
      )
      expect([...seeds].sort()).toEqual(['ng:ch', 'ng:ho', 'ng:me', 'ng:or', 'ng:rm'])
      for (const read of reads) {
        expect(read.sql).toContain('INDEXED BY idx_keyword_mappings_provider_keyword')
        expect(read.params).toContain(PROVIDER)
        expect(read.params).toContain(50)
      }

      // The statement actually executed searches through those indexes in both layouts: the
      // postings key, the meta doc id index for the item id, and the pinned legacy index. A plan
      // that walked the provider is the regression the pin exists to prevent — and the 200
      // neighbouring rows sharing these same keywords are what makes dropping the provider scope
      // visible above.
      const probe = reads[0]!
      const plan = await readerClient.execute({
        sql: `EXPLAIN QUERY PLAN ${probe.sql}`,
        args: probe.params
      })
      const details = plan.rows.map((row) => ('detail' in row ? String(row.detail) : '')).join(' ')
      expect(details).toContain('SEARCH p USING PRIMARY KEY (provider_id=? AND keyword=?)')
      expect(details).toContain('SEARCH m USING INDEX idx_search_index_meta_doc_id (doc_id=?)')
      expect(details).toContain('USING INDEX idx_keyword_mappings_provider_keyword')
      expect(details).not.toMatch(/\bSCAN\b/)
    })
  })

  it('hydrates file candidates through the isolated reader executor off the main thread', async () => {
    await withIsolatedIndex(async ({ reader, readerClient, reads }) => {
      // What FileProvider falls back to when the worker read fails: drizzle's own select, which
      // maps the timestamp columns itself. Scoring and the asset checks must get the same row.
      const fallback = await drizzle(readerClient)
        .select({
          file: files,
          extensionKey: fileExtensions.key,
          extensionValue: fileExtensions.value
        })
        .from(files)
        .leftJoin(fileExtensions, eq(files.id, fileExtensions.fileId))
        .where(eq(files.id, 1))
      expect(fallback[0]?.file.mtime.toISOString()).toBe('2023-11-14T22:13:20.000Z')

      reads.length = 0
      const loaded = await reader.loadFileCandidatesByPaths(['/tmp/test.txt'])
      expect(loaded).toHaveLength(1)
      expect(loaded[0]?.file.name).toBe('test.txt')
      expect(loaded[0]?.file.displayName).toBe('Test Doc')
      expect(loaded[0]?.file.path).toBe('/tmp/test.txt')
      expect(loaded[0]?.extensionKey).toBe('customKey')
      expect(loaded[0]?.extensionValue).toBe('customValue')
      expect(reads).toHaveLength(1)
      expect(reads[0]?.sql).toContain('FROM files f')
      expect(reads[0]?.sql).toContain('LEFT JOIN file_extensions fe')
      expect(loaded).toEqual(fallback)

      reads.length = 0
      const byIds = await reader.loadFileCandidatesByIds([1])
      expect(byIds).toHaveLength(1)
      expect(byIds[0]?.file.id).toBe(1)
      expect(reads).toHaveLength(1)
      expect(byIds).toEqual(fallback)
    })
  })
})
