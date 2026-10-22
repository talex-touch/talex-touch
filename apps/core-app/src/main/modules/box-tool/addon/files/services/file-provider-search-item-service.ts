import type { TuffItem } from '@talex-touch/utils'
import type { files as filesSchema } from '../../../../../db/schema'
import { isSqliteBusyError } from '../../../../../db/sqlite-retry'
import {
  normalizeRenderableSource,
  normalizeTuffItemLocalAssets,
  type LocalAssetFallbackKind
} from '../../../../../utils/local-renderable-assets'
import { mapFileToTuffItem } from '../utils'
import type { FileProviderAssetService } from './file-provider-asset-service'

type FileRecord = typeof filesSchema.$inferSelect

export interface FileProviderSearchItemServiceDeps {
  providerId: string
  providerName: string
  getAssetService: () => FileProviderAssetService
  cleanupStaleFileResult: (file: FileRecord, reason: string) => void
  /** Resolves `false` when the persistence port is not ready. */
  ensurePersistenceReady: (reason: string) => Promise<boolean>
  removeFileExtensions: (fileId: number, keys: string[]) => Promise<void>
  logDebug: (message: string, meta?: Record<string, unknown>) => void
  logWarn: (message: string, error?: unknown, meta?: Record<string, unknown>) => void
}

/**
 * Turns indexed file rows into search items, and repairs the cached icon or thumbnail an item
 * points at when that cache file has gone missing.
 */
export class FileProviderSearchItemService {
  constructor(private readonly deps: FileProviderSearchItemServiceDeps) {}

  createItem(file: FileRecord, extensions: Record<string, string>): TuffItem {
    return mapFileToTuffItem(
      file,
      extensions,
      this.deps.providerId,
      this.deps.providerName,
      (indexedFile) => {
        if (typeof indexedFile.id === 'number') {
          void this.deps
            .getAssetService()
            .ensureIcon(indexedFile.id, indexedFile.path, indexedFile)
            .catch((error) => {
              this.deps.logWarn('Failed to lazy load icon', error, { path: indexedFile.path })
            })
        }
      },
      (indexedFile) => {
        if (typeof indexedFile.id === 'number') {
          void this.deps
            .getAssetService()
            .ensureThumbnail(indexedFile.id, indexedFile.path, indexedFile, extensions)
            .catch((error) => {
              this.deps.logWarn('Failed to lazy load thumbnail', error, { path: indexedFile.path })
            })
        }
      }
    )
  }

  normalizeItem(
    item: TuffItem,
    file: FileRecord,
    extensions: Record<string, string>,
    options: {
      reason: string
      fallbackKind?: LocalAssetFallbackKind
    }
  ): TuffItem | null {
    const normalized = normalizeTuffItemLocalAssets(item, {
      dropMissingFile: true,
      fallbackKind: options.fallbackKind ?? (file.isDir ? 'folder' : 'file')
    })

    if (!normalized.item) {
      this.deps.cleanupStaleFileResult(file, options.reason)
      return null
    }

    if (normalized.missingPaths.length > 0) {
      const staleKeys = this.inferAssetCacheKeys(extensions, normalized.missingPaths)
      this.cleanupStaleFileAsset(file, staleKeys, options.reason)
      if (staleKeys.includes('thumbnail') && typeof file.id === 'number') {
        void this.deps
          .getAssetService()
          .ensureThumbnail(file.id, file.path, file)
          .catch((error) => {
            this.deps.logWarn('Failed to regenerate stale thumbnail', error, { path: file.path })
          })
      }
      if (staleKeys.includes('icon') && typeof file.id === 'number') {
        void this.deps
          .getAssetService()
          .ensureIcon(file.id, file.path, file)
          .catch((error) => {
            this.deps.logWarn('Failed to regenerate stale icon', error, { path: file.path })
          })
      }
    }

    return normalized.item
  }

  private cleanupStaleFileAsset(file: FileRecord, keys: string[], reason: string): void {
    if (typeof file.id !== 'number' || keys.length === 0) return
    void this.deps
      .ensurePersistenceReady(`file-index.${reason}.cleanup-asset`)
      .then(async (ready) => {
        if (!ready) {
          this.deps.logDebug('Stale file asset cleanup skipped: persistence port not ready', {
            path: file.path,
            keys,
            reason
          })
          return
        }
        await this.deps.removeFileExtensions(file.id, keys)
      })
      .catch((error) => {
        if (isSqliteBusyError(error)) {
          this.deps.logDebug('Stale file asset cache cleanup deferred (db busy)', {
            path: file.path,
            keys,
            reason
          })
        } else {
          this.deps.logWarn('Failed to cleanup stale file asset cache', error, {
            path: file.path,
            keys,
            reason
          })
        }
      })
  }

  private inferAssetCacheKeys(
    extensions: Record<string, string>,
    missingPaths: string[]
  ): string[] {
    const keys = new Set<string>()
    const referencesMissingPath = (value: string | undefined): boolean => {
      if (!value) return false
      const normalized = normalizeRenderableSource(value)
      return (
        'missing' in normalized &&
        typeof normalized.localPath === 'string' &&
        missingPaths.includes(normalized.localPath)
      )
    }
    for (const missingPath of missingPaths) {
      if (extensions.thumbnail && extensions.thumbnail.includes(missingPath)) {
        keys.add('thumbnail')
      }
      if (extensions.icon && extensions.icon.includes(missingPath)) {
        keys.add('icon')
      }
    }
    if (referencesMissingPath(extensions.thumbnail)) {
      keys.add('thumbnail')
    }
    if (referencesMissingPath(extensions.icon)) {
      keys.add('icon')
    }
    return Array.from(keys)
  }
}
