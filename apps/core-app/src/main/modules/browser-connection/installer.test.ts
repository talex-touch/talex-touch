import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
  rmSync,
  existsSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserBridgeInstaller } from './installer'

const roots: string[] = []

function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'browser-bridge-installer-'))
  roots.push(root)
  const home = path.join(root, 'home')
  const extensionDirectory = path.join(root, 'extension')
  const binaryPath = path.join(root, 'bridge-source')
  mkdirSync(home, { recursive: true })
  mkdirSync(extensionDirectory, { recursive: true })
  writeFileSync(path.join(extensionDirectory, 'manifest.json'), '{}\n')
  writeFileSync(binaryPath, 'bridge-binary\n')
  return { home, extensionDirectory, binaryPath, root }
}

function serverPublicKey(): string {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('browser bridge installer identity descriptor', () => {
  it('requires endpoint and real Main server identity before installation', async () => {
    const fixture = createFixture()
    const installer = new BrowserBridgeInstaller({
      ...fixture,
      root: fixture.root,
      platform: 'linux'
    })
    await expect(installer.install()).rejects.toThrow()
  })

  it('publishes the endpoint and Main server key atomically with restricted permissions', async () => {
    const fixture = createFixture()
    const installer = new BrowserBridgeInstaller({
      ...fixture,
      root: fixture.root,
      platform: 'linux'
    })
    const key = serverPublicKey()
    await installer.setEndpoint('127.0.0.1:4567', key)
    const state = await installer.install()
    expect(state.installed).toBe(true)

    const descriptorDirectory = installer.directory
    expect(readFileSync(path.join(descriptorDirectory, 'endpoint'), 'utf8')).toBe(
      `127.0.0.1:4567\n${key}\n`
    )
    expect(statSync(path.join(descriptorDirectory, 'endpoint')).mode & 0o777).toBe(0o600)
    expect(existsSync(path.join(descriptorDirectory, 'server-key'))).toBe(false)
  })
  it('removes both trusted identity and endpoint on clearEndpoint', async () => {
    const fixture = createFixture()
    const installer = new BrowserBridgeInstaller({
      ...fixture,
      root: fixture.root,
      platform: 'linux'
    })
    await installer.setEndpoint('127.0.0.1:4567', serverPublicKey())
    await installer.install()
    await installer.clearEndpoint()

    expect(existsSync(path.join(installer.directory, 'server-key'))).toBe(false)
    expect(existsSync(path.join(installer.directory, 'endpoint'))).toBe(false)
  })
})
