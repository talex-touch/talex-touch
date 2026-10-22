import { createClient, type Client } from '@libsql/client'
import type { IndexedSourceDelta } from '@talex-touch/utils/search'
import { drizzle } from 'drizzle-orm/libsql'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SearchIndexStoreAdapter } from './indexing-store-adapter'
import { SearchIndexCommitHub } from './search-index-commit-hub'
import { SearchIndexService, type SearchIndexItem } from './search-index-service'
import { LegacySearchIndexWriter, SourceScopedIndexWriterRouter } from './search-index-writer'

let directory: string
let client: Client
let service: SearchIndexService

function openService(): SearchIndexService {
  return new SearchIndexService(drizzle(client) as never, {
    directMode: true,
    initializationMode: 'writer'
  })
}

const original: SearchIndexItem = {
  providerId: 'document-provider',
  itemId: 'shared-document',
  type: 'file',
  name: 'stabletitle',
  tags: ['oldtag'],
  content: 'oldcontent'
}

async function searchIds(provider: string, term: string): Promise<string[]> {
  return (await service.search(provider, term, 50, undefined, { includeContent: true })).map(
    (row) => row.itemId
  )
}

function createAdapter(hub: SearchIndexCommitHub): SearchIndexStoreAdapter {
  const physical = new LegacySearchIndexWriter(service)
  const writer = new SourceScopedIndexWriterRouter({
    runtime: physical,
    legacy: physical,
    defaultMode: 'legacy',
    commitHub: hub,
    visibilityBarrier: { waitUntilReadable: () => service.waitUntilReadable() }
  })
  return new SearchIndexStoreAdapter(writer)
}

function delta(action: IndexedSourceDelta['action'], title = 'recreatedtitle'): IndexedSourceDelta {
  return {
    sourceId: original.providerId,
    action,
    stableKey: original.itemId,
    record: {
      sourceId: original.providerId,
      recordId: original.itemId,
      stableKey: original.itemId,
      kind: 'file',
      title,
      path: '/isolated/recreated.txt'
    }
  }
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tuff-index-documents-'))
  client = createClient({ url: `file:${join(directory, 'index.sqlite')}` })
  await client.execute(`CREATE TABLE keyword_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL,
    item_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    priority REAL NOT NULL
  )`)
  // A pre-locator profile: writer warmup must upgrade this table without losing its rows.
  await client.execute(`CREATE TABLE search_index_meta (
    provider_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    keyword_hash TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (provider_id, item_id)
  )`)
  service = openService()
  await service.warmup()
})

afterEach(async () => {
  client?.close()
  await rm(directory, { recursive: true, force: true })
})

describe('SearchIndexService complete document contract', () => {
  it.each([
    { field: 'title', change: { name: 'newtitle' }, oldTerm: 'stabletitle', newTerm: 'newtitle' },
    { field: 'tags', change: { tags: ['newtag'] }, oldTerm: 'oldtag', newTerm: 'newtag' },
    {
      field: 'content',
      change: { content: 'newcontent' },
      oldTerm: 'oldcontent',
      newTerm: 'newcontent'
    },
    {
      field: 'keywords',
      change: { keywords: [{ value: 'newkeyword', priority: 2 }] },
      oldTerm: 'oldkeyword',
      newTerm: 'newkeyword'
    },
    {
      field: 'path',
      change: { path: '/newfolder/document.txt' },
      oldTerm: 'oldfolder',
      newTerm: 'newfolder'
    }
  ])(
    'replaces $field so new text is recalled and obsolete text retires',
    async ({ change, oldTerm, newTerm }) => {
      const item = {
        ...original,
        keywords: [{ value: 'oldkeyword', priority: 2 }],
        path: '/oldfolder/document.txt'
      }
      await service.indexItems([item])
      expect(await searchIds(item.providerId, oldTerm)).toEqual([item.itemId])
      await service.indexItems([{ ...item, ...change }])
      expect(await searchIds(item.providerId, newTerm)).toEqual([item.itemId])
      expect(await searchIds(item.providerId, oldTerm)).toEqual([])
      expect(await service.countByProvider(item.providerId)).toBe(1)
    }
  )

  it('does not rewrite an unchanged FTS document but still updates keyword priorities', async () => {
    // No public query exposes FTS write amplification. Only read the engine-owned structures:
    // installing triggers or writing FTS shadow tables can recurse into the native module.
    async function readFtsStorage() {
      const data = await client.execute(
        'SELECT id,hex(block) AS block FROM search_index_data ORDER BY id'
      )
      const index = await client.execute(
        'SELECT segid,hex(term) AS term,pgno FROM search_index_idx ORDER BY segid,term'
      )
      const docsize = await client.execute(
        'SELECT id,hex(sz) AS size FROM search_index_docsize ORDER BY id'
      )
      return { data: data.rows, index: index.rows, docsize: docsize.rows }
    }
    const item = { ...original, keywords: [{ value: 'weightedalias', priority: 2 }] }
    await service.indexItems([item])
    const stored = await readFtsStorage()
    const before = Number((await client.execute('SELECT total_changes() AS count')).rows[0].count)
    await service.indexItems([{ ...item }])
    const after = Number((await client.execute('SELECT total_changes() AS count')).rows[0].count)
    // One optional meta upsert is allowed; unchanged keywords/FTS must cause no other writes.
    // Skipping even that upsert is a valid optimization, so do not pin its exact write count.
    expect(after - before).toBeLessThanOrEqual(1)
    expect(await readFtsStorage()).toEqual(stored)

    await service.indexItems([{ ...item, keywords: [{ value: 'weightedalias', priority: 7 }] }])
    expect(await readFtsStorage()).toEqual(stored)
    expect(
      (await service.lookupByKeywords(item.providerId, ['weightedalias'])).get('weightedalias')
    ).toEqual([{ itemId: item.itemId, priority: 7 }])
    expect(await searchIds(item.providerId, 'weightedalias')).toEqual([item.itemId])

    // Positive control: a real searchable-field update must change FTS storage and perform
    // more than metadata upkeep. This makes a disconnected/constant observer fail loudly.
    const beforeRewrite = Number(
      (await client.execute('SELECT total_changes() AS count')).rows[0].count
    )
    await service.indexItems([
      { ...item, keywords: [{ value: 'weightedalias', priority: 7 }], content: 'changedcontent' }
    ])
    const afterRewrite = Number(
      (await client.execute('SELECT total_changes() AS count')).rows[0].count
    )
    expect(afterRewrite - beforeRewrite).toBeGreaterThan(1)
    expect(await readFtsStorage()).not.toEqual(stored)
    expect(await searchIds(item.providerId, 'changedcontent')).toEqual([item.itemId])
  })

  it('persists the type change even when all indexed keyword text remains identical', async () => {
    await service.indexItems([original])
    await service.indexItems([{ ...original, type: 'plugin' }])
    expect(
      (await client.execute("SELECT type FROM search_index WHERE provider = 'document-provider'"))
        .rows
    ).toEqual([{ type: 'plugin' }])
    expect(await searchIds(original.providerId, 'stabletitle')).toEqual([original.itemId])
  })
})

