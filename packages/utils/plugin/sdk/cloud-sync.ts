import type { CloudSyncSDKOptions as ClientOptions } from '../../cloud-sync/cloud-sync-sdk'
import type { HandshakeResponse } from '../../types/cloud-sync'
import { CloudSyncSDK as CloudSyncClientSDK, CloudSyncError } from '../../cloud-sync/cloud-sync-sdk'

export interface CloudSyncSDKOptions {
  baseUrl?: string
  serviceBaseUrl?: string
  fetch?: typeof fetch
  now?: () => number
  syncTokenCache?: { token?: string, expiresAt?: string }
  onSyncTokenUpdate?: (token: string, expiresAt: string) => void
  onHandshake?: (response: HandshakeResponse) => void
  onStepUpRequired?: () => string | null | Promise<string | null>
  formDataFactory?: () => FormData
  /** @deprecated Unused. Plugins do not receive the account's credential through the channel. */
  channelSend?: (event: string, data?: any) => Promise<any>
  /** @deprecated Unused. Plugins cannot sync through the account. */
  ignoreSyncPreferenceCheck?: boolean
}

/**
 * Sync signs in as the account on this device, and plugins receive neither the account's credential
 * nor the device id. Every call fails with `PLUGIN_SYNC_UNAVAILABLE` before anything is sent.
 */
function rejectPluginSync(): never {
  throw new CloudSyncError(
    '[CloudSyncSDK] Plugins cannot sync through the account. Keep plugin data in plugin storage, which the app syncs.',
    403,
    'PLUGIN_SYNC_UNAVAILABLE',
  )
}

/**
 * @deprecated Plugins cannot sync through the account: every call fails with
 * `PLUGIN_SYNC_UNAVAILABLE`. Files a plugin keeps in plugin storage are synced by the app.
 */
export class CloudSyncSDK extends CloudSyncClientSDK {
  constructor(options: CloudSyncSDKOptions = {}) {
    const clientOptions: ClientOptions = {
      baseUrl: options.baseUrl ?? options.serviceBaseUrl,
      fetch: options.fetch,
      now: options.now,
      syncTokenCache: options.syncTokenCache,
      onSyncTokenUpdate: options.onSyncTokenUpdate,
      onHandshake: options.onHandshake,
      onStepUpRequired: options.onStepUpRequired,
      formDataFactory: options.formDataFactory,
      getAuthToken: rejectPluginSync,
      getDeviceId: rejectPluginSync,
    }
    super(clientOptions)
  }
}

let cachedSDK: CloudSyncSDK | null = null

/** @deprecated See {@link CloudSyncSDK}. */
export function createCloudSyncSDK(options?: CloudSyncSDKOptions): CloudSyncSDK {
  return new CloudSyncSDK(options)
}

/** @deprecated See {@link CloudSyncSDK}. */
export function useCloudSyncSDK(options?: CloudSyncSDKOptions): CloudSyncSDK {
  if (!cachedSDK)
    cachedSDK = new CloudSyncSDK(options)
  return cachedSDK
}

export function resetCloudSyncSDK(): void {
  cachedSDK = null
}

export { CloudSyncError }
