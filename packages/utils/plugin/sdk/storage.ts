import type { FileDetails, StorageStats, StorageTreeNode } from '../../types/storage'
import { createPluginTuffTransport } from '../../transport'
import { PluginEvents } from '../../transport/events'
import { ensureRendererChannel } from './channel'
import { usePluginName } from './plugin-info'

/**
 * Get the storage for the current plugin.
 * It provides simple file-based storage that is persisted across application launches.
 * Each plugin can have multiple storage files in its own directory.
 *
 * @returns An object with methods to interact with the storage.
 */
export function usePluginStorage() {
  const pluginName = usePluginName('[Plugin SDK] Cannot determine plugin name. Make sure this is called in a plugin context.')

  const channel = ensureRendererChannel('[Plugin Storage] Channel not available. Make sure this is called in a plugin context.')
  const transport = createPluginTuffTransport(channel as any)

  return {
    /**
     * Retrieves the content of a storage file.
     * @param fileName The name of the file to retrieve.
     * @returns A promise that resolves with the file content, or null if the file does not exist.
     */
    getFile: async (fileName: string): Promise<any> => {
      return transport.send(PluginEvents.storage.getFile, { pluginName, fileName })
    },

    /**
     * Stores content to a storage file.
     * @param fileName The name of the file to store.
     * @param content The content to store in the file.
     * @returns A promise that resolves when the file has been stored.
     */
    setFile: async (fileName: string, content: any): Promise<{ success: boolean, error?: string }> => {
      const serialized = serializeStorageContent(content)
      if (!serialized.ok)
        return { success: false, error: `Cannot store "${fileName}": ${serialized.reason}` }

      return transport.send(PluginEvents.storage.setFile, { pluginName, fileName, content: serialized.value })
    },

    /**
     * Deletes a storage file.
     * @param fileName The name of the file to delete.
     * @returns A promise that resolves when the file has been deleted.
     */
    deleteFile: async (fileName: string): Promise<{ success: boolean, error?: string }> => {
      return transport.send(PluginEvents.storage.deleteFile, { pluginName, fileName })
    },

    /**
     * Lists all storage files for the current plugin.
     * @returns A promise that resolves with an array of file names.
     */
    listFiles: async (): Promise<string[]> => {
      return transport.send(PluginEvents.storage.listFiles, { pluginName })
    },

    /**
     * Gets storage statistics for the current plugin.
     * @returns A promise that resolves with storage statistics.
     */
    getStats: async (): Promise<StorageStats> => {
      return transport.send(PluginEvents.storage.getStats, { pluginName }) as Promise<StorageStats>
    },

    /**
     * Gets the directory tree structure of plugin storage.
     * @returns A promise that resolves with the tree structure.
     */
    getTree: async (): Promise<StorageTreeNode[]> => {
      return transport.send(PluginEvents.storage.getTree, { pluginName }) as Promise<StorageTreeNode[]>
    },

    /**
     * Gets detailed information about a specific file.
     * @param fileName The name of the file to get details for.
     * @returns A promise that resolves with file details.
     */
    getFileDetails: async (fileName: string): Promise<FileDetails | null> => {
      return transport.send(PluginEvents.storage.getFileDetails, { pluginName, fileName }) as Promise<FileDetails | null>
    },

    /**
     * Clears all storage for the current plugin.
     * @returns A promise that resolves with the operation result.
     */
    clearAll: async (): Promise<{ success: boolean, error?: string }> => {
      return transport.send(PluginEvents.storage.clear, { pluginName })
    },

    /**
     * Opens the plugin storage folder in the system file manager.
     * @returns A promise that resolves when the folder is opened.
     */
    openFolder: async (): Promise<void> => {
      await transport.send(PluginEvents.storage.openFolder, { pluginName })
    },

    /**
     * Listens for changes to the storage.
     *
     * The broadcast carries only `{ name, fileName }`, so the new content is read back before the
     * callback runs - the callback receives what `getFile` would return, or `null` once the file
     * is gone.
     *
     * A broadcast with no `fileName` is `clearStorage()`, which empties every storage root. Every
     * subscribed file really did change, so every subscriber is notified and each reads back
     * `null`. Suppressing those would leave subscribers serving state for files that no longer
     * exist.
     *
     * @param fileName The file name to listen for changes
     * @param callback The function to call when the storage changes for the current plugin.
     * @returns A function to unsubscribe from the listener.
     */
    onDidChange: (fileName: string, callback: (newConfig: any) => void) => {
      let latestTicket = 0

      const listener = (data: { name: string, fileName?: string }) => {
        if (data.name !== pluginName)
          return
        if (data.fileName !== undefined && data.fileName !== fileName)
          return

        // Reading back is asynchronous, so two quick writes can resolve out of order. Only the
        // most recently requested read is allowed to reach the callback.
        const ticket = ++latestTicket
        transport
          .send(PluginEvents.storage.getFile, { pluginName, fileName })
          .then((content: unknown) => {
            if (ticket === latestTicket)
              callback(content)
          })
          .catch((error: unknown) => {
            console.error(`[Plugin Storage] Failed to read "${fileName}" after a change notification:`, error)
          })
      }

      return transport.on(PluginEvents.storage.update, listener)
    },
  }
}

