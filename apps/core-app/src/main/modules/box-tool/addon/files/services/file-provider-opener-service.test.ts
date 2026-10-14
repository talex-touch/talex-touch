import type { InValue } from '@libsql/client'
import type { OpenerInfo } from '@talex-touch/utils'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as schema from '../../../../../db/schema'
import { createDbUtils } from '../../../../../db/utils'
import { FileProviderOpenerService } from './file-provider-opener-service'

const ICON_PATH = '/cache/file-icons/generated-preview.png'
const APP_INFO = {
  fileId: 5,
  name: 'Preview',
  path: '/Applications/Preview.app',
  logo: ''
}
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function createHarness() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opener-primary-contract-'))
  const primaryClient = createClient({ url: `file:${path.join(directory, 'primary.db')}` })
  const searchClient = createClient({ url: `file:${path.join(directory, 'search.db')}` })
  cleanups.push(async () => {
    primaryClient.close()
    searchClient.close()
    await fs.rm(directory, { recursive: true, force: true })
  })
  for (const client of [primaryClient, searchClient]) {
    await client.execute(`CREATE TABLE files (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, display_name TEXT, path TEXT NOT NULL,
      type TEXT NOT NULL
    )`)
    await client.execute(`CREATE TABLE file_extensions (
      file_id INTEGER NOT NULL, key TEXT NOT NULL, value TEXT,
      PRIMARY KEY (file_id, key)
    )`)
  }
  await primaryClient.execute({
    sql: 'INSERT INTO files VALUES (?, ?, ?, ?, ?)',
    args: [5, 'Preview.app', 'Preview', APP_INFO.path, 'app']
  })
  await primaryClient.execute({
    sql: 'INSERT INTO file_extensions VALUES (?, ?, ?)',
    args: [5, 'bundleId', 'com.apple.Preview']
  })
  await searchClient.execute({
    sql: 'INSERT INTO files VALUES (?, ?, ?, ?, ?)',
    args: [5, 'not-an-app.pdf', 'Search collision', '/Documents/not-an-app.pdf', 'file']
  })
  await searchClient.execute({
    sql: 'INSERT INTO file_extensions VALUES (?, ?, ?)',
    args: [5, 'icon', '/search-file-icon.png']
  })
  const primary = drizzle(primaryClient, { schema })
  const search = drizzle(searchClient, { schema })
  const dbUtils = createDbUtils(primary, primary, {
    enabled: true,
    searchDb: search,
    writer: {
      execWrite: async (statements) => {
        for (const statement of statements)
          await searchClient.execute({ sql: statement.sql, args: statement.args as InValue[] })
        return []
      }
    }
  })
  const getFileIconPath = vi.fn<(filePath: string) => Promise<string | null>>(async () => ICON_PATH)
  const writeStarted = Promise.withResolvers<void>()
  const writeFinished = Promise.withResolvers<void>()
  let admitWrite: () => Promise<void> = async () => {}
  let storedOpeners: Record<string, OpenerInfo> = {}
  const service = new FileProviderOpenerService({
    emptyLogo: 'empty-logo',
    enableFileIconExtraction: true,
    getDbUtils: () => dbUtils,
    withDbWrite: async <T>(_label: string, operation: () => Promise<T>): Promise<T> => {
      writeStarted.resolve()
      await admitWrite()
      try {
        return await operation()
      } finally {
        writeFinished.resolve()
      }
    },
    getStoredOpeners: () => storedOpeners,
    saveStoredOpeners: (next) => {
      storedOpeners = next
    },
    getFileIconPath,
    logWarn: vi.fn(),
    logError: vi.fn()
  })
  cleanups.push(() => service.close())
  return {
    service,
    primaryClient,
    searchClient,
    getFileIconPath,
    writeStarted,
    writeFinished,
    gateWrite: (gate: Promise<void>) => {
      admitWrite = () => gate
    },
    storedOpeners: () => storedOpeners,
    primaryIcon: async () =>
      (
        await primaryClient.execute(
          "SELECT value FROM file_extensions WHERE file_id = 5 AND key = 'icon'"
        )
      ).rows.map((row) => row.value),
    searchIcon: async () =>
      (
        await searchClient.execute(
          "SELECT value FROM file_extensions WHERE file_id = 5 AND key = 'icon'"
        )
      ).rows.map((row) => row.value)
  }
}

async function settleScheduledJob(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
}