describe('file keywords come from the name', () => {
  const filePath = '/home/projects/alpha/notes.md'
  const file: SearchIndexItem = {
    providerId: 'file-provider',
    itemId: filePath,
    type: 'file',
    name: 'notes.md',
    description: filePath,
    path: filePath,
    extension: '.md',
    tags: ['md', 'document', 'markdown'],
    indexPathKeywords: false
  }

  async function keywordsOf(itemId: string): Promise<string[]> {
    const rows = await service.listItemKeywords(file.providerId, [itemId], 10_000)
    return rows.map((row) => row.keyword).sort()
  }

  it('finds a file by folder and by type through FTS without a keyword row for either', async () => {
    await service.indexItems([file])

    expect(await searchIds(file.providerId, 'alpha')).toEqual([filePath])
    expect(await searchIds(file.providerId, 'markdown')).toEqual([filePath])
    const keywords = await keywordsOf(filePath)
    expect(keywords).toContain('notes')
    expect(keywords).not.toContain('alpha')
    expect(keywords).not.toContain('projects')
    expect(keywords).not.toContain(filePath)
    // Bigrams of the type word `markdown` that the name `notes.md` does not contain.
    expect(keywords).not.toContain('ng:kd')
    expect(keywords).not.toContain('ng:wn')
    expect((await service.lookupByKeywords(file.providerId, ['alpha'])).size).toBe(0)
  })

  it('still writes path keywords for an item that keeps them', async () => {
    await service.indexItems([{ ...file, indexPathKeywords: undefined }])

    expect(await keywordsOf(filePath)).toEqual(expect.arrayContaining(['alpha', 'projects']))
  })
})

describe('ordered deltas and commit publication on real SQL', () => {
  it.each([
    { name: 'delete then add', actions: ['delete', 'add'], expected: ['shared-document'] },
    { name: 'add then delete', actions: ['add', 'delete'], expected: [] },
    {
      name: 'delete add delete add',
      actions: ['delete', 'add', 'delete', 'add'],
      expected: ['shared-document']
    }
  ] as const)('preserves the final document for $name', async ({ actions, expected }) => {
    await service.indexItems([
      original,
      { ...original, providerId: 'other-provider', name: 'othertitle' }
    ])
    const adapter = createAdapter(new SearchIndexCommitHub())
    await adapter.applyDeltas(actions.map((action) => delta(action)))
    expect(await searchIds(original.providerId, 'recreatedtitle')).toEqual([...expected])
    expect(await searchIds(original.providerId, 'stabletitle')).toEqual([])
    expect(await searchIds('other-provider', 'othertitle')).toEqual([original.itemId])
    const keywords = await service.lookupByKeywords(original.providerId, ['recreatedtitle'])
    expect((keywords.get('recreatedtitle') ?? []).map((row) => row.itemId)).toEqual([...expected])
    expect(await service.countByProvider(original.providerId)).toBe(expected.length)
  })

  it('rolls back FTS and metadata and publishes no commit when keyword persistence fails', async () => {
    await service.indexItems([original])
    const hub = new SearchIndexCommitHub()
    const events: number[] = []
    const unsubscribe = hub.subscribe((event) => events.push(event.revision))
    const adapter = createAdapter(hub)
    await client.execute(`CREATE TRIGGER reject_keyword_write BEFORE INSERT ON search_keyword_postings
      WHEN NEW.provider_id = 'document-provider' BEGIN
        SELECT RAISE(ABORT, 'injected keyword failure');
      END`)
    try {
      await expect(adapter.applyDeltas([delta('change')])).rejects.toThrow()
      expect(events).toEqual([])
      expect(await searchIds(original.providerId, 'stabletitle')).toEqual([original.itemId])
      expect(await searchIds(original.providerId, 'recreatedtitle')).toEqual([])
      expect(
        (await service.lookupByKeywords(original.providerId, ['stabletitle'])).get('stabletitle')
      ).toEqual([{ itemId: original.itemId, priority: 1.25 }])
      expect(await service.countByProvider(original.providerId)).toBe(1)
      await client.execute('DROP TRIGGER reject_keyword_write')
      await adapter.applyDeltas([delta('change')])
      expect(events).toEqual([1])
      expect(await searchIds(original.providerId, 'recreatedtitle')).toEqual([original.itemId])
    } finally {
      unsubscribe()
    }
  })
})

