import { Buffer } from 'node:buffer'
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface LocalEmbeddingAssets {
  readonly helper: string
  readonly helperSha256: string
  readonly modelDirectory?: string
}

const MAX_MANIFEST_BYTES = 8192

/** Shared across development and installed Tuff; never discovers executables through PATH. */
export function localEmbeddingInstallManifestPath(): string {
  const home = os.homedir()
  const base =
    process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : process.platform === 'win32'
        ? process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
        : process.env.XDG_DATA_HOME || path.join(home, '.local', 'share')
  return path.join(base, 'Tuff', 'intelligence', 'local-embedding.json')
}

function absolutePath(value: unknown): value is string {
  return typeof value === 'string' && !value.includes('\0') && path.isAbsolute(value)
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

/** Bounded configuration read; model and executable checksums remain mandatory before launch. */
function installedAssets(): LocalEmbeddingAssets | null {
  let handle: number | undefined
  try {
    handle = openSync(localEmbeddingInstallManifestPath(), 'r')
    const details = fstatSync(handle)
    if (!details.isFile() || details.size > MAX_MANIFEST_BYTES) return null
    const bytes = Buffer.alloc(MAX_MANIFEST_BYTES + 1)
    let length = 0
    while (length < bytes.length) {
      const count = readSync(handle, bytes, length, bytes.length - length, null)
      if (count === 0) break
      length += count
    }
    if (length > MAX_MANIFEST_BYTES) return null
    const manifest: unknown = JSON.parse(bytes.toString('utf8', 0, length))
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return null
    const record = manifest as Record<string, unknown>
    if (
      record.version !== 1 ||
      record.platform !== process.platform ||
      record.arch !== process.arch ||
      !absolutePath(record.helper) ||
      !validHash(record.helperSha256) ||
      !absolutePath(record.modelDirectory)
    )
      return null
    return {
      helper: record.helper,
      helperSha256: record.helperSha256.toLowerCase(),
      modelDirectory: record.modelDirectory
    }
  } catch {
    // Missing or invalid installation cannot authorize an executable or trigger a download.
    return null
  } finally {
    if (handle !== undefined) closeSync(handle)
  }
}

/** Explicit helper overrides are fail-closed and never borrow an installed helper's checksum. */
export function resolveLocalEmbeddingAssets(): LocalEmbeddingAssets | null {
  const helper = process.env.TUFF_LOCAL_EMBEDDING_HELPER || process.env.TUFF_DIGUP_HELPER
  const modelDirectory =
    process.env.TUFF_LOCAL_EMBEDDING_MODEL_DIR || process.env.DIGUP_MODELS || undefined
  if (helper) {
    const helperSha256 = process.env.TUFF_LOCAL_EMBEDDING_HELPER_SHA256
    if (
      !absolutePath(helper) ||
      !validHash(helperSha256) ||
      (modelDirectory !== undefined && !absolutePath(modelDirectory))
    )
      return null
    return { helper, helperSha256: helperSha256.toLowerCase(), modelDirectory }
  }
  const assets = installedAssets()
  if (!assets || (modelDirectory !== undefined && !absolutePath(modelDirectory))) return null
  return modelDirectory ? { ...assets, modelDirectory } : assets
}
