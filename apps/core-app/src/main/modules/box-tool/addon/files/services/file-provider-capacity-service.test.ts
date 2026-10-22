/**
 * Capacity mode against real libSQL (`file-provider-capacity-service.ts`).
 *
 * The first suite fills an index to its cap through the real writer and evicts through the
 * maintenance service's own deletion path. The second drives the service over the real schema with
 * rows written directly, where windows, restarts and races can be staged.
 */
import type { Client, InArgs } from '@libsql/client'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const { capOverride } = vi.hoisted(() => ({ capOverride: { bytes: null as number | null } }))

vi.mock('@talex-touch/utils/common/utils/polling', () => ({
  pollingService: {
    register: vi.fn(),
    unregister: vi.fn()
  }
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/tmp/tuff-app'),
    getPath: vi.fn(() => '/tmp/tuff-user-data')
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
    getAllWindows: vi.fn(() => [])
  },
  dialog: {
    showMessageBox: vi.fn()
  }
}))

// The real generated migrations, as in `index.search-schema.test.ts`.
vi.mock('../../../../../../../resources/db/locator.json?commonjs-external&asset', () => {
  const testDir = dirname(fileURLToPath(import.meta.url))
  return { default: resolve(testDir, '../../../../../../../resources/db/locator.json') }
})

vi.mock('../../../../../db/search-index-size-cap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../db/search-index-size-cap')>()
  return {
    ...actual,
    readSearchIndexMaxBytes: async (directory: string) =>
      capOverride.bytes ?? (await actual.readSearchIndexMaxBytes(directory))
  }
})

vi.mock('../../../../../db/runtime-flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../../db/runtime-flags')>()),
  DB_SEARCH_SPLIT_ENABLED: true
}))

import * as schema from '../../../../../db/schema'
import { isSearchIndexReserveReachedError } from '../../../../../db/search-index-size-cap'
import { DatabaseModule } from '../../../../database'
import {
  acknowledgeFileDeletionCommitsInPrimaryHome,
  listPendingFileDeletionCommitsInPrimaryHome,
  removeFileRecordsInPrimaryHome,
  searchIndexWriter,
  type ExpectedFileRecord,
  type FilePersistencePort,
  type UpsertFileRecord
} from '../../../search-engine/search-index-writer'
import { markSearchActivity } from '../../../search-engine/search-activity'
import { SearchIndexService } from '../../../search-engine/search-index-service'
import { mapIndexedSourceRecordToSearchIndexItem } from '../../../search-engine/indexing-store-adapter'
import { getTypeTagsForExtension, KEYWORD_MAP } from '../constants'
import type { FileIndexedSourceRuntimeMutationDelegate } from '../file-provider-index-contracts'
import {
  FILE_CAPACITY_MIN_AGE_DAYS,
  FILE_CAPACITY_SWEEP_WINDOW,
  FILE_CAPACITY_TASKS,
  FileProviderCapacityService,
  type FileProviderCapacityDeps
} from './file-provider-capacity-service'
import {
  FILE_MAINTENANCE_ROUND_BUDGET_MS,
  FileProviderMaintenanceService
} from './file-provider-maintenance-service'
import type { FileProviderReconciliationDbRecord } from './file-provider-reconciliation-run-service'

const SOURCE = 'file-provider'
const DAY = 86_400
const NOW = Math.floor(Date.now() / 1000)
const MIGRATIONS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../../resources/db/migrations'
)
/** 1,536 pages of 4 KiB, of which the reserve keeps 256; about 1,170 of these files fit. */
const CAP_BYTES = 6 * 1024 * 1024
const EXTENSIONS = ['.ts', '.md', '.pdf', '.png', '.json', '.txt', '.docx', '.jpg', '.xlsx', '.py']
const WORDS = [
  'report',
  'invoice',
  'budget',
  'draft',
  'notes',
  'meeting',
  'design',
  'plan',
  'review',
  'photo',
  'contract',
  'summary',
  'chart',
  'slides',
  'lesson',
  'project',
  'config',
  'backup',
  'archive',
  'receipt'
]

