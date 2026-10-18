import type {
  HandlerContext,
  ITuffTransportMain,
  TuffEvent
} from '@talex-touch/utils/transport/main'
import type { BrowserWindow } from 'electron'
import type { BrowserPersistedWorkspace } from './workspace-manager'
import { EventEmitter } from 'node:events'
import { BrowserEvents } from '@talex-touch/utils/transport/sdk/domains/browser'
import { afterEach, describe, expect, it } from 'vitest'
import { registerBrowserHandlers } from './handlers'
import { BrowserWorkspaceManager } from './workspace-manager'

type Handler = (payload: unknown, context: HandlerContext) => unknown

class InMemoryTransport {
  private handlers = new Map<object, Handler>()

  on: ITuffTransportMain['on'] = (event, handler) => {
    this.handlers.set(event, handler as Handler)
    return () => {
      this.handlers.delete(event)
    }
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

const cleanups: Array<() => Promise<void>> = []

function createHarness() {
  const status = { ownerDestroyed: false, senderDestroyed: false, frameDestroyed: false }
  const frame = { parent: null as object | null, isDestroyed: () => status.frameDestroyed }
  const sender = Object.assign(new EventEmitter(), {
    id: 101,
    mainFrame: frame,
    isDestroyed: () => status.senderDestroyed
  })
  const owner = Object.assign(new EventEmitter(), {
    webContents: sender,
    isDestroyed: () => status.ownerDestroyed,
    isVisible: () => true,
    getContentSize: () => [1000, 700]
  })
  const saved: BrowserPersistedWorkspace[] = []
  const manager = new BrowserWorkspaceManager(
    {
      owner: owner as unknown as BrowserWindow,
      createView: () => {
        throw new Error('hidden workspace must not create native guests')
      },
      persist: async (state) => {
        saved.push(structuredClone(state))
      },
      notify: () => {}
    },
    {
      tabs: [{ id: 'first', url: 'https://one.example/', title: 'One' }],
      activeTabId: 'first',
      recent: [],
      bookmarks: []
    }
  )
  const transport = new InMemoryTransport()
  const unregister = registerBrowserHandlers(
    transport as unknown as ITuffTransportMain,
    owner as unknown as BrowserWindow,
    manager
  )
  cleanups.push(async () => {
    unregister()
    await manager.dispose()
  })
  const context = { sender, senderFrame: frame, eventName: '' } as unknown as HandlerContext
  return { manager, saved, transport, context, status, frame, sender }
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

describe('browser command sender authority', () => {
  it('allows the owning live top-level renderer to create, reorder, navigate and close real workspace tabs', async () => {
    const { manager, transport, saved, context } = createHarness()
    const created = await transport.dispatch(
      BrowserEvents.createTab,
      { input: 'two.example' },
      context
    )
    const id = created.activeTabId
    expect(created.tabs.find((tab) => tab.id === id)?.url).toBe('https://two.example/')
    const reordered = await transport.dispatch(
      BrowserEvents.moveTab,
      { tabId: id, beforeTabId: 'first' },
      context
    )
    expect(reordered.tabs.map((tab) => tab.id)).toEqual([id, 'first'])
    expect(reordered.activeTabId).toBe(id)
    expect(saved.at(-1)?.tabs.map((tab) => tab.id)).toEqual([id, 'first'])
    const navigated = await transport.dispatch(
      BrowserEvents.navigate,
      { tabId: id, input: 'three.example/path' },
      context
    )
    expect(navigated.tabs.find((tab) => tab.id === id)?.url).toBe('https://three.example/path')
    const closed = await transport.dispatch(BrowserEvents.closeTab, { tabId: id }, context)
    expect(closed.tabs.map((tab) => tab.id)).toEqual(['first'])
    expect(closed.activeTabId).toBe('first')
    expect(saved.at(-1)?.tabs).toEqual([{ id: 'first', url: 'https://one.example/', title: 'One' }])
    expect(await transport.dispatch(BrowserEvents.getState, undefined, context)).toEqual(
      manager.getState()
    )
  })

  it.each([
    'subframe',
    'missing frame',
    'null frame',
    'foreign sender',
    'same-id forged sender',
    'plugin caller',
    'destroyed frame',
    'parented main frame',
    'destroyed owner',
    'destroyed sender'
  ])(
    'rejects every command from a %s without revealing or mutating workspace state',
    async (kind) => {
      const harness = createHarness()
      const { manager, transport, saved, frame, sender, status } = harness
      const context = { ...harness.context }
      switch (kind) {
        case 'subframe':
          context.senderFrame = {
            parent: frame,
            isDestroyed: () => false
          } as unknown as HandlerContext['senderFrame']
          break
        case 'missing frame':
          delete context.senderFrame
          break
        case 'null frame':
          context.senderFrame = null
          break
        case 'foreign sender':
          context.sender = { ...sender, id: 202 } as unknown as HandlerContext['sender']
          break
        case 'same-id forged sender':
          context.sender = { ...sender } as unknown as HandlerContext['sender']
          break
        case 'plugin caller':
          context.plugin = { name: 'untrusted-plugin' } as HandlerContext['plugin']
          break
        case 'destroyed frame':
          status.frameDestroyed = true
          break
        case 'parented main frame':
          frame.parent = {}
          break
        case 'destroyed owner':
          status.ownerDestroyed = true
          break
        case 'destroyed sender':
          status.senderDestroyed = true
          break
      }
      const before = manager.getState()
      const payload = {
        input: 'https://two.example/',
        tabId: 'first',
        beforeTabId: null,
        visible: true,
        bounds: { x: 0, y: 0, width: 800, height: 600 }
      }
      const requestEvents = [
        BrowserEvents.getState,
        BrowserEvents.createTab,
        BrowserEvents.activateTab,
        BrowserEvents.closeTab,
        BrowserEvents.moveTab,
        BrowserEvents.navigate,
        BrowserEvents.back,
        BrowserEvents.forward,
        BrowserEvents.reload,
        BrowserEvents.stop,
        BrowserEvents.setViewport,
        BrowserEvents.toggleBookmark
      ]
      for (const event of requestEvents) {
        await expect(
          transport.dispatch(event as TuffEvent<unknown, unknown>, payload, context)
        ).rejects.toThrow('BROWSER_HOST_ONLY')
      }
      expect(manager.getState()).toEqual(before)
      expect(saved).toEqual([])
    }
  )
})
