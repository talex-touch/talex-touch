import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileProviderContentCapacityService } from './file-provider-content-capacity-service'

const GIB = 1024 ** 3
const guards: FileProviderContentCapacityService[] = []

function createGuard(
  overrides: ConstructorParameters<typeof FileProviderContentCapacityService>[0]
) {
  const guard = new FileProviderContentCapacityService(overrides)
  guards.push(guard)
  return guard
}

afterEach(() => {
  for (const guard of guards.splice(0)) guard.dispose()
  vi.clearAllTimers()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('FileProviderContentCapacityService admission', () => {
  it('blocks the actual index volume even when a different volume has abundant capacity', async () => {
    let directory = '/synthetic/external/index'
    const guard = createGuard({
      getDirectory: () => directory,
      statfs: async (target) => ({
        bavail: target === '/synthetic/external/index' ? 1n : 8n,
        bsize: BigInt(GIB)
      })
    })

    await expect(guard.check(true)).resolves.toBe(false)
    expect(guard.isReady()).toBe(false)
    directory = '/synthetic/other/index'
    await expect(guard.check(true)).resolves.toBe(true)
    expect(guard.isReady()).toBe(true)
  })

  it.each([
    { name: 'one byte below initial margin', bytes: 2 * GIB - 1, admitted: false },
    { name: 'exact initial margin', bytes: 2 * GIB, admitted: true },
    { name: 'one byte above initial margin', bytes: 2 * GIB + 1, admitted: true }
  ])('$name admits or blocks actual work', async ({ bytes, admitted }) => {
    const guard = createGuard({
      getDirectory: () => '/synthetic/index',
      statfs: async () => ({ bavail: bytes, bsize: 1 })
    })
    await expect(guard.check(true)).resolves.toBe(admitted)
    expect(guard.isReady()).toBe(admitted)
  })

  it('does not flap around two GiB after pausing and resumes at exactly three GiB', async () => {
    let available = 2 * GIB
    const guard = createGuard({
      getDirectory: () => '/synthetic/index',
      statfs: async () => ({ bavail: available, bsize: 1 })
    })
    await expect(guard.check(true)).resolves.toBe(true)
    available = 2 * GIB - 1
    await expect(guard.check(true)).resolves.toBe(false)
    for (available of [2 * GIB, 2 * GIB + 1, 3 * GIB - 1]) {
      await expect(guard.check(true)).resolves.toBe(false)
    }
    available = 3 * GIB
    await expect(guard.check(true)).resolves.toBe(true)
    available = 2 * GIB
    await expect(guard.check(true)).resolves.toBe(true)
  })

  it('coalesces concurrent admission reads so callers cannot observe different capacity decisions', async () => {
    let finish!: (value: { bavail: number; bsize: number }) => void
    let reads = 0
    const guard = createGuard({
      getDirectory: () => '/synthetic/index',
      statfs: () => {
        reads++
        const deferred = Promise.withResolvers<{ bavail: number; bsize: number }>()
        finish = deferred.resolve
        return deferred.promise
      }
    })
    const admissions = [guard.check(true), guard.check(true), guard.check(true)]
    await Promise.resolve()
    finish({ bavail: GIB, bsize: 1 })
    await expect(Promise.all(admissions)).resolves.toEqual([false, false, false])
    expect(reads).toBe(1)
  })

  it('fails closed after a previously successful read without leaking the path or raw error', async () => {
    const secret = '/synthetic/private-volume/secret-index.sqlite'
    let fail = false
    let available = 4 * GIB
    const guard = createGuard({
      getDirectory: () => secret,
      now: () => 1234,
      statfs: async () => {
        if (fail) throw new Error(`EACCES opening ${secret}: private-token`)
        return { bavail: available, bsize: 1 }
      }
    })
    await expect(guard.check(true)).resolves.toBe(true)
    fail = true
    await expect(guard.check(true)).resolves.toBe(false)
    expect(guard.isReady()).toBe(false)
    expect(guard.getSnapshot()).toEqual({
      status: 'unavailable',
      availableBytes: null,
      requiredBytes: 3 * GIB,
      checkedAt: 1234
    })
    expect(JSON.stringify(guard.getSnapshot())).not.toContain(secret)
    expect(JSON.stringify(guard.getSnapshot())).not.toContain('private-token')
    fail = false
    available = 2 * GIB
    await expect(guard.check(true)).resolves.toBe(false)
    available = 3 * GIB
    await expect(guard.check(true)).resolves.toBe(true)
  })

  it('does not query another volume when the index directory is unavailable', async () => {
    const guard = createGuard({
      getDirectory: () => null,
      statfs: async () => {
        throw new Error('Must not fall back to home or root')
      }
    })
    await expect(guard.check(true)).resolves.toBe(false)
    expect(guard.getSnapshot().status).toBe('unavailable')
  })

  it.each([
    {
      name: 'nested SQLITE_FULL',
      error: new Error('write wrapper', {
        cause: Object.assign(new Error('database full'), { code: 'SQLITE_FULL' })
      })
    },
    {
      name: 'nested ENOSPC',
      error: new Error('write wrapper', {
        cause: Object.assign(new Error('device full'), { code: 'ENOSPC' })
      })
    }
  ])('$name revokes admission immediately and requires the recovery margin', async ({ error }) => {
    let available = 4 * GIB
    let now = 0
    const guard = createGuard({
      getDirectory: () => '/synthetic/index',
      now: () => now,
      checkIntervalMs: 1000,
      statfs: async () => ({ bavail: available, bsize: 1 })
    })
    await guard.check(true)
    expect(guard.recordFailure(error)).toBe(true)
    expect(guard.isReady()).toBe(false)
    // A real quota/disk write failure cannot be immediately undone by a healthy
    // statfs result; even forced reads wait for the controlled check interval.
    await expect(guard.check(true)).resolves.toBe(false)
    now = 999
    await expect(guard.check(true)).resolves.toBe(false)
    now = 1000
    available = 3 * GIB - 1
    await expect(guard.check(true)).resolves.toBe(false)
    available = 3 * GIB
    await expect(guard.check(true)).resolves.toBe(true)
  })

  it('does not mistake an ordinary parser failure for disk exhaustion', async () => {
    const guard = createGuard({
      getDirectory: () => '/synthetic/index',
      statfs: async () => ({ bavail: 4 * GIB, bsize: 1 })
    })
    await guard.check(true)
    expect(guard.recordFailure(new Error('unsupported document'))).toBe(false)
    expect(guard.isReady()).toBe(true)
  })

  it('does not let an older healthy read undo a disk-full failure that arrived during the read', async () => {
    const deferred = Promise.withResolvers<{ bavail: number; bsize: number }>()
    const guard = createGuard({
      getDirectory: () => '/synthetic/index',
      statfs: () => deferred.promise
    })
    const reading = guard.check(true)
    guard.recordFailure(Object.assign(new Error('write failed'), { code: 'ENOSPC' }))
    deferred.resolve({ bavail: 4 * GIB, bsize: 1 })
    await expect(reading).resolves.toBe(false)
    expect(guard.isReady()).toBe(false)
    expect(guard.getSnapshot().status).toBe('low-space')
  })

  it('bounds a hung statfs read and permits a later independent recovery read', async () => {
    vi.useFakeTimers()
    let hung = true
    const guard = createGuard({
      getDirectory: () => '/synthetic/index',
      checkTimeoutMs: 50,
      statfs: () =>
        hung
          ? Promise.withResolvers<{ bavail: number; bsize: number }>().promise
          : Promise.resolve({ bavail: 4 * GIB, bsize: 1 })
    })
    const admission = guard.check(true)
    await vi.advanceTimersByTimeAsync(50)
    await expect(admission).resolves.toBe(false)
    expect(guard.getSnapshot().status).toBe('unavailable')
    hung = false
    await expect(guard.check(true)).resolves.toBe(true)
  })

  it('stops polling and ignores an outstanding read after disposal', async () => {
    vi.useFakeTimers()
    let finish!: (value: { bavail: number; bsize: number }) => void
    const changes: string[] = []
    const guard = createGuard({
      getDirectory: () => '/synthetic/index',
      checkIntervalMs: 1000,
      checkTimeoutMs: 100,
      statfs: () => {
        const deferred = Promise.withResolvers<{ bavail: number; bsize: number }>()
        finish = deferred.resolve
        return deferred.promise
      },
      onChange: (storage) => changes.push(storage.status)
    })
    guard.start()
    const read = guard.check(true)
    await Promise.resolve()
    guard.dispose()
    const afterDisposal = [...changes]
    finish({ bavail: 4 * GIB, bsize: 1 })
    await read
    await vi.advanceTimersByTimeAsync(5000)
    expect(changes).toEqual(afterDisposal)
    expect(vi.getTimerCount()).toBe(0)
  })
})
