import type {
  HandlerContext,
  ITuffTransportMain,
  TuffEvent
} from '@talex-touch/utils/transport/main'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StorageEvents } from '@talex-touch/utils/transport/events'
import * as mainTransport from '@talex-touch/utils/transport/main'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { databaseModule } from '../database'
import { StorageModule } from '../storage'
import { BROWSER_WORKSPACE_STORAGE_KEY } from '../storage/main-storage-registry'

type Handler = (payload: unknown, context: HandlerContext) => unknown

class GenericStorageTransport {
  private handlers = new Map<object, Handler>()

  on: ITuffTransportMain['on'] = (event, handler) => {
    this.handlers.set(event, handler as Handler)
    return () => {
      this.handlers.delete(event)
    }
  }

  onStream: ITuffTransportMain['onStream'] = () => () => {}

  async dispatch<Request, Response>(
    event: TuffEvent<Request, Response>,
    payload: Request,
    context: HandlerContext
  ): Promise<Response> {
    const handler = this.handlers.get(event)
    if (!handler) throw new Error('unregistered storage event')
    return (await handler(payload, context)) as Response
  }
}

let storage: StorageModule | undefined
let directory: string | undefined

afterEach(async () => {
  try {
    await storage?.onDestroy()
  } finally {
    storage = undefined
    const cleanupDirectory = directory
    directory = undefined
    vi.restoreAllMocks()
    vi.useRealTimers()
    if (cleanupDirectory) await rm(cleanupDirectory, { recursive: true, force: true })
  }
})

describe('browser workspace generic-storage intrusion', () => {
  it('redacts browser history on generic reads and rejects every generic mutation without losing durable state', async () => {
    vi.useFakeTimers()
    const transport = new GenericStorageTransport()
    vi.spyOn(mainTransport, 'getTuffTransportMain').mockReturnValue(
      transport as unknown as ITuffTransportMain
    )
    vi.spyOn(databaseModule, 'getClient').mockReturnValue(null)
    directory = await mkdtemp(join(tmpdir(), 'browser-storage-boundary-'))
    const privateWorkspace = {
      tabs: [
        { id: 'private-tab', url: 'https://private.example/account', title: 'Private account' }
      ],
      activeTabId: 'private-tab',
      recent: [
        {
          url: 'https://private.example/history',
          title: 'Private history',
          favicon: null,
          visitedAt: 123
        }
      ],
      bookmarks: [
        {
          url: 'https://private.example/saved',
          title: 'Private bookmark',
          favicon: null,
          visitedAt: 124
        }
      ]
    }
    const workspaceFile = join(directory, BROWSER_WORKSPACE_STORAGE_KEY)
    await writeFile(workspaceFile, JSON.stringify(privateWorkspace), 'utf8')
    storage = new StorageModule()
    await storage.init({
      app: { channel: {} },
      file: { create: true, dirName: 'config', dirPath: directory }
    } as unknown as Parameters<StorageModule['init']>[0])
    const context = { sender: { id: 202 }, eventName: 'generic-storage' } as HandlerContext
    const request = { key: BROWSER_WORKSPACE_STORAGE_KEY }

    expect(storage.getConfig(BROWSER_WORKSPACE_STORAGE_KEY)).toEqual(privateWorkspace)
    expect(await transport.dispatch(StorageEvents.app.get, request, context)).toEqual({})
    const versioned = await transport.dispatch(StorageEvents.app.getVersioned, request, context)
    expect(versioned?.data).toEqual({})

    const replacement = { tabs: [], activeTabId: 'forged', recent: [], bookmarks: [] }
    await expect(
      transport.dispatch(StorageEvents.app.set, { ...request, value: replacement }, context)
    ).rejects.toThrow('BROWSER_HOST_ONLY')
    expect(storage.getConfig(BROWSER_WORKSPACE_STORAGE_KEY)).toEqual(privateWorkspace)
    await expect(
      transport.dispatch(
        StorageEvents.app.save,
        { ...request, value: replacement, persist: true },
        context
      )
    ).rejects.toThrow('BROWSER_HOST_ONLY')
    expect(storage.getConfig(BROWSER_WORKSPACE_STORAGE_KEY)).toEqual(privateWorkspace)
    await expect(transport.dispatch(StorageEvents.app.delete, request, context)).rejects.toThrow(
      'BROWSER_HOST_ONLY'
    )
    expect(storage.getConfig(BROWSER_WORKSPACE_STORAGE_KEY)).toEqual(privateWorkspace)

    await storage.persistConfigNow(BROWSER_WORKSPACE_STORAGE_KEY)
    expect(JSON.parse(await readFile(workspaceFile, 'utf8'))).toEqual(privateWorkspace)
  })
})
