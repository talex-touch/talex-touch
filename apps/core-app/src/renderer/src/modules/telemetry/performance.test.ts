import type { SentryEvents as SentryEventDefinitions } from '@talex-touch/utils/transport/events'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  send: vi.fn(),
  polling: {
    isRegistered: vi.fn(() => false),
    register: vi.fn(),
    unregister: vi.fn(),
    start: vi.fn()
  }
}))

vi.mock('@talex-touch/utils/common/utils/polling', () => ({
  PollingService: {
    getInstance: () => state.polling
  }
}))

vi.mock('@talex-touch/utils/renderer/hooks/arg-mapper', () => ({
  isCoreBox: () => true
}))

vi.mock('@talex-touch/utils/transport', () => ({
  useTuffTransport: () => ({ send: state.send })
}))

let SentryEvents: typeof SentryEventDefinitions

type EntryCallback = (list: Pick<PerformanceObserverEntryList, 'getEntries'>) => void

const observers = new Map<string, (durations: number[]) => void>()
const observerCallbacks: EntryCallback[] = []

class FakePerformanceObserver {
  static supportedEntryTypes: string[] = []

  constructor(private readonly callback: EntryCallback) {
    observerCallbacks.push(callback)
  }

  observe({ type }: PerformanceObserverInit): void {
    if (!type || !FakePerformanceObserver.supportedEntryTypes.includes(type)) {
      throw new Error(`Unsupported performance entry type: ${type}`)
    }
    observers.set(type, (durations) => {
      this.callback({
        getEntries: () => durations.map((duration) => ({ duration }) as PerformanceEntry)
      })
    })
  }
}

function performanceRecords() {
  return state.send.mock.calls.filter(([event]) => event === SentryEvents.api.recordPerformance)
}

