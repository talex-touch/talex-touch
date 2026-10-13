import type {
  PerformanceWorkerRole,
  PerformanceWorkerSample
} from '@talex-touch/utils/transport/events/types'
import type { EventLoopUtilization } from 'node:perf_hooks'
import type { Worker } from 'node:worker_threads'

/**
 * Every Node.js worker thread the main process starts, so Settings › Performance can say what each
 * one is for. Workers register when they are created and drop out when they exit.
 *
 * Figures are read from the parent side. Event-loop utilization is a plain read of the worker's
 * loop counters and does not disturb it; CPU and heap are answered by the worker thread itself via
 * an interrupt, so a worker that is busy inside a long native call may not answer in time — its
 * value is then null for that report rather than holding the report up.
 */

const PROBE_TIMEOUT_MS = 250

type CpuUsage = { user: number; system: number }
/** `Worker.cpuUsage()` arrived in Node 24.6; older typings do not declare it. */
type WorkerWithCpuUsage = Worker & { cpuUsage?: () => Promise<CpuUsage> }

interface TrackedWorker {
  worker: Worker
  role: PerformanceWorkerRole
  instance: string | null
  threadId: number
  startedAt: number
  lastCpu: { usage: CpuUsage; at: number } | null
  lastLoop: EventLoopUtilization | null
}

const trackedWorkers = new Map<Worker, TrackedWorker>()

export function trackWorkerThread(
  worker: Worker,
  role: PerformanceWorkerRole,
  instance: string | null = null
): void {
  if (trackedWorkers.has(worker)) return
  trackedWorkers.set(worker, {
    worker,
    role,
    instance,
    threadId: worker.threadId,
    startedAt: Date.now(),
    lastCpu: null,
    lastLoop: null
  })
  worker.on('exit', () => {
    trackedWorkers.delete(worker)
  })
}

/** CPU, event-loop and heap figures for every live worker, as deltas since the previous call. */
export async function sampleWorkerThreads(): Promise<PerformanceWorkerSample[]> {
  return await Promise.all(Array.from(trackedWorkers.values(), sampleWorker))
}

async function sampleWorker(entry: TrackedWorker): Promise<PerformanceWorkerSample> {
  const { worker } = entry
  const loop = worker.performance.eventLoopUtilization()
  const eventLoopUtilization = entry.lastLoop
    ? worker.performance.eventLoopUtilization(loop, entry.lastLoop).utilization
    : null
  entry.lastLoop = loop

  const readCpu = (worker as WorkerWithCpuUsage).cpuUsage
  const [cpu, heap] = await Promise.all([
    readCpu ? settleWithin(readCpu.call(worker)) : Promise.resolve(null),
    settleWithin(worker.getHeapStatistics())
  ])

  const now = Date.now()
  let cpuPercent: number | null = null
  if (cpu) {
    const previous = entry.lastCpu
    if (previous && now > previous.at) {
      const usedMicros = cpu.user - previous.usage.user + (cpu.system - previous.usage.system)
      cpuPercent = Math.max(0, usedMicros / 1000 / (now - previous.at)) * 100
    }
    entry.lastCpu = { usage: cpu, at: now }
  }

  return {
    role: entry.role,
    instance: entry.instance,
    threadId: entry.threadId,
    uptimeMs: now - entry.startedAt,
    cpuPercent,
    eventLoopUtilization,
    heapUsedBytes: heap?.used_heap_size ?? null,
    heapLimitBytes: heap?.heap_size_limit ?? null
  }
}

async function settleWithin<T>(probe: Promise<T>): Promise<T | null> {
  const { promise: timeout, resolve } = Promise.withResolvers<null>()
  const timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS)
  try {
    return await Promise.race([probe.catch(() => null), timeout])
  } finally {
    clearTimeout(timer)
  }
}
