import type { Server, Socket } from 'node:net'
import type { BrowserConnectionManager, BrowserConnectionSession } from './manager'
import { createServer } from 'node:net'
import { BrowserFrameDecoder, encodeBrowserFrame } from './protocol'

export class BrowserConnectionServer {
  private server: Server | null = null
  private sockets = new Set<Socket>()
  private address: string | null = null
  private starting: Promise<string> | null = null
  private disposed = false
  constructor(private readonly manager: BrowserConnectionManager) {}
  start(): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('BROWSER_SERVER_DISPOSED'))
    if (this.address) return Promise.resolve(this.address)
    if (this.starting) return this.starting
    this.starting = new Promise<string>((resolve, reject) => {
      this.manager.claimServerBinding()
      const server = createServer((socket) => {
        if (this.sockets.size >= 16 || socket.remoteAddress !== '127.0.0.1') {
          socket.destroy()
          return
        }
        this.sockets.add(socket)
        socket.setNoDelay(true)
        const decoder = new BrowserFrameDecoder()
        let session: BrowserConnectionSession
        try {
          session = this.manager.openConnection({
            send: (message) => {
              if (socket.destroyed || socket.writableLength > 2 * 768 * 1024)
                throw new Error('BROWSER_CONNECTION_BACKPRESSURE')
              socket.write(encodeBrowserFrame(message))
            },
            close: () => socket.destroy()
          })
        } catch {
          this.sockets.delete(socket)
          socket.destroy()
          return
        }
        socket.on('data', (chunk) => {
          socket.pause()
          void (async () => {
            for (const message of decoder.push(chunk)) await session.receive(message)
            socket.resume()
          })().catch(async () => {
            await session.fail('BROWSER_FRAME_INVALID').catch(() => {})
            socket.destroy()
          })
        })
        socket.on('error', () => socket.destroy())
        socket.on('end', () => {
          try {
            decoder.finish()
          } catch {
            void session.fail('BROWSER_FRAME_TRUNCATED').catch(() => {})
          }
          socket.destroy()
        })
        socket.on('close', () => {
          this.sockets.delete(socket)
          void session.close().catch(() => {})
        })
      })
      this.server = server
      server.once('error', (error) => {
        this.starting = null
        reject(error)
      })
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') {
          reject(new Error('BROWSER_LISTEN_FAILED'))
          return
        }
        this.address = `127.0.0.1:${address.port}`
        this.starting = null
        resolve(this.address)
      })
    })
    return this.starting
  }
  async dispose(): Promise<void> {
    this.disposed = true
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    const server = this.server
    this.server = null
    this.address = null
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
  }
}
