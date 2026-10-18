import type { ITuffTransport, TuffEvent } from '@talex-touch/utils/transport'
import type { AgentToolConfirmRequest } from '@talex-touch/utils/transport/sdk/domains/agent-tools'
import type { EffectScope } from 'vue'
import * as rendererTransport from '@talex-touch/utils/transport'
import { AgentToolEvents } from '@talex-touch/utils/transport/sdk/domains/agent-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useAgentTools } from './useAgentTools'

/** A main-side boundary: an invisible confirmation surface cannot admit a prompt. */
class ConfirmationBoundary {
  private mounted = false
  private listeners = new Map<object, Set<(payload: unknown) => unknown>>()

  send: ITuffTransport['send'] = async <Request, Response>(
    event: TuffEvent<Request, Response>,
    payload?: Request
  ): Promise<Response> => {
    if (event !== AgentToolEvents.setConfirmationSurface)
      throw new Error('unexpected gateway command')
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('mounted' in payload) ||
      typeof payload.mounted !== 'boolean'
    ) {
      throw new Error('invalid confirmation-surface payload')
    }
    this.mounted = payload.mounted
    return { mounted: this.mounted } as Response
  }

  on: ITuffTransport['on'] = (event, listener) => {
    const listeners = this.listeners.get(event) ?? new Set<(payload: unknown) => unknown>()
    listeners.add(listener as (payload: unknown) => unknown)
    this.listeners.set(event, listeners)
    return () => {
      listeners.delete(listener as (payload: unknown) => unknown)
    }
  }

  request(requestId: string): void {
    if (!this.mounted) throw new Error('CONFIRMATION_SURFACE_UNAVAILABLE')
    const request: AgentToolConfirmRequest = {
      requestId,
      tool: 'fs.read',
      risk: 'read',
      summary: 'Read a project file',
      input: '{}'
    }
    for (const listener of this.listeners.get(AgentToolEvents.confirmRequest) ?? [])
      listener(request)
  }
}

const scopes: EffectScope[] = []

afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.restoreAllMocks()
})

describe('home and browser confirmation surface ownership', () => {
  it('keeps the other page answerable when one page hides or disposes, until the last page closes', () => {
    const boundary = new ConfirmationBoundary()
    vi.spyOn(rendererTransport, 'useTuffTransport').mockReturnValue(
      boundary as unknown as ITuffTransport
    )
    const homeScope = effectScope()
    const browserScope = effectScope()
    scopes.push(homeScope, browserScope)
    const home = homeScope.run(() => useAgentTools())!
    const browser = browserScope.run(() => useAgentTools())!
    home.setSurfaceVisible(true)
    browser.setSurfaceVisible(true)

    home.setSurfaceVisible(false)
    boundary.request('home-hidden')
    expect(browser.pending.value?.requestId).toBe('home-hidden')

    homeScope.stop()
    boundary.request('home-disposed')
    expect(browser.queued.value.map((request) => request.requestId)).toEqual(['home-disposed'])

    browser.setSurfaceVisible(false)
    expect(() => boundary.request('nobody-visible')).toThrow('CONFIRMATION_SURFACE_UNAVAILABLE')
    home.setSurfaceVisible(true)
    expect(() => boundary.request('disposed-owner-cannot-return')).toThrow(
      'CONFIRMATION_SURFACE_UNAVAILABLE'
    )
    expect(browser.pending.value?.requestId).toBe('home-hidden')
    expect(browser.queued.value.map((request) => request.requestId)).toEqual(['home-disposed'])
  })
})
