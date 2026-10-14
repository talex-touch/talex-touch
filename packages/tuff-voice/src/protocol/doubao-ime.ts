import type { VoiceProviderEvent, VoiceStreamRequest } from '../contracts'
import { Buffer } from 'node:buffer'

export const DEFAULT_DOUBAO_IME_STREAM_URL = 'wss://frontier-audio-ime-ws.doubao.com/ocean/api/v1/ws'
export const DEFAULT_DOUBAO_IME_TOKEN_URL = 'https://ime.oceancloudapi.com/api/v1/user/get_config'
export const DOUBAO_IME_APP_KEY = 'OrnqKvSSrs'
export const DOUBAO_IME_ACCESS_KEY = 'SYlxZr6LnvBaIVmF'

export interface DoubaoImeTokenResponse {
  Code?: number
  Msg?: string
  Data?: {
    sami_token?: string
  }
}

let cachedToken: string | null = null
let cachedTokenExpiresAt = 0

/**
 * Fetches and caches a valid 24h SAMI Odin Token for Doubao IME cloud ASR.
 */
export async function acquireDoubaoImeToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  const now = Date.now()
  if (cachedToken && now < cachedTokenExpiresAt - 600_000) {
    return cachedToken
  }

  const response = await fetchImpl(DEFAULT_DOUBAO_IME_TOKEN_URL, {
    method: 'POST',
    headers: {
      'User-Agent': 'DoubaoIme/1.0.0 (Macintosh; Apple Silicon)',
      'Content-Type': 'application/json',
      'X-Api-Access-Key': DOUBAO_IME_ACCESS_KEY,
      'X-Api-Request-Id': crypto.randomUUID(),
    },
    body: JSON.stringify({ sami_app_key: DOUBAO_IME_APP_KEY }),
  })

  if (!response.ok) {
    throw new Error(`Failed to acquire Doubao IME token: HTTP ${response.status}`)
  }

  const data = (await response.json()) as DoubaoImeTokenResponse
  if (data.Code === 0 && data.Data?.sami_token) {
    cachedToken = data.Data.sami_token
    cachedTokenExpiresAt = now + 18_000_000 // 5 hours
    return cachedToken
  }

  throw new Error(`Invalid Doubao IME token response: ${JSON.stringify(data)}`)
}

export function buildDoubaoImeStartTask(
  taskId: string,
  sessionId: string,
  token: string,
  request?: Partial<VoiceStreamRequest>,
): string {
  const payload = {
    app_name: 'DoubaoIme',
    app_version: '1.0.0.207',
    enable_asr_twopass: request?.enableNonstream ?? true,
    enable_asr_threepass: request?.enableDdc ?? true,
    strong_ddc: request?.enableDdc ?? true,
    remove_space_between_han_num: true,
    remove_space_between_han_eng: true,
    enable_asr_format: request?.enablePunctuation ?? true,
    audio_format: request?.audio?.codec === 'opus' ? 'speech_opus' : 'raw_pcm',
  }

  return JSON.stringify({
    task_id: taskId,
    session_id: sessionId,
    namespace: 'ASR',
    event: 'StartTask',
    appkey: DOUBAO_IME_APP_KEY,
    token,
    payload: JSON.stringify(payload),
  })
}

export function buildDoubaoImeAudioRequest(
  taskId: string,
  sessionId: string,
  token: string,
  seqId: number,
  audioChunk: Uint8Array,
  isLast = false,
): string {
  const extra = {
    is_history_audio: false,
    seq_id: seqId,
    timestamp_ms: Date.now(),
    is_last_history_audio: isLast,
  }

  return JSON.stringify({
    task_id: taskId,
    session_id: sessionId,
    namespace: 'ASR',
    event: 'TaskRequest',
    appkey: DOUBAO_IME_APP_KEY,
    token,
    payload: Buffer.from(audioChunk).toString('base64'),
    extra: JSON.stringify(extra),
  })
}

export function buildDoubaoImeFinishTask(
  taskId: string,
  sessionId: string,
  token: string,
): string {
  return JSON.stringify({
    task_id: taskId,
    session_id: sessionId,
    namespace: 'ASR',
    event: 'FinishTask',
    appkey: DOUBAO_IME_APP_KEY,
    token,
  })
}

export interface DoubaoImeServerMessage {
  task_id?: string
  message_id?: string
  namespace?: string
  event?: string
  status_code?: number
  status_text?: string
  payload?: string
}

export function parseDoubaoImeResponse(
  rawText: string,
): VoiceProviderEvent | null {
  try {
    const msg = JSON.parse(rawText) as DoubaoImeServerMessage
    if (msg.status_code && msg.status_code !== 20000000) {
      return {
        type: 'error',
        code: `DOUBAO_IME_${msg.status_code}`,
        message: msg.status_text || 'Doubao IME ASR error',
        retryable: msg.status_code === 40200001, // Token expired -> retryable
        requestId: msg.task_id,
      }
    }

    if (msg.payload) {
      const payload = JSON.parse(msg.payload)
      const results = payload.results as Array<{ text?: string, is_interim?: boolean }> | undefined
      if (results && results.length > 0) {
        const first = results[0]
        const text = first?.text ?? ''
        if (text) {
          const isInterim = first.is_interim ?? true
          return isInterim
            ? { type: 'partial', text, requestId: msg.task_id }
            : { type: 'final', text, requestId: msg.task_id }
        }
      }
    }

    if (msg.event === 'TaskFinished') {
      return { type: 'end', requestId: msg.task_id }
    }

    return null
  }
  catch {
    return null
  }
}
