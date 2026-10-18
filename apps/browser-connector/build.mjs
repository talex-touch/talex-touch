import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { extensionManifest } from './manifest.mjs'

const directory = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(directory, '../..')
const canonicalOutput = path.join(root, 'apps/core-app/resources/browser-connector')
let inFlight

/** Bundle using the existing CoreApp/root esbuild installation; never installs dependencies. */
export async function buildBrowserConnector({ outdir = canonicalOutput } = {}) {
  if (inFlight)
    return inFlight
  inFlight = build(outdir).finally(() => {
    inFlight = undefined
  })
  return inFlight
}

async function build(outdir) {
  const digest = createHash('sha256').update(Buffer.from(extensionManifest.key, 'base64')).digest('hex').slice(0, 32)
  const extensionId = digest.replace(/[0-9a-f]/g, digit => String.fromCharCode(97 + Number.parseInt(digit, 16)))
  if (extensionId !== 'dalmacfpdfmbedbaamfinhaikanpafcl') {
    throw new Error(
      'Chrome connector manifest identity changed; update the approved shared protocol identity deliberately',
    )
  }
  let esbuild
  for (const packagePath of ['apps/core-app/package.json', 'package.json']) {
    try {
      esbuild = createRequire(path.join(root, packagePath))('esbuild')
      break
    }
    catch {}
  }
  if (!esbuild) {
    throw new Error(
      'Chrome connector needs the existing CoreApp/root esbuild dependency; no dependencies are downloaded by this build',
    )
  }
  await mkdir(path.dirname(outdir), { recursive: true })
  const staged = await mkdtemp(path.join(path.dirname(outdir), '.browser-connector-build-'))
  const backup = `${staged}-previous`
  let backedUp = false
  let installed = false
  try {
    await esbuild.build({
      absWorkingDir: directory,
      entryPoints: { 'service-worker': 'src/service-worker.ts', 'popup': 'src/popup.ts' },
      outdir: staged,
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'chrome124',
      charset: 'utf8',
      legalComments: 'none',
      sourcemap: false,
      logLevel: 'warning',
    })
    await cp(path.join(directory, 'public'), staged, { recursive: true })
    await writeFile(path.join(staged, 'manifest.json'), `${JSON.stringify(extensionManifest, null, 2)}\n`)
    try {
      await rename(outdir, backup)
      backedUp = true
    }
    catch (error) {
      if (error.code !== 'ENOENT')
        throw error
    }
    try {
      await rename(staged, outdir)
      installed = true
    }
    catch (error) {
      if (backedUp) {
        await rename(backup, outdir)
        backedUp = false
      }
      throw error
    }
    if (backedUp) {
      await rm(backup, { recursive: true, force: true })
      backedUp = false
    }
    return { outdir, extensionId }
  }
  finally {
    if (!installed)
      await rm(staged, { recursive: true, force: true })
    if (installed && backedUp)
      await rm(backup, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void buildBrowserConnector().then((result) => {
    process.stdout.write(`${result.outdir}\n`)
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
