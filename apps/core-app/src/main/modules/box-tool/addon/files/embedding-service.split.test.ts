import type { Client, InValue } from '@libsql/client'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('../../../ai/intelligence-sdk', () => ({
  tuffIntelligence: { embedding: { generate: vi.fn() } }
}))
import * as schema from '../../../../db/schema'
import { EmbeddingService, type EmbeddingDbRouting } from './embedding-service'
import { SqliteFileIndexPersistenceRepository } from '../../search-engine/file-index-persistence-repository'
import { hashFileContentChunk } from './services/file-content-match'

const EMBEDDINGS_DDL = `CREATE TABLE embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  embedding TEXT NOT NULL,
  model TEXT NOT NULL,
  content_hash TEXT,
  created_at INTEGER NOT NULL DEFAULT 0
)`
const FILES_DDL = `CREATE TABLE files (
  id INTEGER PRIMARY KEY, path TEXT NOT NULL, name TEXT NOT NULL,
  display_name TEXT, extension TEXT, size INTEGER, mtime INTEGER NOT NULL,
  ctime INTEGER NOT NULL, last_indexed_at INTEGER NOT NULL DEFAULT 0,
  is_dir INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT 'file',
  content TEXT, embedding_status TEXT NOT NULL DEFAULT 'pending'
)`
const CHUNKS = [
  { text: 'Lease cover and rent payment schedule.', pageNumber: 1 },
  { text: 'Tenant shall not keep any pets without written consent.', pageNumber: 4 }
]
const QUERY = 'Are animals allowed in the rented apartment?'
const MODEL = 'lease-space@revision-a/dim3'
const clients: Client[] = []
let directory: string | undefined
async function makeDb(name: string) {
  directory ??= await mkdtemp(join(tmpdir(), 'embedding-contract-'))
  const url = `file:${join(directory, `${name}.sqlite`)}`
  const client = createClient({ url })
  clients.push(client)
  await client.execute(EMBEDDINGS_DDL)
  await client.execute(FILES_DDL)
  await client.execute(
    "INSERT INTO files (id, path, name, mtime, ctime, size) VALUES (1, '/lease.pdf', 'lease.pdf', 2, 2, 64), (2, '/other.pdf', 'other.pdf', 2, 2, 64)"
  )
  return { client, db: drizzle(client, { schema }), url }
}
function generateEmbedding(text: string): Promise<{ vector: number[]; model: string }> {
  return Promise.resolve({ vector: text === CHUNKS[0]!.text ? [0, 1, 0] : [1, 0, 0], model: MODEL })
}
afterEach(async () => {
  for (const client of clients.splice(0)) client.close()
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('EmbeddingService physical chunk ownership', () => {
  it('persists each page in the worker home, recalls page four after reopening, and removes all file vectors', async () => {
    const main = await makeDb('main')
    const search = await makeDb('search')
    const routing: EmbeddingDbRouting = {
      isSplitEnabled: () => true,
      getReadDb: () => search.db,
      getPrimaryDb: () => main.db,
      execWrite: async (statements) =>
        search.client.batch(
          statements.map((statement) => ({
            sql: statement.sql,
            args: statement.args as InValue[]
          })),
          'write'
        )
    }
    const service = new EmbeddingService(routing, generateEmbedding)
    await search.client.execute({
      sql: 'UPDATE files SET content = ? WHERE id = 1',
      args: [CHUNKS.map((chunk) => chunk.text).join('\n\n')]
    })
    await service.indexFiles([
      {
        fileId: '1',
        content: CHUNKS.map((chunk) => chunk.text).join('\n\n'),
        chunks: CHUNKS,
        fileVersion: 2_000,
        fileSize: 64
      }
    ])
    const persisted = await search.client.execute(
      'SELECT source_id, content_hash FROM embeddings ORDER BY id'
    )
    expect(persisted.rows.map((row) => ({ id: row.source_id, hash: row.content_hash }))).toEqual(
      CHUNKS.map((chunk) => ({ id: '1', hash: hashFileContentChunk(chunk) }))
    )
    expect((await main.client.execute('SELECT source_id FROM embeddings')).rows).toEqual([])
    search.client.close()
    clients.splice(clients.indexOf(search.client), 1)
    search.client = createClient({ url: search.url })
    clients.push(search.client)
    search.db = drizzle(search.client, { schema })
    const reopened = new EmbeddingService(routing, generateEmbedding)
    const result = await reopened.semanticSearch(QUERY)
    expect(result[0]).toEqual({
      sourceId: '1',
      score: 1,
      contentHash: hashFileContentChunk(CHUNKS[1]!)
    })
    await reopened.removeFiles(['1'])
    expect(await reopened.semanticSearch(QUERY)).toEqual([])
  })

  it('resolves each write home at call time rather than capturing the split state', async () => {
    const main = await makeDb('main')
    const search = await makeDb('search')
    let split = false
    const service = new EmbeddingService(
      {
        isSplitEnabled: () => split,
        getReadDb: () => (split ? search.db : main.db),
        getPrimaryDb: () => main.db,
        execWrite: async (statements) =>
          search.client.batch(
            statements.map((statement) => ({
              sql: statement.sql,
              args: statement.args as InValue[]
            })),
            'write'
          )
      },
      generateEmbedding
    )
    await main.client.execute({
      sql: 'UPDATE files SET content = ? WHERE id = 1',
      args: [CHUNKS[0]!.text]
    })
    await service.indexFile('1', CHUNKS[0]!.text)
    split = true
    await search.client.execute({
      sql: 'UPDATE files SET content = ? WHERE id = 2',
      args: [CHUNKS[1]!.text]
    })
    await service.indexFile('2', CHUNKS[1]!.text)
    expect(
      (await main.client.execute('SELECT source_id FROM embeddings')).rows.map(
        (row) => row.source_id
      )
    ).toEqual(['1'])
    expect(
      (await search.client.execute('SELECT source_id FROM embeddings')).rows.map(
        (row) => row.source_id
      )
    ).toEqual(['2'])
    expect((await service.semanticSearch(QUERY)).map((row) => row.sourceId)).toEqual(['2'])
  })

  it('does not compare query vectors to unrelated models even when dimensions and coordinates coincide', async () => {
    const home = await makeDb('models')
    await home.client.execute({
      sql: 'INSERT INTO embeddings (source_id, source_type, embedding, model, content_hash) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
      args: [
        '2',
        'file',
        '[1,0,0]',
        'unrelated-space@revision-b/dim3',
        'foreign-hash',
        '1',
        'file',
        '[0.8,0.6,0]',
        MODEL,
        'same-model-hash'
      ]
    })
    const service = new EmbeddingService(
      {
        isSplitEnabled: () => false,
        getReadDb: () => home.db,
        getPrimaryDb: () => home.db,
        execWrite: async () => {
          throw new Error('Unexpected worker write')
        }
      },
      generateEmbedding
    )
    const result = await service.semanticSearch(QUERY)
    expect(result.map((row) => row.sourceId)).toEqual(['1'])
    expect(result[0]?.score).toBeCloseTo(0.8)
  })

  it('leaves the previous complete page set intact when one replacement embedding fails', async () => {
    const home = await makeDb('replacement')
    const routing: EmbeddingDbRouting = {
      isSplitEnabled: () => false,
      getReadDb: () => home.db,
      getPrimaryDb: () => home.db,
      execWrite: async () => {
        throw new Error('Unexpected worker write')
      }
    }
    const original = new EmbeddingService(routing, generateEmbedding)
    await home.client.execute({
      sql: 'UPDATE files SET content = ? WHERE id = 1',
      args: [CHUNKS.map((chunk) => chunk.text).join('\n\n')]
    })
    await original.indexFiles([
      { fileId: '1', content: CHUNKS.map((chunk) => chunk.text).join('\n\n'), chunks: CHUNKS }
    ])
    const before = (
      await home.client.execute(
        'SELECT source_id, content_hash, embedding FROM embeddings ORDER BY id'
      )
    ).rows
    const failing = new EmbeddingService(routing, async (text) => {
      if (text === 'replacement second page') throw new Error('model inference failed')
      return generateEmbedding(text)
    })
    const outcome = await failing.indexFiles([
      {
        fileId: '1',
        content: 'replacement',
        chunks: [
          { text: 'replacement first page', pageNumber: 1 },
          { text: 'replacement second page', pageNumber: 4 }
        ]
      }
    ])
    expect(outcome).toMatchObject({ indexed: 0, failed: 1 })
    expect(
      (
        await home.client.execute(
          'SELECT source_id, content_hash, embedding FROM embeddings ORDER BY id'
        )
      ).rows
    ).toEqual(before)
    expect((await original.semanticSearch(QUERY))[0]?.contentHash).toBe(
      hashFileContentChunk(CHUNKS[1]!)
    )
  })

  it.each([
    {
      name: 'different model revision',
      second: { vector: [1, 0, 0], model: 'lease-space@revision-b/dim3' }
    },
    { name: 'different dimensions', second: { vector: [1, 0], model: MODEL } }
  ])(
    'rejects a $name midway through a file instead of publishing a mixed vector set',
    async ({ second }) => {
      const home = await makeDb('model-transition')
      const content = CHUNKS.map((chunk) => chunk.text).join('\n\n')
      await home.client.execute({
        sql: 'UPDATE files SET content = ? WHERE id = 1',
        args: [content]
      })
      const service = new EmbeddingService(
        {
          isSplitEnabled: () => false,
          getReadDb: () => home.db,
          getPrimaryDb: () => home.db,
          execWrite: async () => {
            throw new Error('Unexpected worker write')
          }
        },
        async (text) => (text === CHUNKS[1]!.text ? second : generateEmbedding(text))
      )
      expect(await service.indexFiles([{ fileId: '1', content, chunks: CHUNKS }])).toMatchObject({
        indexed: 0,
        failed: 1
      })
      expect((await home.client.execute('SELECT source_id FROM embeddings')).rows).toEqual([])
      expect(
        (await home.client.execute('SELECT embedding_status FROM files WHERE id = 1')).rows
      ).toEqual([{ embedding_status: 'pending' }])
    }
  )

  it('rolls back the delete and first inserted vector when the second split-off insert fails', async () => {
    const home = await makeDb('insert-rollback')
    const content = CHUNKS.map((chunk) => chunk.text).join('\n\n')
    await home.client.execute({ sql: 'UPDATE files SET content = ? WHERE id = 1', args: [content] })
    const service = new EmbeddingService(
      {
        isSplitEnabled: () => false,
        getReadDb: () => home.db,
        getPrimaryDb: () => home.db,
        execWrite: async () => {
          throw new Error('Unexpected worker write')
        }
      },
      generateEmbedding
    )
    expect(await service.indexFiles([{ fileId: '1', content, chunks: CHUNKS }])).toEqual({
      indexed: 1,
      skipped: 0,
      failed: 0
    })
    const before = (
      await home.client.execute(
        'SELECT source_id, content_hash, embedding, model FROM embeddings ORDER BY id'
      )
    ).rows
    const replacement = [
      { text: 'Replacement first page.', pageNumber: 1 },
      { text: 'Replacement second page.', pageNumber: 4 }
    ]
    const replacementContent = replacement.map((chunk) => chunk.text).join('\n\n')
    await home.client.execute({
      sql: "UPDATE files SET content = ?, embedding_status = 'pending' WHERE id = 1",
      args: [replacementContent]
    })
    await home.client.execute(`CREATE TRIGGER reject_second_replacement BEFORE INSERT ON embeddings
      WHEN NEW.content_hash = '${hashFileContentChunk(replacement[1]!)}'
      BEGIN SELECT RAISE(ABORT, 'second replacement insert rejected'); END`)

    expect(
      await service.indexFiles([{ fileId: '1', content: replacementContent, chunks: replacement }])
    ).toEqual({ indexed: 0, skipped: 0, failed: 1 })
    expect(
      (
        await home.client.execute(
          'SELECT source_id, content_hash, embedding, model FROM embeddings ORDER BY id'
        )
      ).rows
    ).toEqual(before)
    expect(
      (await home.client.execute('SELECT content, embedding_status FROM files WHERE id = 1')).rows
    ).toEqual([{ content: replacementContent, embedding_status: 'pending' }])
    expect((await service.semanticSearch(QUERY))[0]?.contentHash).toBe(
      hashFileContentChunk(CHUNKS[1]!)
    )
  })
})

describe('EmbeddingService semantic scan and publication fences', () => {
  it('finds the best matching file beyond the first thousand persisted vectors', async () => {
    const home = await makeDb('late-row')
    await home.client.batch(
      Array.from({ length: 999 }, (_, index) => ({
        sql: 'INSERT INTO files (id, path, name, mtime, ctime, content, embedding_status) VALUES (?, ?, ?, 2, 2, ?, ?)',
        args: [
          index + 3,
          `/file-${index + 3}.txt`,
          `file-${index + 3}.txt`,
          index === 998 ? CHUNKS[1]!.text : CHUNKS[0]!.text,
          'completed'
        ]
      })),
      'write'
    )
    await home.client.batch(
      Array.from({ length: 1001 }, (_, index) => ({
        sql: 'INSERT INTO embeddings (source_id, source_type, embedding, model, content_hash) VALUES (?, ?, ?, ?, ?)',
        args: [
          String(index + 1),
          'file',
          index === 1000 ? '[1,0,0]' : '[0,1,0]',
          MODEL,
          `chunk-${index + 1}`
        ]
      })),
      'write'
    )
    const service = new EmbeddingService(
      {
        isSplitEnabled: () => false,
        getReadDb: () => home.db,
        getPrimaryDb: () => home.db,
        execWrite: async () => {
          throw new Error('Unexpected worker write')
        }
      },
      generateEmbedding
    )
    expect(await service.semanticSearch(QUERY, 1)).toEqual([
      { sourceId: '1001', score: 1, contentHash: 'chunk-1001' }
    ])
  })

  it('cannot resurrect vectors when content is disabled while inference is in flight', async () => {
    const home = await makeDb('late-inference')
    await home.client.execute({
      sql: 'UPDATE files SET content = ? WHERE id = 1',
      args: [CHUNKS[1]!.text]
    })
    const started = Promise.withResolvers<void>()
    const answered = Promise.withResolvers<{ vector: number[]; model: string }>()
    const service = new EmbeddingService(
      {
        isSplitEnabled: () => false,
        getReadDb: () => home.db,
        getPrimaryDb: () => home.db,
        execWrite: async () => {
          throw new Error('Unexpected worker write')
        }
      },
      async (text) => {
        if (text === 'test') return generateEmbedding(text)
        started.resolve()
        return answered.promise
      }
    )
    const operation = service.indexFiles([
      { fileId: '1', content: CHUNKS[1]!.text, chunks: [CHUNKS[1]!] }
    ])
    try {
      await started.promise
      await home.client.execute(
        "UPDATE files SET content = NULL, embedding_status = 'none' WHERE id = 1"
      )
      answered.resolve({ vector: [1, 0, 0], model: MODEL })
      await operation
      expect((await home.client.execute('SELECT source_id FROM embeddings')).rows).toEqual([])
      expect(
        (await home.client.execute('SELECT content, embedding_status FROM files WHERE id = 1')).rows
      ).toEqual([{ content: null, embedding_status: 'none' }])
    } finally {
      answered.resolve({ vector: [1, 0, 0], model: MODEL })
      await operation
    }
  })

  it('cannot republish chunks or vectors when cleanup commits after preflight but before the worker batch', async () => {
    const main = await makeDb('queued-main')
    const home = await makeDb('queued-worker')
    await home.client.execute(
      'CREATE TABLE file_extensions (id INTEGER PRIMARY KEY AUTOINCREMENT, file_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL)'
    )
    await home.client.execute(`CREATE TABLE file_index_progress (
      file_id INTEGER PRIMARY KEY, status TEXT NOT NULL, progress INTEGER NOT NULL,
      processed_bytes INTEGER, total_bytes INTEGER, last_error TEXT, started_at INTEGER, updated_at INTEGER NOT NULL
    )`)
    const content = CHUNKS.map((chunk) => chunk.text).join('\n\n')
    const repository = new SqliteFileIndexPersistenceRepository(home.db)
    const progress = {
      status: 'completed',
      progress: 100,
      processedBytes: 64,
      totalBytes: 64,
      lastError: null,
      startedAt: null,
      updatedAt: '2026-10-11T00:00:00.000Z'
    }
    await repository.persistEntries([
      {
        fileId: 1,
        fileVersion: 2_000,
        fileSize: 64,
        fileUpdate: { content, embeddingStatus: 'pending', contentHash: null, chunks: CHUNKS },
        progress
      }
    ])
    const queued = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const service = new EmbeddingService(
      {
        isSplitEnabled: () => true,
        getReadDb: () => home.db,
        getPrimaryDb: () => main.db,
        execWrite: async (statements) => {
          queued.resolve()
          await release.promise
          return home.client.batch(
            statements.map((statement) => ({
              sql: statement.sql,
              args: statement.args as InValue[]
            })),
            'write'
          )
        }
      },
      generateEmbedding
    )
    const operation = service.indexFiles([
      { fileId: '1', content, chunks: CHUNKS, fileVersion: 2_000, fileSize: 64 }
    ])
    try {
      await queued.promise
      await repository.persistEntries([
        {
          fileId: 1,
          fileVersion: 2_000,
          fileSize: 64,
          fileUpdate: { content: null, embeddingStatus: 'none', contentHash: null },
          progress
        }
      ])
      release.resolve()
      expect(await operation).toEqual({ indexed: 0, skipped: 1, failed: 0 })
      expect((await home.client.execute('SELECT source_id FROM embeddings')).rows).toEqual([])
      expect(
        (
          await home.client.execute(
            "SELECT file_id FROM file_extensions WHERE key = 'content_chunks'"
          )
        ).rows
      ).toEqual([])
      expect(
        (
          await home.client.execute(
            'SELECT path, content, embedding_status FROM files WHERE id = 1'
          )
        ).rows
      ).toEqual([{ path: '/lease.pdf', content: null, embedding_status: 'none' }])
      expect(await service.semanticSearch(QUERY)).toEqual([])
    } finally {
      release.resolve()
      await operation
    }
  })
})