describe('persisted FTS identity recovery', () => {
  it('removes an existing mapped document after reopening without touching a provider twin', async () => {
    await service.indexItems([
      original,
      { ...original, itemId: 'kept-document', name: 'kepttitle' },
      { ...original, providerId: 'other-provider', name: 'othertitle' }
    ])
    client.close()
    client = createClient({ url: `file:${join(directory, 'index.sqlite')}` })
    service = openService()
    await expect(service.removeProviderItems(original.providerId, [original.itemId])).resolves.toBe(
      1
    )
    expect(await searchIds(original.providerId, 'stabletitle')).toEqual([])
    expect(await searchIds(original.providerId, 'kepttitle')).toEqual(['kept-document'])
    expect(await searchIds('other-provider', 'othertitle')).toEqual([original.itemId])
    expect(await service.countByProvider(original.providerId)).toBe(1)
    expect(
      (await service.lookupByKeywords(original.providerId, ['stabletitle'])).get('stabletitle')
    ).toBeUndefined()
    await expect(service.removeProviderItems(original.providerId, [original.itemId])).resolves.toBe(
      0
    )
  })

  it.each(['missing metadata', 'duplicate identity', 'stale foreign rowid'] as const)(
    'repairs %s without erasing another provider with the same item ID',
    async (damage) => {
      await service.indexItems([
        original,
        { ...original, providerId: 'other-provider', name: 'othertitle' }
      ])
      if (damage === 'missing metadata') {
        await client.execute(
          "DELETE FROM search_index_meta WHERE provider_id = 'document-provider'"
        )
      } else if (damage === 'duplicate identity') {
        await client.execute(`INSERT INTO search_index
          (item_id, provider, type, title, title_compact, keywords, tags, path, content)
          SELECT item_id, provider, type, title, title_compact, keywords, tags, path, content
          FROM search_index WHERE provider = 'document-provider'`)
        await client.execute(`UPDATE search_index_meta SET fts_rowid = NULL, document_hash = NULL
          WHERE provider_id = 'document-provider'`)
      } else {
        await client.execute(`UPDATE search_index_meta
          SET fts_rowid = (SELECT rowid FROM search_index WHERE provider = 'other-provider')
          WHERE provider_id = 'document-provider'`)
      }
      service = openService()
      await service.indexItems([{ ...original, name: 'repairedtitle' }])
      expect(await searchIds(original.providerId, 'stabletitle')).toEqual([])
      expect(await searchIds(original.providerId, 'repairedtitle')).toEqual([original.itemId])
      expect(await searchIds('other-provider', 'othertitle')).toEqual([original.itemId])
      expect(await service.countByProvider(original.providerId)).toBe(1)
      await service.removeProviderItems(original.providerId, [original.itemId])
      expect(await searchIds(original.providerId, 'repairedtitle')).toEqual([])
      expect(await searchIds('other-provider', 'othertitle')).toEqual([original.itemId])
    }
  )

  it('invalidates lost FTS locators so repair cannot delete the document that reuses an old rowid', async () => {
    await service.indexItems([original])
    await service.repair()
    await service.indexItems([{ ...original, providerId: 'other-provider', name: 'othertitle' }])
    await service.removeProviderItems(original.providerId, [original.itemId])
    expect(await searchIds('other-provider', 'othertitle')).toEqual([original.itemId])
    await service.indexItems([{ ...original, name: 'rebuilttitle' }])
    expect(await searchIds(original.providerId, 'rebuilttitle')).toEqual([original.itemId])
    expect(await searchIds('other-provider', 'othertitle')).toEqual([original.itemId])
  })
})

describe('bounded document locator backfill', () => {
  it('maps a legacy profile in bounded pages and resumes after reopening without losing documents', async () => {
    const items = Array.from({ length: 5 }, (_, index) => ({
      ...original,
      itemId: `legacy-${index}`,
      name: `legacytitle${index}`
    }))
    await service.indexItems(items)
    await client.execute('UPDATE search_index_meta SET fts_rowid = NULL, document_hash = NULL')
    service = openService()
    const first = await service.backfillDocumentLocators(2)
    expect(first.processed).toBeGreaterThan(0)
    expect(first.processed).toBeLessThanOrEqual(2)
    expect(first.done).toBe(false)
    const firstMappings = await client.execute(`SELECT item_id, fts_rowid FROM search_index_meta
      WHERE fts_rowid IS NOT NULL ORDER BY item_id`)
    expect(firstMappings.rows.length).toBeGreaterThan(0)
    expect(firstMappings.rows.length).toBeLessThanOrEqual(2)
    const committedProgress = (
      await client.execute(
        'SELECT task,cursor FROM search_index_maintenance_progress ORDER BY task'
      )
    ).rows

    client.close()
    client = createClient({ url: `file:${join(directory, 'index.sqlite')}` })
    service = openService()
    await service.warmup()
    expect(
      (
        await client.execute(
          'SELECT task,cursor FROM search_index_maintenance_progress ORDER BY task'
        )
      ).rows
    ).toEqual(committedProgress)
    const resumed = await service.backfillDocumentLocators(2)
    expect(resumed.processed).toBeLessThanOrEqual(2)
    expect(
      (await client.execute('SELECT item_id FROM search_index_meta WHERE fts_rowid IS NOT NULL'))
        .rows.length
    ).toBeGreaterThan(firstMappings.rows.length)
    let done = resumed.done
    for (let page = 0; page < 10 && !done; page += 1) {
      const result = await service.backfillDocumentLocators(2)
      expect(result.processed).toBeLessThanOrEqual(2)
      expect(result.processed).toBeGreaterThanOrEqual(0)
      done = result.done
    }
    expect(done).toBe(true)
    expect(
      (
        await client.execute(`SELECT m.item_id FROM search_index_meta AS m
      JOIN search_index AS f ON f.rowid = m.fts_rowid
        AND f.provider = m.provider_id AND f.item_id = m.item_id
      WHERE m.document_hash IS NOT NULL ORDER BY m.item_id`)
      ).rows.map((row) => row.item_id)
    ).toEqual(items.map((item) => item.itemId))
    for (const item of items) {
      expect(await searchIds(item.providerId, item.name)).toEqual([item.itemId])
    }
    await service.removeProviderItems(original.providerId, ['legacy-0'])
    expect(await searchIds(original.providerId, 'legacytitle0')).toEqual([])
    expect(await searchIds(original.providerId, 'legacytitle4')).toEqual(['legacy-4'])
  })

  it('rolls back locator writes with the progress cursor when a backfill commit fails', async () => {
    await service.indexItems([
      { ...original, itemId: 'legacy-a', name: 'legacyalpha' },
      { ...original, itemId: 'legacy-b', name: 'legacybeta' }
    ])
    await client.execute('UPDATE search_index_meta SET fts_rowid = NULL, document_hash = NULL')
    const beforeMappings = (
      await client.execute('SELECT * FROM search_index_meta ORDER BY item_id')
    ).rows
    const beforeProgress = (
      await client.execute('SELECT * FROM search_index_maintenance_progress ORDER BY task')
    ).rows
    for (const operation of ['INSERT', 'UPDATE']) {
      await client.execute(`CREATE TRIGGER reject_locator_progress_${operation.toLowerCase()}
        BEFORE ${operation} ON search_index_maintenance_progress BEGIN
          SELECT RAISE(ABORT, 'injected progress failure');
        END`)
    }
    service = openService()
    await expect(service.backfillDocumentLocators(1)).rejects.toThrow()
    expect((await client.execute('SELECT * FROM search_index_meta ORDER BY item_id')).rows).toEqual(
      beforeMappings
    )
    expect(
      (await client.execute('SELECT * FROM search_index_maintenance_progress ORDER BY task')).rows
    ).toEqual(beforeProgress)
    await client.execute('DROP TRIGGER reject_locator_progress_insert')
    await client.execute('DROP TRIGGER reject_locator_progress_update')
    const resumed = await service.backfillDocumentLocators(1)
    expect(resumed.processed).toBe(1)
    expect(await searchIds(original.providerId, 'legacyalpha')).toEqual(['legacy-a'])
    expect(await searchIds(original.providerId, 'legacybeta')).toEqual(['legacy-b'])
  })
})

