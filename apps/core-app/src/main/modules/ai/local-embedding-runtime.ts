import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createReadStream, existsSync, statSync } from 'node:fs'
import {
  embeddingModelDirectories,
  locateLocalEmbeddingModel,
  LOCAL_EMBEDDING_MODEL,
  LOCAL_EMBEDDING_MODEL_KEY,
  verifyLocalEmbeddingModel
} from './local-embedding-model'

export interface LocalEmbeddingGeneration {
  readonly vector: number[]
  readonly modelKey: string
}

export interface LocalEmbeddingRuntime {
  /** Synchronous readiness probe: no process launch, model loading, hashing, or download. */
  isReady(): boolean
  generate(text: string, signal?: AbortSignal): Promise<LocalEmbeddingGeneration>
  close(): void
}

interface WorkerInfo {
  readonly model?: string
  readonly revision?: string
  readonly runtime?: string
  readonly dtype?: string
  readonly dim?: number
}

interface WorkerResponse {
  readonly id?: number
  readonly ready?: boolean
  readonly ok?: boolean
  readonly error?: string
  readonly info?: WorkerInfo
  readonly dim?: number
  readonly count?: number
  readonly vectors?: string
}

interface PendingRequest {
  readonly resolve: (value: LocalEmbeddingGeneration) => void
  readonly reject: (error: unknown) => void
  readonly cleanup: () => void
  readonly timer: NodeJS.Timeout
}

const MAX_INPUT_CHARS = 32_000
const START_TIMEOUT_MS = 20_000
const REQUEST_TIMEOUT_MS = 120_000

function configuredHelperPath(): string | undefined {
  const configured = process.env.TUFF_LOCAL_EMBEDDING_HELPER || process.env.TUFF_DIGUP_HELPER
  if (!configured) return undefined
  try {
    const details = statSync(configured)
    return details.isFile() && (details.mode & 0o111) !== 0 ? configured : undefined
  } catch {
    return undefined
  }
}

function abortError(): Error {
  const error = new Error('Local EmbeddingGemma generation cancelled')
  error.name = 'AbortError'
  return error
}

function readOptionalNumber(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key]
  if (field === undefined) return undefined
  if (typeof field !== 'number' || !Number.isFinite(field))
    throw new Error(`EmbeddingGemma worker field ${key} is invalid`)
  return field
}

function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key]
  if (field === undefined) return undefined
  if (typeof field !== 'string') throw new Error(`EmbeddingGemma worker field ${key} is invalid`)
  return field
}
async function verifyHelperBinary(helper: string): Promise<void> {
  const expected = process.env.TUFF_LOCAL_EMBEDDING_HELPER_SHA256
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) {
    throw new Error(
      'Local EmbeddingGemma helper hash is required in TUFF_LOCAL_EMBEDDING_HELPER_SHA256'
    )
  }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(helper, { highWaterMark: 8 << 20 })) hash.update(chunk)
  if (hash.digest('hex') !== expected.toLowerCase())
    throw new Error('Local EmbeddingGemma helper checksum mismatch')
}

function parseWorkerResponse(line: string): WorkerResponse {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    throw new Error('EmbeddingGemma helper emitted invalid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('EmbeddingGemma helper emitted a non-object response')
  }
  const record = parsed as Record<string, unknown>
  const ready = record.ready
  if (ready !== undefined && typeof ready !== 'boolean')
    throw new Error('EmbeddingGemma worker ready field is invalid')
  const ok = record.ok
  if (ok !== undefined && typeof ok !== 'boolean')
    throw new Error('EmbeddingGemma worker ok field is invalid')
  const infoValue = record.info
  let info: WorkerInfo | undefined
  if (infoValue !== undefined) {
    if (infoValue === null || typeof infoValue !== 'object' || Array.isArray(infoValue)) {
      throw new Error('EmbeddingGemma worker info field is invalid')
    }
    const infoRecord = infoValue as Record<string, unknown>
    info = {
      model: readOptionalString(infoRecord, 'model'),
      revision: readOptionalString(infoRecord, 'revision'),
      runtime: readOptionalString(infoRecord, 'runtime'),
      dtype: readOptionalString(infoRecord, 'dtype'),
      dim: readOptionalNumber(infoRecord, 'dim')
    }
  }
  return {
    id: readOptionalNumber(record, 'id'),
    ready,
    ok,
    error: readOptionalString(record, 'error'),
    info,
    dim: readOptionalNumber(record, 'dim'),
    count: readOptionalNumber(record, 'count'),
    vectors: readOptionalString(record, 'vectors')
  }
}

