import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const execFilePromiseMock = vi.fn()
const withOSAdapterMock = vi.fn()
const startedAt = new Date('2026-10-14T12:00:00.000Z').getTime()

async function loadWallpaperAdapter() {
  // Static imports would retain singleton cache/in-flight state across resetModules boundaries.
  const { wallpaperAdapter } = await import('./wallpaper-adapter')
  return wallpaperAdapter
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(startedAt)

  withOSAdapterMock.mockImplementation((options: Record<string, () => Promise<string | null>>) =>
    options.darwin()
  )
  vi.doMock('@talex-touch/utils/electron/env-tool', () => ({
    withOSAdapter: withOSAdapterMock
  }))
  vi.doMock('node:child_process', () => {
    const execFile = vi.fn()
    ;(execFile as unknown as Record<symbol, unknown>)[Symbol.for('nodejs.util.promisify.custom')] =
      execFilePromiseMock
    return { execFile }
  })
})

afterEach(() => {
  vi.doUnmock('node:child_process')
  vi.doUnmock('@talex-touch/utils/electron/env-tool')
  vi.resetModules()
  vi.resetAllMocks()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('wallpaperAdapter platform results', () => {
  it.each([
    {
      platform: 'win32',
      stdout:
        'HKEY_CURRENT_USER\\Control Panel\\Desktop\r\n    WallPaper    REG_SZ    C:\\Wallpapers\\aurora day.jpg\r\n',
      expected: 'C:\\Wallpapers\\aurora day.jpg'
    },
    {
      platform: 'darwin',
      stdout: '/Users/demo/Pictures/aurora day.jpg\n',
      expected: '/Users/demo/Pictures/aurora day.jpg'
    },
    {
      platform: 'linux',
      stdout: "'file:///home/demo/Pictures/aurora%20day.jpg'\n",
      expected: '/home/demo/Pictures/aurora day.jpg'
    }
  ])(
    'parses $platform system output into the wallpaper path',
    async ({ platform, stdout, expected }) => {
      // Select the OS boundary without mutating process.platform for other test files.
      withOSAdapterMock.mockImplementation(
        (options: Record<string, () => Promise<string | null>>) => options[platform]()
      )
      execFilePromiseMock.mockResolvedValueOnce({ stdout, stderr: '' })
      const wallpaperAdapter = await loadWallpaperAdapter()

      expect(await wallpaperAdapter.getDesktopWallpaperPath()).toBe(expected)
    }
  )

  it.each(['win32', 'darwin', 'linux'])(
    'returns null when the %s system command fails',
    async (platform) => {
      withOSAdapterMock.mockImplementation(
        (options: Record<string, () => Promise<string | null>>) => options[platform]()
      )
      execFilePromiseMock.mockRejectedValueOnce(new Error('wallpaper command access denied'))
      const wallpaperAdapter = await loadWallpaperAdapter()

      expect(await wallpaperAdapter.getDesktopWallpaperPath()).toBeNull()
    }
  )
})

describe('wallpaperAdapter cache', () => {
  it('shares one system query across concurrent first reads and returns its resolved path', async () => {
    const query = Promise.withResolvers<{ stdout: string; stderr: string }>()
    execFilePromiseMock.mockReturnValueOnce(query.promise)
    const wallpaperAdapter = await loadWallpaperAdapter()

    const first = wallpaperAdapter.getDesktopWallpaperPath()
    const second = wallpaperAdapter.getDesktopWallpaperPath()
    const third = wallpaperAdapter.getDesktopWallpaperPath()

    expect(execFilePromiseMock).toHaveBeenCalledTimes(1)
    query.resolve({ stdout: '/Pictures/first wallpaper.png\n', stderr: '' })

    expect(await Promise.all([first, second, third])).toEqual([
      '/Pictures/first wallpaper.png',
      '/Pictures/first wallpaper.png',
      '/Pictures/first wallpaper.png'
    ])
    expect(execFilePromiseMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      name: 'a wallpaper path',
      stdout: '/Pictures/cached.png\n',
      expected: '/Pictures/cached.png'
    },
    { name: 'no wallpaper', stdout: '', expected: null }
  ])('caches $name through the last millisecond before expiry', async ({ stdout, expected }) => {
    execFilePromiseMock.mockResolvedValueOnce({ stdout, stderr: '' })
    const wallpaperAdapter = await loadWallpaperAdapter()

    expect(await wallpaperAdapter.getDesktopWallpaperPath()).toBe(expected)
    vi.setSystemTime(startedAt + 59_999)

    expect(
      await Promise.all([
        wallpaperAdapter.getDesktopWallpaperPath(),
        wallpaperAdapter.getDesktopWallpaperPath(),
        wallpaperAdapter.getDesktopWallpaperPath()
      ])
    ).toEqual([expected, expected, expected])
    expect(execFilePromiseMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    { name: 'the old wallpaper path', stdout: '/Pictures/old.png', expected: '/Pictures/old.png' },
    { name: 'a cached null', stdout: '', expected: null }
  ])(
    'returns $name at expiry while sharing one refresh, then exposes the new path',
    async ({ stdout, expected }) => {
      const refresh = Promise.withResolvers<{ stdout: string; stderr: string }>()
      execFilePromiseMock
        .mockResolvedValueOnce({ stdout, stderr: '' })
        .mockReturnValueOnce(refresh.promise)
      const wallpaperAdapter = await loadWallpaperAdapter()

      expect(await wallpaperAdapter.getDesktopWallpaperPath()).toBe(expected)
      vi.setSystemTime(startedAt + 60_000)

      // These reads must finish before the system query does, including cached null.
      expect(
        await Promise.all([
          wallpaperAdapter.getDesktopWallpaperPath(),
          wallpaperAdapter.getDesktopWallpaperPath(),
          wallpaperAdapter.getDesktopWallpaperPath()
        ])
      ).toEqual([expected, expected, expected])
      expect(execFilePromiseMock).toHaveBeenCalledTimes(2)

      refresh.resolve({ stdout: '/Pictures/new.png\n', stderr: '' })
      await vi.advanceTimersByTimeAsync(0)

      expect(await wallpaperAdapter.getDesktopWallpaperPath()).toBe('/Pictures/new.png')
      vi.setSystemTime(startedAt + 119_999)
      expect(await wallpaperAdapter.getDesktopWallpaperPath()).toBe('/Pictures/new.png')
      expect(execFilePromiseMock).toHaveBeenCalledTimes(2)
    }
  )

  it('caches command failures and permits only one retry per expired cache window', async () => {
    const failedRefresh = Promise.withResolvers<{ stdout: string; stderr: string }>()
    execFilePromiseMock
      .mockRejectedValueOnce(new Error('osascript: access denied'))
      .mockReturnValueOnce(failedRefresh.promise)
      .mockResolvedValueOnce({ stdout: '/Pictures/recovered.png', stderr: '' })
    const wallpaperAdapter = await loadWallpaperAdapter()

    expect(
      await Promise.all([
        wallpaperAdapter.getDesktopWallpaperPath(),
        wallpaperAdapter.getDesktopWallpaperPath()
      ])
    ).toEqual([null, null])
    vi.setSystemTime(startedAt + 59_999)
    expect(await wallpaperAdapter.getDesktopWallpaperPath()).toBeNull()
    expect(execFilePromiseMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(startedAt + 60_000)
    expect(
      await Promise.all([
        wallpaperAdapter.getDesktopWallpaperPath(),
        wallpaperAdapter.getDesktopWallpaperPath()
      ])
    ).toEqual([null, null])
    expect(execFilePromiseMock).toHaveBeenCalledTimes(2)

    failedRefresh.reject(new Error('osascript: timed out'))
    await vi.advanceTimersByTimeAsync(0)
    vi.setSystemTime(startedAt + 119_999)
    expect(
      await Promise.all([
        wallpaperAdapter.getDesktopWallpaperPath(),
        wallpaperAdapter.getDesktopWallpaperPath()
      ])
    ).toEqual([null, null])
    expect(execFilePromiseMock).toHaveBeenCalledTimes(2)

    vi.setSystemTime(startedAt + 120_000)
    expect(await wallpaperAdapter.getDesktopWallpaperPath()).toBeNull()
    await vi.advanceTimersByTimeAsync(0)

    expect(await wallpaperAdapter.getDesktopWallpaperPath()).toBe('/Pictures/recovered.png')
    expect(execFilePromiseMock).toHaveBeenCalledTimes(3)
  })
})
