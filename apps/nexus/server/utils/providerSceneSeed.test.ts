import type { H3Event } from 'h3'
import type { SqliteD1Database } from '../../test/helpers/d1-sqlite'
import type { ProviderRegistryRecord } from './providerRegistryStore'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../../test/helpers/d1-sqlite'
import { createProviderRegistryEntry, getProviderRegistryEntry, listProviderRegistryEntries } from './providerRegistryStore'
import { createSceneRegistryEntry, deleteSceneRegistryEntry, getSceneRegistryEntry, listSceneRegistryEntries, withSceneRegistryReadiness } from './sceneRegistryStore'
import { ensureDefaultProviderSceneSeed, ensureDefaultProviderSceneSeedForMiss } from './providerSceneSeed'

let db: SqliteD1Database

function eventFor(): H3Event {
  // Store APIs only consume this fixture's Cloudflare binding, not an HTTP socket.
  return { context: { cloudflare: { env: { DB: db } } } } as unknown as H3Event
}

async function provider(name: string, options: {
  adapterKey?: string
  models?: string[]
  defaultModel?: string
  ownerScope?: 'system' | 'user'
} = {}): Promise<ProviderRegistryRecord> {
  return createProviderRegistryEntry(eventFor(), {
    name,
    displayName: name,
    vendor: 'custom',
    authType: 'api_key',
    authRef: `secure://providers/${name}`,
    status: 'enabled',
    ownerScope: options.ownerScope ?? 'system',
    ownerId: options.ownerScope === 'user' ? 'user_1' : null,
    endpoint: 'https://provider.example.test/v1',
    metadata: {
      adapterKey: options.adapterKey ?? 'openai-compatible',
      ...(options.models ? { models: options.models } : {}),
      ...(options.defaultModel ? { defaultModel: options.defaultModel } : {}),
    },
    capabilities: [],
  }, 'admin_1')
}

beforeEach(() => {
  db = createSqliteD1()
})

afterEach(() => {
  vi.useRealTimers()
  db.close()
})