interface SeedFile {
  path: string
  name: string
  extension: string
  mtime: number
  ctime: number
  size: number
}

interface DatabaseModuleInternals {
  initSearchDatabase: (databaseDirPath: string) => Promise<void>
  searchClient: Client | null
}

/** `count` files under `root`, `ageDays(index)` days old; created five days before they were last modified. */
function corpus(root: string, count: number, ageDays: (index: number) => number): SeedFile[] {
  return Array.from({ length: count }, (_, index) => {
    const extension = EXTENSIONS[index % EXTENSIONS.length]
    const name = `${WORDS[(index * 7) % WORDS.length]}-${WORDS[(index * 13 + 5) % WORDS.length]} ${index}${extension}`
    const mtime = Math.round(NOW - ageDays(index) * DAY)
    return {
      path: `${root}/folder-${index % 37}/${name}`,
      name,
      extension,
      mtime,
      ctime: mtime - 5 * DAY,
      size: 1_000 + index
    }
  })
}

/** 60 to 2,000 days old, in an order unrelated to age, as a scan finds them. */
function scrambledAge(count: number): (index: number) => number {
  return (index) => 60 + (((index * 7919) % count) / count) * 1_940
}

function fileTime(file: Pick<SeedFile, 'mtime' | 'ctime'>): number {
  return Math.max(file.mtime, file.ctime)
}

function toWriterInput(files: SeedFile[]) {
  const records: UpsertFileRecord[] = files.map((file) => ({
    path: file.path,
    name: file.name,
    extension: file.extension,
    size: file.size,
    mtime: new Date(file.mtime * 1000),
    ctime: new Date(file.ctime * 1000),
    lastIndexedAt: new Date(NOW * 1000),
    isDir: false,
    type: 'file'
  }))
  const items = files.map((file) => {
    const keywords = KEYWORD_MAP[file.extension] ?? []
    const tags = new Set<string>(getTypeTagsForExtension(file.extension))
    tags.add(file.extension.slice(1))
    const item = mapIndexedSourceRecordToSearchIndexItem({
      sourceId: SOURCE,
      recordId: file.path,
      stableKey: file.path,
      kind: 'file',
      title: file.name,
      subtitle: file.path,
      path: file.path,
      mtime: file.mtime * 1000,
      size: file.size,
      metadata: {
        extension: file.extension,
        type: 'file',
        isDir: false,
        runtimePublication: 'base'
      },
      keywords,
      tags: [...tags],
      search: { keywords: keywords.map((value) => ({ value, priority: 1.05 })) }
    } as never)
    if (!item) throw new Error(`no search item for ${file.path}`)
    return item
  })
  return { records, items }
}

/** Inserts in batches of ten, as a scan does, and stops at the first refusal. */
async function insertFiles(
  writer: SearchIndexService,
  files: SeedFile[]
): Promise<{ inserted: SeedFile[]; error: unknown }> {
  const inserted: SeedFile[] = []
  for (let start = 0; start < files.length; start += 10) {
    const batch = files.slice(start, start + 10)
    const { records, items } = toWriterInput(batch)
    try {
      await writer.persistAndApplyProviderItems(records, SOURCE, items)
    } catch (error) {
      return { inserted, error }
    }
    inserted.push(...batch)
  }
  return { inserted, error: null }
}

async function openSearchIndex(directory: string): Promise<Client> {
  const module = new DatabaseModule() as unknown as DatabaseModuleInternals
  await module.initSearchDatabase(directory)
  if (!module.searchClient) throw new Error('search index did not open')
  return module.searchClient
}

async function openWriter(client: Client): Promise<SearchIndexService> {
  const writer = new SearchIndexService(drizzle(client) as never, {
    directMode: true,
    initializationMode: 'writer'
  })
  await writer.warmup()
  return writer
}

