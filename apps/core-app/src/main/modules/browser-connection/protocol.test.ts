import { BROWSER_MAX_FRAME_BYTES } from '@talex-touch/utils/transport/sdk/domains/browser-connection'
import { describe, expect, it } from 'vitest'
import { BrowserFrameDecoder, encodeBrowserFrame } from './protocol'

describe('browser native messaging framing', () => {
  it('reassembles split headers and bodies without publishing partial messages', () => {
    const frame = encodeBrowserFrame({ type: 'origin', origin: 'chrome-extension://allowed/' })
    const decoder = new BrowserFrameDecoder()
    expect(decoder.push(frame.subarray(0, 2))).toEqual([])
    expect(decoder.push(frame.subarray(2, 7))).toEqual([])
    expect(decoder.push(frame.subarray(7))).toEqual([
      { type: 'origin', origin: 'chrome-extension://allowed/' }
    ])
    expect(() => decoder.finish()).not.toThrow()
  })

  it('decodes multiple bounded frames from one read', () => {
    const decoder = new BrowserFrameDecoder()
    const input = Buffer.concat([
      encodeBrowserFrame({ type: 'refresh' }),
      encodeBrowserFrame({ type: 'error', error: 'x' })
    ])
    expect(decoder.push(input)).toEqual([{ type: 'refresh' }, { type: 'error', error: 'x' }])
  })

  it.each([
    ['empty frame', Buffer.from([0, 0, 0, 0]), 'BROWSER_FRAME_SIZE'],
    [
      'oversized frame',
      (() => {
        const header = Buffer.alloc(4)
        header.writeUInt32LE(BROWSER_MAX_FRAME_BYTES + 1)
        return header
      })(),
      'BROWSER_FRAME_SIZE'
    ],
    ['truncated body', Buffer.from([3, 0, 0, 0, 123]), 'BROWSER_FRAME_TRUNCATED']
  ] as const)('rejects %s with a bounded protocol error', (_name, input, error) => {
    const decoder = new BrowserFrameDecoder()
    if (error === 'BROWSER_FRAME_TRUNCATED') {
      expect(decoder.push(input)).toEqual([])
      expect(() => decoder.finish()).toThrow(error)
    } else {
      expect(() => decoder.push(input)).toThrow(error)
    }
  })

  it('rejects malformed UTF-8 and non-object JSON rather than passing them to the backend', () => {
    const invalidUtf8 = Buffer.from([2, 0, 0, 0, 0xc3, 0x28])
    expect(() => new BrowserFrameDecoder().push(invalidUtf8)).toThrow('BROWSER_FRAME_UTF8')
    const primitive = encodeBrowserFrame('not an object')
    expect(() => new BrowserFrameDecoder().push(primitive)).toThrow('BROWSER_FRAME_OBJECT')
  })

  it('rejects oversized outbound messages before allocating a frame', () => {
    expect(() => encodeBrowserFrame({ payload: 'x'.repeat(BROWSER_MAX_FRAME_BYTES) })).toThrow(
      'BROWSER_FRAME_SIZE'
    )
  })
})
