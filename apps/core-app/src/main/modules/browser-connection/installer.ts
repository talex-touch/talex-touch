import type { BrowserConnectionState } from '@talex-touch/utils/transport/sdk/domains/browser-connection'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  BROWSER_EXTENSION_ID,
  BROWSER_NATIVE_HOST_NAME
} from '@talex-touch/utils/transport/sdk/domains/browser-connection'

export interface BrowserBridgeInstallerOptions {
  home: string
  root: string
  extensionDirectory: string
  binaryPath: string
  platform: NodeJS.Platform
  registry?: (args: string[]) => Promise<string>
}
const execFileAsync = promisify(execFile)

/** User-level Native Messaging registration is changed only by explicit install(). */
export class BrowserBridgeInstaller {
  private endpoint: string | null = null
  private serverPublicKey: string | null = null
  constructor(private readonly options: BrowserBridgeInstallerOptions) {}
  get directory(): string {
    return path.join(this.options.root, 'browser-connector')
  }
  get manifestPath(): string {
    return path.join(this.directory, `${BROWSER_NATIVE_HOST_NAME}.json`)
  }
  private get binary(): string {
    return path.join(
      this.directory,
      `tuff-browser-bridge${this.options.platform === 'win32' ? '.exe' : ''}`
    )
  }
  private get registrations(): string[] {
    if (this.options.platform === 'darwin')
      return [
        path.join(
          this.options.home,
          'Library/Application Support/Google/Chrome/NativeMessagingHosts',
          `${BROWSER_NATIVE_HOST_NAME}.json`
        )
      ]
    if (this.options.platform === 'linux')
      return [
        path.join(
          this.options.home,
          '.config/google-chrome/NativeMessagingHosts',
          `${BROWSER_NATIVE_HOST_NAME}.json`
        ),
        path.join(
          this.options.home,
          '.config/chromium/NativeMessagingHosts',
          `${BROWSER_NATIVE_HOST_NAME}.json`
        )
      ]
    return []
  }
  private async registry(args: string[]): Promise<string> {
    if (this.options.registry) return this.options.registry(args)
    const result = await execFileAsync(
      path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/reg.exe'),
      args,
      { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 }
    )
    return result.stdout
  }
  async getState(): Promise<BrowserConnectionState['installation']> {
    const supported = ['darwin', 'linux', 'win32'].includes(this.options.platform)
    let installed = false
    try {
      const manifest = JSON.parse(await readFile(this.manifestPath, 'utf8'))
      if (
        manifest.name !== BROWSER_NATIVE_HOST_NAME ||
        manifest.path !== this.binary ||
        manifest.allowed_origins?.length !== 1 ||
        manifest.allowed_origins[0] !== `chrome-extension://${BROWSER_EXTENSION_ID}/`
      )
        throw new Error('BROWSER_INSTALLATION_CHANGED')
      await access(this.binary, constants.F_OK)
      if (this.options.platform === 'win32') {
        const result = await this.registry([
          'query',
          `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${BROWSER_NATIVE_HOST_NAME}`,
          '/ve'
        ])
        const registered = result.split(/\r?\n/).some(
          (line) =>
            line
              .match(/\sREG_SZ\s+(.+)$/)?.[1]
              .trim()
              .toLowerCase() === this.manifestPath.toLowerCase()
        )
        if (!registered) throw new Error('BROWSER_INSTALLATION_CHANGED')
      } else
        for (const registration of this.registrations) {
          if (
            (await readFile(registration, 'utf8')) !== (await readFile(this.manifestPath, 'utf8'))
          )
            throw new Error('BROWSER_INSTALLATION_CHANGED')
        }
      installed = supported
    } catch {
      installed = false
    }
    let extensionDirectory: string | null = null
    try {
      await access(path.join(this.options.extensionDirectory, 'manifest.json'))
      extensionDirectory = this.options.extensionDirectory
    } catch {}
    return { installed, supported, extensionId: BROWSER_EXTENSION_ID, extensionDirectory }
  }
  async install(): Promise<BrowserConnectionState['installation']> {
    if (!['darwin', 'linux', 'win32'].includes(this.options.platform))
      throw new Error('BROWSER_PLATFORM_UNSUPPORTED')
    if (!this.endpoint || !this.serverPublicKey) throw new Error('BROWSER_SERVER_IDENTITY_REQUIRED')
    await access(this.options.binaryPath, constants.F_OK)
    await access(path.join(this.options.extensionDirectory, 'manifest.json'), constants.R_OK)
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    const temporary = `${this.binary}.installing`
    try {
      await copyFile(this.options.binaryPath, temporary)
      await chmod(temporary, 0o700)
      await rename(temporary, this.binary)
    } finally {
      await rm(temporary, { force: true })
    }
    const manifest = `${JSON.stringify({ name: BROWSER_NATIVE_HOST_NAME, description: 'Tuff Chrome connector', path: this.binary, type: 'stdio', allowed_origins: [`chrome-extension://${BROWSER_EXTENSION_ID}/`] }, null, 2)}\n`
    await writeFile(this.manifestPath, manifest, { mode: 0o600 })
    await chmod(this.manifestPath, 0o600)
    if (this.endpoint) await this.writeEndpoint(this.endpoint)
    if (this.options.platform === 'win32')
      await this.registry([
        'add',
        `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${BROWSER_NATIVE_HOST_NAME}`,
        '/ve',
        '/t',
        'REG_SZ',
        '/d',
        this.manifestPath,
        '/f'
      ])
    else
      for (const registration of this.registrations) {
        await mkdir(path.dirname(registration), { recursive: true, mode: 0o700 })
        await writeFile(registration, manifest, { mode: 0o600 })
        await chmod(registration, 0o600)
      }
    return this.getState()
  }
  /** Called only for a verified existing installation or during an explicit install. */
  async setEndpoint(endpoint: string, serverPublicKey: string): Promise<void> {
    if (!/^127\.0\.0\.1:\d{1,5}$/.test(endpoint)) throw new Error('BROWSER_ENDPOINT_INVALID')
    const port = Number(endpoint.split(':')[1])
    if (port < 1 || port > 65535) throw new Error('BROWSER_ENDPOINT_INVALID')
    if (!/^[A-Za-z0-9+/]{120,126}={0,2}$/.test(serverPublicKey) || serverPublicKey.length !== 124)
      throw new Error('BROWSER_SERVER_KEY_INVALID')
    this.serverPublicKey = serverPublicKey
    this.endpoint = endpoint
    if ((await this.getState()).installed) await this.writeEndpoint(endpoint, serverPublicKey)
  }
  private async writeEndpoint(
    endpoint: string,
    serverPublicKey = this.serverPublicKey
  ): Promise<void> {
    if (!serverPublicKey) throw new Error('BROWSER_SERVER_IDENTITY_REQUIRED')
    // One rename binds the address and public key to the same server generation.
    const descriptor = `${endpoint}\n${serverPublicKey}\n`
    const temporary = path.join(this.directory, `endpoint.${randomUUID()}.new`)
    try {
      await writeFile(temporary, descriptor, { mode: 0o600, flag: 'wx' })
      await chmod(temporary, 0o600)
      await rename(temporary, path.join(this.directory, 'endpoint'))
    } finally {
      await rm(temporary, { force: true })
    }
  }
  async clearEndpoint(): Promise<void> {
    this.endpoint = null
    this.serverPublicKey = null
    await rm(path.join(this.directory, 'endpoint'), { force: true })
  }
}