/** A posting no meta row owns, as a document deleted by an older build leaves behind. */
async function insertOrphanPosting(keyword: string, docId: number): Promise<void> {
  await client.execute({
    sql: 'INSERT INTO search_keyword_postings(provider_id,keyword,doc_id,priority) VALUES (?,?,?,3)',
    args: [original.providerId, keyword, docId]
  })
}

async function postingKeywords(docId: number): Promise<string[]> {
  const result = await client.execute({
    sql: 'SELECT keyword FROM search_keyword_postings WHERE doc_id = ? ORDER BY keyword',
    args: [docId]
  })
  return result.rows.map((row) => String(row.keyword))
}

const POSTINGS_SNAPSHOT = 'SELECT * FROM search_keyword_postings ORDER BY doc_id, keyword'

async function docIdOf(providerId: string, itemId: string): Promise<number | null> {
  const rows = (
    await client.execute({
      sql: 'SELECT doc_id FROM search_index_meta WHERE provider_id = ? AND item_id = ?',
      args: [providerId, itemId]
    })
  ).rows
  return rows[0]?.doc_id === null || rows[0]?.doc_id === undefined ? null : Number(rows[0].doc_id)
}

describe('bounded orphan keyword maintenance', () => {
  async function cleanupUntilRemoval(target: SearchIndexService, limit: number): Promise<number> {
    for (let page = 0; page < 64; page += 1) {
      const removed = await target.cleanupOrphanKeywords(original.providerId, limit)
      expect(removed).toBeGreaterThanOrEqual(0)
      expect(removed).toBeLessThanOrEqual(limit)
      if (removed > 0) return removed
    }
    throw new Error('fixture orphan was not reached by bounded keyword traversal')
  }

  it('resumes provider-scoped orphan deletion in bounded pages without deleting live keyword recall', async () => {
    await service.indexItems([
      original,
      {
        ...original,
        providerId: 'other-provider',
        itemId: 'ghost-0',
        keywords: [{ value: 'orphanword0', priority: 3 }]
      }
    ])
    const orphanWords = Array.from({ length: 6 }, (_, index) => `orphanword${index}`)
    for (let index = 0; index < orphanWords.length; index += 1) {
      await insertOrphanPosting(orphanWords[index], 100 + index)
    }
    let removed = 0
    for (let page = 0; page < 64 && removed < orphanWords.length; page += 1) {
      const slice = await service.runIndexMaintenanceSlice(original.providerId, 2)
      expect(slice.processed).toBeGreaterThanOrEqual(0)
      expect(slice.processed).toBeLessThanOrEqual(2)
      for (const notification of slice.notifications) {
        expect(notification.sourceId).toBe(original.providerId)
        removed += notification.affectedItems
        await service.acknowledgeIndexMaintenanceCommit(notification)
      }
      if (page === 0) {
        // Bounded enumeration may cover only live documents/keywords. Restart from the
        // actual committed cursor instead of assuming the first page contains an orphan.
        const progress = (
          await client.execute(
            'SELECT task,cursor FROM search_index_maintenance_progress ORDER BY task'
          )
        ).rows
        client.close()
        client = createClient({ url: `file:${join(directory, 'index.sqlite')}` })
        service = openService()
        await service.warmup()
        expect(
          (
            await client.execute(
              'SELECT task,cursor FROM search_index_maintenance_progress ORDER BY task'
            )
          ).rows
        ).toEqual(progress)
      }
    }
    expect(removed).toBe(orphanWords.length)
    for (let index = 0; index < orphanWords.length; index += 1) {
      expect(await postingKeywords(100 + index)).toEqual([])
    }
    expect(
      (await service.lookupByKeywords(original.providerId, ['stabletitle'])).get('stabletitle')
    ).toEqual([{ itemId: original.itemId, priority: 1.25 }])
    expect(
      (await service.lookupByKeywords('other-provider', ['orphanword0'])).get('orphanword0')
    ).toEqual([{ itemId: 'ghost-0', priority: 3 }])
    expect(await searchIds('other-provider', 'orphanword0')).toEqual(['ghost-0'])
  })

  it('does not lose orphan work or advance its cursor when maintenance persistence fails', async () => {
    await insertOrphanPosting('orphanword', 100)
    const before = (await client.execute(POSTINGS_SNAPSHOT)).rows
    const progress = (
      await client.execute('SELECT * FROM search_index_maintenance_progress ORDER BY task')
    ).rows
    await client.execute(`CREATE TRIGGER reject_keyword_cursor BEFORE INSERT ON search_index_maintenance_progress BEGIN
      SELECT RAISE(ABORT, 'injected keyword progress failure');
    END`)
    await expect(service.cleanupOrphanKeywords(original.providerId, 2)).rejects.toThrow()
    expect((await client.execute(POSTINGS_SNAPSHOT)).rows).toEqual(before)
    expect(
      (await client.execute('SELECT * FROM search_index_maintenance_progress ORDER BY task')).rows
    ).toEqual(progress)
    await client.execute('DROP TRIGGER reject_keyword_cursor')
    expect(await cleanupUntilRemoval(service, 2)).toBe(1)
    expect(await postingKeywords(100)).toEqual([])
  })

  it('does not remove orphan keywords while the actual maintenance admission gate is closed', async () => {
    await insertOrphanPosting('orphanword', 100)
    let idle = false
    const gated = new SearchIndexService(drizzle(client) as never, {
      directMode: true,
      initializationMode: 'writer',
      canRunMaintenance: () => idle
    })
    expect(await gated.cleanupOrphanKeywords(original.providerId, 2)).toBe(0)
    expect(await postingKeywords(100)).toEqual(['orphanword'])
    idle = true
    expect(await cleanupUntilRemoval(gated, 2)).toBe(1)
    expect(await postingKeywords(100)).toEqual([])
  })
})

