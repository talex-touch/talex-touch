import type { NativeOcrOptions, NativeOcrResult } from '@talex-touch/tuff-native'
import process from 'node:process'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OcrProcessSuccessMessage } from './ocr-process-client'

const nativeOcr = vi.hoisted(() => ({
  recognizeImageText: vi.fn<(options: NativeOcrOptions) => Promise<NativeOcrResult>>()
}))

vi.mock('@talex-touch/tuff-native', () => ({
  getNativeOcrSupport: () => ({ supported: true, platform: 'darwin' }),
  recognizeImageText: nativeOcr.recognizeImageText
}))

const originalParentPort = Object.getOwnPropertyDescriptor(process, 'parentPort')

afterEach(() => {
  if (originalParentPort) Object.defineProperty(process, 'parentPort', originalParentPort)
  else Reflect.deleteProperty(process, 'parentPort')
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  nativeOcr.recognizeImageText.mockReset()
})

describe('OCR child image coordinates', () => {
  it('recognizes a bounded image but replies with bounding boxes in original clipboard pixels', async () => {
    const originalImage = await sharp({
      create: { width: 4001, height: 1333, channels: 3, background: '#996633' }
    })
      .png()
      .toBuffer()
    const unchangedImage = Buffer.from(originalImage)
    let nativeImageSize: { width?: number; height?: number } | undefined
    nativeOcr.recognizeImageText.mockImplementation(async ({ image }) => {
      nativeImageSize = await sharp(image).metadata()
      return {
        text: 'Recognized text',
        confidence: 0.93,
        language: 'en-US',
        engine: 'apple-vision',
        durationMs: 12,
        blocks: [
          { text: 'located', confidence: 0.91, boundingBox: [100, 200, 300, 400] },
          { text: 'without layout', confidence: 0.8 }
        ]
      }
    })

    let deliver!: (event: { data: unknown }) => void
    let reply!: (message: OcrProcessSuccessMessage) => void
    const response = new Promise<OcrProcessSuccessMessage>((resolve) => {
      reply = resolve
    })
    const port = {
      once: (_event: string, listener: typeof deliver) => {
        deliver = listener
      },
      off: () => undefined,
      postMessage: (message: OcrProcessSuccessMessage) => reply(message)
    }
    Object.defineProperty(process, 'parentPort', { configurable: true, value: port })
    vi.useFakeTimers({ toFake: ['setImmediate', 'clearImmediate'] })
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    // Exercise the child-entry loading boundary: its top-level run() must see the installed port,
    // so a static import would run before this Electron process fixture exists.
    await import('./ocr-process')
    // Electron's structured clone delivers a Uint8Array, not a Node Buffer.
    deliver({
      data: {
        type: 'ocr.request',
        requestId: 'original-pixel-coordinates',
        options: { image: new Uint8Array(originalImage), includeLayout: true }
      }
    })

    const message = await response
    expect(nativeImageSize).toMatchObject({ width: 2000, height: 666 })
    expect(message).toMatchObject({
      type: 'ocr.success',
      requestId: 'original-pixel-coordinates',
      result: {
        text: 'Recognized text',
        confidence: 0.93,
        language: 'en-US',
        engine: 'apple-vision',
        durationMs: 12
      }
    })
    const blocks = message.result.blocks
    expect(blocks).toHaveLength(2)
    expect(blocks?.[0]).toMatchObject({ text: 'located', confidence: 0.91 })
    const boundingBox = blocks?.[0].boundingBox
    expect(boundingBox?.[0]).toBeCloseTo((100 * 4001) / 2000, 8)
    expect(boundingBox?.[1]).toBeCloseTo((200 * 1333) / 666, 8)
    expect(boundingBox?.[2]).toBeCloseTo((300 * 4001) / 2000, 8)
    expect(boundingBox?.[3]).toBeCloseTo((400 * 1333) / 666, 8)
    expect(blocks?.[1]).toEqual({ text: 'without layout', confidence: 0.8 })
    expect(originalImage).toEqual(unchangedImage)
  })
})