async function checkpointAndClose(client: Client): Promise<void> {
  await client.execute('PRAGMA wal_checkpoint(TRUNCATE)')
  client.close()
}

async function readProgress(client: Client): Promise<Record<string, number>> {
  const result = await client.execute({
    sql: 'SELECT task, cursor FROM search_index_maintenance_progress WHERE task IN (?, ?)',
    args: [FILE_CAPACITY_TASKS.horizon, FILE_CAPACITY_TASKS.sweep]
  })
  return Object.fromEntries(result.rows.map((row) => [String(row.task), Number(row.cursor)]))
}

async function readPaths(client: Client): Promise<Set<string>> {
  const result = await client.execute("SELECT path FROM files WHERE type = 'file'")
  return new Set(result.rows.map((row) => String(row.path)))
}

function seconds(value: FileProviderReconciliationDbRecord['mtime']): number {
  return value instanceof Date ? Math.floor(value.getTime() / 1000) : Number(value)
}

function toExpected(record: FileProviderReconciliationDbRecord): ExpectedFileRecord {
  return {
    id: record.id,
    path: record.path,
    mtime: seconds(record.mtime),
    ctime: seconds(record.ctime),
    size: record.size,
    lastIndexedAt: seconds(record.lastIndexedAt),
    itemId: record.path
  }
}

function reserveRefusal(): Error {
  return new Error('SQLITE_FULL: SEARCH_INDEX_RESERVE_REACHED')
}

let templateDir = ''
let fullIndexFiles: SeedFile[] = []
/** One test may open several profiles. */
const dirs: string[] = []
const clients: Client[] = []
let maintenance: FileProviderMaintenanceService | undefined

beforeAll(async () => {
  templateDir = await mkdtemp(join(tmpdir(), 'tuff-capacity-template-'))
  const primary = createClient({ url: `file:${join(templateDir, 'database.db')}` })
  await migrate(drizzle(primary), { migrationsFolder: MIGRATIONS })
  primary.close()

  await mkdir(join(templateDir, 'empty'))
  await checkpointAndClose(await openSearchIndex(join(templateDir, 'empty')))

  // Filled through the real writer until the cap refuses a file, as a scan leaves it.
  await mkdir(join(templateDir, 'full'))
  capOverride.bytes = CAP_BYTES
  try {
    const search = await openSearchIndex(join(templateDir, 'full'))
    const filled = await insertFiles(
      await openWriter(search),
      corpus('/Users/someone/Archive', 4_000, scrambledAge(4_000))
    )
    if (!isSearchIndexReserveReachedError(filled.error)) {
      throw new Error(`the fixture did not fill: ${String(filled.error)}`)
    }
    fullIndexFiles = filled.inserted
    await checkpointAndClose(search)
  } finally {
    capOverride.bytes = null
  }
}, 180_000)

afterAll(async () => {
  if (templateDir) await rm(templateDir, { recursive: true, force: true })
})

