import type {
  PerformanceNativeRuntimeBudget,
  PerformanceNativeRuntimeId
} from '@talex-touch/utils/transport/events/types'
import process from 'node:process'
import { createClient } from '@libsql/client'
import { createLogger } from '../utils/logger'

/**
 * Three N-API addons in the main process each build a Tokio multi-thread runtime: libSQL, the
 * `@crosscopy/clipboard` watcher and Tuff's screenshot addon. Tokio sizes one at the CPU count
 * unless `TOKIO_WORKER_THREADS` says otherwise — 3 × 14 parked threads on a 14-core M4 Pro, 42 of
 * the main process's 110 (`sample`, 2026-10-13). What they run is short native calls and one
 * change watcher, so two workers each is enough; blocking work goes to Tokio's separate,
 * on-demand blocking pool, which this does not cap.
 *
 * Each runtime is process-global and built once, when first needed: the clipboard and screenshot
 * addons when they load, libSQL when it opens its first database, from whichever thread does so.
 * Tokio reads the variable at that moment, so it is set only around those synchronous calls and
 * removed straight after. It must not stay set: child processes inherit the environment, and Codex
 * (itself a Tokio program), the terminal and every CLI the user starts from Tuff would run under
 * Tuff's cap.
 */
export const NATIVE_RUNTIME_WORKER_THREADS = 2

const TOKIO_WORKER_THREADS = 'TOKIO_WORKER_THREADS'
const nativeRuntimeLog = createLogger('NativeRuntimeThreads')
const builtRuntimes = new Set<PerformanceNativeRuntimeId>()

/**
 * Runs `build` — which must be synchronous — with Tokio's worker count capped, then records the
 * runtime as built when `isBuilt` accepts the result. A `TOKIO_WORKER_THREADS` the user set is
 * left alone and applies instead.
 */
export function withNativeRuntimeThreadBudget<T>(
  id: PerformanceNativeRuntimeId,
  build: () => T,
  isBuilt: (result: T) => boolean = () => true
): T {
  const userValue = process.env[TOKIO_WORKER_THREADS]
  if (userValue === undefined) {
    process.env[TOKIO_WORKER_THREADS] = String(NATIVE_RUNTIME_WORKER_THREADS)
  }
  try {
    const result = build()
    if (isBuilt(result)) builtRuntimes.add(id)
    return result
  } finally {
    if (userValue === undefined) delete process.env[TOKIO_WORKER_THREADS]
  }
}

/**
 * Builds libSQL's runtime before anything opens a real database. Several paths open one first
 * depending on startup order (startup config, the database module, worker threads), and a worker
 * thread's `process.env` is a private copy Tokio never sees — so the runtime is built here, from
 * the main thread, by opening and closing an in-memory database.
 */
export function prepareDatabaseRuntime(open: () => void = openInMemoryDatabase): void {
  try {
    withNativeRuntimeThreadBudget('libsql', open)
  } catch (error) {
    // The real open reports a broken binding with its own context; this only loses the cap.
    nativeRuntimeLog.warn('libSQL runtime was not prepared; it will size itself on first open', {
      error
    })
  }
}

function openInMemoryDatabase(): void {
  createClient({ url: ':memory:' }).close()
}

export function getNativeRuntimeBudget(): PerformanceNativeRuntimeBudget {
  const userValue = Number(process.env[TOKIO_WORKER_THREADS])
  const built = [...builtRuntimes]
  if (Number.isInteger(userValue) && userValue > 0) {
    return { workerThreads: userValue, source: 'environment', built }
  }
  return { workerThreads: NATIVE_RUNTIME_WORKER_THREADS, source: 'host-budget', built }
}
