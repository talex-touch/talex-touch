import type { H3Event } from 'h3'
import type { ProviderRegistryRecord } from '../../../../server/utils/providerRegistryStore'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SqliteD1Database } from '../../../helpers/d1-sqlite'
import { createSqliteD1 } from '../../../helpers/d1-sqlite'
import { resolveProviderCredential, storeProviderCredential } from '../../../../server/utils/providerCredentialStore'
import { createProviderRegistryEntry, getProviderRegistryEntry, updateProviderRegistryEntry } from '../../../../server/utils/providerRegistryStore'
import {
  MockD1Database,
  makeProviderRegistryEvent,
  tencentTranslateProviderBody,
} from '../../../helpers/provider-registry-test-utils'

const authMocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
}))

const h3Mocks = vi.hoisted(() => ({
  readBody: vi.fn(),
  getQuery: vi.fn(),
  getRouterParam: vi.fn(),
}))

const state = vi.hoisted(() => ({
  db: null as MockD1Database | null,
  realDb: null as SqliteD1Database | null,
}))

const importsMocks = vi.hoisted(() => ({
  useRuntimeConfig: vi.fn(() => ({
    providerRegistry: {
      secureStoreKey: 'unit-test-provider-registry-key',
    },
  })),
}))

const networkMocks = vi.hoisted(() => ({
  request: vi.fn(),
}))

const healthMocks = vi.hoisted(() => ({
  recordProviderHealthCheck: vi.fn(),
}))

const intelligenceHealthMocks = vi.hoisted(() => ({
  checkIntelligenceProviderRegistryEntry: vi.fn(),
  isIntelligenceProviderRegistryEntry: vi.fn((provider: ProviderRegistryRecord) => provider.metadata?.adapterKey === 'openai-compatible' || provider.metadata?.adapterKey === 'openai-responses'),
}))

vi.mock('h3', async () => {
  const actual = await vi.importActual<typeof import('h3')>('h3')
  return {
    ...actual,
    readBody: h3Mocks.readBody,
    getQuery: h3Mocks.getQuery,
    getRouterParam: h3Mocks.getRouterParam,
  }
})

