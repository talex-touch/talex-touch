import fs from 'fs'
import path from 'path'
import { LogItem } from './types'
import { ITouchPlugin } from '..'
import { structuredStrictStringify } from '@talex-touch/utils'

/**
 * PluginLoggerManager is responsible for managing and writing logs for a specific plugin.
 */
export class PluginLoggerManager {
  private readonly pluginInfo: ITouchPlugin
  private readonly pluginLogDir: string
  private readonly sessionLogPath: string
  private readonly pluginInfoPath: string
  private buffer: LogItem[] = []
  private flushInterval: NodeJS.Timeout
  private onLogAppend?: (log: LogItem) => void

  /**
   * Initializes a new PluginLoggerManager instance.
   * @param baseDir - Base directory to store logs.
   * @param pluginInfo - Plugin information for logging context.
   * @param onLogAppend - Optional callback to be invoked when a log is appended.
   */
  constructor(baseDir: string, pluginInfo: ITouchPlugin, onLogAppend?: (log: LogItem) => void) {
    this.pluginInfo = pluginInfo
    this.onLogAppend = onLogAppend
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const sessionFolder = `${timestamp}_${pluginInfo.name.replace(/[^a-zA-Z0-9-_]/g, '_')}`

    this.pluginLogDir = path.resolve(baseDir, 'logs', sessionFolder)
    this.sessionLogPath = path.resolve(this.pluginLogDir, 'session.log')
    this.pluginInfoPath = path.resolve(this.pluginLogDir, 'touch-plugin.info')

    this.ensureDirectory()
    this.createPluginInfoFile()
    this.flushInterval = setInterval(() => this.flush(), 5000)
  }

  /**
   * Appends a new log item to the buffer.
   * @param log - The log entry to append.
   */
  append(log: LogItem): void {
    this.buffer.push(log)
    this.onLogAppend?.(log)
  }

  /**
   * Flushes all buffered log items to the current session log file.
   */
  flush(): void {
    if (this.buffer.length === 0) return
    const lines = this.buffer.map((item) => structuredStrictStringify(item)).join('\n') + '\n'
    fs.appendFileSync(this.sessionLogPath, lines)
    this.buffer = []
  }

  /**
   * Returns the path to the current session log file.
   * @returns The path to the session log.
   */
  public getSessionLogPath(): string {
    return this.sessionLogPath
  }

  /**
   * Returns the current log buffer.
   * @returns An array of log items.
   */
  public getBuffer(): LogItem[] {
    return this.buffer
  }

  /**
   * Stops the flush interval and ensures remaining logs are written.
   */
  destroy(): void {
    clearInterval(this.flushInterval)
    this.flush()
  }

  /**
   * Creates the touch-plugin.info file with plugin information.
   */
  private createPluginInfoFile(): void {
    const pluginInfo = {
      name: this.pluginInfo.name,
      version: this.pluginInfo.version,
      description: this.pluginInfo.desc,
      sessionStart: new Date().toISOString(),
      icon: this.pluginInfo.icon,
      platforms: this.pluginInfo.platforms,
      status: this.pluginInfo.status,
      features: this.pluginInfo.features.map(feature => ({
        id: feature.id,
        name: feature.name,
        desc: feature.desc
      }))
    }

    fs.writeFileSync(this.pluginInfoPath, JSON.stringify(pluginInfo, null, 2))
  }

  /**
   * Ensures the log directory exists.
   */
  private ensureDirectory(): void {
    if (!fs.existsSync(this.pluginLogDir)) {
      fs.mkdirSync(this.pluginLogDir, { recursive: true })
    }
  }
}
