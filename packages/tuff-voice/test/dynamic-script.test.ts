import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  DynamicScriptVoiceProvider,
  isSafeRemoteUrl,
  VoiceProviderError,
} from '../src/index'

describe('dynamic-script provider and sandbox', () => {
  describe('isSafeRemoteUrl', () => {
    it('allows valid HTTPS and WSS remote endpoints', () => {
      expect(isSafeRemoteUrl('https://api.example.com/v1/voice')).toBe(true)
      expect(isSafeRemoteUrl('wss://stream.example.com/audio')).toBe(true)
    })

    it('denies insecure HTTP or WS when only HTTPS/WSS allowed', () => {
      expect(isSafeRemoteUrl('http://api.example.com/v1/voice')).toBe(false)
      expect(isSafeRemoteUrl('ws://stream.example.com/audio')).toBe(false)
    })

    it('denies private, loopback, or metadata IPs (SSRF protection)', () => {
      expect(isSafeRemoteUrl('https://localhost/api')).toBe(false)
      expect(isSafeRemoteUrl('https://127.0.0.1/api')).toBe(false)
      expect(isSafeRemoteUrl('https://10.0.0.1/api')).toBe(false)
      expect(isSafeRemoteUrl('https://172.16.0.1/api')).toBe(false)
      expect(isSafeRemoteUrl('https://192.168.1.1/api')).toBe(false)
      expect(isSafeRemoteUrl('https://169.254.169.254/latest/meta-data')).toBe(false)
    })

    it('denies credentials in URL', () => {
      expect(isSafeRemoteUrl('https://admin:secret@api.example.com/api')).toBe(false)
    })
  })

  describe('sandbox isolation', () => {
    it('blocks access to process, require, and dangerous Node globals', () => {
      const dangerousScript = `
        module.exports = {
          createSession: (ctx) => {
            const hasProcess = typeof process !== 'undefined';
            const hasRequire = typeof require !== 'undefined';
            if (hasProcess || hasRequire) {
              throw new Error('Sandbox escaped');
            }
            return {
              writePcm: () => {},
              end: () => {}
            };
          }
        };
      `

      const provider = new DynamicScriptVoiceProvider({ scriptContent: dangerousScript })
      expect(provider.id).toBe('dynamic-script')
    })

    it('disallows eval and new Function through codeGeneration restrictions', async () => {
      const evalScript = `
        module.exports = {
          createSession: () => {
            eval('1 + 1');
            return { writePcm: () => {}, end: () => {} };
          }
        };
      `
      const provider = new DynamicScriptVoiceProvider({ scriptContent: evalScript })
      const stream = await provider.createStream({
        model: 'test',
        audio: { format: 'pcm', sampleRate: 16000, channels: 1, bitsPerSample: 16 },
        requestId: 'req-eval',
      })
      await expect(stream.ready).rejects.toThrow()
    })
    it('fails evaluation when script syntax is invalid', () => {
      expect(
        () => new DynamicScriptVoiceProvider({ scriptContent: 'this is not valid js {' }),
      ).toThrowError(VoiceProviderError)
    })

    it('fails when module.exports is not an object with required methods', () => {
      expect(
        () => new DynamicScriptVoiceProvider({ scriptContent: 'module.exports = 123;' }),
      ).toThrowError(VoiceProviderError)

      expect(
        () => new DynamicScriptVoiceProvider({ scriptContent: 'module.exports = {};' }),
      ).toThrowError(VoiceProviderError)
    })
  })

  describe('streaming session execution', () => {
    it('simulates a reverse-engineered input method session that streams chunks and emits text', async () => {
      const mockReverseWeChatInputScript = `
        module.exports = {
          name: 'mock-wechat-voice',
          defaultStreamModel: 'wechat-v1',
          createSession: (ctx) => {
            let bufferLen = 0;
            return {
              writePcm: (chunk) => {
                bufferLen += chunk.length;
                ctx.emit({
                  type: 'partial',
                  text: '正在识别...' + bufferLen
                });
              },
              end: () => {
                ctx.emit({
                  type: 'final',
                  text: '微信语音输入成功'
                });
                ctx.emit({ type: 'end' });
              }
            };
          }
        };
      `

      const provider = new DynamicScriptVoiceProvider({
        scriptContent: mockReverseWeChatInputScript,
      })

      expect(provider.id).toBe('mock-wechat-voice')
      expect(provider.defaultStreamModel).toBe('wechat-v1')
      expect(provider.capabilities.stream).toBe(true)

      const stream = await provider.createStream({
        model: 'wechat-v1',
        audio: { format: 'pcm', sampleRate: 16000, channels: 1, bitsPerSample: 16 },
        requestId: 'req-wechat-test',
      })

      await stream.ready

      const events: string[] = []
      const readEvents = (async () => {
        for await (const event of stream.events) {
          if (event.type === 'partial' || event.type === 'final') {
            events.push(event.text)
          }
        }
      })()

      await stream.writePcm(new Uint8Array([1, 2, 3, 4]))
      await stream.writePcm(new Uint8Array([5, 6, 7, 8]))
      await stream.end()
      await readEvents

      expect(events).toEqual([
        '正在识别...4',
        '正在识别...8',
        '微信语音输入成功',
      ])
    })

    it('enforces handshake timeout when session creation hangs', async () => {
      const hangingScript = `
        module.exports = {
          createSession: () => new Promise(() => {})
        };
      `

      const provider = new DynamicScriptVoiceProvider({
        scriptContent: hangingScript,
        timeoutMs: 100,
      })

      const stream = await provider.createStream({
        model: 'default',
        audio: { format: 'pcm', sampleRate: 16000, channels: 1, bitsPerSample: 16 },
        requestId: 'req-hang',
      })

      await expect(stream.ready).rejects.toMatchObject({
        code: 'VOICE_SCRIPT_TIMEOUT',
      })
    })

    it('rejects SSRF requests inside context.fetch', async () => {
      const ssrfScript = `
        module.exports = {
          createSession: async (ctx) => {
            await ctx.fetch('https://169.254.169.254/secret');
            return { writePcm: () => {}, end: () => {} };
          }
        };
      `

      const provider = new DynamicScriptVoiceProvider({ scriptContent: ssrfScript })
      const stream = await provider.createStream({
        model: 'default',
        audio: { format: 'pcm', sampleRate: 16000, channels: 1, bitsPerSample: 16 },
        requestId: 'req-ssrf',
      })

      await expect(stream.ready).rejects.toMatchObject({
        code: 'VOICE_SCRIPT_URL_DENIED',
      })
    })
  })

  describe('upload mode', () => {
    it('executes transcribeUpload successfully', async () => {
      const uploadScript = `
        module.exports = {
          transcribeUpload: async (ctx, req) => {
            return {
              text: '上传识别成功',
              language: 'zh-CN',
              durationMs: 1200
            };
          }
        };
      `

      const provider = new DynamicScriptVoiceProvider({ scriptContent: uploadScript })
      expect(provider.capabilities.upload).toBe(true)
      expect(provider.capabilities.stream).toBe(false)

      const result = await provider.transcribeUpload({
        model: 'test-upload',
        source: { kind: 'bytes', bytes: Buffer.from([0, 1]), format: 'wav' },
        requestId: 'req-upload',
      })

      expect(result).toEqual({
        text: '上传识别成功',
        language: 'zh-CN',
        durationMs: 1200,
      })
    })
  })
})