describe('providerSceneSeed', () => {
  it('空库也建立产品场景，缺少上游能力的场景对外呈现 degraded', async () => {
    await ensureDefaultProviderSceneSeed(eventFor())

    const entries = await listSceneRegistryEntries(eventFor())
    const productContracts = [
      ['corebox.screenshot.translate', ['vision.ocr', 'text.translate']],
      ['corebox.selection.translate', ['text.translate']],
      ['corebox.fx.latest', ['fx.rate.latest']],
      ['corebox.fx.convert', ['fx.convert']],
      ['nexus.intelligence.chat.completion', ['chat.completion']],
      ['nexus.intelligence.text.translate', ['text.translate']],
      ['nexus.intelligence.vision.ocr', ['vision.ocr']],
      ['nexus.intelligence.audio.transcribe', ['audio.transcribe']],
      ['nexus.intelligence.text.summarize', ['text.summarize']],
      ['nexus.intelligence.text.rewrite', ['text.rewrite']],
      ['nexus.intelligence.content.extract', ['content.extract']],
      ['nexus.intelligence.code.explain', ['code.explain']],
      ['nexus.intelligence.code.review', ['code.review']],
    ] as const
    for (const [id, missing] of productContracts) {
      const entry = entries.find(scene => scene.id === id)
      expect(entry, id).toBeDefined()
      const projected = await withSceneRegistryReadiness(eventFor(), entry!)
      expect(projected.readiness.status, id).toBe('degraded')
      expect(projected.readiness.missingCapabilities, id).toEqual([...missing])
    }
    expect(entries.filter(scene => scene.id === 'nexus.intelligence.chat.completion')).toHaveLength(1)
    expect(entries.some(scene => scene.id === 'nexus.intelligence.text.chat')).toBe(false)
    const overlay = (await listProviderRegistryEntries(eventFor())).filter(item => item.capabilities.some(capability => capability.capability === 'overlay.render'))
    expect(overlay).toHaveLength(1)
    const screenshot = entries.find(scene => scene.id === 'corebox.screenshot.translate')!
    expect(screenshot.bindings.map(binding => [binding.providerId, binding.capability])).toEqual([[overlay[0]!.id, 'overlay.render']])
  })

  it('新增 scene bindings 不钉死 provider 的默认模型，未选择默认模型也不会自动选首项', async () => {
    const chosen = await provider('chosen-model', { models: ['model-a', 'model-b'], defaultModel: 'model-b' })
    const unchosen = await provider('unchosen-model', { models: ['model-x', 'model-y'] })

    await ensureDefaultProviderSceneSeed(eventFor())

    const chat = (await getSceneRegistryEntry(eventFor(), 'nexus.intelligence.chat.completion'))!
    expect(chat.bindings.map(binding => binding.providerId).sort()).toEqual([chosen.id, unchosen.id].sort())
    expect(chat.bindings.map(binding => binding.model)).toEqual([null, null])
    expect((await getProviderRegistryEntry(eventFor(), chosen.id))!.metadata).toMatchObject({ models: ['model-a', 'model-b'], defaultModel: 'model-b' })
    const unchosenAfter = (await getProviderRegistryEntry(eventFor(), unchosen.id))!
    expect(unchosenAfter.metadata?.models).toEqual(['model-x', 'model-y'])
    expect(unchosenAfter.metadata?.defaultModel ?? null).toBeNull()
    const selection = (await getSceneRegistryEntry(eventFor(), 'corebox.selection.translate'))!
    expect(selection.bindings.map(binding => binding.model)).toEqual([null])
  })

  it.each([
    { sceneId: 'corebox.selection.translate', capability: 'text.translate', owner: 'core-app' },
    { sceneId: 'corebox.screenshot.translate', capability: 'text.translate', owner: 'core-app' },
    { sceneId: 'nexus.intelligence.chat.completion', capability: 'chat.completion', owner: 'nexus' },
  ] as const)('seed 保留 $sceneId 的手动路由和策略，不追加同能力的另一个 provider', async ({ sceneId, capability, owner }) => {
    const preferred = await provider('a-seed-preferred', { models: ['automatic-model'], defaultModel: 'automatic-model' })
    const manual = await provider('z-manual', { models: ['manual-model'], defaultModel: 'manual-model' })
    await createSceneRegistryEntry(eventFor(), {
      id: sceneId,
      displayName: 'Operator configured route',
      owner,
      ownerScope: 'system',
      status: 'enabled',
      requiredCapabilities: [capability],
      strategyMode: 'manual',
      fallback: 'disabled',
      auditPolicy: { persistInput: false, persistOutput: false },
      meteringPolicy: { label: 'manual-policy' },
      metadata: { managedBy: 'operator' },
      bindings: [{ providerId: manual.id, capability, model: 'manual-model', priority: 7, status: 'disabled', constraints: { budget: 17 }, metadata: { route: 'manual' } }],
    }, 'admin_1')
    const before = (await getSceneRegistryEntry(eventFor(), sceneId))!

    await ensureDefaultProviderSceneSeed(eventFor())
    await ensureDefaultProviderSceneSeed(eventFor())

    const after = (await getSceneRegistryEntry(eventFor(), sceneId))!
    expect(after).toMatchObject({
      displayName: before.displayName,
      requiredCapabilities: before.requiredCapabilities,
      strategyMode: before.strategyMode,
      fallback: before.fallback,
      auditPolicy: before.auditPolicy,
      meteringPolicy: before.meteringPolicy,
      metadata: before.metadata,
    })
    expect(after.bindings.filter(binding => binding.capability === capability)).toEqual(before.bindings)
    expect(after.bindings.some(binding => binding.capability === capability && binding.providerId === preferred.id)).toBe(false)
  })

  it('system scene 不会自动绑定 user scope provider', async () => {
    const userProvider = await provider('user-private', { ownerScope: 'user' })

    await ensureDefaultProviderSceneSeed(eventFor())

    const entries = await listSceneRegistryEntries(eventFor())
    expect(entries.flatMap(scene => scene.bindings).filter(binding => binding.providerId === userProvider.id)).toEqual([])
    const selection = entries.find(scene => scene.id === 'corebox.selection.translate')!
    expect((await withSceneRegistryReadiness(eventFor(), selection)).readiness).toMatchObject({ status: 'degraded', missingCapabilities: ['text.translate'] })
  })

  it('重复 seed 不新增 provider、scene 或替换既有 binding', async () => {
    await provider('idempotent-provider')
    await ensureDefaultProviderSceneSeed(eventFor())
    const beforeProviders = await listProviderRegistryEntries(eventFor())
    const beforeScenes = await listSceneRegistryEntries(eventFor())

    await ensureDefaultProviderSceneSeed(eventFor())

    expect(await listProviderRegistryEntries(eventFor())).toEqual(beforeProviders)
    expect(await listSceneRegistryEntries(eventFor())).toEqual(beforeScenes)
  })
})

describe('ensureDefaultProviderSceneSeedForMiss', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T08:00:00.000Z'))
  })

  it('同一数据库的缺失场景只在窗口结束后重建', async () => {
    const id = 'nexus.intelligence.chat.completion'
    await ensureDefaultProviderSceneSeedForMiss(eventFor())
    expect((await getSceneRegistryEntry(eventFor(), id))?.requiredCapabilities).toEqual(['chat.completion'])
    await deleteSceneRegistryEntry(eventFor(), id)

    await ensureDefaultProviderSceneSeedForMiss(eventFor())
    expect(await getSceneRegistryEntry(eventFor(), id)).toBeNull()
    vi.setSystemTime(new Date('2026-10-15T08:00:31.000Z'))
    await ensureDefaultProviderSceneSeedForMiss(eventFor())

    expect((await getSceneRegistryEntry(eventFor(), id))?.requiredCapabilities).toEqual(['chat.completion'])
  })

  it('数据库写入失败不消耗 seed 重试窗口', async () => {
    await listSceneRegistryEntries(eventFor())
    db.sqlite.exec("CREATE TRIGGER fail_seed BEFORE INSERT ON scene_registry BEGIN SELECT RAISE(ABORT, 'seed write denied'); END")

    await expect(ensureDefaultProviderSceneSeedForMiss(eventFor())).rejects.toThrow('seed write denied')
    db.sqlite.exec('DROP TRIGGER fail_seed')
    await ensureDefaultProviderSceneSeedForMiss(eventFor())

    expect((await getSceneRegistryEntry(eventFor(), 'nexus.intelligence.chat.completion'))?.requiredCapabilities).toEqual(['chat.completion'])
  })
})