describe('atomic index-maintenance notifications', () => {
  async function finishLocatorMigration(): Promise<void> {
    for (let page = 0; page < 8; page += 1) {
      if ((await service.backfillDocumentLocators(64)).done) return
    }
    throw new Error('fixture locator migration did not complete')
  }

  async function runUntilNotification() {
    for (let page = 0; page < 64; page += 1) {
      const slice = await service.runIndexMaintenanceSlice(original.providerId, 64)
      expect(slice.processed).toBeGreaterThanOrEqual(0)
      expect(slice.processed).toBeLessThanOrEqual(64)
      if (slice.notifications.length > 0) return slice
    }
    throw new Error('fixture physical maintenance change did not produce a notification')
  }

  it.each([
    {
      name: 'before notification persistence',
      kind: 'keyword',
      failureTask: 'index-maintenance-commit/%'
    },
    {
      name: 'after notification but before keyword cursor persistence',
      kind: 'keyword',
      failureTask: 'orphan-keywords:%'
    },
    {
      name: 'after dedup notification but before document cursor persistence',
      kind: 'document',
      failureTask: 'document-locators'
    },
    {
      name: 'after orphan metadata notification but before validation cursor persistence',
      kind: 'metadata',
      failureTask: 'document-meta-validation'
    }
  ])('rolls back physical work, cursor and notification $name', async ({ kind, failureTask }) => {
    if (kind === 'keyword') {
      await finishLocatorMigration()
      await insertOrphanPosting('maintenanceorphan', 100)
    } else if (kind === 'document') {
      await service.indexItems([original])
      await client.execute(`INSERT INTO search_index
        (item_id,provider,type,title,title_compact,keywords,tags,path,content)
        SELECT item_id,provider,type,title,title_compact,keywords,tags,path,content
        FROM search_index WHERE provider = 'document-provider'`)
    } else {
      await client.execute(`INSERT INTO search_index_meta(provider_id,item_id,keyword_hash,updated_at,fts_rowid,document_hash)
        VALUES ('document-provider','orphan-meta','legacy-hash',123,NULL,NULL)`)
      await service.backfillDocumentLocators(64)
    }
    const afterNotification =
      failureTask === 'index-maintenance-commit/%'
        ? ''
        : "AND EXISTS (SELECT 1 FROM search_index_maintenance_progress WHERE task LIKE 'index-maintenance-commit/%')"
    await client.execute(`CREATE TRIGGER reject_maintenance_boundary
      BEFORE INSERT ON search_index_maintenance_progress
      WHEN NEW.task LIKE '${failureTask}' ${afterNotification} BEGIN
        SELECT RAISE(ABORT, 'maintenance boundary failed');
      END`)
    let rejected = false
    for (let page = 0; page < 64 && !rejected; page += 1) {
      // Earlier enumeration-only slices may commit legitimately. The failing slice must
      // restore exactly its own preceding committed state, not the start of the whole round.
      const beforeProgress = (
        await client.execute(
          'SELECT task,cursor FROM search_index_maintenance_progress ORDER BY task'
        )
      ).rows
      const beforeKeywords = (await client.execute(POSTINGS_SNAPSHOT)).rows
      const beforeDocuments = (
        await client.execute('SELECT rowid,item_id,provider,title FROM search_index ORDER BY rowid')
      ).rows
      const beforeMetadata = (
        await client.execute('SELECT * FROM search_index_meta ORDER BY provider_id,item_id')
      ).rows
      const outcome = await service.runIndexMaintenanceSlice(original.providerId, 64).then(
        (slice) => ({ slice }),
        (error: unknown) => ({ error })
      )
      if ('slice' in outcome) {
        expect(outcome.slice.notifications).toEqual([])
        continue
      }
      rejected = true
      expect(
        (
          await client.execute(
            'SELECT task,cursor FROM search_index_maintenance_progress ORDER BY task'
          )
        ).rows
      ).toEqual(beforeProgress)
      expect((await client.execute(POSTINGS_SNAPSHOT)).rows).toEqual(beforeKeywords)
      expect(
        (
          await client.execute(
            'SELECT rowid,item_id,provider,title FROM search_index ORDER BY rowid'
          )
        ).rows
      ).toEqual(beforeDocuments)
      expect(
        (await client.execute('SELECT * FROM search_index_meta ORDER BY provider_id,item_id')).rows
      ).toEqual(beforeMetadata)
    }
    expect(rejected).toBe(true)
    await client.execute('DROP TRIGGER reject_maintenance_boundary')
    const retry = await runUntilNotification()
    expect(retry.notifications).toEqual([
      expect.objectContaining({ sourceId: original.providerId, affectedItems: 1 })
    ])
    if (kind === 'keyword') {
      expect(await postingKeywords(100)).toEqual([])
    } else if (kind === 'document') {
      expect(await searchIds(original.providerId, 'stabletitle')).toEqual([original.itemId])
    } else {
      expect(
        (
          await client.execute(
            "SELECT item_id FROM search_index_meta WHERE provider_id = 'document-provider' AND item_id = 'orphan-meta'"
          )
        ).rows
      ).toEqual([])
    }
  })

  it('recovers an unpublished notification after reopening and an old ACK cannot consume a later same-count commit', async () => {
    await finishLocatorMigration()
    await insertOrphanPosting('firstorphan', 100)
    const committed = await runUntilNotification()
    expect(committed.notifications).toEqual([
      expect.objectContaining({ sourceId: original.providerId, affectedItems: 1 })
    ])
    const observed = committed.notifications[0]
    // Commit succeeded but publication/ACK did not. A second orphan is deliberately present
    // when the writer reopens: pending replay must not physically process this next work yet.
    await insertOrphanPosting('laterorphan', 101)
    client.close()
    client = createClient({ url: `file:${join(directory, 'index.sqlite')}` })
    service = openService()
    const replay = await service.runIndexMaintenanceSlice(original.providerId, 64)
    expect(replay.processed).toBe(0)
    expect(replay.notifications).toEqual([observed])
    expect(await postingKeywords(101)).toEqual(['laterorphan'])

    // The public direct API represents a later committed writer mutation before the earlier
    // publication is acknowledged. Both real changes have the same count, so count-only ACK
    // would erase the wrong notification when an old acknowledgement is retried.
    let laterRemoved = 0
    for (let page = 0; page < 64 && laterRemoved === 0; page += 1) {
      laterRemoved = await service.cleanupOrphanKeywords(original.providerId, 64)
    }
    expect(laterRemoved).toBe(1)
    const pending = await service.runIndexMaintenanceSlice(original.providerId, 64)
    const later = pending.notifications.find(
      (notification) => notification.commitKey !== observed.commitKey
    )!
    expect(later).toEqual(
      expect.objectContaining({ sourceId: original.providerId, affectedItems: 1 })
    )
    await service.acknowledgeIndexMaintenanceCommit(observed)
    await service.acknowledgeIndexMaintenanceCommit(observed)
    expect((await service.runIndexMaintenanceSlice(original.providerId, 64)).notifications).toEqual(
      [later]
    )
    await expect(
      service.acknowledgeIndexMaintenanceCommit({ ...later, sourceId: 'other-provider' })
    ).rejects.toThrow('INDEX_MAINTENANCE_COMMIT_SOURCE_MISMATCH')
    expect((await service.runIndexMaintenanceSlice(original.providerId, 64)).notifications).toEqual(
      [later]
    )
    await service.acknowledgeIndexMaintenanceCommit(later)
    expect((await service.runIndexMaintenanceSlice(original.providerId, 64)).notifications).toEqual(
      []
    )
  })
})

