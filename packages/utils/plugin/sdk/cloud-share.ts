import type { CloudShareSDKOptions as ClientOptions } from '../../cloud-share/cloud-share-sdk'
import { CloudShareSDK as CloudShareClientSDK, CloudShareError } from '../../cloud-share/cloud-share-sdk'

export interface CloudShareSDKOptions {
  baseUrl?: string
  serviceBaseUrl?: string
  pluginId?: string
  fetch?: typeof fetch
  /** @deprecated Unused. Plugins do not receive the account's credential through the channel. */
  channelSend?: (event: string, data?: any) => Promise<any>
  /** The token `publish` sends. Listing, reading and installing shared content need none. */
  getAuthToken?: () => string | null | undefined | Promise<string | null | undefined>
}

/**
 * Plugins do not receive the account's credential, so publishing has a token only when the plugin
 * passes `getAuthToken`, and fails before anything is sent when it does not.
 */
async function resolveAuthToken(options: CloudShareSDKOptions): Promise<string> {
  const token = await options.getAuthToken?.()
  if (typeof token === 'string' && token.trim())
    return token
  throw new CloudShareError(
    '[CloudShareSDK] Publishing needs an auth token, and plugins do not receive the account\'s. Pass getAuthToken.',
    401,
    'AUTH_TOKEN_UNAVAILABLE',
  )
}

export class CloudShareSDK extends CloudShareClientSDK {
  constructor(options: CloudShareSDKOptions = {}) {
    const clientOptions: ClientOptions = {
      baseUrl: options.baseUrl ?? options.serviceBaseUrl,
      pluginId: options.pluginId,
      fetch: options.fetch,
      getAuthToken: () => resolveAuthToken(options),
    }
    super(clientOptions)
  }
}

let cachedSDK: CloudShareSDK | null = null

export function createCloudShareSDK(options?: CloudShareSDKOptions): CloudShareSDK {
  return new CloudShareSDK(options)
}

export function useCloudShareSDK(options?: CloudShareSDKOptions): CloudShareSDK {
  if (!cachedSDK)
    cachedSDK = new CloudShareSDK(options)
  return cachedSDK
}

export function resetCloudShareSDK(): void {
  cachedSDK = null
}

export { CloudShareError }
