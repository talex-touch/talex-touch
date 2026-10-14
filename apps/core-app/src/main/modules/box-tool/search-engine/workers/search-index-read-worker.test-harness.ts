import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll } from 'vitest'

let workerPathPromise: Promise<string> | undefined
let ownedDirectory: string | undefined

async function buildCurrentReadWorker(): Promise<string> {
  ownedDirectory = await mkdtemp(join(tmpdir(), 'tuff-search-read-worker-test-'))
  const workerPath = join(ownedDirectory, 'search-index-read-worker.cjs')
  const libsqlPath = createRequire(import.meta.url).resolve('@libsql/client')
  await build({
    absWorkingDir: fileURLToPath(new URL('.', import.meta.url)),
    entryPoints: [fileURLToPath(new URL('./search-index-read-worker.ts', import.meta.url))],
    outfile: workerPath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    plugins: [
      {
        name: 'external-test-libsql',
        setup(builder) {
          builder.onResolve({ filter: /^@libsql\/client$/ }, () => ({
            path: libsqlPath,
            external: true
          }))
        }
      }
    ]
  })
  return workerPath
}

/** One real current-source worker artifact per suite; explicit artifacts remain caller-owned. */
export function getSearchIndexReadWorkerTestPath(): Promise<string> {
  if (!workerPathPromise) {
    const configured = process.env.TUFF_SEARCH_READ_WORKER_TEST_PATH?.trim()
    workerPathPromise = configured ? Promise.resolve(configured) : buildCurrentReadWorker()
  }
  return workerPathPromise
}

afterAll(async () => {
  await workerPathPromise?.catch(() => undefined)
  if (ownedDirectory) await rm(ownedDirectory, { recursive: true, force: true })
  ownedDirectory = undefined
  workerPathPromise = undefined
})