describe('passive renderer performance telemetry', () => {
  let document: EventTarget & { hidden: boolean }
  let window: EventTarget
  let requestAnimationFrame: Mock

  beforeEach(async () => {
    // Static imports retain start/activity state and stale event identities across module resets.
    vi.resetModules()
    vi.clearAllMocks()
    state.send.mockReset()
    state.send.mockResolvedValue(undefined)
    state.send.mockResolvedValueOnce({ enabled: true })
    observers.clear()
    observerCallbacks.length = 0
    FakePerformanceObserver.supportedEntryTypes = ['longtask', 'long-animation-frame']
    document = Object.assign(new EventTarget(), { hidden: false })
    window = new EventTarget()
    requestAnimationFrame = vi.fn(() => 1)
    vi.stubGlobal('document', document)
    vi.stubGlobal('window', window)
    vi.stubGlobal('PerformanceObserver', FakePerformanceObserver)
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    ;({ SentryEvents } = await import('@talex-touch/utils/transport/events'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('aggregates both entry types on inactivity, resets the buffer, and never requests frames', async () => {
    const { startRendererPerformanceTelemetry } = await import('./performance')
    const { setRendererActivity } = await import('./renderer-activity')
    await startRendererPerformanceTelemetry()

    observers.get('longtask')!([50.4])
    observers.get('longtask')!([75.4])
    observers.get('long-animation-frame')!([90.6, 120.6, 51.6])
    expect(performanceRecords()).toEqual([])

    setRendererActivity(false)
    expect(performanceRecords()).toEqual([
      [
        SentryEvents.api.recordPerformance,
        {
          longTaskCount: 2,
          longTaskTotalMs: 126,
          longTaskMaxMs: 75,
          longAnimationFrameCount: 3,
          longAnimationFrameTotalMs: 263,
          longAnimationFrameMaxMs: 121,
          windowType: 'corebox'
        }
      ]
    ])

    setRendererActivity(true)
    setRendererActivity(false)
    expect(performanceRecords()).toHaveLength(1)

    setRendererActivity(true)
    observers.get('longtask')!([60.6])
    setRendererActivity(false)
    expect(performanceRecords()).toHaveLength(2)
    expect(performanceRecords()[1]).toEqual([
      SentryEvents.api.recordPerformance,
      {
        longTaskCount: 1,
        longTaskTotalMs: 61,
        longTaskMaxMs: 61,
        longAnimationFrameCount: 0,
        longAnimationFrameTotalMs: 0,
        longAnimationFrameMaxMs: 0,
        windowType: 'corebox'
      }
    ])
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('installs no observers and sends no performance records when telemetry is disabled', async () => {
    state.send.mockReset()
    state.send.mockResolvedValue({ enabled: false })
    const { startRendererPerformanceTelemetry } = await import('./performance')
    const { setRendererActivity } = await import('./renderer-activity')
    await startRendererPerformanceTelemetry()

    setRendererActivity(false)
    document.hidden = true
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('beforeunload'))
    for (const [, flush] of state.polling.register.mock.calls) await flush()

    expect(observerCallbacks).toEqual([])
    expect(performanceRecords()).toEqual([])
    expect(requestAnimationFrame).not.toHaveBeenCalled()
  })

  it.each([
    {
      supportedType: 'longtask',
      countField: 'longTaskCount',
      totalField: 'longTaskTotalMs',
      maxField: 'longTaskMaxMs'
    },
    {
      supportedType: 'long-animation-frame',
      countField: 'longAnimationFrameCount',
      totalField: 'longAnimationFrameTotalMs',
      maxField: 'longAnimationFrameMaxMs'
    }
  ])(
    'reports $supportedType even when the other entry type is unsupported',
    async ({ supportedType, countField, totalField, maxField }) => {
      FakePerformanceObserver.supportedEntryTypes = [supportedType]
      const { startRendererPerformanceTelemetry } = await import('./performance')
      const { setRendererActivity } = await import('./renderer-activity')
      await startRendererPerformanceTelemetry()

      expect([...observers.keys()]).toEqual([supportedType])
      expect(observerCallbacks).toHaveLength(1)
      observers.get(supportedType)!([70.6, 80.6])
      setRendererActivity(false)

      expect(performanceRecords()).toEqual([
        [
          SentryEvents.api.recordPerformance,
          {
            longTaskCount: 0,
            longTaskTotalMs: 0,
            longTaskMaxMs: 0,
            longAnimationFrameCount: 0,
            longAnimationFrameTotalMs: 0,
            longAnimationFrameMaxMs: 0,
            [countField]: 2,
            [totalField]: 151,
            [maxField]: 81,
            windowType: 'corebox'
          }
        ]
      ])
      expect(requestAnimationFrame).not.toHaveBeenCalled()
    }
  )

  it.each(['hidden document', 'beforeunload', 'polling task'])(
    'flushes pending entries once on %s without requesting frames',
    async (trigger) => {
      const { startRendererPerformanceTelemetry } = await import('./performance')
      await startRendererPerformanceTelemetry({ flushIntervalMs: 1_000 })
      observers.get('long-animation-frame')!([95.6])
      document.dispatchEvent(new Event('visibilitychange'))
      expect(performanceRecords()).toEqual([])

      const flush = async () => {
        if (trigger === 'hidden document') {
          document.hidden = true
          document.dispatchEvent(new Event('visibilitychange'))
        } else if (trigger === 'beforeunload') {
          window.dispatchEvent(new Event('beforeunload'))
        } else {
          const [, pollingFlush] = state.polling.register.mock.calls[0]
          await pollingFlush()
        }
      }
      await flush()
      expect(performanceRecords()).toEqual([
        [
          SentryEvents.api.recordPerformance,
          {
            longTaskCount: 0,
            longTaskTotalMs: 0,
            longTaskMaxMs: 0,
            longAnimationFrameCount: 1,
            longAnimationFrameTotalMs: 96,
            longAnimationFrameMaxMs: 96,
            windowType: 'corebox'
          }
        ]
      ])

      await flush()
      expect(performanceRecords()).toHaveLength(1)
      expect(requestAnimationFrame).not.toHaveBeenCalled()
    }
  )
})
