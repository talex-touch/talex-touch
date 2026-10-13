import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os, { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import process from 'node:process'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { localEmbeddingInstallManifestPath } from './local-embedding-assets'
import * as models from './local-embedding-model'
import {
  getLocalEmbeddingRuntime,
  setLocalEmbeddingRuntimeForTests
} from './local-embedding-runtime'

let directory: string | undefined

async function sparseWeight(file: string, bytes: number): Promise<void> {
  const handle = await open(file, 'w')
  try {
    await handle.truncate(bytes)
  } finally {
    await handle.close()
  }
}

/** A real JSON-lines subprocess replaces only the slow neural-model boundary. */
async function makeRuntime(media: boolean) {
  directory = await mkdtemp(join(tmpdir(), 'embedding-image-runtime-'))
  vi.spyOn(os, 'homedir').mockReturnValue(directory)
  for (const variable of ['XDG_DATA_HOME', 'LOCALAPPDATA', 'HF_HOME', 'HF_HUB_CACHE']) {
    vi.stubEnv(variable, directory)
  }
  vi.stubEnv('TUFF_DIGUP_HELPER', '')
  vi.stubEnv('DIGUP_MODELS', '')
  const imagePath = join(directory, 'IMG_2048.png')
  await sharp({ create: { width: 2, height: 2, channels: 3, background: '#996633' } })
    .png()
    .toFile(imagePath)
  const details = await stat(imagePath)
  const input = { path: imagePath, mtime: details.mtimeMs, size: details.size }
  await sparseWeight(
    join(directory, models.LOCAL_EMBEDDING_MODEL.file),
    models.LOCAL_EMBEDDING_MODEL.bytes
  )
  if (media) {
    await sparseWeight(
      join(directory, models.LOCAL_EMBEDDING_MEDIA_MODEL.file),
      models.LOCAL_EMBEDDING_MEDIA_MODEL.bytes
    )
  }
  // Verifying hundreds of MB of pinned weights belongs to the real-model acceptance run.
  vi.spyOn(models, 'verifyLocalEmbeddingModel').mockResolvedValue(undefined)
  vi.spyOn(models, 'verifyLocalEmbeddingMediaModel').mockResolvedValue(undefined)
  const script = `#!${process.execPath}
const fs = require('node:fs')
const readline = require('node:readline')
const launchRecord = process.env.TEST_HELPER_LAUNCH_RECORD
if (launchRecord) fs.writeFileSync(launchRecord, process.argv[1])
const textOnly = process.argv.includes('--text-only')
const info = ${JSON.stringify({
    model: 'google/embeddinggemma-2',
    revision: models.LOCAL_EMBEDDING_MODEL.revision,
    runtime: models.LOCAL_EMBEDDING_MODEL.runtime,
    dtype: models.LOCAL_EMBEDDING_MODEL.dtype,
    dim: models.LOCAL_EMBEDDING_MODEL.dimension
  })}
info.text_only = process.env.TEST_HELPER_WRONG_MODE === '1' ? !textOnly : textOnly
const send = value => process.stdout.write(JSON.stringify(value) + '\\n')
send({ ready: true, info })
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line)
  try {
    const values = new Float32Array(info.dim)
    if (request.op === 'image') {
      if (textOnly) throw new Error('IMAGE_SENT_TO_TEXT_ONLY_HELPER')
      if (request.inputs[0] === process.env.TEST_ORIGINAL_IMAGE) throw new Error('UNSAFE_ORIGINAL_PATH_EXPOSED')
      const bytes = fs.readFileSync(request.inputs[0])
      if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('NOT_A_REAL_PNG')
      values[1] = 1
      if (process.env.TEST_REPLACE_IMAGE === '1') fs.writeFileSync(process.env.TEST_ORIGINAL_IMAGE, 'replaced during inference')
    } else if (request.op === 'text') {
      values[0] = 1
    } else {
      throw new Error('UNSUPPORTED_MODEL_OPERATION')
    }
    send({ id: request.id, ok: true, dim: info.dim, count: 1, vectors: Buffer.from(values.buffer).toString('base64') })
  } catch (error) {
    send({ id: request.id, ok: false, error: error.message })
  }
})
`
  const helper = join(directory, 'model-helper.cjs')
  await writeFile(helper, script, { mode: 0o700 })
  const launchRecord = join(directory, 'helper-launched.txt')
  vi.stubEnv('TEST_HELPER_LAUNCH_RECORD', launchRecord)
  vi.stubEnv('TUFF_LOCAL_EMBEDDING_HELPER', helper)
  vi.stubEnv(
    'TUFF_LOCAL_EMBEDDING_HELPER_SHA256',
    createHash('sha256').update(script).digest('hex')
  )
  vi.stubEnv('TUFF_LOCAL_EMBEDDING_MODEL_DIR', directory)
  vi.stubEnv('TEST_ORIGINAL_IMAGE', imagePath)
  vi.stubEnv('TEST_REPLACE_IMAGE', '')
  vi.stubEnv('TEST_HELPER_WRONG_MODE', '')
  setLocalEmbeddingRuntimeForTests(null)
  return { runtime: getLocalEmbeddingRuntime(), input, helper, script, launchRecord }
}

async function installRuntime(media: boolean) {
  const fixture = await makeRuntime(media)
  const manifest = {
    version: 1,
    platform: process.platform,
    arch: process.arch,
    helper: fixture.helper,
    helperSha256: createHash('sha256').update(fixture.script).digest('hex'),
    modelDirectory: directory!
  }
  vi.stubEnv('TUFF_LOCAL_EMBEDDING_HELPER', '')
  vi.stubEnv('TUFF_LOCAL_EMBEDDING_HELPER_SHA256', '')
  vi.stubEnv('TUFF_LOCAL_EMBEDDING_MODEL_DIR', '')
  const manifestPath = localEmbeddingInstallManifestPath()
  if (!manifestPath.startsWith(`${directory!}${sep}`)) {
    throw new Error('Install manifest fixture escaped its isolated temporary home')
  }
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, JSON.stringify(manifest))
  return { ...fixture, manifest, manifestPath }
}

