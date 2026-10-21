import { and, gt, lte, sql } from 'drizzle-orm'
import type { DbUtils } from '../../../../../db/utils'
import { files as filesSchema, fileTypeIs } from '../../../../../db/schema'
import { isSearchIndexReserveReachedError } from '../../../../../db/search-index-size-cap'
import type { ExpectedFileRecord } from '../../../search-engine/search-index-writer'
import type { FileIndexRunOptions } from '../file-provider-index-contracts'
import type { FileProviderReconciliationDbRecord } from './file-provider-reconciliation-run-service'

/**
 * Capacity mode: how a full index keeps taking new files.
 *
 * At its cap the index refuses new files (`search-index-size-cap.ts`), which stops a scan with
 * `FILE_INDEX_STORAGE_FULL`. Each such stop moves a horizon forward. A file whose later of
 * modification and creation time is at or before the horizon is neither kept nor admitted:
 * maintenance sweeps the indexed ones out, sparing those opened or pinned in Tuff, and once the
 * sweep has removed files the scan runs again.
 *
 * One raise moves about a tenth of the files indexed above the horizon to at or below it. The tenth
 * is estimated from a sample, since counting would read the whole table on the main thread, and
 * files that share the horizon's second all go. The horizon stays at least 30 days behind now, so
 * an index full of recent files stays full; a raise that this leaves below every sampled file is
 * not made. Clearing the index clears the horizon.
 *
 * The horizon and the sweep's position are rows in `search_index_maintenance_progress`, and every
 * decision reads them there.
 */
export const FILE_CAPACITY_TASKS = {
  horizon: 'file-capacity:horizon',
  sweep: 'file-capacity:sweep'
} as const
export const FILE_CAPACITY_EVICTION_SHARE = 0.1
export const FILE_CAPACITY_MIN_AGE_DAYS = 30
/** Stripes of the row-id range; each gives at most one sample. */
export const FILE_CAPACITY_SAMPLE_PROBES = 256
/** Fewer samples than this cannot place the tenth, and the horizon stays where it is. */
export const FILE_CAPACITY_MIN_SAMPLES = 32
/** Row ids one sweep read covers. */
export const FILE_CAPACITY_SWEEP_WINDOW = 1_024
/** The most records `deleteFileRecords` takes at once. */
export const FILE_CAPACITY_EVICT_CHUNK = 64
const SECONDS_PER_DAY = 86_400
const PROBES_PER_YIELD = 32

type FileTime = Date | number | string | null | undefined

/**
 * A file's time in capacity mode, in seconds: the later of its modification and creation time
 * (`ctime` holds the birth time, so a copy counts as new). Records built from disk carry Dates or
 * milliseconds. NaN when neither reads; such a file is always admitted.
 */
export function resolveFileCapacityTime(record: { mtime: FileTime; ctime: FileTime }): number {
  const seconds = (value: FileTime): number => {
    const ms =
      value instanceof Date
        ? value.getTime()
        : typeof value === 'number'
          ? value
          : typeof value === 'string'
            ? Date.parse(value)
            : Number.NaN
    return Math.floor(ms / 1000)
  }
  const modified = seconds(record.mtime)
  const created = seconds(record.ctime)
  if (Number.isNaN(modified)) return created
  if (Number.isNaN(created)) return modified
  return Math.max(modified, created)
}

export interface FileProviderCapacityDeps {
  sourceId: string
  getDbUtils: () => DbUtils | null
  isSplitEnabled: () => boolean
  /** Runs the statements in one writer transaction. */
  writeProgress: (statements: Array<{ sql: string; args: unknown[] }>) => Promise<void>
  canContinue: (options: FileIndexRunOptions) => boolean
  /** Deletes what `authorizeEviction` allows of these records, inside a mutation lease. */
  evict: (
    records: FileProviderReconciliationDbRecord[],
    options: FileIndexRunOptions
  ) => Promise<{ deleted: number; deferred: boolean }>
  /** A sweep is over and has made room, so the scan it stopped can run again. */
  onEvicted: () => void
  scheduleMaintenance: () => void
  now?: () => number
  logInfo: (message: string, metadata?: Record<string, unknown>) => void
  logWarn: (message: string, error?: unknown, metadata?: Record<string, unknown>) => void
}