/** A key-value store in the shape TuffEx's `TxForm` takes for its drafts. */
export interface PluginDraftStorage {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
  remove: (key: string) => Promise<void>
  clear: (prefix: string) => Promise<void>
}

/**
 * Form drafts kept in the plugin's own storage, one file per draft. They stay with the plugin
 * rather than the page's origin - the dev server and the packaged plugin see the same drafts -
 * and go when it is uninstalled. Hand it to the forms through the TuffEx form host:
 * `provideTxFormHost({ storage: usePluginDraftStorage() }, app)`.
 */
export function usePluginDraftStorage(): PluginDraftStorage {
  const storage = usePluginStorage()
  const fileOf = (key: string): string => `${encodeURIComponent(key)}.json`
  const keyOf = (fileName: string): string | null => {
    try {
      return decodeURIComponent(fileName.slice(0, -'.json'.length))
    }
    catch {
      return null
    }
  }

  return {
    get: async (key) => {
      const content: unknown = await storage.getFile(fileOf(key))
      if (typeof content === 'string')
        return content
      const error = content && typeof content === 'object' ? (content as { error?: unknown }).error : undefined
      if (typeof error === 'string')
        throw new Error(error)
      // A file that does not exist reads as `{}`.
      return null
    },
    set: async (key, value) => {
      const result = await storage.setFile(fileOf(key), value)
      if (!result?.success)
        throw new Error(result?.error ?? `Cannot store "${key}".`)
    },
    remove: async (key) => {
      const result = await storage.deleteFile(fileOf(key))
      // Most drafts removed were never written: that is not a failure.
      if (!result?.success && result?.error !== 'File not found')
        throw new Error(result?.error ?? `Cannot remove "${key}".`)
    },
    clear: async (prefix) => {
      const files = await storage.listFiles()
      await Promise.all(files
        .filter(fileName => keyOf(fileName)?.startsWith(prefix))
        .map(fileName => storage.deleteFile(fileName)))
    },
  }
}

/**
 * Round-trips content through JSON to drop the non-cloneables that would break structured clone
 * on the way to the main process.
 *
 * The round trip itself has two failure modes and neither used to be caught: `JSON.stringify`
 * throws on circular references and BigInt, and it *returns* `undefined` for a top-level
 * `undefined`, function or symbol - which `JSON.parse` then reads as the string "undefined" and
 * rejects. Both escaped as a synchronous throw from a method declared to resolve
 * `{ success, error? }`.
 */
function serializeStorageContent(
  content: unknown,
): { ok: true, value: unknown } | { ok: false, reason: string } {
  let json: string | undefined
  try {
    json = JSON.stringify(content)
  }
  catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }

  if (json === undefined)
    return { ok: false, reason: `content of type ${typeof content} has no JSON representation` }

  return { ok: true, value: JSON.parse(json) }
}
