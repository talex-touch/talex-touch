import type { IndexedWorkerScheduleResult } from '@talex-touch/utils/search'
import { and, eq, gt, inArray, isNull, notInArray, or } from 'drizzle-orm'
import type { DbUtils } from '../../../../../db/utils'
import { fileIndexProgress, files as filesSchema } from '../../../../../db/schema'
import { IMAGE_EMBEDDING_EXTENSIONS } from '../constants'
import type { FileProviderIndexSchedulerFile } from './file-provider-index-scheduler-service'

const RESUME_BATCH_SIZE = 200
/**
 * A round that admits nothing while the scheduler reports deferred work means
 * capacity is held elsewhere. Stop this pass (rows stay durably pending; the
 * follow-up round after the cooldown retries) instead of spinning.
 */
const MAX_CONSECUTIVE_NO_ADMIT_ROUNDS = 5
/**
 * Quiet time between the end of one recovery round and the start of the next.
 * Every round publishes what it enriches and each publication is an index
 * commit, so rounds must not run back to back: requests made while a round runs
 * or during this window share one follow-up round.
 */
export const ENRICHMENT_RESUME_ROUND_COOLDOWN_MS = 45_000
/** Message of the AggregateError `IndexedWorkerSchedulerService.drain` rejects with. */
const SCHEDULER_DISPATCH_FAILED = 'INDEXED_WORKER_SCHEDULER_DISPATCH_FAILED'

/**
 * How a round ended. `wrapped` reached the end of a lane after starting
 * mid-lane, so the rows before its starting cursor still need a pass.
 */
type ResumeRoundOutcome = 'completed' | 'wrapped' | 'paused' | 'stopped'

export interface FileProviderEnrichmentResumeServiceDeps {
  getDbUtils: () => DbUtils | null
  isSearchIndexAvailable: () => boolean
  isShuttingDown: () => boolean
  isEnabled: () => boolean
  isImageEmbeddingReady?: () => boolean
  withMutationLease: <T>(operation: (leaseId: string) => Promise<T>) => Promise<T>
  scheduleIndexing: (
    files: FileProviderIndexSchedulerFile[],
    reason: string,
    mutationLeaseId: string
  ) => Promise<IndexedWorkerScheduleResult>
  waitForSearchIndexDrain: (reason: string, mutationLeaseId: string) => Promise<void>
  yieldToEventLoop: () => Promise<void>
  logInfo: (message: string, meta?: Record<string, unknown>) => void
  logWarn: (message: string, error?: unknown, meta?: Record<string, unknown>) => void
}

/**
 * Resumes post-scan content/embedding work from durable file_index_progress
 * records. It deliberately does not alter scan_progress: that table proves
 * filesystem coverage, while this service repairs only unfinished enrichment.
 *
 * Fresh files without progress, unfinished retries, and legacy disabled-image
 * backfill have independent keyset cursors. Each round starts with fresh work
 * and rotates fresh → retry → legacy, giving each lane at most one page per
 * turn, including after a partial admission. A cursor advances only over a
 * fully admitted page (`deferred === 0`), so an unadmitted suffix stays pending
 * in its own lane.
 *
 * A lane's cursor survives across rounds and resets to 0 at its end. Within
 * that round, subsequent probes still use its last scanned id, not 0: new work
 * can interrupt backfill without re-reading the head until the next round.
 * Empty lanes are probed again only after another lane admits work or moves
 * past a stuck page. Rounds share the existing cooldown and single unref'd
 * follow-up timer; a paused round or mid-lane wrap also requests a follow-up.
 */
