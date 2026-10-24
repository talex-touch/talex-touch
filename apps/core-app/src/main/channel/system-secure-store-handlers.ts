import type {
  SecureStoreHealthResponse,
  SecureValueGetRequest,
  SecureValueSetRequest
} from '@talex-touch/utils/transport/events/types'
import type { HandlerContext, ITuffTransportMain } from '@talex-touch/utils/transport/main'
import { AppEvents } from '@talex-touch/utils/transport/events'
import {
  getSecureStoreHealth,
  getSecureStoreValue,
  isSecureStoreAvailable,
  setSecureStoreValue
} from '../utils/secure-store'
import type { LogOptions } from '../utils/logger'
import { toErrorMessage } from '../utils/safe-handler'

export interface SystemSecureStoreHandlerOptions {
  rootPath: () => string
  logger: { warn: (message: unknown, options?: LogOptions) => void }
}

function createWarnLogger(logger: SystemSecureStoreHandlerOptions['logger']) {
  return (message: string, error: unknown) => {
    logger.warn(`[CommonChannel] ${message}`, {
      error: toErrorMessage(error)
    })
  }
}

/**
 * The store holds the host's own secrets, `auth.token` among them, so a plugin caller is refused
 * whatever the key. Plugins keep their secrets through the namespaced `plugin:storage:*-secret`
 * handlers instead.
 */
function assertHostOnly(
  context: HandlerContext | undefined,
  eventName: string,
  options: SystemSecureStoreHandlerOptions
): void {
  if (!context?.plugin) return
  options.logger.warn('Blocked a host-only handler invoked from a plugin', {
    meta: { eventName, plugin: context.plugin.name }
  })
  throw new Error('HOST_ONLY_HANDLER')
}

async function getSecureValue(
  rawKey: string,
  options: SystemSecureStoreHandlerOptions
): Promise<string | null> {
  const rootPath = options.rootPath()
  if (!isSecureStoreAvailable(rootPath)) {
    return null
  }

  return await getSecureStoreValue(rootPath, rawKey, createWarnLogger(options.logger))
}

async function setSecureValue(
  rawKey: string,
  value: string | null,
  options: SystemSecureStoreHandlerOptions
): Promise<void> {
  const rootPath = options.rootPath()
  if (!isSecureStoreAvailable(rootPath)) {
    throw new Error('Secure storage is unavailable')
  }

  const persisted = await setSecureStoreValue(
    rootPath,
    rawKey,
    value,
    createWarnLogger(options.logger)
  )
  if (!persisted) {
    throw new Error('Secure storage is unavailable')
  }
}

export function registerSystemSecureStoreHandlers(
  transport: ITuffTransportMain,
  options: SystemSecureStoreHandlerOptions
): Array<() => void> {
  return [
    transport.on<SecureValueGetRequest, string | null>(
      AppEvents.system.getSecureValue,
      async (payload, context) => {
        assertHostOnly(context, 'system.getSecureValue', options)
        const key = typeof payload?.key === 'string' ? payload.key : ''
        if (!key) {
          return null
        }
        return await getSecureValue(key, options)
      }
    ),
    transport.on<SecureValueSetRequest, void>(
      AppEvents.system.setSecureValue,
      async (payload, context) => {
        assertHostOnly(context, 'system.setSecureValue', options)
        const key = typeof payload?.key === 'string' ? payload.key : ''
        if (!key) {
          throw new Error('Missing secure storage key')
        }
        await setSecureValue(key, payload?.value ?? null, options)
      }
    ),
    transport.on<void, SecureStoreHealthResponse>(AppEvents.system.getSecureStoreHealth, () =>
      getSecureStoreHealth(options.rootPath())
    )
  ]
}