function readFloat32Vector(encoded: string, dimension: number): number[] {
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('EmbeddingGemma helper returned invalid base64')
  }
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.byteLength !== dimension * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(`EmbeddingGemma vector dimension mismatch: expected ${dimension}`)
  }
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, dimension)
  const vector = Array.from(values)
  let norm = 0
  for (const value of vector) {
    if (!Number.isFinite(value)) throw new Error('EmbeddingGemma returned a non-finite vector')
    norm += value * value
  }
  if (!(norm > 0)) throw new Error('EmbeddingGemma returned an empty vector')
  return vector
}

class DigUpEmbeddingRuntime implements LocalEmbeddingRuntime {
  private child: ChildProcessWithoutNullStreams | null = null
  private ready = false
  private starting: Promise<void> | null = null
  private nextId = 1
  private busy = false
  private stdout = ''
  private pending = new Map<number, PendingRequest>()
  private startResolve: (() => void) | null = null
  private startReject: ((error: unknown) => void) | null = null
  private startTimer: NodeJS.Timeout | undefined
  private shutdownTimer: NodeJS.Timeout | undefined
  private closed = false

  isReady(): boolean {
    if (this.closed) return false
    const helper = configuredHelperPath()
    if (!helper || !existsSync(helper)) return false
    const helperHash = process.env.TUFF_LOCAL_EMBEDDING_HELPER_SHA256
    if (!helperHash || !/^[a-f0-9]{64}$/i.test(helperHash)) return false
    for (const directory of embeddingModelDirectories()) {
      try {
        const model = statSync(`${directory}/${LOCAL_EMBEDDING_MODEL.file}`)
        if (model.isFile() && model.size === LOCAL_EMBEDDING_MODEL.bytes) return true
      } catch {
        // A missing model is an unavailable local capability, not a download trigger.
      }
    }
    return false
  }

  async generate(text: string, signal?: AbortSignal): Promise<LocalEmbeddingGeneration> {
    if (this.closed) throw new Error('Local EmbeddingGemma runtime is closed')
    if (signal?.aborted) throw abortError()
    if (text.length > MAX_INPUT_CHARS) {
      throw new Error(`Local EmbeddingGemma input exceeds ${MAX_INPUT_CHARS} characters`)
    }
    if (this.busy) throw new Error('Local EmbeddingGemma runtime is busy')
    this.busy = true
    try {
      await this.ensureStarted(signal)
      if (!this.child || !this.ready) throw new Error('Local EmbeddingGemma runtime is not ready')
      return await this.request(text, signal)
    } finally {
      this.busy = false
    }
  }

  close(): void {
    this.closed = true
    this.terminate(new Error('Local EmbeddingGemma runtime closed'))
  }

  private async ensureStarted(signal?: AbortSignal): Promise<void> {
    if (this.child && this.ready) return
    if (!this.starting) this.starting = this.start(signal)
    try {
      await this.awaitWithAbort(this.starting, signal)
    } finally {
      this.starting = null
    }
  }

  private async start(signal?: AbortSignal): Promise<void> {
    const helper = configuredHelperPath()
    if (!helper)
      throw new Error('Local EmbeddingGemma helper is unavailable; set TUFF_LOCAL_EMBEDDING_HELPER')
    await verifyHelperBinary(helper)
    const model = await locateLocalEmbeddingModel()
    if (!model)
      throw new Error(
        `EmbeddingGemma 2 model is unavailable at pinned revision ${LOCAL_EMBEDDING_MODEL.revision}`
      )
    if (this.closed) throw new Error('Local EmbeddingGemma runtime is closed')
    await verifyLocalEmbeddingModel(model)
    if (signal?.aborted) throw abortError()

    const readiness = new Promise<void>((resolve, reject) => {
      this.startResolve = resolve
      this.startReject = reject
      this.startTimer = setTimeout(
        () => this.terminate(new Error('EmbeddingGemma helper readiness timed out')),
        START_TIMEOUT_MS
      )
    })
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(helper, ['worker', '--text-only'], {
        env: { ...process.env, DIGUP_MODELS: model.directory },
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      this.rejectStart(error)
      throw error
    }
    this.child = child
    this.ready = false
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consumeOutput(chunk))
    child.stderr.resume()
    child.once('error', (error) => this.terminate(error))
    child.once('exit', (code, signalName) => {
      clearTimeout(this.shutdownTimer)
      this.shutdownTimer = undefined
      if (!this.ready)
        this.rejectStart(
          new Error(
            `EmbeddingGemma helper exited before ready (${code ?? signalName ?? 'unknown'})`
          )
        )
      if (this.child === child)
        this.terminate(
          new Error(`EmbeddingGemma helper exited (${code ?? signalName ?? 'unknown'})`)
        )
    })
    return await readiness
  }

