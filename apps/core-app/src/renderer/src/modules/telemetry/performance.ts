import { PollingService } from '@talex-touch/utils/common/utils/polling'
import { isCoreBox } from '@talex-touch/utils/renderer/hooks/arg-mapper'
import { useTuffTransport } from '@talex-touch/utils/transport'
import { SentryEvents } from '@talex-touch/utils/transport/events'
import { subscribeRendererActivity } from './renderer-activity'

/**
 * Renderer responsiveness, observed passively.
 *
 * Both sources are `PerformanceObserver` entry types the browser records anyway: `longtask`
 * (main-thread tasks of 50 ms or more) and `long-animation-frame` (frames that took 50 ms or
 * more, the Long Animation Frames API). Jank used to come from a requestAnimationFrame loop
 * re-armed every 33 ms for as long as a window was visible; requesting a frame is what makes
 * Chromium produce one, so the probe kept the compositor and GPU process working on an idle page
 * it was only meant to watch.
 */
interface RendererPerformanceBuffer {
  longTaskCount: number
  longTaskTotalMs: number
  longTaskMaxMs: number
  longAnimationFrameCount: number
  longAnimationFrameTotalMs: number
  longAnimationFrameMaxMs: number
}

function emptyBuffer(): RendererPerformanceBuffer {
  return {
    longTaskCount: 0,
    longTaskTotalMs: 0,
    longTaskMaxMs: 0,
    longAnimationFrameCount: 0,
    longAnimationFrameTotalMs: 0,
    longAnimationFrameMaxMs: 0
  }
}

let buffer = emptyBuffer()

const transport = useTuffTransport()
let started = false
const pollingService = PollingService.getInstance()
const flushTaskId = 'renderer.performance.flush'
/** Matches the main process's performance window; a hidden or closing window flushes early. */
const DEFAULT_FLUSH_INTERVAL_MS = 5 * 60_000

export async function startRendererPerformanceTelemetry(options?: {
  flushIntervalMs?: number
}): Promise<void> {
  if (started) return
  started = true

  try {
    const config = (await transport.send(SentryEvents.api.getConfig)) as
      | { enabled?: boolean }
      | undefined
    if (!config?.enabled) return
  } catch {
    return
  }

  observe('longtask', (duration) => {
    buffer.longTaskCount += 1
    buffer.longTaskTotalMs += duration
    buffer.longTaskMaxMs = Math.max(buffer.longTaskMaxMs, duration)
  })
  observe('long-animation-frame', (duration) => {
    buffer.longAnimationFrameCount += 1
    buffer.longAnimationFrameTotalMs += duration
    buffer.longAnimationFrameMaxMs = Math.max(buffer.longAnimationFrameMaxMs, duration)
  })

  subscribeRendererActivity((active) => {
    if (!active) void flush()
  })

  if (pollingService.isRegistered(flushTaskId)) {
    pollingService.unregister(flushTaskId)
  }
  pollingService.register(flushTaskId, () => flush(), {
    interval: options?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    unit: 'milliseconds'
  })
  pollingService.start()

  window.addEventListener('beforeunload', () => {
    void flush()
  })

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void flush()
  })
}

/** Observes one entry type if this Chromium records it; an unsupported type is skipped. */
function observe(entryType: string, record: (duration: number) => void): void {
  if (typeof PerformanceObserver === 'undefined') return
  if (!PerformanceObserver.supportedEntryTypes?.includes(entryType)) return

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const duration = typeof entry.duration === 'number' ? entry.duration : 0
        if (Number.isFinite(duration) && duration > 0) record(duration)
      }
    })
    observer.observe({ type: entryType })
  } catch {
    // Telemetry must never disturb the page it observes.
  }
}

async function flush(): Promise<void> {
  if (buffer.longTaskCount === 0 && buffer.longAnimationFrameCount === 0) return

  const flushed = buffer
  buffer = emptyBuffer()
  const payload = {
    longTaskCount: flushed.longTaskCount,
    longTaskTotalMs: Math.round(flushed.longTaskTotalMs),
    longTaskMaxMs: Math.round(flushed.longTaskMaxMs),
    longAnimationFrameCount: flushed.longAnimationFrameCount,
    longAnimationFrameTotalMs: Math.round(flushed.longAnimationFrameTotalMs),
    longAnimationFrameMaxMs: Math.round(flushed.longAnimationFrameMaxMs),
    windowType: isCoreBox() ? 'corebox' : 'main'
  }

  try {
    await transport.send(SentryEvents.api.recordPerformance, payload)
  } catch {
    // ignore telemetry errors
  }
}