vi.mock('../../../../server/utils/auth', () => authMocks)
vi.mock('../../../../server/utils/cloudflare', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../../server/utils/cloudflare')>()), readCloudflareBindings: () => state.realDb || state.db ? { DB: state.realDb ?? state.db } : undefined, }))
vi.mock('../../../../server/utils/providerHealthStore', () => healthMocks)
vi.mock('../../../../server/utils/intelligenceProviderHealthCheck', () => intelligenceHealthMocks)
vi.mock('#imports', () => importsMocks)
vi.mock('@talex-touch/utils/network', () => ({
  networkClient: {
    request: networkMocks.request,
  },
}))

let createProviderHandler: (event: any) => Promise<any>
let storeCredentialHandler: (event: any) => Promise<any>
let checkProviderHandler: (event: any) => Promise<any>
let fetchProviderModelsHandler: (event: any) => Promise<any>
let listProvidersHandler: (event: any) => Promise<any>
let patchProviderHandler: (event: any) => Promise<any>
let deleteProviderHandler: (event: any) => Promise<any>
let getProviderQuotaHandler: (event: any) => Promise<any>
let postProviderQuotaHandler: (event: any) => Promise<any>
let smokeProviderQuotaHandler: (event: any) => Promise<any>
let listCapabilitiesHandler: (event: any) => Promise<any>
let createCapabilityHandler: (event: any) => Promise<any>
let patchCapabilityHandler: (event: any) => Promise<any>
let deleteCapabilityHandler: (event: any) => Promise<any>
let tencentProviderUtils: typeof import('../../../../server/utils/tencentMachineTranslationProvider')

beforeAll(async () => {
  ;(globalThis as any).defineEventHandler = (fn: any) => fn
  createProviderHandler = (await import('../../../../server/api/dashboard/provider-registry/providers.post')).default as (event: any) => Promise<any>
  storeCredentialHandler = (await import('../../../../server/api/dashboard/provider-registry/credentials.post')).default as (event: any) => Promise<any>
  checkProviderHandler = (await import('../../../../server/api/dashboard/provider-registry/providers/[id]/check.post')).default as (event: any) => Promise<any>
  fetchProviderModelsHandler = (await import('../../../../server/api/dashboard/provider-registry/providers/[id]/models.post')).default as (event: any) => Promise<any>
  listProvidersHandler = (await import('../../../../server/api/dashboard/provider-registry/providers.get')).default as (event: any) => Promise<any>
  patchProviderHandler = (await import('../../../../server/api/dashboard/provider-registry/providers/[id].patch')).default as (event: any) => Promise<any>
  deleteProviderHandler = (await import('../../../../server/api/dashboard/provider-registry/providers/[id].delete')).default as (event: any) => Promise<any>
  getProviderQuotaHandler = (await import('../../../../server/api/dashboard/provider-registry/providers/[id]/quota.get')).default as (event: any) => Promise<any>
  postProviderQuotaHandler = (await import('../../../../server/api/dashboard/provider-registry/providers/[id]/quota.post')).default as (event: any) => Promise<any>
  smokeProviderQuotaHandler = (await import('../../../../server/api/dashboard/provider-registry/providers/[id]/quota/smoke.post')).default as (event: any) => Promise<any>
  listCapabilitiesHandler = (await import('../../../../server/api/dashboard/provider-registry/capabilities.get')).default as (event: any) => Promise<any>
  createCapabilityHandler = (await import('../../../../server/api/dashboard/provider-registry/providers/[id]/capabilities.post')).default as (event: any) => Promise<any>
  patchCapabilityHandler = (await import('../../../../server/api/dashboard/provider-registry/providers/[id]/capabilities/[capabilityId].patch')).default as (event: any) => Promise<any>
  deleteCapabilityHandler = (await import('../../../../server/api/dashboard/provider-registry/providers/[id]/capabilities/[capabilityId].delete')).default as (event: any) => Promise<any>
  tencentProviderUtils = await import('../../../../server/utils/tencentMachineTranslationProvider')
})

// Route/store fixtures supply only the request fields these handlers consume.
const makeEvent = () => makeProviderRegistryEvent() as unknown as H3Event

afterEach(() => {
  state.realDb?.close()
  state.realDb = null
})

describe('/api/dashboard/provider-registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.db = new MockD1Database()
    authMocks.requireAdmin.mockResolvedValue({
      userId: 'admin_1',
      user: { role: 'admin' },
    })
    importsMocks.useRuntimeConfig.mockReturnValue({
      providerRegistry: {
        secureStoreKey: 'unit-test-provider-registry-key',
      },
    })
    networkMocks.request.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        Response: {
          TargetText: '你好',
          RequestId: 'req-1',
        },
      },
      url: 'https://tmt.tencentcloudapi.com',
      ok: true,
    })
    healthMocks.recordProviderHealthCheck.mockResolvedValue(null)
    intelligenceHealthMocks.isIntelligenceProviderRegistryEntry.mockImplementation(
      (provider: ProviderRegistryRecord) => provider.metadata?.adapterKey === 'openai-compatible' || provider.metadata?.adapterKey === 'openai-responses',
    )
    intelligenceHealthMocks.checkIntelligenceProviderRegistryEntry.mockResolvedValue({
      success: true,
      providerId: 'prv_ai_registry',
      capability: 'chat.completion',
      latency: 33,
      endpoint: 'langchain:openai:chat',
      requestId: 'trace_ai_probe',
      message: 'Probe completed.',
    })
    h3Mocks.getQuery.mockReturnValue({})
    h3Mocks.getRouterParam.mockReturnValue('')
  })

  it('管理员创建腾讯云 provider 时按协议推导认证与真实 adapter 能力', async () => {
    h3Mocks.readBody.mockResolvedValue({
      ...tencentTranslateProviderBody(),
      vendor: 'openai',
      authType: 'none',
      capabilities: [{ capability: 'audio.transcribe' }],
    })

    const { provider } = await createProviderHandler(makeEvent())

    expect(provider).toMatchObject({ vendor: 'tencent-cloud', authType: 'secret_pair' })
    expect(provider.capabilities.map((item: { capability: string }) => item.capability).sort()).toEqual([
      'image.translate.e2e', 'text.translate',
    ])
  })

  it.each([
    { adapterKey: 'openai-compatible', vendor: 'custom', authType: 'api_key', capabilities: ['chat.completion', 'code.explain', 'code.review', 'content.extract', 'intent.detect', 'keywords.extract', 'text.rewrite', 'text.summarize', 'text.translate', 'vision.ocr'] },
    { adapterKey: 'openai-responses', vendor: 'custom', authType: 'api_key', capabilities: ['chat.completion', 'code.explain', 'code.review', 'content.extract', 'intent.detect', 'keywords.extract', 'text.rewrite', 'text.summarize', 'text.translate'] },
    { adapterKey: 'dashscope-filetrans-asr', vendor: 'dashscope', authType: 'api_key', capabilities: ['audio.transcribe'] },
    { adapterKey: 'dashscope-qwen-audio-asr', vendor: 'dashscope', authType: 'api_key', capabilities: ['audio.stt', 'audio.transcribe'] },
    { adapterKey: 'exchange-rate', vendor: 'exchange-rate', authType: 'none', capabilities: ['fx.convert', 'fx.rate.latest'] },
    { adapterKey: 'local-overlay', vendor: 'custom', authType: 'none', capabilities: ['overlay.render'] },
  ])('$adapterKey 只声明该 runtime adapter 可执行的能力', async ({ adapterKey, vendor, authType, capabilities }) => {
    h3Mocks.readBody.mockResolvedValue({
      name: `protocol-${adapterKey}`,
      displayName: adapterKey,
      vendor: 'tencent-cloud',
      authType: 'oauth',
      metadata: { adapterKey },
      capabilities: [{ capability: 'invented.capability' }],
    })

    const { provider } = await createProviderHandler(makeEvent())

    expect(provider).toMatchObject({ vendor, authType })
    expect(provider.capabilities.map((item: { capability: string }) => item.capability).sort()).toEqual(capabilities)
    if (authType === 'none')
      expect(provider.authRef).toBeNull()
  })

  it('拒绝明文密钥字段', async () => {
    h3Mocks.readBody.mockResolvedValue({ ...tencentTranslateProviderBody(), secretKey: 'plain-secret' })

    await expect(createProviderHandler(makeEvent())).rejects.toMatchObject({ statusCode: 400 })
    expect(state.db?.providers.size).toBe(0)
  })

  it('创建和编辑 provider 拒绝调用者直接写入 authRef', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const { provider } = await createProviderHandler(makeEvent())
    h3Mocks.getRouterParam.mockReturnValue(provider.id)
    const before = await getProviderRegistryEntry(makeEvent(), provider.id)

    h3Mocks.readBody.mockResolvedValue({ ...tencentTranslateProviderBody(), authRef: 'secure://providers/shared-slot' })
    await expect(createProviderHandler(makeEvent())).rejects.toMatchObject({ statusCode: 400 })
    h3Mocks.readBody.mockResolvedValue({ authRef: 'secure://providers/shared-slot' })
    await expect(patchProviderHandler(makeEvent())).rejects.toMatchObject({ statusCode: 400 })

    expect(await getProviderRegistryEntry(makeEvent(), provider.id)).toEqual(before)
    expect(state.db?.providers.size).toBe(1)
  })

  it('同名且共享历史 authRef 的 provider 轮换密钥时只更新目标 provider', async () => {
    state.realDb = createSqliteD1()
    const event = makeEvent()
    const legacyRef = 'secure://providers/legacy-shared-name'
    const original = { secretId: 'AKID-original', secretKey: 'original-secret' }
    const rotated = { secretId: 'AKID-rotated', secretKey: 'rotated-secret' }
    const first = await createProviderRegistryEntry(event, { ...tencentTranslateProviderBody(), authRef: legacyRef }, 'admin_1')
    const second = await createProviderRegistryEntry(event, { ...tencentTranslateProviderBody(), authRef: legacyRef }, 'admin_1')
    await storeProviderCredential(event, { authRef: legacyRef, authType: 'secret_pair', credentials: original }, 'admin_1')

    h3Mocks.readBody.mockResolvedValue({ providerId: first.id, credentials: rotated })
    expect(await storeCredentialHandler(event)).toEqual({ success: true, hasCredential: true })
    const changed = (await getProviderRegistryEntry(event, first.id))!
    const untouched = (await getProviderRegistryEntry(event, second.id))!

    expect(changed.authRef).toMatch(/^secure:\/\/providers\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(untouched).toEqual(second)
    expect(await resolveProviderCredential(event, changed.authRef!)).toMatchObject(rotated)
    expect(await resolveProviderCredential(event, untouched.authRef!)).toMatchObject(original)

    h3Mocks.readBody.mockResolvedValue({ providerId: first.id, credentials: { secretId: 'AKID-again', secretKey: 'again-secret' } })
    await storeCredentialHandler(event)
    const changedAgain = (await getProviderRegistryEntry(event, first.id))!
    expect(changedAgain.authRef).not.toBe(changed.authRef)
    expect(await resolveProviderCredential(event, changedAgain.authRef!)).toMatchObject({ secretId: 'AKID-again', secretKey: 'again-secret' })
    expect(await resolveProviderCredential(event, legacyRef)).toMatchObject(original)
    const encryptedRows = state.realDb.sqlite.prepare('SELECT encrypted_value FROM provider_secure_store').all()
    for (const secret of [original.secretId, original.secretKey, rotated.secretId, rotated.secretKey, 'again-secret'])
      expect(JSON.stringify(encryptedRows)).not.toContain(secret)
  })

  it('凭证 schema 由目标 provider 决定，伪造 authType 不能改变认证类型', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const { provider } = await createProviderHandler(makeEvent())
    h3Mocks.readBody.mockResolvedValue({ providerId: provider.id, authType: 'api_key', credentials: { apiKey: 'wrong-shape' } })

    await expect(storeCredentialHandler(makeEvent())).rejects.toMatchObject({ statusCode: 400, statusMessage: expect.stringContaining('secretId') })

    expect(state.db?.credentials.size).toBe(0)
    expect((await getProviderRegistryEntry(makeEvent(), provider.id))?.authRef).toBe(provider.authRef)
  })

  it('凭证接口拒绝没有 providerId 的裸 authRef 请求且不覆写已有凭证', async () => {
    state.realDb = createSqliteD1()
    const event = makeEvent()
    const authRef = 'secure://providers/do-not-overwrite'
    const original = { apiKey: 'original-api-key' }
    await storeProviderCredential(event, { authRef, authType: 'api_key', credentials: original }, 'admin_1')
    h3Mocks.readBody.mockResolvedValue({ authRef, authType: 'api_key', credentials: { apiKey: 'attacker-api-key' } })

    await expect(storeCredentialHandler(event)).rejects.toMatchObject({ statusCode: 404 })
    expect(await resolveProviderCredential(event, authRef)).toMatchObject(original)
  })

  it('未授权调用不能列出 provider 或轮换凭证', async () => {
    state.realDb = createSqliteD1()
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const { provider } = await createProviderHandler(makeEvent())
    const denied = Object.assign(new Error('Administrator required.'), { statusCode: 403 })
    authMocks.requireAdmin.mockRejectedValue(denied)
    h3Mocks.readBody.mockResolvedValue({ providerId: provider.id, credentials: { secretId: 'AKID-denied', secretKey: 'denied-secret' } })

    await expect(storeCredentialHandler(makeEvent())).rejects.toMatchObject({ statusCode: 403 })
    await expect(listProvidersHandler(makeEvent())).rejects.toMatchObject({ statusCode: 403 })
    expect(await getProviderRegistryEntry(makeEvent(), provider.id)).toEqual(provider)
    expect(await resolveProviderCredential(makeEvent(), provider.authRef)).toBeNull()
  })

  it('列表只投影凭证是否存在，即使密文不可解密也不读取或泄漏明文', async () => {
    state.realDb = createSqliteD1()
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const { provider } = await createProviderHandler(makeEvent())
    expect((await listProvidersHandler(makeEvent())).providers[0].hasCredential).toBe(false)
    h3Mocks.readBody.mockResolvedValue({ providerId: provider.id, credentials: { secretId: 'AKID-list-private', secretKey: 'list-private-secret' } })
    await storeCredentialHandler(makeEvent())
    const bound = (await getProviderRegistryEntry(makeEvent(), provider.id))!
    state.realDb.sqlite.prepare('UPDATE provider_secure_store SET encrypted_value = ? WHERE auth_ref = ?').run('unreadable-ciphertext', bound.authRef!)

    const result = await listProvidersHandler(makeEvent())

    expect(result.providers[0]).toMatchObject({ id: provider.id, hasCredential: true })
    const serialized = JSON.stringify(result)
    for (const secret of ['AKID-list-private', 'list-private-secret', 'unreadable-ciphertext', 'secure://providers/'])
      expect(serialized).not.toContain(secret)
  })

  it('生产环境缺少 secure-store master key 时拒绝绑定且保留旧引用', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const { provider } = await createProviderHandler(makeEvent())
    const originalNodeEnv = process.env.NODE_ENV
    const originalSecureStoreKey = process.env.PROVIDER_REGISTRY_SECURE_STORE_KEY
    try {
      process.env.NODE_ENV = 'production'
      delete process.env.PROVIDER_REGISTRY_SECURE_STORE_KEY
      importsMocks.useRuntimeConfig.mockReturnValue({ providerRegistry: {} })
      h3Mocks.readBody.mockResolvedValue({ providerId: provider.id, credentials: { secretId: 'AKID-unit-test', secretKey: 'secret-key-unit-test' } })

      await expect(storeCredentialHandler(makeEvent())).rejects.toMatchObject({ statusCode: 500, statusMessage: expect.stringContaining('secure store key') })
      expect((await getProviderRegistryEntry(makeEvent(), provider.id))?.authRef).toBe(provider.authRef)
      expect(state.db?.credentials.size).toBe(0)
    }
    finally {
      if (originalNodeEnv == null)
        delete process.env.NODE_ENV
      else
        process.env.NODE_ENV = originalNodeEnv
      if (originalSecureStoreKey == null)
        delete process.env.PROVIDER_REGISTRY_SECURE_STORE_KEY
      else
        process.env.PROVIDER_REGISTRY_SECURE_STORE_KEY = originalSecureStoreKey
    }
  })

  it('列表接口返回 provider 与 capabilities', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    await createProviderHandler(makeEvent())

    h3Mocks.getQuery.mockReturnValue({ vendor: 'tencent-cloud' })
    const result = await listProvidersHandler(makeEvent())

    expect(result.providers).toHaveLength(1)
    expect(result.providers[0]).toMatchObject({
      vendor: 'tencent-cloud',
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          capability: 'text.translate',
          adapter: expect.objectContaining({
            ready: true,
            matchedKey: 'tencent-translation:text.translate',
            reason: 'adapter-ready',
          }),
        }),
        expect.objectContaining({ capability: 'image.translate.e2e' }),
      ]),
    })
  })

  it.each(['anthropic', 'unsupported-adapter'])('拒绝没有真实 runtime adapter 的协议 %s', async (adapterKey) => {
    h3Mocks.readBody.mockResolvedValue({ ...tencentTranslateProviderBody(), metadata: { adapterKey } })

    await expect(createProviderHandler(makeEvent())).rejects.toMatchObject({ statusCode: 400 })
    expect(state.db?.providers.size).toBe(0)
  })

  it('capabilities 接口支持按 vendor 查询', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    await createProviderHandler(makeEvent())

    h3Mocks.getQuery.mockReturnValue({ vendor: 'tencent-cloud' })
    const result = await listCapabilitiesHandler(makeEvent())

    expect(result.capabilities.map((item: any) => item.capability)).toEqual([
      'image.translate.e2e',
      'text.translate',
    ])
  })

  it('capabilities 接口返回 capability adapter readiness', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    await createProviderHandler(makeEvent())

    h3Mocks.getQuery.mockReturnValue({ vendor: 'tencent-cloud' })
    const result = await listCapabilitiesHandler(makeEvent())

    expect(result.capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability: 'text.translate',
        adapter: expect.objectContaining({
          ready: true,
          matchedKey: 'tencent-translation:text.translate',
          reason: 'adapter-ready',
        }),
      }),
    ]))
  })

  it('Provider quota API 按 provider id 保存并返回 request/token 限制', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const created = await createProviderHandler(makeEvent())

    h3Mocks.getRouterParam.mockReturnValue(created.provider.id)
    h3Mocks.readBody.mockResolvedValue({
      name: 'Tencent MT quota',
      enabled: true,
      limits: {
        windowDays: 14,
        maxRequests: 250,
        maxTokens: 500000,
      },
      warningThreshold: 70,
      config: {
        source: 'provider-registry-panel',
      },
    })

    const saved = await postProviderQuotaHandler(makeEvent())
    const listed = await getProviderQuotaHandler(makeEvent())

    expect(saved.quota).toMatchObject({
      configType: 'intelligence_provider_quota',
      name: 'Tencent MT quota',
      targetId: created.provider.id,
      provider: 'tencent-cloud',
      enabled: true,
      limits: {
        windowDays: 14,
        maxRequests: 250,
        maxTokens: 500000,
      },
      warningThreshold: 70,
      config: {
        source: 'provider-registry-panel',
      },
    })
    expect(listed.quota).toMatchObject({
      id: saved.quota.id,
      targetId: created.provider.id,
      provider: 'tencent-cloud',
      limits: {
        windowDays: 14,
        maxRequests: 250,
        maxTokens: 500000,
      },
    })
    expect(saved.evaluations).toEqual([
      expect.objectContaining({
        configId: saved.quota.id,
        providerId: created.provider.id,
        provider: 'tencent-cloud',
        status: 'ok',
        usage: {
          requests: 0,
          tokens: 0,
        },
        remaining: {
          requests: 250,
          tokens: 500000,
        },
      }),
    ])
    expect(listed.evaluations).toEqual(saved.evaluations)
    expect(state.db?.governanceConfigs.size).toBe(1)
  })

  it('Provider quota API 返回同一 provider 的多 channel 配额', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const created = await createProviderHandler(makeEvent())
    const now = new Date().toISOString()
    const rows = [
      {
        id: `quota_text_${created.provider.id}`,
        channel: 'text.translate',
        maxRequests: 100,
      },
      {
        id: `quota_image_${created.provider.id}`,
        channel: 'image.translate',
        maxRequests: 20,
      },
    ]
    for (const row of rows) {
      state.db?.governanceConfigs.set(row.id, {
        id: row.id,
        config_type: 'intelligence_provider_quota',
        name: `${row.channel} quota`,
        owner_scope: 'system',
        owner_id: '',
        target_id: created.provider.id,
        channel: row.channel,
        provider: 'tencent-cloud',
        enabled: 1,
        limits_json: JSON.stringify({ windowDays: 30, maxRequests: row.maxRequests }),
        warning_threshold: 80,
        config_json: JSON.stringify({ source: 'provider-registry-panel' }),
        created_by: 'admin',
        created_at: now,
        updated_at: now,
      })
    }

    h3Mocks.getRouterParam.mockReturnValue(created.provider.id)
    const listed = await getProviderQuotaHandler(makeEvent())

    expect(listed.quota).toEqual(expect.objectContaining({
      configType: 'intelligence_provider_quota',
      targetId: created.provider.id,
    }))
    expect(listed.quotas).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: created.provider.id,
        channel: 'text.translate',
        limits: { windowDays: 30, maxRequests: 100 },
      }),
      expect.objectContaining({
        targetId: created.provider.id,
        channel: 'image.translate',
        limits: { windowDays: 30, maxRequests: 20 },
      }),
    ]))
    expect(listed.evaluations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: created.provider.id,
        channel: 'text.translate',
        remaining: expect.objectContaining({ requests: 100 }),
      }),
      expect.objectContaining({
        providerId: created.provider.id,
        channel: 'image.translate',
        remaining: expect.objectContaining({ requests: 20 }),
      }),
    ]))
  })

  it('Provider quota API 更新同一 provider 配额而不是重复创建', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const created = await createProviderHandler(makeEvent())

    h3Mocks.getRouterParam.mockReturnValue(created.provider.id)
    h3Mocks.readBody.mockResolvedValue({
      name: 'Initial provider quota',
      limits: {
        windowDays: 30,
        maxRequests: 100,
      },
    })
    const initial = await postProviderQuotaHandler(makeEvent())

    h3Mocks.readBody.mockResolvedValue({
      name: 'Updated provider quota',
      enabled: false,
      limits: {
        windowDays: 7,
        maxTokens: 9000,
      },
    })
    const updated = await postProviderQuotaHandler(makeEvent())

    expect(updated.quota).toMatchObject({
      id: initial.quota.id,
      name: 'Updated provider quota',
      enabled: false,
      limits: {
        windowDays: 7,
        maxTokens: 9000,
      },
    })
    expect(state.db?.governanceConfigs.size).toBe(1)
  })

  it('Provider quota smoke 记录受控消费并产生 fail-closed 证据', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const created = await createProviderHandler(makeEvent())

    h3Mocks.getRouterParam.mockReturnValue(created.provider.id)
    h3Mocks.readBody.mockResolvedValue({
      name: 'Smoke provider quota',
      channel: 'text.translate',
      limits: {
        windowDays: 30,
        maxRequests: 1,
        maxTokens: 10,
      },
    })
    await postProviderQuotaHandler(makeEvent())

    h3Mocks.readBody.mockResolvedValue({
      channel: 'text.translate',
      mode: 'consume',
      tokenQuantity: 10,
    })
    const consumed = await smokeProviderQuotaHandler(makeEvent())

    expect(consumed.result).toMatchObject({
      providerId: created.provider.id,
      channel: 'text.translate',
      mode: 'consume',
      status: 'blocked',
      reason: 'request-quota-exceeded',
      requestRecorded: true,
      tokensRecorded: 10,
      evaluation: expect.objectContaining({
        providerId: created.provider.id,
        channel: 'text.translate',
        status: 'blocked',
        usage: {
          requests: 1,
          tokens: 10,
        },
        remaining: {
          requests: 0,
          tokens: 0,
        },
      }),
    })

    h3Mocks.readBody.mockResolvedValue({
      channel: 'text.translate',
      mode: 'dry-run',
    })
    const dryRun = await smokeProviderQuotaHandler(makeEvent())
    expect(dryRun.result).toMatchObject({
      providerId: created.provider.id,
      channel: 'text.translate',
      mode: 'dry-run',
      status: 'failed',
      reason: 'request-quota-exceeded',
      requestRecorded: false,
      tokensRecorded: 0,
    })

    const events = [...(state.db?.governanceEvents ?? [])]
    const serialized = JSON.stringify(events)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'provider.quota_smoke.blocked',
        resource_id: created.provider.id,
        channel: 'text.translate',
      }),
      expect.objectContaining({
        action: 'provider.quota_smoke.failed',
        resource_id: created.provider.id,
        channel: 'text.translate',
      }),
    ]))
    expect(serialized).not.toContain('admin_1')
    expect(serialized).not.toContain('secret-key-unit-test')
    expect(serialized).not.toContain('secure://providers')
  })

  it('切换协议时同步更新认证与能力，不保留旧协议或调用者伪造能力', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const created = await createProviderHandler(makeEvent())
    h3Mocks.getRouterParam.mockReturnValue(created.provider.id)
    h3Mocks.readBody.mockResolvedValue({
      status: 'degraded',
      vendor: 'tencent-cloud',
      authType: 'secret_pair',
      metadata: { adapterKey: 'exchange-rate', owner: 'ops' },
      capabilities: [{ capability: 'text.translate' }],
    })

    const { provider } = await patchProviderHandler(makeEvent())

    expect(provider).toMatchObject({ id: created.provider.id, vendor: 'exchange-rate', authType: 'none', authRef: null, status: 'degraded', metadata: { adapterKey: 'exchange-rate', owner: 'ops' } })
    expect(provider.capabilities.map((item: { capability: string }) => item.capability).sort()).toEqual(['fx.convert', 'fx.rate.latest'])
  })

  it('可以通过独立 API 新增 adapter 支持的 provider capability', async () => {
    h3Mocks.readBody.mockResolvedValue({
      name: 'openai-capability-provider',
      displayName: 'OpenAI Capability Provider',
      vendor: 'openai',
      status: 'enabled',
      authType: 'api_key',
      ownerScope: 'system',
      endpoint: 'https://api.openai.com/v1',
      metadata: { adapterKey: 'openai-compatible', models: ['gpt-4.1-mini'], defaultModel: 'gpt-4.1-mini' },
      capabilities: [{ capability: 'text.chat' }],
    })
    const created = await createProviderHandler(makeEvent())
    await updateProviderRegistryEntry(makeEvent(), created.provider.id, { capabilities: [{ capability: 'chat.completion' }] })

    h3Mocks.getRouterParam.mockImplementation((_event, name) => {
      if (name === 'id')
        return created.provider.id
      return ''
    })
    h3Mocks.readBody.mockResolvedValue({
      capability: 'vision.ocr',
      schemaRef: 'nexus://schemas/provider/vision-ocr.v1',
      metering: { unit: 'image' },
      constraints: { maxImageBytes: 5_242_880 },
      metadata: { providerModel: 'gpt-4.1-mini' },
    })

    const result = await createCapabilityHandler(makeEvent())
    expect(result.capability).toMatchObject({
      providerId: created.provider.id,
      capability: 'vision.ocr',
      schemaRef: 'nexus://schemas/provider/vision-ocr.v1',
      metering: { unit: 'image' },
      constraints: { maxImageBytes: 5_242_880 },
      metadata: { providerModel: 'gpt-4.1-mini' },
    })
  })

  it('独立 capability API 可以局部更新 schemaRef、metering、constraints 与 metadata', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const created = await createProviderHandler(makeEvent())
    const textCapability = created.provider.capabilities.find((item: any) => item.capability === 'text.translate')

    h3Mocks.getRouterParam.mockImplementation((_event, name) => {
      if (name === 'id')
        return created.provider.id
      if (name === 'capabilityId')
        return textCapability.id
      return ''
    })
    h3Mocks.readBody.mockResolvedValue({
      schemaRef: 'nexus://schemas/provider/text-translate.v2',
      metering: {
        unit: 'character',
        unitCost: 0.02,
      },
      constraints: {
        maxTextLength: 8000,
        sourceLanguages: ['auto', 'en'],
      },
      metadata: {
        qualityTier: 'premium',
      },
    })

    const result = await patchCapabilityHandler(makeEvent())

    expect(result.capability).toMatchObject({
      id: textCapability.id,
      providerId: created.provider.id,
      capability: 'text.translate',
      schemaRef: 'nexus://schemas/provider/text-translate.v2',
      metering: {
        unit: 'character',
        unitCost: 0.02,
      },
      constraints: {
        maxTextLength: 8000,
        sourceLanguages: ['auto', 'en'],
      },
      metadata: {
        qualityTier: 'premium',
      },
    })
  })

  it('独立 capability API 可以删除单个 capability 而不影响同 provider 其他能力', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const created = await createProviderHandler(makeEvent())
    const imageCapability = created.provider.capabilities.find((item: { capability: string }) => item.capability === 'image.translate.e2e')

    h3Mocks.getRouterParam.mockImplementation((_event, name) => {
      if (name === 'id')
        return created.provider.id
      if (name === 'capabilityId')
        return imageCapability.id
      return ''
    })

    const deleted = await deleteCapabilityHandler(makeEvent())
    h3Mocks.getQuery.mockReturnValue({ providerId: created.provider.id })
    const listed = await listCapabilitiesHandler(makeEvent())

    expect(deleted).toEqual({ success: true })
    expect(listed.capabilities.map((item: any) => item.capability)).toEqual([
      'text.translate',
    ])
  })

  it('独立 capability API 对不存在 provider 或 capability 返回 404', async () => {
    h3Mocks.getRouterParam.mockImplementation((_event, name) => {
      if (name === 'id')
        return 'missing-provider'
      return ''
    })
    h3Mocks.readBody.mockResolvedValue({
      capability: 'vision.ocr',
    })

    await expect(createCapabilityHandler(makeEvent())).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Provider registry entry not found.',
    })

    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const created = await createProviderHandler(makeEvent())
    h3Mocks.getRouterParam.mockImplementation((_event, name) => {
      if (name === 'id')
        return created.provider.id
      if (name === 'capabilityId')
        return 'missing-capability'
      return ''
    })
    h3Mocks.readBody.mockResolvedValue({ metadata: { qualityTier: 'premium' } })

    await expect(patchCapabilityHandler(makeEvent())).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Provider capability not found.',
    })
    await expect(deleteCapabilityHandler(makeEvent())).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Provider capability not found.',
    })
  })

  it('独立 capability API 拒绝重复 capability', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const created = await createProviderHandler(makeEvent())
    const imageCapability = created.provider.capabilities.find((item: { capability: string }) => item.capability === 'image.translate.e2e')

    h3Mocks.getRouterParam.mockImplementation((_event, name) => {
      if (name === 'id')
        return created.provider.id
      if (name === 'capabilityId')
        return imageCapability.id
      return ''
    })
    h3Mocks.readBody.mockResolvedValue({
      capability: 'text.translate',
    })

    await expect(patchCapabilityHandler(makeEvent())).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Provider capability already exists.',
    })

    h3Mocks.readBody.mockResolvedValue({
      capability: 'text.translate',
      schemaRef: 'nexus://schemas/provider/text-translate.v1',
    })

    await expect(createCapabilityHandler(makeEvent())).rejects.toMatchObject({
      statusCode: 409,
      statusMessage: 'Provider capability already exists.',
    })
  })

  it('腾讯云机器翻译 provider check 会解析 authRef 并注入 TC3 签名请求', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const created = await createProviderHandler(makeEvent())

    h3Mocks.readBody.mockResolvedValue({
      providerId: created.provider.id,
      credentials: {
        secretId: 'AKID-unit-test',
        secretKey: 'secret-key-unit-test',
      },
    })
    await storeCredentialHandler(makeEvent())

    h3Mocks.getRouterParam.mockReturnValue(created.provider.id)
    h3Mocks.readBody.mockResolvedValue({ capability: 'text.translate' })

    const result = await checkProviderHandler(makeEvent())
    const request = networkMocks.request.mock.calls.at(-1)?.[0]

    expect(result).toMatchObject({
      success: true,
      providerId: created.provider.id,
      capability: 'text.translate',
      endpoint: 'https://tmt.tencentcloudapi.com',
      requestId: 'req-1',
    })
    expect(JSON.stringify(result)).not.toContain('secret-key-unit-test')
    expect(healthMocks.recordProviderHealthCheck).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: created.provider.id }),
      expect.objectContaining({
        success: true,
        providerId: created.provider.id,
        capability: 'text.translate',
        requestId: 'req-1',
      }),
    )
    expect(request).toMatchObject({
      method: 'POST',
      url: 'https://tmt.tencentcloudapi.com',
      headers: expect.objectContaining({
        Authorization: expect.stringContaining('TC3-HMAC-SHA256'),
        'X-TC-Action': 'TextTranslate',
        'X-TC-Version': '2018-03-21',
        'X-TC-Region': 'ap-shanghai',
      }),
    })
    expect(request.headers.Authorization).toContain('/tmt/tc3_request')
    expect(request.body).toContain('"SourceText":"hello"')
  })

  it('生产环境缺少 secure-store master key 时 provider check 拒绝解析凭证', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const created = await createProviderHandler(makeEvent())

    h3Mocks.readBody.mockResolvedValue({
      providerId: created.provider.id,
      credentials: {
        secretId: 'AKID-unit-test',
        secretKey: 'secret-key-unit-test',
      },
    })
    await storeCredentialHandler(makeEvent())

    const originalNodeEnv = process.env.NODE_ENV
    const originalSecureStoreKey = process.env.PROVIDER_REGISTRY_SECURE_STORE_KEY
    try {
      process.env.NODE_ENV = 'production'
      delete process.env.PROVIDER_REGISTRY_SECURE_STORE_KEY
      importsMocks.useRuntimeConfig.mockReturnValue({
        providerRegistry: {},
      })
      h3Mocks.getRouterParam.mockReturnValue(created.provider.id)
      h3Mocks.readBody.mockResolvedValue({ capability: 'text.translate' })

      await expect(checkProviderHandler(makeEvent())).rejects.toMatchObject({
        statusCode: 500,
        statusMessage: expect.stringContaining('secure store key'),
      })
      expect(networkMocks.request).not.toHaveBeenCalled()
    }
    finally {
      process.env.NODE_ENV = originalNodeEnv
      if (originalSecureStoreKey == null)
        delete process.env.PROVIDER_REGISTRY_SECURE_STORE_KEY
      else
        process.env.PROVIDER_REGISTRY_SECURE_STORE_KEY = originalSecureStoreKey
    }
  })

  it('腾讯云 provider check 缺失 secure credential 时返回 AUTH_REQUIRED 失败结果', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const created = await createProviderHandler(makeEvent())

    h3Mocks.getRouterParam.mockReturnValue(created.provider.id)
    h3Mocks.readBody.mockResolvedValue({})

    const result = await checkProviderHandler(makeEvent())

    expect(result).toMatchObject({
      success: false,
      error: expect.objectContaining({
        code: 'AUTH_REQUIRED',
      }),
    })
    expect(networkMocks.request).not.toHaveBeenCalled()
  })

  it('腾讯云 provider check 会映射供应商错误响应', async () => {
    networkMocks.request.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        Response: {
          RequestId: 'req-error',
          Error: {
            Code: 'AuthFailure.SecretIdNotFound',
            Message: 'secret id not found',
          },
        },
      },
      url: 'https://tmt.tencentcloudapi.com',
      ok: true,
    })
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const created = await createProviderHandler(makeEvent())

    h3Mocks.readBody.mockResolvedValue({
      providerId: created.provider.id,
      credentials: {
        secretId: 'AKID-unit-test',
        secretKey: 'secret-key-unit-test',
      },
    })
    await storeCredentialHandler(makeEvent())

    h3Mocks.getRouterParam.mockReturnValue(created.provider.id)
    h3Mocks.readBody.mockResolvedValue({})
    const result = await checkProviderHandler(makeEvent())

    expect(result).toMatchObject({
      success: false,
      requestId: 'req-error',
      error: expect.objectContaining({
        code: 'AuthFailure.SecretIdNotFound',
        message: 'secret id not found',
      }),
    })
  })

  it('AI registry provider check 复用 Intelligence provider 探活并记录 health', async () => {
    h3Mocks.readBody.mockResolvedValue({
      name: 'ip_ai_provider_1',
      displayName: 'OpenAI Main',
      vendor: 'openai',
      status: 'enabled',
      authType: 'api_key',
      ownerScope: 'user',
      ownerId: 'admin_1',
      endpoint: 'https://api.openai.com/v1',
      metadata: {
        source: 'provider-registry',
        intelligenceType: 'openai',
        adapterKey: 'openai-compatible',
      },
      capabilities: [
        {
          capability: 'chat.completion',
          schemaRef: 'nexus://schemas/provider/chat-completion.v1',
          metering: { unit: 'token' },
        },
      ],
    })
    const created = await createProviderHandler(makeEvent())

    h3Mocks.getRouterParam.mockReturnValue(created.provider.id)
    h3Mocks.readBody.mockResolvedValue({
      capability: 'chat.completion',
      model: 'gpt-4.1-mini',
      prompt: 'ping',
      timeoutMs: 7000,
    })
    intelligenceHealthMocks.checkIntelligenceProviderRegistryEntry.mockResolvedValueOnce({
      success: true,
      providerId: created.provider.id,
      capability: 'chat.completion',
      latency: 33,
      endpoint: 'langchain:openai:chat',
      requestId: 'trace_ai_probe',
      message: 'Probe completed.',
    })

    const result = await checkProviderHandler(makeEvent())

    expect(intelligenceHealthMocks.checkIntelligenceProviderRegistryEntry).toHaveBeenCalledWith(
      expect.anything(),
      'admin_1',
      expect.objectContaining({
        id: created.provider.id,
        metadata: expect.objectContaining({
          source: 'provider-registry',
          adapterKey: 'openai-compatible',
        }),
      }),
      {
        capability: 'chat.completion',
        model: 'gpt-4.1-mini',
        prompt: 'ping',
        timeoutMs: 7000,
      },
    )
    expect(result).toMatchObject({
      success: true,
      providerId: created.provider.id,
      capability: 'chat.completion',
      endpoint: 'langchain:openai:chat',
      requestId: 'trace_ai_probe',
    })
    expect(healthMocks.recordProviderHealthCheck).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: created.provider.id, vendor: created.provider.vendor }),
      expect.objectContaining({
        success: true,
        providerId: created.provider.id,
        capability: 'chat.completion',
      }),
    )
  })

  it('Provider Registry models endpoint 使用安全凭证拉取 AI 模型且不返回密钥', async () => {
    h3Mocks.readBody.mockResolvedValue({
      name: 'ip_ai_models_provider',
      displayName: 'OpenAI Models',
      vendor: 'openai',
      status: 'enabled',
      authType: 'api_key',
      ownerScope: 'user',
      ownerId: 'admin_1',
      endpoint: 'https://api.openai.com/v1',
      metadata: {
        source: 'provider-registry',
        intelligenceType: 'openai',
        adapterKey: 'openai-compatible',
      },
      capabilities: [
        {
          capability: 'chat.completion',
          schemaRef: 'nexus://schemas/provider/chat-completion.v1',
          metering: { unit: 'token' },
        },
      ],
    })
    const created = await createProviderHandler(makeEvent())

    h3Mocks.readBody.mockResolvedValue({
      providerId: created.provider.id,
      credentials: {
        apiKey: 'sk-models-unit-test',
      },
    })
    await storeCredentialHandler(makeEvent())

    networkMocks.request.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        data: [
          { id: 'gpt-4.1-mini' },
          { id: 'gpt-4.1' },
        ],
      },
      url: 'https://api.openai.com/v1/models',
      ok: true,
    })
    h3Mocks.getRouterParam.mockReturnValue(created.provider.id)

    const result = await fetchProviderModelsHandler(makeEvent())

    expect(networkMocks.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      url: 'https://api.openai.com/v1/models',
      headers: expect.objectContaining({
        Authorization: 'Bearer sk-models-unit-test',
      }),
    }))
    expect(result).toEqual({ models: ['gpt-4.1-mini', 'gpt-4.1'] })
    expect(JSON.stringify(result)).not.toContain('sk-models-unit-test')
  })

  it('AI registry provider check 支持 vision.ocr probe 输入透传', async () => {
    h3Mocks.readBody.mockResolvedValue({
      name: 'ip_ai_vision_provider',
      displayName: 'OpenAI Vision',
      vendor: 'openai',
      status: 'enabled',
      authType: 'api_key',
      ownerScope: 'user',
      ownerId: 'admin_1',
      endpoint: 'https://api.openai.com/v1',
      metadata: {
        source: 'provider-registry',
        intelligenceType: 'openai',
        adapterKey: 'openai-compatible',
      },
      capabilities: [
        {
          capability: 'vision.ocr',
          schemaRef: 'nexus://schemas/provider/vision-ocr.v1',
          metering: { unit: 'image' },
        },
      ],
    })
    const created = await createProviderHandler(makeEvent())

    h3Mocks.getRouterParam.mockReturnValue(created.provider.id)
    h3Mocks.readBody.mockResolvedValue({
      capability: 'vision.ocr',
      imageDataUrl: 'data:image/png;base64,abc123',
      language: 'en',
      prompt: 'ocr probe',
      timeoutMs: 7000,
    })
    intelligenceHealthMocks.checkIntelligenceProviderRegistryEntry.mockResolvedValueOnce({
      success: true,
      providerId: created.provider.id,
      capability: 'vision.ocr',
      latency: 41,
      endpoint: 'https://api.openai.com/v1',
      requestId: 'req_ocr_probe',
      message: 'Intelligence vision OCR check succeeded.',
    })

    const result = await checkProviderHandler(makeEvent())

    expect(intelligenceHealthMocks.checkIntelligenceProviderRegistryEntry).toHaveBeenCalledWith(
      expect.anything(),
      'admin_1',
      expect.objectContaining({ id: created.provider.id }),
      {
        capability: 'vision.ocr',
        model: undefined,
        prompt: 'ocr probe',
        imageDataUrl: 'data:image/png;base64,abc123',
        imageBase64: undefined,
        language: 'en',
        timeoutMs: 7000,
      },
    )
    expect(result).toMatchObject({
      success: true,
      providerId: created.provider.id,
      capability: 'vision.ocr',
      requestId: 'req_ocr_probe',
    })
    expect(healthMocks.recordProviderHealthCheck).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: created.provider.id, vendor: created.provider.vendor }),
      expect.objectContaining({
        capability: 'vision.ocr',
        requestId: 'req_ocr_probe',
      }),
    )
  })

  it('腾讯云图片翻译 adapter 将标准 payload 转换为 ImageTranslateLLM 请求', async () => {
    networkMocks.request.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        Response: {
          Data: 'translated-image-base64',
          Source: 'auto',
          Target: 'zh',
          SourceText: 'hello',
          TargetText: '你好',
          Angle: 0,
          TransDetails: [{ source: 'hello', target: '你好' }],
          RequestId: 'req-image-translate',
        },
      },
      url: 'https://tmt.tencentcloudapi.com',
      ok: true,
    })
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const created = await createProviderHandler(makeEvent())

    h3Mocks.readBody.mockResolvedValue({
      providerId: created.provider.id,
      credentials: {
        secretId: 'AKID-unit-test',
        secretKey: 'secret-key-unit-test',
      },
    })
    await storeCredentialHandler(makeEvent())

    const boundProvider = (await getProviderRegistryEntry(makeEvent(), created.provider.id))!
    const result = await tencentProviderUtils.invokeTencentImageTranslate(makeEvent(), boundProvider, {
      imageBase64: 'source-image-base64',
      targetLang: 'zh',
    }, 'image.translate.e2e')
    const request = networkMocks.request.mock.calls.at(-1)?.[0]

    expect(result).toMatchObject({
      translatedImageBase64: 'translated-image-base64',
      sourceLang: 'auto',
      targetLang: 'zh',
      sourceText: 'hello',
      targetText: '你好',
      providerRequestId: 'req-image-translate',
      usage: {
        unit: 'image',
        quantity: 1,
        billable: true,
        estimated: true,
      },
    })
    expect(JSON.stringify(result)).not.toContain('secret-key-unit-test')
    expect(request).toMatchObject({
      method: 'POST',
      url: 'https://tmt.tencentcloudapi.com',
      headers: expect.objectContaining({
        Authorization: expect.stringContaining('TC3-HMAC-SHA256'),
        'X-TC-Action': 'ImageTranslateLLM',
        'X-TC-Version': '2018-03-21',
        'X-TC-Region': 'ap-shanghai',
      }),
    })
    expect(request.body).toContain('"Data":"source-image-base64"')
    expect(request.body).toContain('"Target":"zh"')
  })

  it('删除 provider 时同步删除 capabilities', async () => {
    h3Mocks.readBody.mockResolvedValue(tencentTranslateProviderBody())
    const created = await createProviderHandler(makeEvent())

    h3Mocks.getRouterParam.mockReturnValue(created.provider.id)
    const deleted = await deleteProviderHandler(makeEvent())
    const listed = await listProvidersHandler(makeEvent())
    const capabilities = await listCapabilitiesHandler(makeEvent())

    expect(deleted).toEqual({ success: true })
    expect(listed.providers).toEqual([])
    expect(capabilities.capabilities).toEqual([])
  })
})