  private consumeOutput(chunk: string): void {
    this.stdout += chunk
    if (this.stdout.length > 4 * 1024 * 1024) {
      this.terminate(new Error('EmbeddingGemma helper response exceeded the size limit'))
      return
    }
    const lines = this.stdout.split('\n')
    this.stdout = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      let response: WorkerResponse
      try {
        response = parseWorkerResponse(line)
      } catch (error) {
        this.terminate(error)
        return
      }
      if (response.ready !== undefined) {
        if (!response.ready) {
          this.terminate(new Error(response.error || 'EmbeddingGemma helper failed to load'))
          return
        }
        const info = response.info
        if (
          info?.model !== 'google/embeddinggemma-2' ||
          info.revision !== LOCAL_EMBEDDING_MODEL.revision ||
          info.dim !== LOCAL_EMBEDDING_MODEL.dimension ||
          info.runtime !== LOCAL_EMBEDDING_MODEL.runtime ||
          info.dtype !== LOCAL_EMBEDDING_MODEL.dtype
        ) {
          this.terminate(
            new Error('EmbeddingGemma helper model identity does not match the pinned vector space')
          )
          return
        }
        this.ready = true
        clearTimeout(this.startTimer)
        this.startTimer = undefined
        const resolve = this.startResolve
        this.startResolve = null
        this.startReject = null
        resolve?.()
        continue
      }
      if (typeof response.id !== 'number') continue
      const pending = this.pending.get(response.id)
      if (!pending) continue
      this.pending.delete(response.id)
      clearTimeout(pending.timer)
      pending.cleanup()
      if (!response.ok) {
        pending.reject(new Error(response.error || 'EmbeddingGemma helper request failed'))
        continue
      }
      try {
        if (
          response.dim !== LOCAL_EMBEDDING_MODEL.dimension ||
          response.count !== 1 ||
          !response.vectors
        ) {
          throw new Error('EmbeddingGemma helper returned an invalid vector payload')
        }
        pending.resolve({
          vector: readFloat32Vector(response.vectors, LOCAL_EMBEDDING_MODEL.dimension),
          modelKey: LOCAL_EMBEDDING_MODEL_KEY
        })
      } catch (error) {
        pending.reject(error)
      }
    }
  }

  private request(text: string, signal?: AbortSignal): Promise<LocalEmbeddingGeneration> {
    const child = this.child
    if (!child) return Promise.reject(new Error('Local EmbeddingGemma helper is unavailable'))
    const id = this.nextId++
    return new Promise<LocalEmbeddingGeneration>((resolve, reject) => {
      let onAbort: () => void = () => undefined
      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort)
      }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        cleanup()
        this.terminate(new Error('Local EmbeddingGemma request timed out'))
        reject(new Error('Local EmbeddingGemma request timed out'))
      }, REQUEST_TIMEOUT_MS)
      onAbort = () => {
        this.pending.delete(id)
        clearTimeout(timer)
        cleanup()
        this.terminate(abortError())
        reject(abortError())
      }
      this.pending.set(id, { resolve, reject, cleanup, timer })
      signal?.addEventListener('abort', onAbort, { once: true })
      child.stdin.write(`${JSON.stringify({ id, op: 'text', inputs: [text] })}\n`, (error) => {
        if (!error) return
        this.pending.delete(id)
        clearTimeout(timer)
        cleanup()
        reject(error)
      })
    })
  }

  private awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort)
        this.terminate(abortError())
        reject(abortError())
      }
      signal.addEventListener('abort', onAbort, { once: true })
      promise.then(
        (value) => {
          signal.removeEventListener('abort', onAbort)
          resolve(value)
        },
        (error) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        }
      )
    })
  }

  private rejectStart(error: unknown): void {
    clearTimeout(this.startTimer)
    this.startTimer = undefined
    const reject = this.startReject
    this.startResolve = null
    this.startReject = null
    reject?.(error)
  }

  private terminate(error: unknown): void {
    const child = this.child
    this.child = null
    this.ready = false
    this.stdout = ''
    this.rejectStart(error)
    for (const [id, pending] of this.pending) {
      this.pending.delete(id)
      clearTimeout(pending.timer)
      pending.cleanup()
      pending.reject(error)
    }
    if (!child) return
    child.kill('SIGTERM')
    clearTimeout(this.shutdownTimer)
    this.shutdownTimer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
    }, 1_000)
  }
}

let runtime: LocalEmbeddingRuntime | null = null

export function getLocalEmbeddingRuntime(): LocalEmbeddingRuntime {
  runtime ??= new DigUpEmbeddingRuntime()
  return runtime
}

/** Test/host seam; production callers should use the singleton getter. */
export function setLocalEmbeddingRuntimeForTests(value: LocalEmbeddingRuntime | null): void {
  runtime?.close()
  runtime = value
}
