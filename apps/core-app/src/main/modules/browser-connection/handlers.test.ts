import type {
  HandlerContext,
  ITuffTransportMain,
  TuffEvent
} from '@talex-touch/utils/transport/main'
import type { BrowserWindow } from 'electron'
import { EventEmitter } from 'node:events'
import {
  BrowserConnectionEvents,
  BROWSER_EXTENSION_ID,
  type BrowserConnectionState
} from '@talex-touch/utils/transport/sdk/domains/browser-connection'
import { describe, expect, it, vi } from 'vitest'
import { registerBrowserConnectionHandlers } from './handlers'

type Handler = (payload: unknown, context: HandlerContext) => unknown

class InMemoryTransport {
  private handlers = new Map<object, Handler>()
  on: ITuffTransportMain['on'] = (event, handler) => {
    this.handlers.set(event, handler as Handler)
    return () => this.handlers.delete(event)
  }
  async dispatch<Request, Response>(
    event: TuffEvent<Request, Response>,
    payload: Request,
    context: HandlerContext
  ): Promise<Response> {
    const handler = this.handlers.get(event)
    if (!handler) throw new Error('unregistered event')
    return (await handler(payload, context)) as Response
  }
}

const state: BrowserConnectionState = {
  revision: 0,
  activeProfileId: null,
  installation: {
    installed: false,
    extensionId: BROWSER_EXTENSION_ID,
    extensionDirectory: null,
    supported: true
  },
  pairing: null,
  profiles: []
}

function createHarness() {
  const status = { owner: false, sender: false, frame: false }
  const frame = { parent: null as object | null, detached: false, isDestroyed: () => status.frame }
  const sender = Object.assign(new EventEmitter(), {
    mainFrame: frame,
    isDestroyed: () => status.sender
  })
  const owner = Object.assign(new EventEmitter(), {
    webContents: sender,
    isDestroyed: () => status.owner
  })
  const manager = {
    getState: vi.fn(() => state),
    updateInstallation: vi.fn(async () => state),
    beginPairing: vi.fn(async () => state),
    cancelPairing: vi.fn(async () => state),
    selectProfile: vi.fn(async () => state),
    setPaused: vi.fn(async () => state),
    disconnect: vi.fn(async () => state),
    bookmark: vi.fn(async () => state),
    resolveConflict: vi.fn(async () => state),
    tab: vi.fn(async () => state),
    refresh: vi.fn(async () => state),
    getCookies: vi.fn(async () => [
      {
        name: 'session',
        value: '123',
        domain: 'example.com',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'lax' as const
      }
    ])
  }
  const installer = {
    install: vi.fn(async () => state.installation),
    revealExtension: vi.fn(async () => {})
  }
  const transport = new InMemoryTransport()
  const unregister = registerBrowserConnectionHandlers(
    transport as unknown as ITuffTransportMain,
    owner as unknown as BrowserWindow,
    manager as never,
    installer
  )
  const context = { sender, senderFrame: frame, eventName: '' } as unknown as HandlerContext
  return { context, frame, owner, sender, status, manager, transport, unregister }
}

describe('browser connection renderer sender authority', () => {
  it('allows only the owning live top-level main frame to read state', async () => {
    const harness = createHarness()
    await expect(
      harness.transport.dispatch(BrowserConnectionEvents.getState, undefined, harness.context)
    ).resolves.toBe(state)
    expect(harness.manager.getState).toHaveBeenCalledTimes(1)
    harness.unregister()
  })

  it('routes getCookies and importCookies from authenticated owner', async () => {
    const harness = createHarness()
    const filter = { domain: 'example.com' }
    await expect(
      harness.transport.dispatch(
        BrowserConnectionEvents.getCookies,
        { profileId: 'p1', filter },
        harness.context
      )
    ).resolves.toEqual({
      cookies: [
        {
          name: 'session',
          value: '123',
          domain: 'example.com',
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'lax'
        }
      ]
    })
    expect(harness.manager.getCookies).toHaveBeenCalledWith('p1', filter)
    harness.unregister()
  })

  it.each([
    'subframe',
    'missing frame',
    'foreign sender',
    'same-id forged sender',
    'plugin caller',
    'destroyed frame',
    'parented main frame',
    'destroyed owner',
    'destroyed sender'
  ])('rejects %s before exposing or mutating connection state', async (kind) => {
    const harness = createHarness()
    const context = { ...harness.context }
    switch (kind) {
      case 'subframe':
        context.senderFrame = {
          parent: harness.frame,
          detached: false,
          isDestroyed: () => false
        } as unknown as HandlerContext['senderFrame']
        break
      case 'missing frame':
        delete context.senderFrame
        break
      case 'foreign sender':
        context.sender = Object.assign(new EventEmitter(), {
          id: 22,
          mainFrame: harness.frame,
          isDestroyed: () => false
        }) as unknown as HandlerContext['sender']
        break
      case 'same-id forged sender':
        context.sender = Object.assign(new EventEmitter(), {
          mainFrame: harness.frame,
          isDestroyed: () => false
        }) as unknown as HandlerContext['sender']
        break
      case 'plugin caller':
        context.plugin = { name: 'untrusted-plugin' } as HandlerContext['plugin']
        break
      case 'destroyed frame':
        harness.status.frame = true
        break
      case 'parented main frame':
        harness.frame.parent = {}
        break
      case 'destroyed owner':
        harness.status.owner = true
        break
      case 'destroyed sender':
        harness.status.sender = true
        break
    }
    await expect(
      harness.transport.dispatch(BrowserConnectionEvents.beginPairing, undefined, context)
    ).rejects.toThrow('BROWSER_HOST_ONLY')
    await expect(
      harness.transport.dispatch(BrowserConnectionEvents.getState, undefined, context)
    ).rejects.toThrow('BROWSER_HOST_ONLY')
    expect(harness.manager.beginPairing).not.toHaveBeenCalled()
    expect(harness.manager.getState).toHaveBeenCalledTimes(0)
    harness.unregister()
  })
})