afterEach(async () => {
  await maintenance?.stop()
  maintenance = undefined
  vi.restoreAllMocks()
  for (const client of clients.splice(0)) client.close()
  capOverride.bytes = null
  markSearchActivity(0)
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

/** A copy of a template: the primary database and the search index. */
async function openProfile(template: 'empty' | 'full') {
  const dir = await mkdtemp(join(tmpdir(), 'tuff-capacity-'))
  dirs.push(dir)
  await copyFile(join(templateDir, 'database.db'), join(dir, 'database.db'))
  await copyFile(join(templateDir, template, 'search-index.db'), join(dir, 'search-index.db'))
  const primary = createClient({ url: `file:${join(dir, 'database.db')}` })
  clients.push(primary)
  capOverride.bytes = template === 'full' ? CAP_BYTES : null
  const search = await openSearchIndex(dir)
  clients.push(search)
  const queries: Array<{ client: Client; sql: string; params: unknown[] }> = []
  const logged = (client: Client) => ({
    logQuery: (query: string, params: unknown[]) => queries.push({ client, sql: query, params })
  })
  return {
    primary,
    search,
    primaryDb: drizzle(primary, { schema, logger: logged(primary) }),
    searchDb: drizzle(search, { schema, logger: logged(search) }),
    queries
  }
}

describe('capacity mode on a full index', () => {
  it('evicts the oldest files, keeps the ones opened or pinned in Tuff, and takes new files again', async () => {
    markSearchActivity(0)
    const { primary, search, primaryDb, searchDb } = await openProfile('full')
    const writer = await openWriter(search)
    vi.spyOn(searchIndexWriter, 'execWrite').mockImplementation(async (statements) => {
      await search.batch(
        statements.map((statement) => ({ sql: statement.sql, args: statement.args as InArgs })),
        'write'
      )
      return []
    })

    const byAge = [...fullIndexFiles].sort((a, b) => fileTime(a) - fileTime(b))
    const [opened, searchedOnly, openedElsewhere, pinned] = byAge
    await primary.batch(
      [
        {
          sql: `INSERT INTO item_usage_stats (source_id, item_id, source_type, search_count, execute_count)
            VALUES (?, ?, 'file', 4, 2), (?, ?, 'file', 9, 0), ('app-provider', ?, 'application', 3, 3)`,
          args: [SOURCE, opened.path, SOURCE, searchedOnly.path, openedElsewhere.path]
        },
        {
          sql: "INSERT INTO pinned_items (source_id, item_id, source_type) VALUES (?, ?, 'file')",
          args: [SOURCE, pinned.path]
        }
      ],
      'write'
    )

    const published: number[] = []
    const delegate = {
      withMutationLease: async (operation: (leaseId: string) => Promise<unknown>) =>
        await operation('capacity-test-lease'),
      publishFileDeletionCommit: async (commit: { deletedRecords: Array<{ id?: number }> }) => {
        for (const record of commit.deletedRecords) published.push(Number(record.id))
      }
    } as unknown as FileIndexedSourceRuntimeMutationDelegate
    const port = {
      removeFileRecords: async (sourceId, records, options) =>
        await removeFileRecordsInPrimaryHome(searchDb, writer, sourceId, records, options),
      listPendingFileDeletionCommits: async (sourceId, limit, options) =>
        await listPendingFileDeletionCommitsInPrimaryHome(searchDb, sourceId, limit, options),
      acknowledgeFileDeletionCommits: async (sourceId, commitIds, options) =>
        await acknowledgeFileDeletionCommitsInPrimaryHome(searchDb, sourceId, commitIds, options)
    } as Partial<FilePersistencePort> as FilePersistencePort
    const onCapacityEvicted = vi.fn()
    const unsupported = (): never => {
      throw new Error('not part of capacity mode')
    }
    maintenance = new FileProviderMaintenanceService({
      sourceId: SOURCE,
      getDbUtils: () => ({ getDb: () => primaryDb, getFileIndexReadDb: () => searchDb }) as never,
      getSearchIndex: () => writer,
      getFilePersistencePort: () => port,
      getRuntimeMutationDelegate: () => delegate,
      isSplitEnabled: () => true,
      isShuttingDown: () => false,
      isInitializing: () => false,
      isWithinWatchRoots: () => true,
      normalizePath: normalize,
      mapRecord: unsupported,
      onBaseCommitReady: () => undefined,
      onCapacityEvicted,
      emitCleanupProgress: () => undefined,
      logInfo: () => undefined,
      logDebug: () => undefined,
      logWarn: () => undefined
    })
    const scheduled = vi
      .spyOn(maintenance, 'scheduleFileMaintenance')
      .mockImplementation(() => undefined)
    const capacity = maintenance.capacity

    const fresh = corpus('/Users/someone/Inbox', 600, (index) => (index % 20) / 2)
    let next = 0
    let attempt = await insertFiles(writer, fresh.slice(next, (next += 10)))
    expect(attempt.inserted).toHaveLength(0)
    expect(isSearchIndexReserveReachedError(attempt.error)).toBe(true)

    // Each refusal raises the horizon once; a scan the sweep made room for runs again.
    const horizons: number[] = []
    let admitted: SeedFile[] = []
    while (admitted.length === 0 && horizons.length < 6) {
      await capacity.relieve(attempt.error)
      const horizon = await capacity.readHorizonMs()
      expect(horizon).not.toBeNull()
      horizons.push(horizon! / 1000)
      while (
        await capacity.runSweepSlice({
          maintenance: true,
          maintenanceDeadlineAt: performance.now() + FILE_MAINTENANCE_ROUND_BUDGET_MS
        })
      );
      attempt = await insertFiles(writer, fresh.slice(next, (next += 50)))
      admitted = attempt.inserted
    }

    expect(admitted.length).toBeGreaterThan(0)
    expect(horizons).toEqual([...horizons].sort((a, b) => a - b))
    expect(scheduled).toHaveBeenCalledTimes(horizons.length)
    expect(onCapacityEvicted).toHaveBeenCalledTimes(horizons.length)
    const horizon = horizons.at(-1)!
    expect(await readProgress(search)).toEqual({ [FILE_CAPACITY_TASKS.horizon]: horizon })

    const remaining = await readPaths(search)
    const evicted = fullIndexFiles.filter((file) => !remaining.has(file.path))
    for (const file of fullIndexFiles) {
      const spared = file === opened || file === pinned
      expect(remaining.has(file.path), file.path).toBe(spared || fileTime(file) > horizon)
    }
    expect(remaining.has(searchedOnly.path)).toBe(false)
    expect(remaining.has(openedElsewhere.path)).toBe(false)
    expect(evicted.length / fullIndexFiles.length).toBeLessThan(0.5)
    expect(published).toHaveLength(evicted.length)
    const pending = await search.execute(
      'SELECT count(*) AS count FROM search_index_pending_commits'
    )
    expect(Number(pending.rows[0]?.count)).toBe(0)
    const documents = await search.execute({
      sql: 'SELECT item_id AS itemId FROM search_index_meta WHERE provider_id = ?',
      args: [SOURCE]
    })
    expect(new Set(documents.rows.map((row) => String(row.itemId)))).toEqual(remaining)

    // A scan that finds the evicted files again does not take them back.
    expect(await maintenance.admitScanRecords(toWriterInput(evicted).records)).toHaveLength(0)
    expect(await maintenance.admitScanRecords(toWriterInput(admitted).records)).toHaveLength(
      admitted.length
    )
  }, 120_000)
})

describe('capacity mode over the real schema', () => {
  interface Row {
    id: number
    path: string
    mtime: number
    ctime: number
  }

  async function insertRows(client: Client, rows: Row[]): Promise<void> {
    for (let start = 0; start < rows.length; start += 500) {
      const chunk = rows.slice(start, start + 500)
      await client.execute({
        sql: `INSERT INTO files (id, path, name, mtime, ctime, last_indexed_at, is_dir, type) VALUES ${chunk
          .map(() => "(?, ?, 'fixture', ?, ?, ?, 0, 'file')")
          .join(', ')}`,
        args: chunk.flatMap((row) => [row.id, row.path, row.mtime, row.ctime, row.mtime])
      })
    }
  }

  /** `count` rows `step` ids apart, aged as `ageDays(index)`. */
  function rows(count: number, step: number, ageDays: (index: number) => number): Row[] {
    return Array.from({ length: count }, (_, index) => {
      const mtime = Math.round(NOW - ageDays(index) * DAY)
      return {
        id: 1 + index * step,
        path: `/Users/someone/row-${index}`,
        mtime,
        ctime: mtime - DAY
      }
    })
  }

  async function setup(fixture: Row[], overrides: Partial<FileProviderCapacityDeps> = {}) {
    const profile = await openProfile('empty')
    await insertRows(profile.search, fixture)
    const evicted: number[] = []
    const offered: number[] = []
    const deps: FileProviderCapacityDeps = {
      sourceId: SOURCE,
      getDbUtils: () =>
        ({
          getDb: () => profile.primaryDb,
          getFileIndexReadDb: () => profile.searchDb
        }) as never,
      isSplitEnabled: () => true,
      writeProgress: async (statements) => {
        await profile.search.batch(
          statements.map((statement) => ({ sql: statement.sql, args: statement.args as InArgs })),
          'write'
        )
      },
      canContinue: () => true,
      evict: async (records) => {
        offered.push(...records.map((record) => record.id))
        const allowed = [...(await service.authorizeEviction(records.map(toExpected)))]
        if (allowed.length > 0) {
          await profile.search.execute({
            sql: `DELETE FROM files WHERE id IN (${allowed.map(() => '?').join(', ')})`,
            args: allowed
          })
        }
        evicted.push(...allowed)
        return { deleted: allowed.length, deferred: false }
      },
      onEvicted: vi.fn(),
      scheduleMaintenance: vi.fn(),
      now: () => NOW * 1000,
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      ...overrides
    }
    const service = new FileProviderCapacityService(deps)
    return { ...profile, deps, service, evicted, offered }
  }

  /** Lets a slice cover `windows` windows: the sweep checks once before each. */
  function windowsPerSlice(windows: number): {
    canContinue: () => boolean
    nextSlice: () => void
  } {
    let left = windows
    return {
      canContinue: () => left-- > 0,
      nextSlice: () => {
        left = windows
      }
    }
  }

  it('raises the horizon to about the oldest tenth and sweeps it window by window, across a restart', async () => {
    // Copies made recently count as new, whatever their modification time.
    const fixture = rows(3_000, 3, scrambledAge(3_000)).map((row, index) =>
      index % 100 === 0 ? { ...row, ctime: NOW - 3 * DAY } : row
    )
    const budget = windowsPerSlice(2)
    const first = await setup(fixture, { canContinue: budget.canContinue })

    await first.service.relieve(reserveRefusal())
    const horizon = (await first.service.readHorizonMs())! / 1000
    const covered = fixture.filter((row) => fileTime(row) <= horizon)
    expect(covered.length / fixture.length).toBeGreaterThan(0.06)
    expect(covered.length / fixture.length).toBeLessThan(0.14)
    expect(covered.some((row) => row.ctime > row.mtime)).toBe(false)
    expect(first.deps.scheduleMaintenance).toHaveBeenCalledTimes(1)
    expect(await readProgress(first.search)).toEqual({
      [FILE_CAPACITY_TASKS.horizon]: horizon,
      [FILE_CAPACITY_TASKS.sweep]: 0
    })

    const cursors: number[] = []
    for (let slice = 0; slice < 2; slice += 1) {
      budget.nextSlice()
      expect(await first.service.runSweepSlice({})).toBe(true)
      cursors.push((await readProgress(first.search))[FILE_CAPACITY_TASKS.sweep])
    }
    expect(cursors).toEqual([2 * FILE_CAPACITY_SWEEP_WINDOW, 4 * FILE_CAPACITY_SWEEP_WINDOW])

    // After a restart another instance takes the sweep up where the cursor stands.
    const second = new FileProviderCapacityService(first.deps)
    const onEvicted = vi.fn()
    first.deps.onEvicted = onEvicted
    let slices = 0
    do {
      budget.nextSlice()
      slices += 1
    } while (await second.runSweepSlice({}))
    expect(slices).toBe(3)
    expect(onEvicted).toHaveBeenCalledTimes(1)
    expect(first.deps.logInfo).toHaveBeenLastCalledWith(
      'File index capacity sweep finished',
      expect.objectContaining({ resumed: true })
    )
    expect(await readProgress(first.search)).toEqual({ [FILE_CAPACITY_TASKS.horizon]: horizon })
    // The sweep reads only what the horizon covers; the copies never reach the deletion.
    expect(first.offered).toEqual(covered.map((row) => row.id))
    expect([...first.evicted].sort((a, b) => a - b)).toEqual(covered.map((row) => row.id))
    const remaining = await readPaths(first.search)
    expect(remaining.size).toBe(fixture.length - covered.length)

    // Each query runs on an index; none walks a table or sorts.
    for (const query of first.queries) {
      if (!/\b(files|item_usage_stats|pinned_items)\b/.test(query.sql)) continue
      const plan = await query.client.execute({
        sql: `EXPLAIN QUERY PLAN ${query.sql}`,
        args: query.params as InArgs
      })
      const details = plan.rows.map((row) => String(row.detail))
      expect(
        details.filter((detail) => /^SCAN (?!CONSTANT ROW)|TEMP B-TREE/.test(detail)),
        query.sql
      ).toEqual([])
    }
  }, 60_000)

  it('treats a sweep from before a restart as having made room', async () => {
    const budget = windowsPerSlice(1)
    const first = await setup(rows(600, 1, scrambledAge(600)), { canContinue: budget.canContinue })
    await first.service.relieve(reserveRefusal())
    budget.nextSlice()
    // The one window holds every row; the check before the finish is past the budget.
    expect(await first.service.runSweepSlice({})).toBe(true)
    expect(first.evicted.length).toBeGreaterThan(0)
    expect(first.deps.onEvicted).not.toHaveBeenCalled()

    const second = new FileProviderCapacityService(first.deps)
    budget.nextSlice()
    expect(await second.runSweepSlice({})).toBe(false)
    expect(first.deps.onEvicted).toHaveBeenCalledTimes(1)
  })

  it('admits only files whose later of modification and creation time is after the horizon', async () => {
    const { service, deps } = await setup(rows(600, 1, scrambledAge(600)))
    const at = NOW * 1000 - 400 * DAY * 1000
    const candidates = [
      { name: 'at the horizon', mtime: new Date(at), ctime: new Date(at - DAY * 1000) },
      { name: 'a second later', mtime: new Date(at + 1_000), ctime: new Date(at - DAY * 1000) },
      { name: 'copied later', mtime: at - 100 * DAY * 1000, ctime: at + 1_000 },
      {
        name: 'older, as text',
        mtime: new Date(at - DAY * 1000).toISOString(),
        ctime: new Date(at - 2 * DAY * 1000).toISOString()
      },
      { name: 'unreadable', mtime: null, ctime: undefined }
    ]
    expect(await service.admit(candidates)).toEqual(candidates)

    await deps.writeProgress([
      {
        sql: 'INSERT INTO search_index_maintenance_progress (task, cursor) VALUES (?, ?)',
        args: [FILE_CAPACITY_TASKS.horizon, at / 1000]
      }
    ])
    expect((await service.admit(candidates)).map((candidate) => candidate.name)).toEqual([
      'a second later',
      'copied later',
      'unreadable'
    ])

    deps.isSplitEnabled = () => false
    expect(await service.admit(candidates)).toEqual(candidates)
  })

  it('stays 30 days behind now, and makes no raise that would leave every sampled file above it', async () => {
    // Nearly all files from the last 25 days, one in twenty from 40 to 60 days ago.
    const age = (index: number) => (index % 20 === 0 ? 40 + (index % 400) / 20 : (index % 25) + 0.5)
    const clamped = await setup(rows(2_000, 1, age))
    await clamped.service.relieve(reserveRefusal())
    expect((await clamped.service.readHorizonMs())! / 1000).toBe(
      NOW - FILE_CAPACITY_MIN_AGE_DAYS * DAY
    )
    while (await clamped.service.runSweepSlice({}));
    expect(clamped.evicted).toHaveLength(100)

    const recent = await setup(rows(2_000, 1, (index) => (index % 25) + 0.5))
    await recent.service.relieve(reserveRefusal())
    expect(await readProgress(recent.search)).toEqual({})
    expect(recent.deps.scheduleMaintenance).not.toHaveBeenCalled()
    expect(recent.deps.logInfo).toHaveBeenCalledWith(
      'File index full; no files old enough to evict',
      { horizon: null }
    )
  })

  it('needs enough samples to place the tenth', async () => {
    const { service, search } = await setup(rows(20, 1, scrambledAge(20)))
    await service.relieve(reserveRefusal())
    expect(await readProgress(search)).toEqual({})
  })

  it('acts only on the cap', async () => {
    const { service, search } = await setup(rows(600, 1, scrambledAge(600)))
    await service.relieve(
      Object.assign(new Error('SQLITE_FULL: database or disk is full'), { code: 'SQLITE_FULL' })
    )
    await service.relieve(new Error('SQLITE_BUSY: database is locked'))
    expect(await readProgress(search)).toEqual({})
    await service.relieve(new Error('wrapped', { cause: reserveRefusal() }))
    expect((await readProgress(search))[FILE_CAPACITY_TASKS.horizon]).toBeGreaterThan(0)
  })

  it('lets a reset win over a raise under way', async () => {
    const { service, search } = await setup(rows(600, 1, scrambledAge(600)))
    const raising = service.relieve(reserveRefusal())
    await service.reset()
    await raising
    expect(await readProgress(search)).toEqual({})
    expect(await service.readHorizonMs()).toBeNull()
  })

  it('does not move the cursor of a sweep under a horizon that changed during the slice', async () => {
    let moved = false
    const fixture = rows(2_000, 1, scrambledAge(2_000))
    const context = await setup(fixture)
    const { service, deps, search } = context
    const evict = deps.evict
    deps.evict = async (records, options) => {
      if (!moved) {
        moved = true
        await service.reset()
        await deps.writeProgress([
          {
            sql: 'INSERT INTO search_index_maintenance_progress (task, cursor) VALUES (?, ?), (?, ?)',
            args: [FILE_CAPACITY_TASKS.horizon, NOW - 1_000 * DAY, FILE_CAPACITY_TASKS.sweep, 0]
          }
        ])
      }
      return await evict(records, options)
    }
    await service.relieve(reserveRefusal())
    expect(await service.runSweepSlice({})).toBe(true)
    expect(await readProgress(search)).toEqual({
      [FILE_CAPACITY_TASKS.horizon]: NOW - 1_000 * DAY,
      [FILE_CAPACITY_TASKS.sweep]: 0
    })

    // The next slice sweeps the new horizon from the start.
    while (await service.runSweepSlice({}));
    const remaining = await readPaths(search)
    for (const row of fixture) {
      if (fileTime(row) <= NOW - 1_000 * DAY) expect(remaining.has(row.path)).toBe(false)
    }
  })

  it('clears the horizon on reset, after which nothing is refused or evicted', async () => {
    const { service, search } = await setup(rows(600, 1, scrambledAge(600)))
    await service.relieve(reserveRefusal())
    expect(await service.readHorizonMs()).not.toBeNull()
    await service.reset()
    expect(await readProgress(search)).toEqual({})
    expect(await service.readHorizonMs()).toBeNull()
    expect(await service.runSweepSlice({})).toBe(false)
    const old = {
      id: 1,
      path: '/Users/someone/row-0',
      mtime: 1,
      ctime: 1,
      size: 0,
      lastIndexedAt: 1,
      itemId: ''
    }
    expect(await service.authorizeEviction([old])).toEqual(new Set())
    expect(await service.admit([old])).toEqual([old])
  })
})
