import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as H3 from 'h3'
import type { H3Event } from 'h3'

const authMocks = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
}))

const rateLimitMocks = vi.hoisted(() => ({
  enforceAdminRateLimit: vi.fn(),
}))

const creditsMocks = vi.hoisted(() => ({
  getCreditSummary: vi.fn(),
  consumeCredits: vi.fn(),
}))

const pricingMocks = vi.hoisted(() => ({
  resolveSellableCreditPricingRule: vi.fn(),
}))

const asrServiceMocks = vi.hoisted(() => ({
  resolveDashScopeAsrProvider: vi.fn(),
}))

const dashscopeMocks = vi.hoisted(() => ({
  createDashScopeEphemeralToken: vi.fn(),
}))

const h3Mocks = vi.hoisted(() => ({
  readBody: vi.fn(),
}))

vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof H3>('h3')
  return {
    ...actual,
    readBody: h3Mocks.readBody,
  }
})

vi.mock('../../../../../server/utils/auth', () => authMocks)
vi.mock('../../../../../server/utils/adminRateLimitStore', () => rateLimitMocks)
vi.mock('../../../../../server/utils/creditsStore', () => creditsMocks)
vi.mock('../../../../../server/utils/creditPricingStore', () => pricingMocks)
vi.mock('../../../../../server/utils/asrTranscriptionService', () => asrServiceMocks)
vi.mock('../../../../../server/utils/dashscopeAsrProvider', () => dashscopeMocks)

interface GlobalEventHandlerScope {
  defineEventHandler?: (fn: unknown) => unknown
}
const globalScope = globalThis as unknown as GlobalEventHandlerScope

let tokenHandler: (event: H3Event) => Promise<unknown>
let settleHandler: (event: H3Event) => Promise<unknown>

beforeAll(async () => {
  globalScope.defineEventHandler = (fn: unknown) => fn

  // Exception: Nuxt server routes register via global defineEventHandler at import time
  const tokenModule = await import('../../../../../server/api/v1/ai/audio/token.post')
  tokenHandler = tokenModule.default as (event: H3Event) => Promise<unknown>

  const settleModule = await import('../../../../../server/api/v1/ai/audio/settle.post')
  settleHandler = settleModule.default as (event: H3Event) => Promise<unknown>
})

afterAll(() => {
  delete globalScope.defineEventHandler
})

describe('Nexus voice token issuance and settlement', () => {
  const fakeEvent = {} as H3Event

  beforeEach(() => {
    vi.clearAllMocks()
    authMocks.requireAppAuth.mockResolvedValue({ userId: 'user-123' })
    rateLimitMocks.enforceAdminRateLimit.mockResolvedValue(undefined)
    creditsMocks.getCreditSummary.mockResolvedValue({ balance: 500 })
    asrServiceMocks.resolveDashScopeAsrProvider.mockResolvedValue({
      provider: { id: 'dashscope-main', authRef: 'ref-1' },
    })
    dashscopeMocks.createDashScopeEphemeralToken.mockResolvedValue({
      token: 'st-mock-token-xyz',
      expiresAt: 1791761400,
    })
    pricingMocks.resolveSellableCreditPricingRule.mockResolvedValue({
      creditsPerUnit: 4,
      secondaryCreditsPerUnit: 1,
      minCredits: 1,
    })
    creditsMocks.consumeCredits.mockResolvedValue({
      ledgerId: 'ledger-456',
    })
  })

  describe('POST /api/v1/ai/audio/token', () => {
    it('issues an ephemeral token when user is authenticated and has credit balance', async () => {
      const result = await tokenHandler(fakeEvent)

      expect(authMocks.requireAppAuth).toHaveBeenCalledWith(fakeEvent)
      expect(rateLimitMocks.enforceAdminRateLimit).toHaveBeenCalledWith(
        fakeEvent,
        expect.objectContaining({ key: 'asr-token:user:user-123' })
      )
      expect(creditsMocks.getCreditSummary).toHaveBeenCalledWith(fakeEvent, 'user-123')
      expect(dashscopeMocks.createDashScopeEphemeralToken).toHaveBeenCalledWith(
        fakeEvent,
        { id: 'dashscope-main', authRef: 'ref-1' },
        300
      )
      expect(result).toMatchObject({
        token: 'st-mock-token-xyz',
        expiresAt: 1791761400,
        websocketUrl: 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
        model: 'qwen3-asr-flash-realtime',
        sessionId: expect.any(String),
      })
    })

    it('rejects with 402 INSUFFICIENT_CREDITS when balance is zero or negative', async () => {
      creditsMocks.getCreditSummary.mockResolvedValueOnce({ balance: 0 })

      await expect(tokenHandler(fakeEvent)).rejects.toMatchObject({
        statusCode: 402,
        statusMessage: 'INSUFFICIENT_CREDITS',
      })
      expect(dashscopeMocks.createDashScopeEphemeralToken).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/v1/ai/audio/settle', () => {
    it('calculates credits based on audio duration and transcript units and deducts balance', async () => {
      h3Mocks.readBody.mockResolvedValueOnce({
        sessionId: 'session-abc-123',
        durationMs: 4200, // 5 seconds ceiling -> 5 * 4 = 20 credits
        transcriptUnits: 25, // 25 credits
        requestId: 'req-realtime-1',
      })

      const result = await settleHandler(fakeEvent)

      // Math.max(5 * 4, 25 * 1, 1) = 25 credits
      expect(creditsMocks.consumeCredits).toHaveBeenCalledWith(
        fakeEvent,
        'user-123',
        25,
        'asr:qwen-realtime',
        expect.objectContaining({
          sessionId: 'session-abc-123',
          durationMs: 4200,
          durationSeconds: 5,
          transcriptUnits: 25,
        }),
        { idempotencyKey: 'asr-settle:session-abc-123' }
      )
      expect(result).toEqual({
        settled: true,
        creditsCharged: 25,
        ledgerId: 'ledger-456',
      })
    })

    it('rejects invalid parameters', async () => {
      h3Mocks.readBody.mockResolvedValueOnce({
        sessionId: '',
        durationMs: -10,
      })

      await expect(settleHandler(fakeEvent)).rejects.toMatchObject({
        statusCode: 400,
        statusMessage: 'INVALID_USAGE_PARAMETERS',
      })
    })
  })
})