describe('FileProviderOpenerService primary app catalog', () => {
  it('resolves the primary application name and logo despite a same-id search file', async () => {
    const harness = await createHarness()
    await harness.primaryClient.execute({
      sql: 'INSERT INTO file_extensions VALUES (?, ?, ?)',
      args: [5, 'icon', '/primary-preview-icon.png']
    })
    await expect(harness.service.getAppInfoByBundleId('com.apple.Preview')).resolves.toEqual({
      ...APP_INFO,
      logo: '/primary-preview-icon.png'
    })
    await expect(harness.service.getAppInfoByBundleId('com.missing')).resolves.toBeNull()
  })

  it('never treats a normal file with a forged bundleId as an application', async () => {
    const harness = await createHarness()
    await harness.primaryClient.execute({
      sql: 'INSERT INTO files VALUES (?, ?, ?, ?, ?)',
      args: [8, 'fake.app', 'Fake app', '/Documents/fake.app', 'file']
    })
    await harness.primaryClient.execute({
      sql: 'INSERT INTO file_extensions VALUES (?, ?, ?)',
      args: [8, 'bundleId', 'com.forged.app']
    })
    await expect(harness.service.getAppInfoByBundleId('com.forged.app')).resolves.toBeNull()
  })
})

describe('FileProviderOpenerService generated opener icons', () => {
  it('persists the generated icon only in primary and serves its authorized URL', async () => {
    const harness = await createHarness()
    harness.service.scheduleOpenerIconUpdate('pdf', 'com.apple.Preview', APP_INFO)
    await harness.writeFinished.promise
    expect(await harness.primaryIcon()).toEqual([ICON_PATH])
    expect(await harness.searchIcon()).toEqual(['/search-file-icon.png'])
    expect(
      (
        await harness.primaryClient.execute(
          'SELECT name, display_name, path, type FROM files WHERE id = 5'
        )
      ).rows
    ).toEqual([{ name: 'Preview.app', display_name: 'Preview', path: APP_INFO.path, type: 'app' }])
    expect(
      (
        await harness.searchClient.execute(
          'SELECT name, display_name, path, type FROM files WHERE id = 5'
        )
      ).rows
    ).toEqual([
      {
        name: 'not-an-app.pdf',
        display_name: 'Search collision',
        path: '/Documents/not-an-app.pdf',
        type: 'file'
      }
    ])
    expect((await harness.service.getOpenerForExtension('.pdf'))?.logo).toBe(`tfile://${ICON_PATH}`)
    expect(harness.storedOpeners().pdf?.logo).toBe(`tfile://${ICON_PATH}`)
  })

  it('writes nothing when a scheduled extraction finishes after close', async () => {
    const harness = await createHarness()
    const icon = Promise.withResolvers<string | null>()
    const extractionStarted = Promise.withResolvers<void>()
    harness.getFileIconPath.mockImplementation(() => {
      extractionStarted.resolve()
      return icon.promise
    })
    harness.service.scheduleOpenerIconUpdate('pdf', 'com.apple.Preview', APP_INFO)
    await extractionStarted.promise
    await harness.service.close()
    icon.resolve(ICON_PATH)
    await settleScheduledJob()
    expect(await harness.primaryIcon()).toEqual([])
    expect(await harness.searchIcon()).toEqual(['/search-file-icon.png'])
    expect(harness.storedOpeners()).toEqual({})
    expect(await harness.service.getOpenerForExtension('.pdf')).toBeNull()
  })

  it('stops serving a previously resolved opener after close', async () => {
    const harness = await createHarness()
    harness.service.scheduleOpenerIconUpdate('pdf', 'com.apple.Preview', APP_INFO)
    await harness.writeFinished.promise
    expect((await harness.service.getOpenerForExtension('.pdf'))?.logo).toBe(`tfile://${ICON_PATH}`)
    await harness.service.close()
    expect(await harness.service.getOpenerForExtension('.pdf')).toBeNull()
  })

  it('drains an admitted primary write before close resolves', async () => {
    const harness = await createHarness()
    const writeGate = Promise.withResolvers<void>()
    harness.gateWrite(writeGate.promise)
    harness.service.scheduleOpenerIconUpdate('pdf', 'com.apple.Preview', APP_INFO)
    await harness.writeStarted.promise
    let closed = false
    const closing = harness.service.close().then(() => {
      closed = true
    })
    await settleScheduledJob()
    expect(closed).toBe(false)
    expect(await harness.primaryIcon()).toEqual([])
    writeGate.resolve()
    await closing
    expect(await harness.primaryIcon()).toEqual([ICON_PATH])
    expect(await harness.searchIcon()).toEqual(['/search-file-icon.png'])
    expect(await harness.service.getOpenerForExtension('.pdf')).toBeNull()
  })
})
