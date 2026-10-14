import type { VoiceSocket, VoiceSocketFactory, VoiceStreamRequest } from '../src/index'
import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import {
  acquireDoubaoImeToken,
  buildDoubaoImeAudioRequest,
  buildDoubaoImeFinishTask,
  buildDoubaoImeStartTask,
  DoubaoImeVoiceProvider,
  parseDoubaoImeResponse,
} from '../src/index'

describe('doubao-ime protocol & provider', () => {
  it('acquires token via simulated oceancloudapi endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        Code: 0,
        Msg: '',
        Data: { sami_token: 'mock-sami-token-xyz' },
      }),
    })

    const token = await acquireDoubaoImeToken(mockFetch as unknown as typeof fetch)
    expect(token).toBe('mock-sami-token-xyz')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://ime.oceancloudapi.com/api/v1/user/get_config',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Api-Access-Key': 'SYlxZr6LnvBaIVmF',
        }),
      }),
    )
  })

  it('builds StartTask, TaskRequest, and FinishTask messages correctly', () => {
    const startJson = buildDoubaoImeStartTask('task-1', 'sess-1', 'token-abc', {
      enableNonstream: true,
      enableDdc: true,
    })
    const startObj = JSON.parse(startJson)
    expect(startObj.event).toBe('StartTask')
    expect(startObj.token).toBe('token-abc')
    expect(startObj.namespace).toBe('ASR')
    const innerPayload = JSON.parse(startObj.payload)
    expect(innerPayload.app_name).toBe('DoubaoIme')
    expect(innerPayload.enable_asr_threepass).toBe(true)

    const chunk = Buffer.from([0x01, 0x02, 0x03])
    const audioJson = buildDoubaoImeAudioRequest('task-1', 'sess-1', 'token-abc', 42, chunk, false)
    const audioObj = JSON.parse(audioJson)
    expect(audioObj.event).toBe('TaskRequest')
    expect(audioObj.payload).toBe(chunk.toString('base64'))
    const audioExtra = JSON.parse(audioObj.extra)
    expect(audioExtra.seq_id).toBe(42)
    expect(audioExtra.is_last_history_audio).toBe(false)

    const finishJson = buildDoubaoImeFinishTask('task-1', 'sess-1', 'token-abc')
    const finishObj = JSON.parse(finishJson)
    expect(finishObj.event).toBe('FinishTask')
    expect(finishObj.task_id).toBe('task-1')
  })

  it('parses server streaming responses', () => {
    // 1. Partial interim result
    const partialRaw = JSON.stringify({
      task_id: 'task-1',
      event: 'TaskResponse',
      status_code: 20000000,
      status_text: 'OK',
      payload: JSON.stringify({
        results: [{ text: '你好世界', is_interim: true }],
      }),
    })
    const partialEvent = parseDoubaoImeResponse(partialRaw)
    expect(partialEvent).toEqual({
      type: 'partial',
      text: '你好世界',
      requestId: 'task-1',
    })

    // 2. Final polished result
    const finalRaw = JSON.stringify({
      task_id: 'task-1',
      event: 'TaskResponse',
      status_code: 20000000,
      status_text: 'OK',
      payload: JSON.stringify({
        results: [{ text: '你好，世界。', is_interim: false }],
      }),
    })
    const finalEvent = parseDoubaoImeResponse(finalRaw)
    expect(finalEvent).toEqual({
      type: 'final',
      text: '你好，世界。',
      requestId: 'task-1',
    })

    // 3. Error
    const errorRaw = JSON.stringify({
      task_id: 'task-1',
      event: 'TaskFailed',
      status_code: 40200001,
      status_text: 'session auth, userID or appID is empty',
    })
    const errorEvent = parseDoubaoImeResponse(errorRaw)
    expect(errorEvent).toEqual({
      type: 'error',
      code: 'DOUBAO_IME_40200001',
      message: 'session auth, userID or appID is empty',
      retryable: true,
      requestId: 'task-1',
    })

    // 4. TaskFinished
    const finRaw = JSON.stringify({
      task_id: 'task-1',
      event: 'TaskFinished',
      status_code: 20000000,
    })
    expect(parseDoubaoImeResponse(finRaw)).toEqual({
      type: 'end',
      requestId: 'task-1',
    })
  })

  it('runs stream session through DoubaoImeVoiceProvider', async () => {
    const sentMessages: string[] = []
    let onMessageHandler: ((data: string) => void) | null = null

    let openHandler: (() => void) | null = null
    let messageHandler: ((data: string | Uint8Array) => void) | null = null

    const mockSocket: VoiceSocket = {
      readyState: 1,
      send: (data: string | Uint8Array) => {
        sentMessages.push(typeof data === 'string' ? data : Buffer.from(data).toString())
      },
      close: vi.fn(),
      onOpen: (handler) => {
        openHandler = handler
      },
      onMessage: (handler) => {
        messageHandler = handler
      },
      onError: vi.fn(),
      onClose: vi.fn(),
    }

    const mockSocketFactory: VoiceSocketFactory = {
      connect: vi.fn().mockImplementation(async () => {
        queueMicrotask(() => openHandler?.())
        return mockSocket
      }),
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        Code: 0,
        Msg: '',
        Data: { sami_token: 'mock-sami-token-xyz' },
      }),
    })

    const provider = new DoubaoImeVoiceProvider({
      socketFactory: mockSocketFactory,
      fetchImpl: mockFetch as unknown as typeof fetch,
    })

    const req: VoiceStreamRequest = {
      model: 'bigmodel',
      audio: { format: 'pcm', sampleRate: 16000, channels: 1, bitsPerSample: 16 },
      requestId: 'req-001',
    }

    const session = await provider.createStream(req)
    expect(session).toBeDefined()
    expect(sentMessages.length).toBeGreaterThan(0)
    expect(JSON.parse(sentMessages[0]).event).toBe('StartTask')

    // Write audio chunk
    await session.writePcm(new Uint8Array([0x10, 0x20]))
    expect(sentMessages.length).toBe(2)
    expect(JSON.parse(sentMessages[1]).event).toBe('TaskRequest')

    await session.end()
    expect(sentMessages.length).toBe(3)
    expect(JSON.parse(sentMessages[2]).event).toBe('FinishTask')
  })
})
