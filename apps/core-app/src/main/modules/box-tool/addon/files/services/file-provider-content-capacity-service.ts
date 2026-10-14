import { statfs } from 'node:fs/promises'
import {
  FILE_CONTENT_INDEX_MIN_FREE_BYTES,
  FILE_CONTENT_INDEX_RESUME_FREE_BYTES,
  type FileIndexContentStorage
} from '@talex-touch/utils/transport/events/types'
import { isSqliteStorageFullError } from '../../../../../db/sqlite-retry'

export interface FileProviderContentCapacityServiceDeps {
  getDirectory: () => string | null
  statfs?: (directory: string) => Promise<{ bavail: number | bigint; bsize: number | bigint }>
  now?: () => number
  onChange?: (storage: FileIndexContentStorage) => void
  checkIntervalMs?: number
  checkTimeoutMs?: number
}

/** Checks only the writer's volume; never walks or stats the index database. */
export class FileProviderContentCapacityService {
  private storage: FileIndexContentStorage = {
    status: 'unavailable',
    availableBytes: null,
    requiredBytes: FILE_CONTENT_INDEX_MIN_FREE_BYTES,
    checkedAt: null
  }
  private paused = false
  private disposed = false
  private failureVersion = 0
  private failureNotBefore = 0
  private checkedDirectory: string | null = null
  private checkPromise: Promise<boolean> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private checkTimer: ReturnType<typeof setTimeout> | null = null
  private cancelCheck: (() => void) | null = null
  private readonly now: () => number
  private readonly readStatfs: NonNullable<FileProviderContentCapacityServiceDeps['statfs']>
  private readonly intervalMs: number

  constructor(private readonly deps: FileProviderContentCapacityServiceDeps) {
    this.now = deps.now ?? Date.now
    this.readStatfs = deps.statfs ?? ((directory) => statfs(directory, { bigint: true }))
    this.intervalMs = deps.checkIntervalMs ?? 30_000
  }

  getSnapshot(): FileIndexContentStorage {
    return { ...this.storage }
  }

  isReady(): boolean {
    try {
      return (
        !this.disposed &&
        this.storage.status === 'ready' &&
        this.checkedDirectory === this.deps.getDirectory()
      )
    } catch {
      return false
    }
  }

  start(): void {
    if (this.timer || this.disposed) return
    this.timer = setInterval(() => {
      void this.check(true)
    }, this.intervalMs)
    this.timer.unref?.()
  }

  check(force = false): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false)
    if (this.now() < this.failureNotBefore) return Promise.resolve(false)
    if (this.checkPromise) return this.checkPromise
    let directory: string | null = null
    try {
      directory = this.deps.getDirectory()
    } catch {
      // An uninitialized writer target is unavailable, never a guessed profile volume.
    }
    if (
      !force &&
      directory === this.checkedDirectory &&
      this.storage.checkedAt !== null &&
      this.now() - this.storage.checkedAt < this.intervalMs
    )
      return Promise.resolve(this.isReady())
    const version = this.failureVersion
    this.checkPromise = this.readCapacity(directory, version).finally(() => {
      this.checkPromise = null
    })
    return this.checkPromise
  }

  recordFailure(error: unknown): boolean {
    if (this.disposed) return false
    if (!isSqliteStorageFullError(error)) return false
    this.failureVersion++
    this.failureNotBefore = this.now() + this.intervalMs
    this.paused = true
    this.publish({
      status: 'low-space',
      availableBytes: this.storage.availableBytes,
      requiredBytes: FILE_CONTENT_INDEX_RESUME_FREE_BYTES,
      checkedAt: this.now()
    })
    return true
  }

  stop(): void {
    clearInterval(this.timer ?? undefined)
    this.timer = null
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    this.cancelCheck?.()
    this.cancelCheck = null
    clearTimeout(this.checkTimer ?? undefined)
    this.checkTimer = null
  }

  private async readCapacity(directory: string | null, version: number): Promise<boolean> {
    try {
      if (!directory) throw new Error('FILE_CONTENT_STORAGE_UNAVAILABLE')
      const result = await Promise.race([
        this.readStatfs(directory),
        new Promise<never>((_, reject) => {
          this.cancelCheck = () => reject(new Error('FILE_CONTENT_STORAGE_UNAVAILABLE'))
          this.checkTimer = setTimeout(
            () => reject(new Error('FILE_CONTENT_STORAGE_UNAVAILABLE')),
            this.deps.checkTimeoutMs ?? 2000
          )
          this.checkTimer.unref?.()
        })
      ])
      if (this.disposed || version !== this.failureVersion) return false
      const availableBytes = Number(result.bavail) * Number(result.bsize)
      if (!Number.isFinite(availableBytes) || availableBytes < 0 || Number(result.bsize) <= 0) {
        throw new Error('FILE_CONTENT_STORAGE_UNAVAILABLE')
      }
      const threshold = this.paused
        ? FILE_CONTENT_INDEX_RESUME_FREE_BYTES
        : FILE_CONTENT_INDEX_MIN_FREE_BYTES
      const ready = availableBytes >= threshold
      this.paused = !ready
      this.checkedDirectory = directory
      this.publish({
        status: ready ? 'ready' : 'low-space',
        availableBytes,
        requiredBytes: ready
          ? FILE_CONTENT_INDEX_MIN_FREE_BYTES
          : FILE_CONTENT_INDEX_RESUME_FREE_BYTES,
        checkedAt: this.now()
      })
      return ready
    } catch {
      if (this.disposed || version !== this.failureVersion) return false
      this.paused = true
      this.checkedDirectory = directory
      this.publish({
        status: 'unavailable',
        availableBytes: null,
        requiredBytes: FILE_CONTENT_INDEX_RESUME_FREE_BYTES,
        checkedAt: this.now()
      })
      return false
    } finally {
      clearTimeout(this.checkTimer ?? undefined)
      this.checkTimer = null
      this.cancelCheck = null
    }
  }

  private publish(storage: FileIndexContentStorage): void {
    const previous = this.storage.status
    this.storage = storage
    if (previous !== storage.status) this.deps.onChange?.(this.getSnapshot())
  }
}
