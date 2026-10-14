/**
 * Settings › Performance: what Tuff itself costs while it runs.
 *
 * The host computes a report only when the page asks for one and keeps no sampler of its own.
 * CPU, wakeup and event-loop figures are deltas since the previous request, so the page's refresh
 * cadence is the measurement window and nothing is measured while the page is closed.
 */

/** What a process is for, resolved by the host from Electron's process type and service name. */
export type PerformanceProcessRole =
  | 'browser'
  | 'gpu'
  | 'renderer'
  | 'network-service'
  | 'plugin-runtime'
  | 'pi-agent-runtime'
  | 'ocr-runtime'
  | 'utility'
  | 'other'

/** A window or view hosted by a renderer process. */
export type PerformanceSurfaceKind =
  | 'corebox'
  | 'main-window'
  | 'meta-overlay'
  | 'plugin-view'
  | 'devtools'
  | 'other'

export interface PerformanceSurface {
  kind: PerformanceSurfaceKind
  /** The plugin's name for `plugin-view`; null for every other kind. */
  pluginName: string | null
}

export interface PerformanceProcessSample {
  pid: number
  role: PerformanceProcessRole
  /** Electron's `ProcessMetric.type`, e.g. `Browser`, `Tab`, `GPU`, `Utility`. */
  electronType: string
  /** The utility service name Electron reports; null for other process types. */
  serviceName: string | null
  /** Windows and views this renderer hosts; empty for every other role. */
  surfaces: PerformanceSurface[]
  /** CPU since the previous report, as a percentage of one core (can exceed 100). */
  cpuPercent: number
  /** Idle wakeups per second since the previous report; null where the OS does not report them. */
  idleWakeupsPerSecond: number | null
  workingSetBytes: number
  peakWorkingSetBytes: number
  /** Private memory where the OS reports it (macOS, Windows); null elsewhere. */
  privateBytes: number | null
  createdAt: number
}

/** The job a Node.js worker thread started by the main process does. */
export type PerformanceWorkerRole =
  | 'file-scan'
  | 'file-index'
  | 'file-reconcile'
  | 'file-icon'
  | 'file-thumbnail'
  | 'search-index-writer'
  | 'search-index-reader'
  | 'plugin-sqlite'
  | 'plugin-image-tools'

export interface PerformanceWorkerSample {
  role: PerformanceWorkerRole
  /** Tells apart several workers of one role (a reader lane); null when the role has one. */
  instance: string | null
  threadId: number
  uptimeMs: number
  /** This thread's own CPU since the previous report, percent of one core; null when unknown. */
  cpuPercent: number | null
  /** Event-loop utilization since the previous report, 0–1; null on the worker's first report. */
  eventLoopUtilization: number | null
  heapUsedBytes: number | null
  heapLimitBytes: number | null
}

export interface PerformanceEventLoopLag {
  lagMs: number
  severity: 'warn' | 'error'
  at: number
}

export interface PerformanceMainThreadSample {
  /**
   * The main thread's own CPU since the previous report, percent of one core; null on the first
   * report. Electron's main thread runs Node's event loop and Chromium's UI loop together, and
   * Node's event-loop utilization reads zero there, so thread CPU is what shows how busy it is.
   */
  cpuPercent: number | null
  heapUsedBytes: number
  heapTotalBytes: number
  heapLimitBytes: number
  /** The most recent lag the host's event-loop monitor recorded, if any. */
  lastLag: PerformanceEventLoopLag | null
}

/** Native addons in the main process that each build a Tokio runtime. */
export type PerformanceNativeRuntimeId = 'libsql' | 'clipboard' | 'screenshot'

export interface PerformanceNativeRuntimeBudget {
  /** Worker threads each runtime is built with. */
  workerThreads: number
  /** `host-budget`: Tuff's own cap. `environment`: the user's `TOKIO_WORKER_THREADS`, left alone. */
  source: 'host-budget' | 'environment'
  /** Runtimes built so far; a runtime appears once its addon has been loaded. */
  built: PerformanceNativeRuntimeId[]
}

export interface PerformanceResourceReport {
  capturedAt: number
  /** Milliseconds the deltas in this report cover; null on the first report. */
  windowMs: number | null
  platform: string
  logicalCpuCount: number
  totals: {
    cpuPercent: number
    workingSetBytes: number
    /** Null where the OS does not report wakeups. */
    idleWakeupsPerSecond: number | null
  }
  processes: PerformanceProcessSample[]
  mainThread: PerformanceMainThreadSample
  workers: PerformanceWorkerSample[]
  nativeRuntimes: PerformanceNativeRuntimeBudget
  /**
   * Main-thread time spent building this report — the cost of looking. Waiting for worker threads
   * to answer is not counted: the main thread is free meanwhile.
   */
  collectMs: number
}

export interface PerformanceProcessTreeEntry {
  pid: number
  /** The executable's base name; never a path. */
  command: string
  threads: number | null
  cpuPercent: number | null
  residentBytes: number | null
  /** True for processes the resource report already lists (main, GPU, renderers, utilities). */
  electronManaged: boolean
}

export interface PerformanceProcessTreeReport {
  capturedAt: number
  /** False where the host cannot list threads (Windows); `processes` is then empty. */
  supported: boolean
  /** The main process first, then every descendant. */
  processes: PerformanceProcessTreeEntry[]
  collectMs: number
}