export class FileProviderEnrichmentResumeService {
  private resumePromise: Promise<void> | null = null
  private rerunRequested = false
  /** Independent keyset cursors (files.id) shared by every round. */
  private readonly cursors = { fresh: 0, retry: 0, legacy: 0 }
  private lastRoundEndedAt: number | null = null
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deps: FileProviderEnrichmentResumeServiceDeps) {}

  resume(reason: string): void {
    if (this.deps.isShuttingDown() || !this.deps.isEnabled()) return
    if (this.resumePromise) {
      // A pass is already running. Rows it marks pending (or a change event's
      // deferred overflow) must not wait for an unrelated future drain, so
      // remember the request and run one more pass after the cooldown.
      this.rerunRequested = true
      return
    }
    // The pending follow-up already covers every request made during the cooldown.
    if (this.cooldownTimer) return
    // Capped at one cooldown: `lastRoundEndedAt` is wall-clock time, and a clock set back after
    // the round ended would otherwise hold recovery for as long as the clock moved.
    const cooldownRemainingMs =
      this.lastRoundEndedAt === null
        ? 0
        : Math.min(
            ENRICHMENT_RESUME_ROUND_COOLDOWN_MS,
            this.lastRoundEndedAt + ENRICHMENT_RESUME_ROUND_COOLDOWN_MS - Date.now()
          )
    if (cooldownRemainingMs > 0) {
      this.scheduleFollowUp(cooldownRemainingMs, reason)
      return
    }
    this.startRound(reason)
  }

  stop(): void {
    this.rerunRequested = false
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer)
      this.cooldownTimer = null
    }
  }

  isActive(): boolean {
    return this.resumePromise !== null || this.cooldownTimer !== null
  }

  private startRound(reason: string): void {
    const run: Promise<void> = this.run(reason)
      .catch((error): ResumeRoundOutcome => {
        this.deps.logWarn('Deferred file enrichment recovery paused', error, { reason })
        return 'paused'
      })
      .then((outcome) => {
        if (this.resumePromise === run) this.resumePromise = null
        this.lastRoundEndedAt = Date.now()
        // The round's own publications do not call resume
        // (FileProvider.drainIndexedSourceMutations), so a paused or partial
        // pass would otherwise wait for some unrelated mutation.
        const followUp = this.rerunRequested || outcome === 'paused' || outcome === 'wrapped'
        this.rerunRequested = false
        if (followUp && !this.deps.isShuttingDown() && this.deps.isEnabled()) {
          this.scheduleFollowUp(ENRICHMENT_RESUME_ROUND_COOLDOWN_MS, 'follow-up')
        }
      })
    this.resumePromise = run
  }

  /** Arms the single cooldown timer; while it is pending, further requests add nothing. */
  private scheduleFollowUp(delayMs: number, reason: string): void {
    if (this.cooldownTimer) return
    const timer = setTimeout(() => {
      this.cooldownTimer = null
      if (this.deps.isShuttingDown() || !this.deps.isEnabled()) return
      if (this.resumePromise) {
        this.rerunRequested = true
        return
      }
      this.startRound(reason)
    }, delayMs)
    // Background recovery must never keep the process alive.
    timer.unref?.()
    this.cooldownTimer = timer
  }

  private async run(reason: string): Promise<ResumeRoundOutcome> {
    const dbUtils = this.deps.getDbUtils()
    if (!dbUtils || !this.deps.isSearchIndexAvailable() || !this.deps.isEnabled()) return 'stopped'

    const label = `enrichment-resume.${reason}`
    const lanes = {
      fresh: {
        cursor: this.cursors.fresh,
        startedAt: this.cursors.fresh,
        exhausted: false,
        reachedEnd: false,
        failedPageIds: null as number[] | null
      },
      retry: {
        cursor: this.cursors.retry,
        startedAt: this.cursors.retry,
        exhausted: false,
        reachedEnd: false,
        failedPageIds: null as number[] | null
      },
      legacy: {
        cursor: this.cursors.legacy,
        startedAt: this.cursors.legacy,
        exhausted: false,
        reachedEnd: false,
        failedPageIds: null as number[] | null
      }
    }
    const laneOrder = ['fresh', 'retry', 'legacy'] as const
    let laneIndex = 0
    const imageExtensions = [...IMAGE_EMBEDDING_EXTENSIONS]
    let outcome: ResumeRoundOutcome = 'stopped'
    let scheduled = 0
    let noAdmitRounds = 0
    let failedPages = 0
    while (!this.deps.isShuttingDown() && this.deps.isEnabled()) {
      if (laneOrder.every((name) => lanes[name].exhausted)) {
        outcome = laneOrder.some((name) => lanes[name].reachedEnd && lanes[name].startedAt > 0)
          ? 'wrapped'
          : 'completed'
        break
      }
      const lane = laneOrder[laneIndex]!
      const state = lanes[lane]
      if (state.exhausted) {
        laneIndex = (laneIndex + 1) % laneOrder.length
        continue
      }
      const imageReady = this.deps.isImageEmbeddingReady?.() ?? true
      if (lane === 'legacy' && !imageReady) {
        // Model unavailability is not the end of this lane; retain its cursor.
        state.exhausted = true
        laneIndex = (laneIndex + 1) % laneOrder.length
        continue
      }
      const nonImage = or(
        isNull(filesSchema.extension),
        notInArray(filesSchema.extension, imageExtensions)
      )
      const unfinished =
        lane === 'fresh'
          ? isNull(fileIndexProgress.fileId)
          : inArray(fileIndexProgress.status, ['pending', 'processing'])
      const recoverable =
        lane === 'legacy'
          ? and(
              inArray(filesSchema.extension, imageExtensions),
              eq(fileIndexProgress.status, 'skipped'),
              eq(fileIndexProgress.lastError, 'content-indexing-disabled')
            )
          : imageReady
            ? unfinished
            : and(unfinished, nonImage)
      const rows = await dbUtils
        .getFileIndexReadDb()
        .select({
          id: filesSchema.id,
          path: filesSchema.path,
          name: filesSchema.name,
          displayName: filesSchema.displayName,
          extension: filesSchema.extension,
          size: filesSchema.size,
          mtime: filesSchema.mtime,
          ctime: filesSchema.ctime
        })
        .from(filesSchema)
        .leftJoin(fileIndexProgress, eq(fileIndexProgress.fileId, filesSchema.id))
        .where(and(eq(filesSchema.type, 'file'), gt(filesSchema.id, state.cursor), recoverable))
        .orderBy(filesSchema.id)
        .limit(RESUME_BATCH_SIZE)

      if (rows.length === 0) {
        // Keep this round's scan position for probes of newly added higher ids.
        // The durable cursor stays wrapped for the next round's head recovery.
        this.cursors[lane] = 0
        state.reachedEnd = true
        state.exhausted = true
        laneIndex = (laneIndex + 1) % laneOrder.length
        continue
      }

      if (state.failedPageIds && isSamePage(rows, state.failedPageIds)) {
        // The failed dispatch left this entire lane's page pending. Step past
        // it for now; the pass after the wrap retries these durable rows.
        state.cursor = rows[rows.length - 1]!.id
        if (!state.reachedEnd) this.cursors[lane] = state.cursor
        state.failedPageIds = null
        for (const peer of laneOrder) {
          if (peer !== lane) lanes[peer].exhausted = false
        }
        laneIndex = (laneIndex + 1) % laneOrder.length
        await this.deps.yieldToEventLoop()
        continue
      }
      state.failedPageIds = null

      const { result, dispatchFailed } = await this.deps.withMutationLease(async (leaseId) => {
        // A successor scan/reset must not hold the gate while waiting for this
        // page's publication to acquire it. Own one lease for the entire page.
        const result = await this.deps.scheduleIndexing(rows, label, leaseId)
        const dispatchFailed = await this.drainPage(label, leaseId)
        return { result, dispatchFailed }
      })
      if (dispatchFailed) failedPages += 1

      if (result.accepted + result.deferred === 0) {
        // Nothing schedulable (provider closed or index unavailable): stop.
        break
      }
      // Only admitted work can make empty peer lanes worth probing again.
      if (result.accepted > 0) {
        for (const peer of laneOrder) {
          if (peer !== lane) lanes[peer].exhausted = false
        }
      }
      laneIndex = (laneIndex + 1) % laneOrder.length

      if (result.deferred > 0) {
        scheduled += result.accepted
        noAdmitRounds = result.accepted === 0 ? noAdmitRounds + 1 : 0
        if (noAdmitRounds >= MAX_CONSECUTIVE_NO_ADMIT_ROUNDS) {
          this.deps.logWarn('Deferred file enrichment recovery paused', undefined, {
            reason,
            remaining: rows.length
          })
          outcome = 'paused'
          break
        }
        // Leave this lane's cursor before the unadmitted suffix, but give the
        // other lanes their next pages before retrying the durable remainder.
        if (dispatchFailed) state.failedPageIds = rows.map((row) => row.id)
        await this.deps.yieldToEventLoop()
        continue
      }

      scheduled += result.accepted
      noAdmitRounds = 0
      // A fully admitted page is done even when a chunk failed (failed files are
      // terminal). Do not overwrite a wrap already owed to the next round.
      state.cursor = rows[rows.length - 1]!.id
      if (!state.reachedEnd) this.cursors[lane] = state.cursor
      await this.deps.yieldToEventLoop()
    }

    if (scheduled > 0) {
      this.deps.logInfo('Deferred file enrichment recovery completed', {
        reason,
        scheduled,
        ...(failedPages > 0 ? { failedPages } : {})
      })
    }
    return outcome
  }

  /**
   * Waits for the page's admitted work. A failed chunk surfaces as the
   * scheduler's dispatch-failed error as soon as the scheduler is idle; that is
   * a failed page, not a failed round, so settle the page's flush and move on.
   * Any other error (a drain timeout) still ends the round.
   */
  private async drainPage(label: string, mutationLeaseId: string): Promise<boolean> {
    try {
      await this.deps.waitForSearchIndexDrain(label, mutationLeaseId)
      return false
    } catch (error) {
      if (!isSchedulerDispatchFailure(error)) throw error
    }
    try {
      await this.deps.waitForSearchIndexDrain(label, mutationLeaseId)
    } catch (error) {
      if (!isSchedulerDispatchFailure(error)) throw error
    }
    return true
  }
}

function isSchedulerDispatchFailure(error: unknown): boolean {
  return error instanceof Error && error.message === SCHEDULER_DISPATCH_FAILED
}

function isSamePage(rows: ReadonlyArray<{ id: number }>, ids: readonly number[]): boolean {
  return rows.length === ids.length && rows.every((row, index) => row.id === ids[index])
}