afterEach(async () => {
  setLocalEmbeddingRuntimeForTests(null)
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('LocalEmbeddingRuntime image filesystem and vector-space boundaries', () => {
  it('keeps text generation usable when the image encoder is missing', async () => {
    const { runtime, input } = await makeRuntime(false)
    expect(runtime.isReady()).toBe(true)
    expect(runtime.isImageReady()).toBe(false)
    const before = await runtime.generate('猫')
    await expect(runtime.generateImage(input)).rejects.toThrow(/media|image|model.*unavailable/i)
    const text = await runtime.generate('猫')
    expect(text.vector).toEqual([
      1,
      ...Array<number>(models.LOCAL_EMBEDDING_MODEL.dimension - 1).fill(0)
    ])
    expect(text.modelKey).toBe(models.LOCAL_EMBEDDING_MODEL_KEY)
    expect(text.vector).toEqual(before.vector)
  })

  it('upgrades a text helper to full mode and returns image and text in the same vector space', async () => {
    const { runtime, input } = await makeRuntime(true)
    const before = await runtime.generate('猫')
    const image = await runtime.generateImage(input)
    const after = await runtime.generate('宠物')
    expect(before.vector).toEqual([
      1,
      ...Array<number>(models.LOCAL_EMBEDDING_MODEL.dimension - 1).fill(0)
    ])
    expect(image.vector).toEqual([
      0,
      1,
      ...Array<number>(models.LOCAL_EMBEDDING_MODEL.dimension - 2).fill(0)
    ])
    expect(after.vector).toEqual(before.vector)
    expect(image.modelKey).toBe(before.modelKey)
    expect(after.modelKey).toBe(before.modelKey)
  })

  it('rejects a symlink rather than reading a different file through an admitted image path', async () => {
    const { runtime, input } = await makeRuntime(true)
    const link = join(directory!, 'link.png')
    await symlink(input.path, link)
    await expect(runtime.generateImage({ ...input, path: link })).rejects.toMatchObject({
      code: 'ELOOP'
    })
    expect((await runtime.generate('猫')).vector[0]).toBe(1)
  })

  it.each([
    { name: 'mtime', field: 'mtime' as const },
    { name: 'size', field: 'size' as const }
  ])('rejects an image scheduled with a stale $name before decoding it', async ({ field }) => {
    const { runtime, input } = await makeRuntime(true)
    await expect(runtime.generateImage({ ...input, [field]: input[field] + 1 })).rejects.toThrow(
      'Local EmbeddingGemma image identity changed'
    )
  })

  it('rejects a vector when the source image is replaced during inference', async () => {
    const { runtime, input } = await makeRuntime(true)
    vi.stubEnv('TEST_REPLACE_IMAGE', '1')
    await expect(runtime.generateImage(input)).rejects.toThrow(/changed|identity|version/i)
    expect(await stat(input.path).then((value) => value.size)).toBe(
      Buffer.byteLength('replaced during inference')
    )
  })

  it('rejects a helper claiming the wrong text-only mode before accepting its vectors', async () => {
    const { runtime } = await makeRuntime(true)
    vi.stubEnv('TEST_HELPER_WRONG_MODE', '1')
    await expect(runtime.generate('猫')).rejects.toThrow(/identity|mode|space/i)
  })

  it('cancels image model loading without making subsequent text generation unusable', async () => {
    const { runtime, input } = await makeRuntime(true)
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    vi.mocked(models.verifyLocalEmbeddingMediaModel).mockImplementation(async () => {
      entered.resolve()
      await release.promise
    })
    const controller = new AbortController()
    const operation = runtime.generateImage(input, controller.signal)
    const cancelled = expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    try {
      await entered.promise
      controller.abort()
      release.resolve()
      await cancelled
      expect((await runtime.generate('猫')).vector).toEqual([
        1,
        ...Array<number>(models.LOCAL_EMBEDDING_MODEL.dimension - 1).fill(0)
      ])
    } finally {
      controller.abort()
      release.resolve()
      await operation.catch(() => undefined)
    }
  })
})

describe('LocalEmbeddingRuntime installed asset discovery', () => {
  it('uses an installed helper without embedding env and preserves caller-owned assets on close', async () => {
    const { runtime, input, helper, script, manifestPath, launchRecord } =
      await installRuntime(true)
    const originalImage = await readFile(input.path)
    const originalManifest = await readFile(manifestPath)
    expect(runtime.isReady()).toBe(true)
    expect(runtime.isImageReady()).toBe(true)
    const text = await runtime.generate('猫')
    const image = await runtime.generateImage(input)
    expect(text.vector).toEqual([
      1,
      ...Array<number>(models.LOCAL_EMBEDDING_MODEL.dimension - 1).fill(0)
    ])
    expect(image.vector).toEqual([
      0,
      1,
      ...Array<number>(models.LOCAL_EMBEDDING_MODEL.dimension - 2).fill(0)
    ])
    expect(text.modelKey).toBe(models.LOCAL_EMBEDDING_MODEL_KEY)
    expect(image.modelKey).toBe(text.modelKey)
    expect(await readFile(launchRecord, 'utf8')).toBe(helper)
    runtime.close()
    expect(await readFile(helper, 'utf8')).toBe(script)
    expect(await readFile(input.path)).toEqual(originalImage)
    expect(await readFile(manifestPath)).toEqual(originalManifest)
    expect((await stat(join(directory!, models.LOCAL_EMBEDDING_MODEL.file))).size).toBe(
      models.LOCAL_EMBEDDING_MODEL.bytes
    )
    expect((await stat(join(directory!, models.LOCAL_EMBEDDING_MEDIA_MODEL.file))).size).toBe(
      models.LOCAL_EMBEDDING_MEDIA_MODEL.bytes
    )
  })

  it.each([
    { name: 'missing manifest', patch: null },
    { name: 'malformed JSON', patch: '{' },
    { name: 'unsupported version', patch: { version: 2 } },
    { name: 'foreign platform', patch: { platform: 'foreign-platform' } },
    { name: 'foreign architecture', patch: { arch: 'foreign-architecture' } },
    { name: 'relative helper', patch: { helper: 'model-helper.cjs' } },
    { name: 'relative model directory', patch: { modelDirectory: 'models' } },
    { name: 'invalid helper hash', patch: { helperSha256: 'not-a-sha256' } }
  ])('refuses readiness and generation for $name', async ({ patch }) => {
    const { runtime, manifest, manifestPath, launchRecord } = await installRuntime(true)
    if (patch === null) {
      await rm(manifestPath)
    } else {
      await writeFile(
        manifestPath,
        typeof patch === 'string' ? patch : JSON.stringify({ ...manifest, ...patch })
      )
    }
    expect(runtime.isReady()).toBe(false)
    expect(runtime.isImageReady()).toBe(false)
    await expect(runtime.generate('猫')).rejects.toBeInstanceOf(Error)
    await expect(stat(launchRecord)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    { name: 'missing explicit helper', missingHelper: true, hash: 'valid' },
    { name: 'explicit helper without its own hash', missingHelper: false, hash: '' },
    { name: 'explicit helper with an invalid hash', missingHelper: false, hash: 'invalid' }
  ])(
    'never rescues $name with an installed helper or its hash',
    async ({ missingHelper, hash }) => {
      const { runtime, helper, manifest, launchRecord } = await installRuntime(true)
      vi.stubEnv(
        'TUFF_LOCAL_EMBEDDING_HELPER',
        missingHelper ? join(directory!, 'missing-helper') : helper
      )
      vi.stubEnv(
        'TUFF_LOCAL_EMBEDDING_HELPER_SHA256',
        hash === 'valid' ? manifest.helperSha256 : hash
      )
      expect(runtime.isReady()).toBe(false)
      expect(runtime.isImageReady()).toBe(false)
      await expect(runtime.generate('猫')).rejects.toBeInstanceOf(Error)
      await expect(stat(launchRecord)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  )

  it.each(['env', 'manifest'] as const)('refuses a wrong %s checksum', async (source) => {
    const { runtime, helper, manifest, manifestPath, launchRecord } = await installRuntime(false)
    vi.stubEnv('TUFF_LOCAL_EMBEDDING_MODEL_DIR', manifest.modelDirectory)
    const wrongHash = '0'.repeat(64)
    if (source === 'env') {
      vi.stubEnv('TUFF_LOCAL_EMBEDDING_HELPER', helper)
      vi.stubEnv('TUFF_LOCAL_EMBEDDING_HELPER_SHA256', wrongHash)
    } else {
      await writeFile(manifestPath, JSON.stringify({ ...manifest, helperSha256: wrongHash }))
    }
    await expect(runtime.generate('猫')).rejects.toBeInstanceOf(Error)
    await expect(stat(launchRecord)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses an explicit model directory instead of unavailable installed model files', async () => {
    const { runtime, input } = await installRuntime(true)
    const override = join(directory!, 'override-models')
    await mkdir(override)
    for (const model of [models.LOCAL_EMBEDDING_MODEL, models.LOCAL_EMBEDDING_MEDIA_MODEL]) {
      await sparseWeight(join(override, model.file), model.bytes)
      await rm(join(directory!, model.file))
    }
    vi.stubEnv('TUFF_LOCAL_EMBEDDING_MODEL_DIR', override)
    expect(runtime.isReady()).toBe(true)
    expect(runtime.isImageReady()).toBe(true)
    expect((await runtime.generateImage(input)).vector).toEqual([
      0,
      1,
      ...Array<number>(models.LOCAL_EMBEDDING_MODEL.dimension - 2).fill(0)
    ])
  })
})
