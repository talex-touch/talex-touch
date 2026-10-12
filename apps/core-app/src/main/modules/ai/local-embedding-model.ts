import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Exact EmbeddingGemma 2 GGUF identity used by the verified llama.cpp runtime. */
export const LOCAL_EMBEDDING_MODEL = {
  repository: 'ggml-org/embeddinggemma-2-GGUF',
  revision: 'bfcd298762cc34d0357ece5ebdd31791a3a374d8',
  file: 'embeddinggemma-2-Q8_0.gguf',
  bytes: 309_855_456,
  sha256: '2188ac1deca4b77dffefd603c2776a9d76d9d74ec01841392982ebb840b09135',
  dimension: 768,
  runtime: 'llama.cpp-vectors1',
  dtype: 'text-q8_0+mmproj-q8_0'
} as const
export const LOCAL_EMBEDDING_MODEL_KEY = `${'google/embeddinggemma-2'}@${LOCAL_EMBEDDING_MODEL.revision}/${LOCAL_EMBEDDING_MODEL.runtime}/${LOCAL_EMBEDDING_MODEL.dtype}/dim${LOCAL_EMBEDDING_MODEL.dimension}`

export interface LocalEmbeddingModelLocation {
  readonly directory: string
  readonly file: string
}

function cacheDirectory(): string {
  const env = process.env
  if (env.HF_HUB_CACHE)
    return path.join(
      env.HF_HUB_CACHE,
      'models--ggml-org--embeddinggemma-2-GGUF',
      'snapshots',
      LOCAL_EMBEDDING_MODEL.revision
    )
  if (env.HF_HOME)
    return path.join(
      env.HF_HOME,
      'hub',
      'models--ggml-org--embeddinggemma-2-GGUF',
      'snapshots',
      LOCAL_EMBEDDING_MODEL.revision
    )
  return path.join(
    os.homedir(),
    '.cache',
    'huggingface',
    'hub',
    'models--ggml-org--embeddinggemma-2-GGUF',
    'snapshots',
    LOCAL_EMBEDDING_MODEL.revision
  )
}

/** Explicit paths only; this never recursively searches a user's disk or downloads weights. */
export function embeddingModelDirectories(): string[] {
  const configured = process.env.TUFF_LOCAL_EMBEDDING_MODEL_DIR || process.env.DIGUP_MODELS
  if (configured) return [configured]
  return [
    path.join(os.homedir(), 'Library', 'Application Support', 'DigUp', 'Models'),
    cacheDirectory()
  ]
}

export async function locateLocalEmbeddingModel(): Promise<LocalEmbeddingModelLocation | null> {
  for (const directory of embeddingModelDirectories()) {
    const file = path.join(directory, LOCAL_EMBEDDING_MODEL.file)
    try {
      const details = await stat(file)
      if (details.isFile() && details.size === LOCAL_EMBEDDING_MODEL.bytes) {
        return { directory, file }
      }
    } catch {
      // An absent model is a degraded runtime, not a reason to search unrelated paths.
    }
  }
  return null
}

export async function verifyLocalEmbeddingModel(
  location: LocalEmbeddingModelLocation
): Promise<void> {
  const details = await stat(location.file)
  if (!details.isFile() || details.size !== LOCAL_EMBEDDING_MODEL.bytes) {
    throw new Error(
      `EmbeddingGemma 2 model size mismatch: expected ${LOCAL_EMBEDDING_MODEL.bytes} bytes`
    )
  }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(location.file, { highWaterMark: 8 << 20 })) {
    hash.update(chunk)
  }
  const digest = hash.digest('hex')
  if (digest !== LOCAL_EMBEDDING_MODEL.sha256) {
    throw new Error(
      `EmbeddingGemma 2 model checksum mismatch for ${LOCAL_EMBEDDING_MODEL.revision}`
    )
  }
}

export async function isLocalEmbeddingModelReady(): Promise<boolean> {
  const location = await locateLocalEmbeddingModel()
  if (!location) return false
  try {
    await access(location.file)
    return true
  } catch {
    return false
  }
}
