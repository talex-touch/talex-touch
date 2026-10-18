'use strict'

const { spawnSync } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const process = require('node:process')

const workspaceDir = path.resolve(__dirname, '..')
const sourcePath = path.join(workspaceDir, 'native-browser-bridge', 'main.rs')
const outputDir = path.join(workspaceDir, 'build', 'Release')
const metadataPath = path.join(outputDir, '.browser-bridge-build.json')
const args = process.argv.slice(2)
const targetIndex = args.indexOf('--target')
if (
  args.some(
    (arg, index) => arg !== '--universal' && arg !== '--target' && !(targetIndex !== -1 && index === targetIndex + 1),
  )
) {
  throw new Error('Usage: build-browser-bridge.js [--universal | --target <rust-target>]')
}
if (targetIndex !== -1 && !args[targetIndex + 1])
  throw new Error('--target requires a Rust target')
if (args.includes('--universal') && (process.platform !== 'darwin' || targetIndex !== -1)) {
  throw new Error('--universal requires macOS and cannot be combined with --target')
}
const targets = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
}
const target = targetIndex === -1 ? targets[`${process.platform}-${process.arch}`] : args[targetIndex + 1]
if (!target || !Object.values(targets).includes(target))
  throw new Error('Unsupported browser bridge platform/target')
const outputPath = path.join(outputDir, `tuff-browser-bridge${target.includes('windows') ? '.exe' : ''}`)
const sourceHash = crypto
  .createHash('sha256')
  .update(fs.readFileSync(sourcePath))
  .update(fs.readFileSync(__filename))
  .digest('hex')
let previous
try {
  previous = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
}
catch {}
let existingUniversal = false
if (process.platform === 'darwin' && fs.existsSync(outputPath)) {
  const bytes = fs.readFileSync(outputPath)
  if (bytes.length >= 4)
    existingUniversal = [0xCAFEBABE, 0xBEBAFECA, 0xCAFEBABF, 0xBFBAFECA].includes(bytes.readUInt32BE(0))
}
// A later ordinary build must never replace an already-produced universal release resource
// with a thin host-architecture binary, even when the source has changed.
const universal
  = args.includes('--universal')
    || (process.platform === 'darwin' && targetIndex === -1 && (previous?.universal === true || existingUniversal))
const buildTargets = universal ? ['aarch64-apple-darwin', 'x86_64-apple-darwin'] : [target]
const targetKey = buildTargets.join(',')
if (previous?.sourceHash === sourceHash && previous?.targetKey === targetKey && fs.existsSync(outputPath)) {
  const artifactHash = crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex')
  if (artifactHash === previous.artifactHash) {
    process.stdout.write(`${outputPath}\n`)
    process.exit(0)
  }
}

function run(binary, commandArgs) {
  const result = spawnSync(binary, commandArgs, { cwd: workspaceDir, stdio: 'inherit', env: process.env })
  if (result.error) {
    throw new Error(
      `Unable to run ${binary}: ${result.error.message}. Install/provision the toolchain explicitly; this script never downloads targets.`,
    )
  }
  if (result.status !== 0) {
    throw new Error(
      `${binary} failed (${result.status ?? result.signal}). Required Rust targets: ${buildTargets.join(', ')}. Provision them before building; no targets are downloaded automatically.`,
    )
  }
}

fs.mkdirSync(outputDir, { recursive: true })
const stem = path.join(outputDir, `.browser-bridge-${process.pid}`)
const temporary = []
try {
  const thinOutputs = buildTargets.map((buildTarget, index) => {
    const thin = `${stem}-${index}${buildTarget.includes('windows') ? '.exe' : ''}`
    temporary.push(thin)
    run(process.env.RUSTC || 'rustc', [
      '--edition=2021',
      '--crate-name',
      'tuff_browser_bridge',
      '--target',
      buildTarget,
      '-C',
      'opt-level=2',
      '-C',
      'panic=abort',
      '-C',
      'strip=symbols',
      '-C',
      'codegen-units=1',
      sourcePath,
      '-o',
      thin,
    ])
    return thin
  })
  let staged = thinOutputs[0]
  if (universal) {
    staged = `${stem}-universal`
    temporary.push(staged)
    run('lipo', ['-create', ...thinOutputs, '-output', staged])
  }
  if (process.platform === 'darwin' && target.includes('apple-darwin'))
    run('codesign', ['--force', '--sign', '-', staged])
  fs.chmodSync(staged, 0o755)
  const artifactHash = crypto.createHash('sha256').update(fs.readFileSync(staged)).digest('hex')
  fs.renameSync(staged, outputPath)
  const metadataStage = `${stem}-metadata.json`
  temporary.push(metadataStage)
  fs.writeFileSync(metadataStage, JSON.stringify({ sourceHash, targetKey, universal, artifactHash }))
  fs.renameSync(metadataStage, metadataPath)
  process.stdout.write(`${outputPath}\n`)
}
finally {
  for (const file of temporary) fs.rmSync(file, { force: true })
}