interface FileCapacityState {
  /** Seconds; `null` while capacity mode is off. */
  horizon: number | null
  /** The highest row id swept so far; `null` when no sweep is pending. */
  sweptThrough: number | null
}

const UPSERT_PROGRESS = `INSERT INTO search_index_maintenance_progress (task, cursor) VALUES (?, ?)
  ON CONFLICT(task) DO UPDATE SET cursor = excluded.cursor`
/** Moves the sweep cursor only from where this slice found it, and only under the same horizon. */
const ADVANCE_SWEEP = `UPDATE search_index_maintenance_progress SET cursor = ?
  WHERE task = ? AND cursor = ? AND EXISTS (
    SELECT 1 FROM search_index_maintenance_progress WHERE task = ? AND cursor = ?)`
const FINISH_SWEEP = `DELETE FROM search_index_maintenance_progress
  WHERE task = ? AND EXISTS (
    SELECT 1 FROM search_index_maintenance_progress WHERE task = ? AND cursor = ?)`
const DROP_ORPHAN_SWEEP = `DELETE FROM search_index_maintenance_progress
  WHERE task = ? AND NOT EXISTS (
    SELECT 1 FROM search_index_maintenance_progress WHERE task = ?)`

function toIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString()
}

export class FileProviderCapacityService {
  private relieving = false
  /** Bumped by `reset`, so a raise computed before it is not written after it. */
  private generation = 0
  /** The sweep this process is running. One found on disk was started before a restart. */
  private sweep: { horizon: number; evicted: number; inherited: boolean } | null = null

  constructor(private readonly deps: FileProviderCapacityDeps) {}

  /** Capacity mode exists only under the split, where the index file has a cap of its own. */
  private get dbUtils(): DbUtils | null {
    const dbUtils = this.deps.getDbUtils()
    return dbUtils && this.deps.isSplitEnabled() ? dbUtils : null
  }

  /** Raises the horizon after the cap stopped a scan; any other error is left alone. */
  public async relieve(error: unknown): Promise<void> {
    if (this.relieving || !isSearchIndexReserveReachedError(error)) return
    const dbUtils = this.dbUtils
    if (!dbUtils) return
    this.relieving = true
    const generation = this.generation
    try {
      const state = await this.readState(dbUtils)
      if (state.sweptThrough !== null) {
        // The last raise has not made its room yet.
        this.deps.scheduleMaintenance()
        return
      }
      const current = state.horizon ?? 0
      const choice = await this.chooseHorizon(dbUtils, current)
      if (!choice) {
        this.deps.logInfo('File index full; no files old enough to evict', {
          horizon: state.horizon === null ? null : toIso(state.horizon)
        })
        return
      }
      if (generation !== this.generation) return
      await this.deps.writeProgress([
        { sql: UPSERT_PROGRESS, args: [FILE_CAPACITY_TASKS.horizon, choice.horizon] },
        { sql: UPSERT_PROGRESS, args: [FILE_CAPACITY_TASKS.sweep, 0] }
      ])
      this.sweep = { horizon: choice.horizon, evicted: 0, inherited: false }
      this.deps.logInfo('File index full; evicting files at or before the horizon', {
        from: state.horizon === null ? null : toIso(state.horizon),
        to: toIso(choice.horizon),
        samples: choice.samples
      })
      this.deps.scheduleMaintenance()
    } catch (relieveError) {
      this.deps.logWarn('File index capacity relief failed', relieveError)
    } finally {
      this.relieving = false
    }
  }