describe('integer document ids', () => {
  it('removes the postings of a removed document and of a removed provider, and nothing else', async () => {
    await service.indexItems([
      original,
      { ...original, itemId: 'kept-document', name: 'kepttitle' },
      { ...original, providerId: 'other-provider', name: 'othertitle' }
    ])
    const removedId = (await docIdOf(original.providerId, original.itemId))!
    const keptId = (await docIdOf(original.providerId, 'kept-document'))!
    const twinId = (await docIdOf('other-provider', original.itemId))!
    expect(new Set([removedId, keptId, twinId]).size).toBe(3)
    expect(await postingKeywords(removedId)).toContain('stabletitle')
    const twinKeywords = await postingKeywords(twinId)

    await service.removeProviderItems(original.providerId, [original.itemId])
    expect(await postingKeywords(removedId)).toEqual([])
    expect(await postingKeywords(keptId)).toContain('kepttitle')

    await service.removeByProvider(original.providerId)
    expect(
      (
        await client.execute(
          "SELECT doc_id FROM search_keyword_postings WHERE provider_id = 'document-provider'"
        )
      ).rows
    ).toEqual([])
    expect(await postingKeywords(twinId)).toEqual(twinKeywords)
  })

  it('does not hand out an id that an orphan posting still holds', async () => {
    await insertOrphanPosting('orphanword', 50)
    await service.indexItems([original])
    // Reusing 50 would give the new document the orphan's keyword.
    expect(await docIdOf(original.providerId, original.itemId)).toBe(51)
    expect(
      (await service.lookupByKeywords(original.providerId, ['orphanword'])).get('orphanword')
    ).toBeUndefined()
  })

  it('reaches postings and meta by document id instead of walking the provider', async () => {
    // Nothing here runs ANALYZE, as in the app. Without statistics SQLite estimates a bare
    // provider prefix at ten rows, so a statement naming more than ten documents prefers walking
    // the provider — on a real index, every row of the source. Hence twenty of each.
    const itemIds = Array.from({ length: 20 }, (_, index) => `document-${index}`)
    await service.indexItems(itemIds.map((itemId) => ({ ...original, itemId })))
    for (let index = 0; index < 20; index += 1)
      await insertOrphanPosting('orphanword', 1000 + index)
    const statements: Array<{ sql: string; params: unknown[] }> = []
    const traced = new SearchIndexService(
      drizzle(client, {
        logger: { logQuery: (query, params) => statements.push({ sql: query, params }) }
      }) as never,
      { directMode: true, initializationMode: 'writer' }
    )
    await traced.warmup()
    statements.length = 0

    const listed = await traced.listItemKeywords(original.providerId, itemIds)
    expect(new Set(listed.map((row) => row.itemId))).toEqual(new Set(itemIds))
    let removed = 0
    for (let page = 0; page < 8 && removed === 0; page += 1)
      removed = await traced.cleanupOrphanKeywords(original.providerId, 64)
    expect(removed).toBe(20)

    const walks: string[] = []
    for (const statement of statements) {
      if (!/search_keyword_postings|search_index_meta/.test(statement.sql)) continue
      const plan = await client.execute({
        sql: `EXPLAIN QUERY PLAN ${statement.sql}`,
        args: statement.params as never
      })
      for (const row of plan.rows) {
        const detail = String(row.detail)
        if (
          /\(provider_id=\?\)$/.test(detail) ||
          /\bSCAN (search_keyword_postings|search_index_meta)\b/.test(detail)
        )
          walks.push(`${detail} <- ${statement.sql}`)
      }
    }
    expect(walks).toEqual([])
  })
})

