import { afterEach, describe, expect, it, vi } from 'vitest'

const { queueNexusTelemetryMock, pollingServiceMock } = vi.hoisted(() => ({
  queueNexusTelemetryMock: vi.fn(),
  pollingServiceMock: {
    isRegistered: vi.fn(() => false),
    register: vi.fn(),
    start: vi.fn(),
    unregister: vi.fn(),
    getDiagnostics: vi.fn(() => ({ activeTasks: [], recentTasks: [], startAttempts: [] }))
  }
}))

vi.mock('@talex-touch/utils/common/utils/polling', () => ({
  PollingService: { getInstance: () => pollingServiceMock }
}))

vi.mock('electron', () => ({
  ipcMain: { on: vi.fn(), off: vi.fn() },
  powerMonitor: { on: vi.fn(), off: vi.fn() }
}))

vi.mock('../modules/sentry/sentry-service', () => ({
  getSentryService: () => ({
    isTelemetryEnabled: () => true,
    isEnabled: () => true,
    queueNexusTelemetry: queueNexusTelemetryMock
  })
}))

vi.mock('./perf-context', () => ({
  getPerfContextSnapshot: () => [],
  getRecentPerfContextSnapshot: () => [],
  markPerfEventLoopLag: vi.fn()
}))

vi.mock('./workflow-debug', () => ({ appendWorkflowDebugLog: vi.fn() }))

import { perfMonitor } from './perf-monitor'

const consoleMethods = ['debug', 'error', 'info', 'log', 'warn'] as const

afterEach(() => {
  queueNexusTelemetryMock.mockReset()
  vi.restoreAllMocks()
})

describe('browser connection diagnostics privacy boundary', () => {
  it('redacts browser payload, metadata, and stack from console and Nexus performance records', () => {
    const canary = 'https://secret.example/account?token=renderer-secret Browser Secret Title'
    const consoleCalls: unknown[][] = []
    for (const method of consoleMethods) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleCalls.push(args)
      })
    }

    perfMonitor.recordRendererReport({
      kind: 'channel.send.timeout',
      eventName: 'browser-connection:profiles:bookmark',
      durationMs: 2_000,
      at: 1_700_000_000_000,
      level: 'error',
      payloadPreview: canary,
      stack: canary,
      meta: { title: canary, url: canary }
    })

    expect(JSON.stringify(consoleCalls)).not.toContain(canary)
    expect(JSON.stringify(queueNexusTelemetryMock.mock.calls)).not.toContain(canary)
    expect(JSON.stringify(queueNexusTelemetryMock.mock.calls)).not.toContain('Browser Secret Title')
  })

  it('keeps unrelated diagnostics unchanged', () => {
    const canary = 'https://unrelated.example/path?token=unrelated-secret'
    const consoleCalls: unknown[][] = []
    for (const method of consoleMethods) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleCalls.push(args)
      })
    }

    perfMonitor.recordRendererReport({
      kind: 'channel.send.timeout',
      eventName: 'unrelated-domain:command',
      durationMs: 2_000,
      at: 1_700_000_000_001,
      level: 'error',
      payloadPreview: canary,
      stack: canary,
      meta: { url: canary }
    })

    expect(JSON.stringify(consoleCalls)).toContain(canary)
    expect(JSON.stringify(queueNexusTelemetryMock.mock.calls)).toContain(canary)
  })
})
