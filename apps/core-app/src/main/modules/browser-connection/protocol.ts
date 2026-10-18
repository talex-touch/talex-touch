import { Buffer, isUtf8 } from 'node:buffer'
import { BROWSER_MAX_FRAME_BYTES } from '@talex-touch/utils/transport/sdk/domains/browser-connection'

export function serializeBrowserFrame(message: unknown): string {
  const json = JSON.stringify(message)
  if (typeof json !== 'string') throw new Error('BROWSER_FRAME_SIZE')
  const size = Buffer.byteLength(json, 'utf8')
  if (!size || size > BROWSER_MAX_FRAME_BYTES) throw new Error('BROWSER_FRAME_SIZE')
  return json
}

export function encodeBrowserFrame(message: unknown): Buffer {
  const body = Buffer.from(serializeBrowserFrame(message), 'utf8')
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32LE(body.length)
  return Buffer.concat([header, body])
}

/** Incremental decoder: the header is checked before allocating or buffering a declared body. */
export class BrowserFrameDecoder {
  private header = Buffer.alloc(4)
  private headerBytes = 0
  private body: Buffer | null = null
  private bodyBytes = 0
  push(input: Buffer): unknown[] {
    const messages: unknown[] = []
    let offset = 0
    while (offset < input.length) {
      if (!this.body) {
        const count = Math.min(4 - this.headerBytes, input.length - offset)
        input.copy(this.header, this.headerBytes, offset, offset + count)
        this.headerBytes += count
        offset += count
        if (this.headerBytes < 4) continue
        const size = this.header.readUInt32LE(0)
        if (!size || size > BROWSER_MAX_FRAME_BYTES) throw new Error('BROWSER_FRAME_SIZE')
        this.body = Buffer.allocUnsafe(size)
        this.bodyBytes = 0
      }
      const count = Math.min(this.body.length - this.bodyBytes, input.length - offset)
      input.copy(this.body, this.bodyBytes, offset, offset + count)
      offset += count
      this.bodyBytes += count
      if (this.bodyBytes === this.body.length) {
        if (!isUtf8(this.body)) throw new Error('BROWSER_FRAME_UTF8')
        const text = this.body.toString('utf8')
        const message: unknown = JSON.parse(text)
        if (!message || typeof message !== 'object' || Array.isArray(message))
          throw new Error('BROWSER_FRAME_OBJECT')
        messages.push(message)
        this.body = null
        this.headerBytes = 0
      }
    }
    return messages
  }
  finish(): void {
    if (this.headerBytes || this.body) throw new Error('BROWSER_FRAME_TRUNCATED')
  }
}