describe('moving keyword rows out of the legacy table', () => {
  type Notification = Awaited<
    ReturnType<SearchIndexService['runIndexMaintenanceSlice']>
  >['notifications'][number]

  const items: SearchIndexItem[] = [
    {
      ...original,
      itemId: 'move-a',
      name: 'alphatitle',
      keywords: [{ value: 'sharedword', priority: 2 }]
    },
    {
      ...original,
      itemId: 'move-b',
      name: 'betatitle',
      keywords: [{ value: 'sharedword', priority: 3 }]
    },
    {
      ...original,
      itemId: 'move-c',
      name: 'gammatitle',
      keywords: [{ value: 'sharedword', priority: 4 }]
    },
    // The same item id under another provider: the move must not cross providers.
    {
      ...original,
      providerId: 'other-provider',
      itemId: 'move-a',
      name: 'alphatitle',
      keywords: [{ value: 'sharedword', priority: 5 }]
    }
  ]

  /** The layout a build before integer ids leaves: keyword rows keyed by item id, no doc ids. */
  async function toLegacyLayout(): Promise<void> {
    await client.execute(`INSERT INTO keyword_mappings (keyword, item_id, provider_id, priority)
      SELECT p.keyword, m.item_id, p.provider_id, p.priority
      FROM search_keyword_postings p JOIN search_index_meta m ON m.doc_id = p.doc_id`)
    await client.execute('DELETE FROM search_keyword_postings')
    await client.execute('UPDATE search_index_meta SET doc_id = NULL')
  }

  /** `[provider, item]` -> sorted `keyword:priority` entries, for one layout. */
  async function documents(layout: 'legacy' | 'postings'): Promise<Map<string, string[]>> {
    const rows = (
      await client.execute(
        layout === 'legacy'
          ? 'SELECT provider_id, item_id, keyword, priority FROM keyword_mappings'
          : `SELECT m.provider_id, m.item_id, p.keyword, p.priority FROM search_keyword_postings p
             JOIN search_index_meta m ON m.doc_id = p.doc_id`
      )
    ).rows
    const byDocument = new Map<string, string[]>()
    for (const row of rows) {
      const key = JSON.stringify([row.provider_id, row.item_id])
      byDocument.set(key, [...(byDocument.get(key) ?? []), `${row.keyword}:${row.priority}`])
    }
    for (const entries of byDocument.values()) entries.sort()
    return byDocument
  }

  /** Everything a reader gets from keyword rows, in a stable order. */
  async function recall(): Promise<Record<string, Record<string, unknown[]>>> {
    const sorted = (rows: readonly unknown[]): unknown[] =>
      rows.map((row) => JSON.stringify(row)).sort()
    const snapshot: Record<string, Record<string, unknown[]>> = {}
    for (const provider of [original.providerId, 'other-provider']) {
      const exact = await service.lookupByKeywords(provider, ['sharedword', 'alphatitle'])
      snapshot[provider] = {
        exact: sorted([...exact].map(([keyword, rows]) => [keyword, sorted(rows)])),
        prefix: sorted(await service.lookupByKeywordPrefix(provider, 'shared')),
        subsequence: sorted(await service.lookupBySubsequence(provider, 'gmt')),
        ngrams: sorted(await service.lookupByNgrams(provider, 'alphatilte')),
        keywords: sorted(
          await service.listItemKeywords(provider, ['move-a', 'move-b', 'move-c'], 10_000)
        )
      }
    }
    return snapshot
  }

  async function insertLegacyRows(
    providerId: string,
    itemId: string,
    rows: ReadonlyArray<readonly [keyword: string, priority: number]>
  ): Promise<void> {
    for (const [keyword, priority] of rows) {
      await client.execute({
        sql: 'INSERT INTO keyword_mappings (keyword, item_id, provider_id, priority) VALUES (?, ?, ?, ?)',
        args: [keyword, itemId, providerId, priority]
      })
    }
  }

  async function drain(limit = 64): Promise<Notification[]> {
    const notifications: Notification[] = []
    for (let page = 0; page < 64; page += 1) {
      const slice = await service.runIndexMaintenanceSlice(original.providerId, limit)
      // The move out of the legacy table counts rows, 16 per unit of the limit.
      expect(slice.processed).toBeLessThanOrEqual(limit * 16)
      for (const notification of slice.notifications) {
        notifications.push(notification)
        await service.acknowledgeIndexMaintenanceCommit(notification)
      }
      if (slice.done && slice.notifications.length === 0) return notifications
    }
    throw new Error('fixture maintenance did not finish')
  }

  it('moves the rows in bounded slices while readers see each one exactly once', async () => {
    await service.indexItems(items)
    const baseline = await recall()
    expect(baseline['document-provider'].exact).toHaveLength(2)
    expect(baseline['other-provider'].exact).toHaveLength(2)
    for (const lookup of ['prefix', 'subsequence', 'ngrams', 'keywords']) {
      expect(baseline['document-provider'][lookup], lookup).not.toEqual([])
    }
    const moved = await documents('postings')
    await toLegacyLayout()
    expect(await documents('legacy')).toEqual(moved)
    expect(await recall()).toEqual(baseline)

    const rowCount = (byDocument: Map<string, string[]>): number =>
      [...byDocument.values()].reduce((sum, entries) => sum + entries.length, 0)
    let remaining = rowCount(moved)
    let split = 0
    for (let page = 0; page < 64 && remaining > 0; page += 1) {
      const slice = await service.runIndexMaintenanceSlice(original.providerId, 1)
      expect(slice.processed).toBeLessThanOrEqual(16)
      expect(slice.notifications).toEqual([])
      const legacy = await documents('legacy')
      const postings = await documents('postings')
      for (const [document, entries] of moved) {
        // Each row in exactly one layout.
        const held = [...(legacy.get(document) ?? []), ...(postings.get(document) ?? [])]
        expect(held.sort()).toEqual(entries)
        if (legacy.has(document) && postings.has(document)) split += 1
      }
      remaining = rowCount(legacy)
      expect(await recall()).toEqual(baseline)
    }
    expect(remaining).toBe(0)
    // Every document here has more rows than a slice moves.
    expect(split).toBeGreaterThan(0)
    const ids = (await client.execute('SELECT doc_id FROM search_index_meta')).rows.map(
      (row) => row.doc_id
    )
    expect(ids).toHaveLength(moved.size)
    expect(ids.every((id) => typeof id === 'number')).toBe(true)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('lets legacy rows replace the postings of the same document, across slices and passes', async () => {
    await service.indexItems([{ ...original, keywords: [{ value: 'currentword', priority: 2 }] }])
    const indexedId = (await docIdOf(original.providerId, original.itemId))!
    expect(await postingKeywords(indexedId)).toContain('currentword')
    // Only an older build writes here: after a downgrade and upgrade these rows are the newer copy.
    // Forty rows take three slices; the keyword held twice is in the first and the last.
    const fill = Array.from({ length: 38 }, (_, index) => [`downgradefill${index}`, 1] as const)
    await insertLegacyRows(original.providerId, original.itemId, [
      ['downgradeword', 5],
      ...fill,
      ['downgradeword', 4]
    ])

    expect(await drain(1)).toEqual([])
    const movedId = (await docIdOf(original.providerId, original.itemId))!
    expect(await postingKeywords(indexedId)).toEqual([])
    expect(await postingKeywords(movedId)).toEqual(
      ['downgradeword', ...fill.map(([keyword]) => keyword)].sort()
    )
    expect(
      await service.lookupByKeywords(original.providerId, ['downgradeword', 'currentword'])
    ).toEqual(new Map([['downgradeword', [{ itemId: original.itemId, priority: 5 }]]]))

    // A downgrade in the middle of a pass: the older build rewrites a document whose first rows
    // have moved, deleting its other legacy rows and writing its new keywords, which replace all.
    const pass = Array.from({ length: 40 }, (_, index) => [`password${index}`, 1] as const)
    await insertLegacyRows(original.providerId, original.itemId, pass)
    await service.runIndexMaintenanceSlice(original.providerId, 1)
    const partId = (await docIdOf(original.providerId, original.itemId))!
    expect(await postingKeywords(partId)).toHaveLength(16)
    await client.execute({
      sql: 'DELETE FROM keyword_mappings WHERE provider_id = ? AND item_id = ?',
      args: [original.providerId, original.itemId]
    })
    await insertLegacyRows(original.providerId, original.itemId, [['rewrittenword', 1]])

    expect(await drain(1)).toEqual([])
    const rewrittenId = (await docIdOf(original.providerId, original.itemId))!
    expect(await postingKeywords(rewrittenId)).toEqual(['rewrittenword'])
    expect(
      (await client.execute('SELECT count(*) AS n FROM search_keyword_postings')).rows
    ).toEqual([expect.objectContaining({ n: 1 })])
  })

  it('drops legacy rows no document owns and notifies their source once per document', async () => {
    await service.indexItems([original])
    const postings = (await client.execute(POSTINGS_SNAPSHOT)).rows
    // Twenty rows of one document take two slices: it still counts once.
    await insertLegacyRows(original.providerId, 'ghost-1', [
      ['ghostword', 1],
      ...Array.from({ length: 19 }, (_, index) => [`ghostother${index}`, 1] as const)
    ])
    await insertLegacyRows(original.providerId, 'ghost-2', [['ghostword', 1]])
    // Rows from before provider ids existed belong to no source.
    await insertLegacyRows('', 'ancient-item', [['ancientword', 1]])

    expect(await drain(1)).toEqual([
      expect.objectContaining({ sourceId: original.providerId, affectedItems: 2 })
    ])
    expect((await client.execute('SELECT id FROM keyword_mappings')).rows).toEqual([])
    expect((await client.execute(POSTINGS_SNAPSHOT)).rows).toEqual(postings)
    expect((await service.lookupByKeywords(original.providerId, ['ghostword'])).size).toBe(0)
  })
})