  /**
   * The tenth of the indexed files above `current`, from the first file of each stripe of the
   * row-id range. A stripe reads at most its own rows, so the whole sample reads at most the table.
   */
  private async chooseHorizon(
    dbUtils: DbUtils,
    current: number
  ): Promise<{ horizon: number; samples: number } | null> {
    const db = dbUtils.getFileIndexReadDb()
    // Two subqueries: `min(id), max(id)` in one SELECT walks the whole table.
    const bounds = await db.all<{ low: number | null; high: number | null }>(
      sql`SELECT (SELECT min(id) FROM files) AS low, (SELECT max(id) FROM files) AS high`
    )
    const low = Number(bounds[0]?.low)
    const high = Number(bounds[0]?.high)
    if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high)) return null
    const span = high - low + 1
    const times: number[] = []
    for (let probe = 0; probe < FILE_CAPACITY_SAMPLE_PROBES; probe += 1) {
      if (probe > 0 && probe % PROBES_PER_YIELD === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      const from = low + Math.floor((span * probe) / FILE_CAPACITY_SAMPLE_PROBES)
      const to = low + Math.floor((span * (probe + 1)) / FILE_CAPACITY_SAMPLE_PROBES)
      if (to <= from) continue
      const rows = await db.all<{ time: number }>(sql`
        SELECT max(mtime, ctime) AS time FROM files
        WHERE id >= ${from} AND id < ${to} AND ${fileTypeIs('file')}
          AND max(mtime, ctime) > ${current}
        ORDER BY id LIMIT 1`)
      const time = Number(rows[0]?.time)
      if (rows.length > 0 && Number.isSafeInteger(time)) times.push(time)
    }
    if (times.length < FILE_CAPACITY_MIN_SAMPLES) return null
    times.sort((a, b) => a - b)
    const tenth = times[Math.max(0, Math.ceil(times.length * FILE_CAPACITY_EVICTION_SHARE) - 1)]
    const newest =
      Math.floor((this.deps.now?.() ?? Date.now()) / 1000) -
      FILE_CAPACITY_MIN_AGE_DAYS * SECONDS_PER_DAY
    const horizon = Math.min(tenth, newest)
    // Clamped below every sample, a raise would sweep the table for next to nothing.
    return times[0] <= horizon ? { horizon, samples: times.length } : null
  }

  /**
   * One maintenance round of the pending sweep: windows of row ids in order, as far as the round's
   * budget goes. Returns whether a sweep is still pending.
   */
  public async runSweepSlice(options: FileIndexRunOptions): Promise<boolean> {
    const dbUtils = this.dbUtils
    if (!dbUtils) return false
    const generation = this.generation
    const state = await this.readState(dbUtils)
    if (state.sweptThrough === null) return false
    const horizon = state.horizon
    if (horizon === null) {
      await this.deps.writeProgress([
        { sql: DROP_ORPHAN_SWEEP, args: [FILE_CAPACITY_TASKS.sweep, FILE_CAPACITY_TASKS.horizon] }
      ])
      return false
    }
    if (this.sweep?.horizon !== horizon) this.sweep = { horizon, evicted: 0, inherited: true }
    const sweep = this.sweep
    const db = dbUtils.getFileIndexReadDb()
    const top = Number(
      (await db.all<{ high: number | null }>(sql`SELECT max(id) AS high FROM files`))[0]?.high ?? 0
    )
    let sweptThrough = state.sweptThrough
    while (generation === this.generation && this.deps.canContinue(options)) {
      if (sweptThrough >= top) {
        await this.finishSweep(horizon, sweep)
        return false
      }
      const through = Math.min(sweptThrough + FILE_CAPACITY_SWEEP_WINDOW, top)
      const records = await db
        .select({
          id: filesSchema.id,
          path: filesSchema.path,
          mtime: filesSchema.mtime,
          ctime: filesSchema.ctime,
          size: filesSchema.size,
          lastIndexedAt: filesSchema.lastIndexedAt
        })
        .from(filesSchema)
        .where(
          and(
            gt(filesSchema.id, sweptThrough),
            lte(filesSchema.id, through),
            fileTypeIs('file'),
            sql`max(${filesSchema.mtime}, ${filesSchema.ctime}) <= ${horizon}`
          )
        )
        .orderBy(filesSchema.id)
      // The read is synchronous; let the main thread breathe between windows.
      await new Promise<void>((resolve) => setImmediate(resolve))
      let deferred = false
      for (let start = 0; start < records.length; start += FILE_CAPACITY_EVICT_CHUNK) {
        const result = await this.deps.evict(
          records.slice(start, start + FILE_CAPACITY_EVICT_CHUNK),
          options
        )
        sweep.evicted += result.deleted
        if (result.deferred) {
          deferred = true
          break
        }
      }
      if (deferred) break
      sweptThrough = through
    }
    if (sweptThrough > state.sweptThrough) {
      await this.deps.writeProgress([
        {
          sql: ADVANCE_SWEEP,
          args: [
            sweptThrough,
            FILE_CAPACITY_TASKS.sweep,
            state.sweptThrough,
            FILE_CAPACITY_TASKS.horizon,
            horizon
          ]
        }
      ])
    }
    return true
  }

  private async finishSweep(
    horizon: number,
    sweep: { evicted: number; inherited: boolean }
  ): Promise<void> {
    await this.deps.writeProgress([
      { sql: FINISH_SWEEP, args: [FILE_CAPACITY_TASKS.sweep, FILE_CAPACITY_TASKS.horizon, horizon] }
    ])
    this.sweep = null
    this.deps.logInfo('File index capacity sweep finished', {
      horizon: toIso(horizon),
      evicted: sweep.evicted,
      resumed: sweep.inherited
    })
    // What a sweep from before a restart removed is unknown; assume it made room.
    if (sweep.evicted > 0 || sweep.inherited) this.deps.onEvicted()
  }

  /**
   * Which of these indexed records capacity mode may delete, checked inside the deletion's lease:
   * those at or below the horizon as it stands now that were never opened or pinned in Tuff.
   */
  public async authorizeEviction(records: readonly ExpectedFileRecord[]): Promise<Set<number>> {
    const dbUtils = this.dbUtils
    if (!dbUtils || records.length === 0) return new Set()
    const { horizon } = await this.readState(dbUtils)
    if (horizon === null) return new Set()
    const candidates = records.filter((record) => Math.max(record.mtime, record.ctime) <= horizon)
    if (candidates.length === 0) return new Set()
    const list = sql.join(
      candidates.map((record) => sql`${record.path}`),
      sql`, `
    )
    // Usage and pins live in the primary database; a file's item id is its path.
    const kept = await dbUtils.getDb().all<{ itemId: string }>(sql`
      SELECT item_id AS itemId FROM item_usage_stats
      WHERE source_id = ${this.deps.sourceId} AND +execute_count > 0 AND item_id IN (${list})
      UNION ALL
      SELECT item_id FROM pinned_items
      WHERE source_id = ${this.deps.sourceId} AND item_id IN (${list})`)
    const keptPaths = new Set(kept.map((row) => row.itemId))
    return new Set(
      candidates.filter((record) => !keptPaths.has(record.path)).map((record) => record.id)
    )
  }

  /** Drops the records at or below the horizon: a full index does not take them back. */
  public async admit<T extends { mtime: FileTime; ctime: FileTime }>(records: T[]): Promise<T[]> {
    if (records.length === 0) return records
    const dbUtils = this.dbUtils
    if (!dbUtils) return records
    const { horizon } = await this.readState(dbUtils)
    if (horizon === null) return records
    return records.filter((record) => !(resolveFileCapacityTime(record) <= horizon))
  }

  /** Clears the horizon. Call it before the index is cleared, so a failure leaves both in place. */
  public async reset(): Promise<void> {
    this.generation += 1
    this.sweep = null
    if (!this.dbUtils) return
    await this.deps.writeProgress([
      {
        sql: 'DELETE FROM search_index_maintenance_progress WHERE task IN (?, ?)',
        args: [FILE_CAPACITY_TASKS.horizon, FILE_CAPACITY_TASKS.sweep]
      }
    ])
  }

  /** The horizon in milliseconds, or `null` while capacity mode is off. */
  public async readHorizonMs(): Promise<number | null> {
    const dbUtils = this.dbUtils
    if (!dbUtils) return null
    const { horizon } = await this.readState(dbUtils)
    return horizon === null ? null : horizon * 1000
  }

  private async readState(dbUtils: DbUtils): Promise<FileCapacityState> {
    const rows = await dbUtils.getFileIndexReadDb().all<{ task: string; cursor: number }>(sql`
      SELECT task, cursor FROM search_index_maintenance_progress
      WHERE task IN (${FILE_CAPACITY_TASKS.horizon}, ${FILE_CAPACITY_TASKS.sweep})`)
    const state: FileCapacityState = { horizon: null, sweptThrough: null }
    for (const row of rows) {
      const cursor = Number(row.cursor)
      if (!Number.isSafeInteger(cursor)) continue
      if (row.task === FILE_CAPACITY_TASKS.horizon && cursor > 0) state.horizon = cursor
      if (row.task === FILE_CAPACITY_TASKS.sweep) state.sweptThrough = cursor
    }
    return state
  }
}
