import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const exec = promisify(execFile)
export const coreAppRoot = fileURLToPath(new URL('../../../', import.meta.url))
export const swapHelperPath = fileURLToPath(
  new URL('../../../../../packages/tuff-native/build/Release/tuff-native-update', import.meta.url)
)

/** Real signed Mach-O bundles: a shell script cannot exercise codesign's sealed executable gate. */
export async function createSignedMacUpdateFixture(root: string) {
  root = await realpath(root)
  const source = path.join(root, 'fixture.c')
  const binary = path.join(root, 'fixture')
  await writeFile(source, 'int main(void) { return 0; }\n')
  await exec('/usr/bin/xcrun', ['clang', source, '-o', binary])
  async function bundle(bundlePath: string, version: string, bundleId = 'com.tuff.ota-fixture') {
    const contents = path.join(bundlePath, 'Contents')
    await mkdir(path.join(contents, 'MacOS'), { recursive: true })
    await mkdir(path.join(contents, 'Resources'), { recursive: true })
    await writeFile(
      path.join(contents, 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleId}</string><key>CFBundleExecutable</key><string>fixture</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>${version}</string></dict></plist>`
    )
    await exec('/bin/cp', [binary, path.join(contents, 'MacOS', 'fixture')])
    await writeFile(path.join(contents, 'Resources', 'payload.txt'), `payload:${version}`)
    await exec('/usr/bin/codesign', ['--force', '--sign', '-', bundlePath])
    return bundlePath
  }
  const appBundlePath = await bundle(path.join(root, 'Tuff.app'), '2.4.9')
  const archiveRoot = path.join(root, 'archive')
  await mkdir(archiveRoot)
  const incomingApp = await bundle(path.join(archiveRoot, 'Tuff.app'), '2.4.10')
  const packagePath = path.join(root, 'Tuff.app.zip')
  async function archive() {
    await exec('/usr/bin/ditto', [
      '-c',
      '-k',
      '--sequesterRsrc',
      '--keepParent',
      incomingApp,
      packagePath
    ])
    return createHash('sha256')
      .update(await readFile(packagePath))
      .digest('hex')
  }
  const packageSha256 = await archive()
  const attemptRoot = path.join(root, 'storage', 'update-recovery', 'attempts', 'attempt-1')
  return {
    appBundlePath,
    incomingApp,
    packagePath,
    packageSha256,
    attemptRoot,
    archive,
    bundle,
    input: {
      attemptId: 'attempt-1',
      attemptRoot,
      appBundlePath,
      packagePath,
      packageSha256,
      targetVersion: '2.4.10',
      resourcesPath: path.join(coreAppRoot, 'resources'),
      appPath: coreAppRoot
    }
  }
}

export async function readMacBundleVersion(bundle: string): Promise<string> {
  const { stdout } = await exec('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleShortVersionString',
    path.join(bundle, 'Contents', 'Info.plist')
  ])
  return stdout.trim()
}
