import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppEvents } from '@talex-touch/utils/transport/events'
import { registerSystemShellHandlers } from './system-shell-handlers'

const shellTrashItemMock = vi.fn(async (_path: string) => undefined)
const dialogShowOpenDialogMock = vi.fn()

vi.mock('electron', () => ({
  shell: {
    trashItem: (p: string) => shellTrashItemMock(p),
    openExternal: vi.fn(),
    openPath: vi.fn(),
    showItemInFolder: vi.fn()
  },
  dialog: {
    showOpenDialog: (...args: unknown[]) => dialogShowOpenDialogMock(...args)
  }
}))

vi.mock('../modules/permission/permission-module-ref', () => ({
  getPermissionModule: () => ({ checkPermission: () => ({ allowed: true }) })
}))

vi.mock('../modules/plugin/plugin-module', () => ({
  pluginModule: { pluginManager: { getPluginByName: () => undefined } }
}))

describe('system-shell-handlers fileAction', () => {
  let tmpRoot: string
  let sourceDir: string
  let destDir: string
  let handlers: Map<string, (payload: unknown, context: unknown) => Promise<unknown>>

  beforeEach(async () => {
    tmpRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tuff-file-action-test-')))
    sourceDir = path.join(tmpRoot, 'source')
    destDir = path.join(tmpRoot, 'dest')
    await fs.mkdir(sourceDir, { recursive: true })
    await fs.mkdir(destDir, { recursive: true })
    shellTrashItemMock.mockClear()
    dialogShowOpenDialogMock.mockClear()

    handlers = new Map()
    const transport = {
      on: vi.fn(
        (
          event: { toEventName: () => string },
          handler: (payload: unknown, context: unknown) => Promise<unknown>
        ) => {
          handlers.set(event.toEventName(), handler)
          return vi.fn()
        }
      )
    }

    registerSystemShellHandlers(
      transport as unknown as Parameters<typeof registerSystemShellHandlers>[0],
      {
        configRootPath: () => tmpRoot,
        appRootPath: () => tmpRoot,
        logger: { warn: vi.fn() },
        registerSafeHandler: vi.fn(),
        resolveIndexedActionPath: async (filePath: string) => {
          try {
            const stats = await fs.stat(filePath)
            return {
              path: filePath,
              isDirectory: stats.isDirectory(),
              identity: { dev: stats.dev, ino: stats.ino }
            }
          } catch {
            return null
          }
        }
      }
    )
  })

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined)
  })

  function dispatchAction(payload: unknown, context: { plugin?: { name: string } } | null = null) {
    const handler = handlers.get(AppEvents.system.fileAction.toEventName())
    if (!handler) throw new Error('fileAction handler not registered')
    return handler(payload, context)
  }

  it('blocks host-only file action when invoked from a plugin context', async () => {
    await expect(
      dispatchAction(
        { action: 'trash', sourcePath: '/tmp/test' },
        { plugin: { name: 'evil-plugin' } }
      )
    ).rejects.toThrow('HOST_ONLY_HANDLER')
  })

  it('trashes an indexed file through shell.trashItem', async () => {
    const file = path.join(sourceDir, 'sample.txt')
    await fs.writeFile(file, 'content')
    const result = await dispatchAction({ action: 'trash', sourcePath: file })
    expect(result).toEqual({ success: true })
    expect(shellTrashItemMock).toHaveBeenCalledWith(file)
  })

  it('copies a file to destination without removing source or leaving staging artifact', async () => {
    const file = path.join(sourceDir, 'doc.txt')
    await fs.writeFile(file, 'important notes')
    dialogShowOpenDialogMock.mockResolvedValueOnce({ canceled: false, filePaths: [destDir] })

    const result = await dispatchAction({ action: 'copy-to', sourcePath: file })
    const expectedDest = path.join(destDir, 'doc.txt')

    expect(result).toEqual({ success: true, destinationPath: expectedDest })
    expect(await fs.readFile(file, 'utf8')).toBe('important notes')
    expect(await fs.readFile(expectedDest, 'utf8')).toBe('important notes')

    // Staging directories are completely cleaned up
    const destEntries = await fs.readdir(destDir)
    expect(destEntries).toEqual(['doc.txt'])
  })

  it('refuses copy-to when destination file already exists and preserves original content', async () => {
    const file = path.join(sourceDir, 'doc.txt')
    await fs.writeFile(file, 'new content')
    const existing = path.join(destDir, 'doc.txt')
    await fs.writeFile(existing, 'pre-existing content')

    dialogShowOpenDialogMock.mockResolvedValueOnce({ canceled: false, filePaths: [destDir] })

    const result = await dispatchAction({ action: 'copy-to', sourcePath: file })
    expect(result).toMatchObject({
      success: false,
      errorCode: 'SYSTEM_FILE_ACTION_DESTINATION_EXISTS'
    })
    expect(await fs.readFile(existing, 'utf8')).toBe('pre-existing content')
  })

  it('moves a file atomically to destination and removes source file', async () => {
    const file = path.join(sourceDir, 'move-me.txt')
    await fs.writeFile(file, 'movable payload')
    dialogShowOpenDialogMock.mockResolvedValueOnce({ canceled: false, filePaths: [destDir] })

    const result = await dispatchAction({ action: 'move-to', sourcePath: file })
    const expectedDest = path.join(destDir, 'move-me.txt')

    expect(result).toEqual({ success: true, destinationPath: expectedDest })
    expect(await fs.readFile(expectedDest, 'utf8')).toBe('movable payload')
    await expect(fs.access(file)).rejects.toThrow()
  })

  it('refuses move-to when destination file exists and leaves source intact', async () => {
    const file = path.join(sourceDir, 'target.txt')
    await fs.writeFile(file, 'source content')
    const existing = path.join(destDir, 'target.txt')
    await fs.writeFile(existing, 'do not overwrite me')

    dialogShowOpenDialogMock.mockResolvedValueOnce({ canceled: false, filePaths: [destDir] })

    const result = await dispatchAction({ action: 'move-to', sourcePath: file })
    expect(result).toEqual({ success: false, errorCode: 'SYSTEM_FILE_ACTION_DESTINATION_EXISTS' })
    expect(await fs.readFile(file, 'utf8')).toBe('source content')
    expect(await fs.readFile(existing, 'utf8')).toBe('do not overwrite me')
  })

  it('refuses to move a directory inside itself', async () => {
    const subFolder = path.join(sourceDir, 'sub')
    await fs.mkdir(subFolder)
    dialogShowOpenDialogMock.mockResolvedValueOnce({ canceled: false, filePaths: [subFolder] })

    const result = await dispatchAction({ action: 'move-to', sourcePath: sourceDir })
    expect(result).toEqual({ success: false, errorCode: 'SYSTEM_FILE_ACTION_BOUNDARY' })
  })

  it('rejects action if file is deleted or inode changes before execution', async () => {
    const file = path.join(sourceDir, 'stale.txt')
    await fs.writeFile(file, 'v1')
    dialogShowOpenDialogMock.mockResolvedValueOnce({ canceled: false, filePaths: [destDir] })

    // Simulate file removed or modified right before action executes
    await fs.unlink(file)
    const result = await dispatchAction({ action: 'copy-to', sourcePath: file })
    expect(result).toEqual({ success: false, errorCode: 'SYSTEM_FILE_ACTION_PATH_UNAVAILABLE' })
  })
})
