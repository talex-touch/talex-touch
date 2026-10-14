import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as H3 from 'h3'
import type { H3Event } from 'h3'
import type { getCreditSummary } from '../../../../../server/utils/creditsStore'

const authMocks = vi.hoisted(() => ({
  requireAppAuth: vi.fn(),
}))

const rateLimitMocks = vi.hoisted(() => ({
  enforceAdminRateLimit: vi.fn(),
}))

const creditsMocks = vi.hoisted(() => ({
  getCreditSummary: vi.fn<typeof getCreditSummary>(),
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
const originalDefineEventHandler = globalScope.defineEventHandler

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
  if (originalDefineEventHandler === undefined)
    delete globalScope.defineEventHandler
  else
    globalScope.defineEventHandler = originalDefineEventHandler
})

describe('Nexus voice token issuance and settlement', () => {
  const fakeEvent = {} as H3Event

  const creditSummary = {
    month: '2026-10',
    user: { quota: 500, used: 100 },
    team: { quota: 1000, used: 200 },
    teamContext: {
      id: 'team_user-123',
      name: 'Personal',
      type: 'personal' as const,
      hasTeamPool: false,
    },
    boost: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    authMocks.requireAppAuth.mockResolvedValue({ userId: 'user-123' })
    rateLimitMocks.enforceAdminRateLimit.mockResolvedValue(undefined)
    creditsMocks.getCreditSummary.mockResolvedValue(creditSummary)
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
    it.each([
      {
        name: 'numeric balances',
        user: { quota: 501, used: 500 },
        team: { quota: 1001, used: 1000 },
      },
      {
        name: 'numeric string balances',
        user: { quota: '501', used: '500' },
        team: { quota: '1001', used: '1000' },
      },
    ])('issues an ephemeral token when both scopes have one credit remaining ($name)', async ({ user, team }) => {
      creditsMocks.getCreditSummary.mockResolvedValueOnce({ ...creditSummary, user, team })

      const result = await tokenHandler(fakeEvent)

      expect(result).toMatchObject({
        token: 'st-mock-token-xyz',
        expiresAt: 1791761400,
      })
      expect(creditsMocks.consumeCredits).not.toHaveBeenCalled()
    })

    describe.each(['user', 'team'] as const)('%s balance admission', (scope) => {
      it.each<{ name: string; balance: { quota?: unknown; used?: unknown } | null }>([
        { name: 'exhausted', balance: { quota: 500, used: 500 } },
        { name: 'overdrawn', balance: { quota: 500, used: 501 } },
        { name: 'missing row', balance: null },
        { name: 'missing amounts', balance: {} },
        { name: 'missing quota', balance: { used: 100 } },
        { name: 'non-numeric quota', balance: { quota: 'invalid', used: 100 } },
        { name: 'non-numeric usage', balance: { quota: 500, used: 'invalid' } },
      ])('rejects $name with 402 before creating a token while the other scope has credits', async ({ balance }) => {
        creditsMocks.getCreditSummary.mockResolvedValueOnce({ ...creditSummary, [scope]: balance })

        await expect(tokenHandler(fakeEvent)).rejects.toMatchObject({
          statusCode: 402,
          statusMessage: 'INSUFFICIENT_CREDITS',
          data: { errorCode: 'INSUFFICIENT_CREDITS' },
        })
        expect(dashscopeMocks.createDashScopeEphemeralToken).not.toHaveBeenCalled()
        expect(creditsMocks.consumeCredits).not.toHaveBeenCalled()
      })
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
