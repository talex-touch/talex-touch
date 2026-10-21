import { getLogger } from '@talex-touch/utils/common/logger'

// FileProvider's log sink. None of it reads provider state, so it lives beside the provider rather
// than inside it (#343).
export const fileProviderLog = getLogger('file-provider')

type LogMeta = Record<string, unknown>

export function logFileProviderInfo(message: string, meta?: LogMeta): void {
  if (meta) {
    fileProviderLog.info(message, meta)
  } else {
    fileProviderLog.info(message)
  }
}

export function logFileProviderWarn(message: string, error?: unknown, meta?: LogMeta): void {
  if (error && meta) {
    fileProviderLog.warn(message, { ...meta, error })
    return
  }
  if (meta) {
    fileProviderLog.warn(message, meta)
    return
  }
  if (error) {
    fileProviderLog.warn(message, error)
    return
  }
  fileProviderLog.warn(message)
}

export function logFileProviderDebug(message: string, meta?: LogMeta): void {
  if (meta) {
    fileProviderLog.debug(message, meta)
  } else {
    fileProviderLog.debug(message)
  }
}

export function logFileProviderError(message: string, error?: unknown, meta?: LogMeta): void {
  if (error && meta) {
    fileProviderLog.error(message, { ...meta, error })
    return
  }
  if (meta) {
    fileProviderLog.error(message, meta)
    return
  }
  if (error) {
    fileProviderLog.error(message, error)
    return
  }
  fileProviderLog.error(message)
}
