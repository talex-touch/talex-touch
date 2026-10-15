import type {
  VoiceProviderAdapter,
  VoiceProviderCapabilities,
  VoiceRecognitionResult,
  VoiceSocketFactory,
  VoiceStreamConnection,
  VoiceStreamRequest,
  VoiceUploadRequest,
} from '../contracts'
import { Buffer } from 'node:buffer'
import { assertVoiceProviderRequestId, VoiceProviderError } from '../contracts'
import {
  acquireDoubaoImeToken,
  buildDoubaoImeAudioRequest,
  buildDoubaoImeFinishTask,
  buildDoubaoImeStartTask,
  DEFAULT_DOUBAO_IME_STREAM_URL,
  parseDoubaoImeResponse,
} from '../protocol/doubao-ime'
import { VoiceSocketSession } from '../socket-session'

export interface DoubaoImeVoiceProviderOptions {
  socketFactory: VoiceSocketFactory
  streamUrl?: string
  fetchImpl?: typeof fetch
}

export class DoubaoImeVoiceProvider implements VoiceProviderAdapter {
  readonly id = 'doubao-ime'
  readonly kind = 'doubao' as const
  readonly capabilities: VoiceProviderCapabilities = {
    stream: true,
    upload: false,
    formats: ['pcm', 'wav', 'opus'],
  }

  readonly defaultStreamModel = 'bigmodel'
  readonly defaultUploadModel = 'bigmodel'

  private readonly options: DoubaoImeVoiceProviderOptions

  constructor(options: DoubaoImeVoiceProviderOptions) {
    this.options = options
  }

  async createStream(request: VoiceStreamRequest): Promise<VoiceStreamConnection> {
    assertVoiceProviderRequestId(request.requestId)

    const token = await acquireDoubaoImeToken(this.options.fetchImpl)
    const taskId = request.requestId
    const sessionId = crypto.randomUUID()
    let sequence = 1

    const session = new VoiceSocketSession({
      socketFactory: this.options.socketFactory,
      request,
      url: this.options.streamUrl ?? DEFAULT_DOUBAO_IME_STREAM_URL,
      headers: { 'User-Agent': 'ttnet/1.0.0' },
      maxPcmChunkBytes: 3200, // 100ms at 16kHz 16-bit mono
      encodePcm: chunk =>
        Buffer.from(
          buildDoubaoImeAudioRequest(taskId, sessionId, token, sequence++, chunk, false),
        ),
      onOpen: (socket, controls) => {
        socket.send(buildDoubaoImeStartTask(taskId, sessionId, token, request))
        // Ready after connection + task handshake
        controls.ready()
      },
      onMessage: (data, controls) => {
        const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8')
        const event = parseDoubaoImeResponse(text)
        if (!event)
          return

        if (event.type === 'error') {
          controls.fail(
            new VoiceProviderError(event.code, event.message, {
              retryable: event.retryable,
              requestId: event.requestId,
            }),
          )
          return
        }

        controls.emit(event)

        if (event.type === 'end') {
          controls.end()
        }
      },
      onEnd: (socket) => {
        socket.send(buildDoubaoImeFinishTask(taskId, sessionId, token))
      },
    })

    await session.ready
    return session
  }

  async transcribeUpload(_request: VoiceUploadRequest): Promise<VoiceRecognitionResult> {
    throw new VoiceProviderError(
      'DOUBAO_IME_UPLOAD_UNSUPPORTED',
      'Doubao IME direct provider only supports real-time streaming recognition.',
    )
  }
}
