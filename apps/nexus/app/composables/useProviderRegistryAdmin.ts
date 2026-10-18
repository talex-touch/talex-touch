import { createProviderRegistryCrudService } from '~/composables/provider-registry/provider-registry-crud-service'
import { createProviderRegistrySceneObservabilityService } from '~/composables/provider-registry/provider-registry-scene-observability-service'
import { computed, reactive, ref, watch } from 'vue'
import { useAdminResource } from '~/composables/useAdminResource'
import { useToast } from '~/composables/useToast'
import { resolveProviderRegistryError } from '~/utils/admin-provider-registry'
import { resolveProviderProtocol } from '../../shared/provider-registry'
import {
  authTypeOptions,
  bindingStatusOptions,
  createProviderEditPanel,
  createProviderQuotaPanel,
  createDefaultSceneCapabilityInput,
  createSceneEditPanel,
  createSceneRunPanel,
  fallbackOptions,
  formatJson,
  formatRunJson,
  extractFailedSceneRun,
  mergeJsonObjects,
  parseBoundedNumber,
  parseCommaList,
  parseJsonObjectField,
  parseOptionalJson,
  ownerScopeOptions,
  PRODUCT_SCENE_TEMPLATES,
  providerStatusOptions,
  ProviderRegistryInputError,
  providerRegistryTemplates,
  providerVendorOptions,
  observabilityTone,
  resolveProviderObservability,
  resolveProviderObservabilityActionHint,
  summarizeProviderQuotaList,
  resolveHealthCheckActionHint,
  resolveHealthCheckReason,
  resolveSceneObservability,
  resolveSceneObservabilityActionHint,
  resolveUsageLedgerActionHint,
  resolveUsageLedgerReference,
  sceneCapabilities,
  sceneOwnerOptions,
  statusTone,
  strategyOptions,
  type BindingFormRow,
  type BindingStatus,
  type OwnerScope,
  type ProductSceneTemplate,
  type ProviderCapabilityRecord,
  type ProviderCheckResult,
  type ProviderEditPanelState,
  type ProviderHealthCheckEntry,
  type ProviderObservabilitySummary,
  type ProviderQuotaPanelState,
  type ProviderQuotaRecord,
  type ProviderRegistryRecord,
  type ProviderStatus,
  type SceneCapabilityAdapterCatalogEntry,
  type ProviderUsageLedgerEntry,
  type SceneEditPanelState,
  type SceneFallback,
  type SceneObservabilitySummary,
  type SceneOwner,
  type SceneRegistryRecord,
  type SceneRunPanelState,
  type SceneStrategyMode,
} from '~/utils/provider-registry-admin'

/** Everything the registry page reads from one load. */
export interface ProviderRegistrySnapshot {
  providers: ProviderRegistryRecord[]
  adapters: SceneCapabilityAdapterCatalogEntry[]
  capabilities: ProviderCapabilityRecord[]
  scenes: SceneRegistryRecord[]
  /** The latest 25 ledger rows: the providers' and routes' latest-run evidence. */
  usageEntries: ProviderUsageLedgerEntry[]
  /** The latest 25 checks: the providers' health badges. */
  healthEntries: ProviderHealthCheckEntry[]
  usageTotal: number
  unhealthyTotal: number
  quotas: Record<string, ProviderQuotaRecord | null>
  quotaLists: Record<string, ProviderQuotaRecord[]>
}


/**
 * The provider registry page's data and actions.
 *
 * The page calls this once, so its stat cards, its Refresh button and every tab
 * read the same registry. Providers, capabilities, scenes, quotas and the
 * 25-row observability windows are one `useAdminResource`: a first-load
 * skeleton, content kept during a refresh, a localized error with a retry. The
 * usage ledger and health check lists are server-paged lists of their own on
 * their tabs.
 *
 * The administrator gate is the layout's (`useAdminGate`): this composable
 * neither checks the role nor redirects, and is only ever mounted for an
 * administrator.
 *
 * Every action answers whether it succeeded, so the drawer that started it
 * decides whether to close; a failure shows its localized message in that
 * drawer, or as a toast for actions without one.
 */
export function useProviderRegistryAdmin() {
  const { t } = useI18n()
  const toast = useToast()
  const providerService = createProviderRegistryCrudService()
  const sceneObservabilityService = createProviderRegistrySceneObservabilityService()

  function failure(err: unknown, key: string, fallback: string): string {
    return resolveProviderRegistryError(err, t, t(key, fallback))
  }

  async function loadRegistry(): Promise<ProviderRegistrySnapshot> {
    await sceneObservabilityService.seedRegistry()
    const [providerResult, registryData] = await Promise.all([
      providerService.listProviders(),
      sceneObservabilityService.loadRegistryCollections(),
    ])
    const providers = providerResult.providers ?? []
    const quotaEntries = await Promise.all(providers.map(async (provider) => {
      const result = await providerService.fetchProviderQuota(provider.id)
      return [provider.id, result] as const
    }))
    return {
      providers,
      adapters: providerResult.adapters ?? [],
      capabilities: registryData.capabilities,
      scenes: registryData.scenes,
      usageEntries: registryData.usageEntries,
      healthEntries: registryData.healthEntries,
      usageTotal: registryData.usageTotal,
      unhealthyTotal: registryData.unhealthyTotal,
      quotas: Object.fromEntries(quotaEntries.map(([providerId, result]) => [providerId, result.quota])),
      quotaLists: Object.fromEntries(quotaEntries.map(([providerId, result]) => [providerId, result.quotas ?? (result.quota ? [result.quota] : [])])),
    }
  }

  const registry = useAdminResource<ProviderRegistrySnapshot>({
    fetch: loadRegistry,
    errorFallback: () => t('dashboard.providerRegistry.errors.loadFailed', 'Failed to load provider registry.'),
  })
  // A failure with nothing loaded yet takes the place of the blocks the registry
  // feeds; a failed refresh leaves the last load on screen under a notice.
  const registryLoadError = computed(() => (registry.data.value ? null : registry.error.value))
  const registryRefreshError = computed(() => (registry.data.value ? registry.error.value : null))

  /**
   * Settles once the registry has rows to page (resolves) or its load has failed
   * with nothing to show (rejects). A client list asked before the first answer
   * waits for it: paging an empty registry would move a link's `?rt_page=2`
   * back to page 1 for good.
   */
  function whenRegistryLoaded(): Promise<void> {
    return new Promise((resolve, reject) => {
      function settle(): boolean {
        if (registry.data.value) {
          resolve()
          return true
        }
        if (!registry.loading.value && registry.error.value) {
          reject(new Error(registry.error.value))
          return true
        }
        return false
      }
      if (settle())
        return
      const stop = watch([() => registry.data.value, () => registry.loading.value, () => registry.error.value], () => {
        if (settle())
          stop()
      })
    })
  }

  const providers = computed(() => registry.data.value?.providers ?? [])
  const adapterCatalog = computed(() => registry.data.value?.adapters ?? [])
  const capabilities = computed(() => registry.data.value?.capabilities ?? [])
  const scenes = computed(() => registry.data.value?.scenes ?? [])
  const usageEntries = computed(() => registry.data.value?.usageEntries ?? [])
  const healthEntries = computed(() => registry.data.value?.healthEntries ?? [])
  const usageTotal = computed(() => registry.data.value?.usageTotal ?? 0)
  const unhealthyTotal = computed(() => registry.data.value?.unhealthyTotal ?? 0)

  const savingProvider = ref(false)
  // The line of the latest failed save, for the panel to toast when the drawer
  // that started the save is no longer there to show it.
  const lastSaveError = ref<string | null>(null)

  function saveFailed(err: unknown, key: string, fallback: string): string {
    const message = failure(err, key, fallback)
    lastSaveError.value = message
    return message
  }
  const savingScene = ref(false)
  const actionPending = ref<string | null>(null)
  const providerCheckResults = ref<Record<string, ProviderCheckResult>>({})
  const sceneRunPanels = reactive<Record<string, SceneRunPanelState>>({})
  const providerEditPanels = reactive<Record<string, ProviderEditPanelState>>({})
  const providerQuotaPanels = reactive<Record<string, ProviderQuotaPanelState>>({})
  const sceneEditPanels = reactive<Record<string, SceneEditPanelState>>({})
  // Quotas are patched in place after a quota save, until the next load.
  const providerQuotas = ref<Record<string, ProviderQuotaRecord | null>>({})
  const providerQuotaLists = ref<Record<string, ProviderQuotaRecord[]>>({})
  /** The create drawers' failures: they have no per-record panel to hold one. */
  const providerCreateError = ref<string | null>(null)
  const sceneCreateError = ref<string | null>(null)
  const fetchingProviderModels = ref<string | null>(null)
  const fetchingFormModels = ref(false)
  const fetchedFormModels = ref<string[]>([])
  const initialProviderTemplate = providerRegistryTemplates.find(template => template.id === 'openai-compatible-ai')
    ?? providerRegistryTemplates[0]!

  const providerForm = reactive({
    name: initialProviderTemplate.name,
    displayName: initialProviderTemplate.displayName,
    vendor: initialProviderTemplate.vendor,
    adapterKey: initialProviderTemplate.adapterKey,
    status: 'disabled' as ProviderStatus,
    authType: initialProviderTemplate.authType,
    ownerScope: 'system' as OwnerScope,
    endpoint: initialProviderTemplate.endpoint,
    region: initialProviderTemplate.region,
    modelsText: (initialProviderTemplate.models ?? []).join('\n'),
    defaultModel: initialProviderTemplate.defaultModel ?? '',
    apiKey: '',
    secretId: '',
    secretKey: '',
  })


  const sceneForm = reactive({
    id: 'corebox.screenshot.translate',
    displayName: 'CoreBox Screenshot Translate',
    owner: 'core-app' as SceneOwner,
    ownerScope: 'system' as OwnerScope,
    status: 'enabled' as BindingStatus,
    requiredCapabilitiesText: 'vision.ocr, text.translate, overlay.render',
    strategyMode: 'priority' as SceneStrategyMode,
    fallback: 'enabled' as SceneFallback,
  })

  const bindingRows = ref<BindingFormRow[]>(['vision.ocr', 'text.translate', 'overlay.render'].map((capability, index) => ({
    providerId: '', capability, model: '', priority: (index + 1) * 10,
  })))

  watch(() => registry.data.value, (data) => {
    if (!data)
      return
    providerQuotas.value = data.quotas
    providerQuotaLists.value = data.quotaLists
  }, { immediate: true })

  const enabledProviders = computed(() => providers.value.filter(item => item.status === 'enabled').length)
  const capabilityCount = computed(() => capabilities.value.length)
  const sceneCount = computed(() => scenes.value.length)
  const providerOptions = computed(() => providers.value.map(provider => ({
    value: provider.id,
    label: `${provider.displayName} · ${provider.vendor}`,
  })))
  const providerObservabilityById = computed<Record<string, ProviderObservabilitySummary>>(() => Object.fromEntries(
    providers.value.map(provider => [
      provider.id,
      resolveProviderObservability(provider.id, healthEntries.value, usageEntries.value),
    ]),
  ))
  const sceneObservabilityById = computed<Record<string, SceneObservabilitySummary>>(() => Object.fromEntries(
    scenes.value.map(scene => [
      scene.id,
      resolveSceneObservability(scene.id, usageEntries.value),
    ]),
  ))
  const providerAdapterOptions = computed(() => adapterCatalog.value.map(adapter => ({
    value: adapter.key,
    label: adapter.label,
  })))

  function applyProviderProtocol(key: unknown, provider?: ProviderRegistryRecord) {
    const protocol = resolveProviderProtocol(String(key))
    if (!protocol)
      return
    const form = provider ? getProviderEditPanel(provider) : providerForm
    form.adapterKey = protocol.key
    form.vendor = protocol.vendor
    form.authType = protocol.authType
    if (!provider)
      fetchedFormModels.value = []
    else
      getProviderEditPanel(provider).fetchedModels = []
  }


  function addBindingRow(capability = parseRequiredCapabilities()[0] ?? '') {
    const priority = Math.max(0, ...bindingRows.value.map(row => row.priority)) + 10
    bindingRows.value.push({ providerId: '', capability, model: '', priority })
  }

  function removeBindingRow(index: number) {
    bindingRows.value.splice(index, 1)
  }

  // The panel getters read the panel back through its reactive record: the
  // object just created is the raw one, and a drawer computed over it would
  // never see the save's error or saving flag.
  function getProviderEditPanel(provider: ProviderRegistryRecord): ProviderEditPanelState {
    providerEditPanels[provider.id] ??= createProviderEditPanel(provider)
    return providerEditPanels[provider.id]!
  }

  function getProviderQuotaPanel(provider: ProviderRegistryRecord): ProviderQuotaPanelState {
    providerQuotaPanels[provider.id] ??= createProviderQuotaPanel(provider, providerQuotas.value[provider.id])
    return providerQuotaPanels[provider.id]!
  }

  function getSceneEditPanel(scene: SceneRegistryRecord): SceneEditPanelState {
    sceneEditPanels[scene.id] ??= createSceneEditPanel(scene)
    return sceneEditPanels[scene.id]!
  }

  /** A fresh editor for a drawer that opens: whatever was typed last time is gone. */
  function resetProviderEditPanel(provider: ProviderRegistryRecord) {
    delete providerEditPanels[provider.id]
  }

  function resetProviderQuotaPanel(provider: ProviderRegistryRecord) {
    delete providerQuotaPanels[provider.id]
  }

  function resetSceneEditPanel(scene: SceneRegistryRecord) {
    delete sceneEditPanels[scene.id]
  }


  function addSceneBindingEditRow(scene: SceneRegistryRecord, capability = scene.requiredCapabilities[0] ?? '') {
    const panel = getSceneEditPanel(scene)
    panel.bindings.push({
      providerId: '',
      capability,
      model: '',
      priority: Math.max(0, ...panel.bindings.map(row => Number(row.priority) || 0)) + 10,
      weightText: '',
      status: 'enabled',
      constraintsText: '',
      metadataText: '',
    })
  }

  function removeSceneBindingEditRow(scene: SceneRegistryRecord, index: number) {
    getSceneEditPanel(scene).bindings.splice(index, 1)
  }

  function parseRequiredCapabilities() {
    return parseCommaList(sceneForm.requiredCapabilitiesText)
  }


  function sceneProviderOptions(scene: SceneRegistryRecord) {
    const providerIds = new Set(scene.bindings.map(binding => binding.providerId))
    return providerOptions.value.filter(provider => providerIds.has(provider.value))
  }

  function bindingModelOptions(providerId: string) {
    const provider = providers.value.find(item => item.id === providerId)
    const models = provider?.metadata?.models
    return Array.isArray(models)
      ? models.filter((model): model is string => typeof model === 'string' && model.trim().length > 0)
      : []
  }

  function bindingProviderOptions(capability: string) {
    return providers.value
      .filter(provider => provider.capabilities.some(item => item.capability === capability))
      .map(provider => ({ value: provider.id, label: provider.displayName }))
  }

  function parseProviderModels(value: string) {
    return Array.from(new Set(parseCommaList(value.replace(/\n/g, ','))))
  }

  function assertDefaultModel(models: string[], defaultModel: string) {
    if (defaultModel && !models.includes(defaultModel))
      throw new ProviderRegistryInputError('default-model-missing', {}, 'Default model must be included in the provider model list.')
  }

  function getSceneRunPanel(scene: SceneRegistryRecord): SceneRunPanelState {
    sceneRunPanels[scene.id] ??= createSceneRunPanel(scene)
    return sceneRunPanels[scene.id]!
  }

  function applySceneRunCapabilitySample(scene: SceneRegistryRecord, capability: string) {
    const panel = getSceneRunPanel(scene)
    const normalizedCapability = capability.trim()
    panel.capability = normalizedCapability
    panel.inputText = formatRunJson(
      normalizedCapability
        ? createDefaultSceneCapabilityInput(normalizedCapability)
        : createDefaultSceneCapabilityInput(sceneCapabilities(scene)),
    )
    panel.result = null
    panel.error = null
  }

  function getProviderCheckResult(providerId: string): ProviderCheckResult | null {
    return providerCheckResults.value[providerId] ?? null
  }

  function getProviderObservability(providerId: string) {
    return providerObservabilityById.value[providerId] ?? resolveProviderObservability(providerId, healthEntries.value, usageEntries.value)
  }

  function getProviderObservabilityActionHint(providerId: string) {
    return resolveProviderObservabilityActionHint(getProviderObservability(providerId))
  }

  function getProviderQuotaSummary(providerId: string) {
    return summarizeProviderQuotaList(getProviderQuotaList(providerId))
  }

  function getProviderQuotaList(providerId: string) {
    return providerQuotaLists.value[providerId] ?? (providerQuotas.value[providerId] ? [providerQuotas.value[providerId]!] : [])
  }

  function getUsageLedgerActionHint(entry: ProviderUsageLedgerEntry) {
    return resolveUsageLedgerActionHint(entry)
  }

  function getUsageLedgerReference(entry: ProviderUsageLedgerEntry) {
    return resolveUsageLedgerReference(entry)
  }

  function getHealthCheckActionHint(entry: ProviderHealthCheckEntry) {
    return resolveHealthCheckActionHint(entry)
  }

  function getHealthCheckReason(entry: ProviderHealthCheckEntry) {
    return resolveHealthCheckReason(entry)
  }

  function getSceneObservability(sceneId: string) {
    return sceneObservabilityById.value[sceneId] ?? resolveSceneObservability(sceneId, usageEntries.value)
  }

  function getSceneObservabilityActionHint(sceneId: string) {
    return resolveSceneObservabilityActionHint(getSceneObservability(sceneId))
  }

  /** Load again, keeping what is on screen until the answer lands. */
  function refresh() {
    return registry.refresh()
  }

  async function createProvider(): Promise<boolean> {
    savingProvider.value = true
    providerCreateError.value = null
    try {
      const targetStatus = providerForm.status
      const hasApiKeyInput = providerForm.authType === 'api_key' && providerForm.apiKey.trim()
      const hasSecretPairInput = providerForm.authType === 'secret_pair'
        && providerForm.secretId.trim()
        && providerForm.secretKey.trim()
      const hasCredentialInput = Boolean(hasApiKeyInput || hasSecretPairInput)
      assertDefaultModel(parseProviderModels(providerForm.modelsText), providerForm.defaultModel.trim())
      const body = {
        name: providerForm.name.trim(),
        displayName: providerForm.name.trim(),
        vendor: providerForm.vendor,
        status: hasCredentialInput ? 'disabled' : providerForm.status,
        authType: providerForm.authType,
        ownerScope: providerForm.ownerScope,
        endpoint: providerForm.endpoint.trim() || undefined,
        region: providerForm.region.trim() || undefined,
        metadata: mergeJsonObjects(
          { intelligenceType: 'custom' },
          {
            adapterKey: providerForm.adapterKey,
            models: parseProviderModels(providerForm.modelsText),
            defaultModel: providerForm.defaultModel.trim() || null,
          },
        ),
        capabilities: [],
      }

      const { provider } = await providerService.createProvider(body)
      if (hasCredentialInput) {
        await providerService.createCredential({
          providerId: provider.id,
          credentials: hasSecretPairInput
            ? {
                secretId: providerForm.secretId.trim(),
                secretKey: providerForm.secretKey,
              }
            : {
                apiKey: providerForm.apiKey.trim(),
              },
        })
        providerForm.apiKey = ''
        providerForm.secretId = ''
        providerForm.secretKey = ''

        if (targetStatus !== 'disabled')
          await providerService.updateProvider(provider.id, { status: targetStatus })
      }
      toast.success(t('dashboard.providerRegistry.providers.created', 'Provider created.'))
      await refresh()
      return true
    }
    catch (err) {
      providerCreateError.value = saveFailed(err, 'dashboard.providerRegistry.errors.createProviderFailed', 'Failed to create provider.')
      return false
    }
    finally {
      savingProvider.value = false
    }
  }

  async function checkProvider(provider: ProviderRegistryRecord, capability?: string): Promise<ProviderCheckResult> {
    actionPending.value = `provider:${provider.id}:check`
    const targetCapability = capability?.trim() || provider.capabilities[0]?.capability || 'text.translate'
    try {
      const result = await providerService.checkProvider(provider.id, targetCapability)
      providerCheckResults.value = {
        ...providerCheckResults.value,
        [provider.id]: result,
      }
      if (result.success) {
        toast.success(result.message || t('dashboard.providerRegistry.providers.checkSucceeded', 'Provider check succeeded.'))
      }
      else {
        toast.warning(result.message || t('dashboard.providerRegistry.providers.checkFailed', 'Provider check failed.'))
      }
      // The check is recorded either way: the health badge and the health card read it from the registry.
      await refresh()
      return result
    }
    catch (err) {
      const message = failure(err, 'dashboard.providerRegistry.errors.checkProviderFailed', 'Failed to check provider.')
      const result: ProviderCheckResult = {
        success: false,
        providerId: provider.id,
        capability: targetCapability,
        latency: 0,
        endpoint: provider.endpoint || '',
        message,
        error: { message },
      }
      providerCheckResults.value = {
        ...providerCheckResults.value,
        [provider.id]: result,
      }
      toast.warning(message)
      return result
    }
    finally {
      actionPending.value = null
    }
  }

  async function updateProviderStatus(provider: ProviderRegistryRecord, status: ProviderStatus): Promise<boolean> {
    actionPending.value = `provider:${provider.id}:${status}`
    try {
      await providerService.updateProvider(provider.id, { status })
      await refresh()
      return true
    }
    catch (err) {
      toast.warning(failure(err, 'dashboard.providerRegistry.errors.updateProviderFailed', 'Failed to update provider.'))
      return false
    }
    finally {
      actionPending.value = null
    }
  }

  async function fetchProviderModels(provider: ProviderRegistryRecord) {
    const panel = getProviderEditPanel(provider)
    fetchingProviderModels.value = provider.id
    panel.error = null
    try {
      const result = await providerService.fetchProviderModels(provider.id)
      const models = Array.from(new Set(
        (result.models ?? [])
          .map(model => model.trim())
          .filter(Boolean),
      ))
      panel.fetchedModels = models
      toast.success(t('dashboard.providerRegistry.providers.modelsFetched', { count: models.length }, `Fetched ${models.length} model(s).`))
    }
    catch (err) {
      panel.error = failure(err, 'dashboard.providerRegistry.errors.fetchModelsFailed', 'Failed to fetch provider models.')
    }
    finally {
      fetchingProviderModels.value = null
    }
  }
  async function fetchFormModels() {
    fetchingFormModels.value = true
    providerCreateError.value = null
    try {
      const result = await providerService.fetchModelsProbe({
        type: 'custom',
        baseUrl: providerForm.endpoint?.trim() || undefined,
        apiKey: providerForm.apiKey?.trim() || undefined,
      })
      const models = Array.from(new Set(
        (result.models ?? [])
          .map(model => model.trim())
          .filter(Boolean),
      ))
      fetchedFormModels.value = models
      toast.success(t('dashboard.providerRegistry.providers.modelsFetched', { count: models.length }, `Fetched ${models.length} model(s).`))
    }
    catch (err) {
      providerCreateError.value = failure(err, 'dashboard.providerRegistry.errors.fetchModelsFailed', 'Failed to fetch provider models.')
    }
    finally {
      fetchingFormModels.value = false
    }
  }


  async function saveProviderEdit(provider: ProviderRegistryRecord): Promise<boolean> {
    const panel = getProviderEditPanel(provider)
    panel.saving = true
    panel.error = null
    try {
      const replacingCredential = Boolean(panel.apiKey?.trim() || panel.secretId?.trim() || panel.secretKey?.trim())
      if (panel.authType === 'secret_pair' && replacingCredential && (!panel.secretId?.trim() || !panel.secretKey?.trim()))
        throw new Error(t('dashboard.providerRegistry.providers.secretPairRequired', 'Enter both SecretId and SecretKey to replace the credential.'))
      assertDefaultModel(parseProviderModels(panel.modelsText), panel.defaultModel.trim())
      const body = {
        name: panel.name.trim(),
        displayName: panel.name.trim(),
        vendor: panel.vendor,
        status: replacingCredential ? 'disabled' : panel.status,
        authType: panel.authType,
        ownerScope: panel.ownerScope,
        ownerId: panel.ownerId.trim() || null,
        description: panel.description.trim() || null,
        endpoint: panel.endpoint.trim() || null,
        region: panel.region.trim() || null,
        metadata: mergeJsonObjects(
          parseJsonObjectField(panel.metadataText, 'provider.metadata'),
          {
            adapterKey: panel.adapterKey,
            intelligenceType: 'custom',
            models: parseProviderModels(panel.modelsText),
            defaultModel: panel.defaultModel.trim() || null,
          },
        ),
      }

      await providerService.updateProvider(provider.id, body)
      if (panel.authType === 'api_key' && panel.apiKey?.trim()) {
        await providerService.createCredential({
          providerId: provider.id,
          credentials: { apiKey: panel.apiKey.trim() },
        })
        panel.apiKey = ''
      }
      else if (panel.authType === 'secret_pair' && panel.secretId?.trim() && panel.secretKey?.trim()) {
        await providerService.createCredential({
          providerId: provider.id,
          credentials: { secretId: panel.secretId.trim(), secretKey: panel.secretKey.trim() },
        })
        panel.secretId = ''
        panel.secretKey = ''
      }
      if (replacingCredential && panel.status !== 'disabled')
        await providerService.updateProvider(provider.id, { status: panel.status })
      toast.success(t('dashboard.providerRegistry.providers.updated', 'Provider updated.'))
      // Unless the drawer was reopened while this saved: that editor is the operator's now.
      if (providerEditPanels[provider.id] === panel)
        delete providerEditPanels[provider.id]
      await refresh()
      return true
    }
    catch (err) {
      panel.error = saveFailed(err, 'dashboard.providerRegistry.errors.updateProviderFailed', 'Failed to update provider.')
      return false
    }
    finally {
      panel.saving = false
    }
  }

  async function saveProviderQuota(provider: ProviderRegistryRecord): Promise<boolean> {
    const panel = getProviderQuotaPanel(provider)
    panel.saving = true
    panel.error = null
    try {
      const windowDays = parseBoundedNumber(panel.windowDays, 'windowDays', 1) ?? 30
      const maxRequests = parseBoundedNumber(panel.maxRequests, 'maxRequests')
      const maxTokens = parseBoundedNumber(panel.maxTokens, 'maxTokens')
      const warningThreshold = parseBoundedNumber(panel.warningThreshold, 'warningThreshold', 0, 100)
      const limits: Record<string, number> = { windowDays }
      if (maxRequests !== undefined)
        limits.maxRequests = maxRequests
      if (maxTokens !== undefined)
        limits.maxTokens = maxTokens

      const result = await providerService.saveProviderQuota(provider.id, {
        name: panel.name.trim() || `${provider.displayName} quota`,
        enabled: panel.enabled === 'enabled',
        limits,
        warningThreshold,
        config: {
          source: 'provider-registry-panel',
        },
      })
      providerQuotas.value = {
        ...providerQuotas.value,
        [provider.id]: result.quota,
      }
      providerQuotaLists.value = {
        ...providerQuotaLists.value,
        [provider.id]: [result.quota],
      }
      toast.success(t('dashboard.providerRegistry.quota.saved', 'Provider quota saved.'))
      return true
    }
    catch (err) {
      panel.error = saveFailed(err, 'dashboard.providerRegistry.errors.saveQuotaFailed', 'Failed to save provider quota.')
      return false
    }
    finally {
      panel.saving = false
    }
  }

  async function deleteProvider(provider: ProviderRegistryRecord): Promise<boolean> {
    actionPending.value = `provider:${provider.id}:delete`
    try {
      await providerService.deleteProvider(provider.id)
      await refresh()
      return true
    }
    catch (err) {
      toast.warning(failure(err, 'dashboard.providerRegistry.errors.deleteProviderFailed', 'Failed to delete provider.'))
      return false
    }
    finally {
      actionPending.value = null
    }
  }

  async function createScene(): Promise<boolean> {
    savingScene.value = true
    sceneCreateError.value = null
    try {
      const existingScene = scenes.value.find(scene => scene.id === sceneForm.id)
      const body = {
        id: sceneForm.id.trim(),
        displayName: sceneForm.displayName.trim(),
        owner: sceneForm.owner,
        ownerScope: sceneForm.ownerScope,
        status: sceneForm.status,
        requiredCapabilities: parseRequiredCapabilities(),
        strategyMode: sceneForm.strategyMode,
        fallback: sceneForm.fallback,
        auditPolicy: {
          persistInput: false,
          persistOutput: false,
        },
        bindings: bindingRows.value
          .filter(row => row.providerId && row.capability.trim())
          .map((row) => {
            const existing = existingScene?.bindings.find(binding => binding.providerId === row.providerId && binding.capability === row.capability)
            return {
              providerId: row.providerId,
              capability: row.capability.trim(),
              model: row.model.trim() || null,
              priority: Number(row.priority) || 100,
              weight: existing?.weight,
              status: existing?.status ?? 'enabled',
              constraints: existing?.constraints,
              metadata: existing?.metadata,
            }
          }),
      }

      if (existingScene)
        await sceneObservabilityService.updateScene(existingScene.id, body)
      else
        await sceneObservabilityService.createScene(body)
      toast.success(t('dashboard.providerRegistry.scenes.updated', 'Scene updated.'))
      await refresh()
      return true
    }
    catch (err) {
      sceneCreateError.value = saveFailed(err, 'dashboard.providerRegistry.errors.createSceneFailed', 'Failed to create scene.')
      return false
    }
    finally {
      savingScene.value = false
    }
  }

  async function updateSceneStatus(scene: SceneRegistryRecord, status: BindingStatus): Promise<boolean> {
    actionPending.value = `scene:${scene.id}:${status}`
    try {
      await sceneObservabilityService.updateScene(scene.id, { status })
      await refresh()
      return true
    }
    catch (err) {
      toast.warning(failure(err, 'dashboard.providerRegistry.errors.updateSceneFailed', 'Failed to update scene.'))
      return false
    }
    finally {
      actionPending.value = null
    }
  }

  async function saveSceneEdit(scene: SceneRegistryRecord): Promise<boolean> {
    const panel = getSceneEditPanel(scene)
    panel.saving = true
    panel.error = null
    try {
      const body = {
        displayName: panel.displayName.trim(),
        owner: panel.owner,
        ownerScope: panel.ownerScope,
        ownerId: panel.ownerId.trim() || null,
        status: panel.status,
        requiredCapabilities: parseCommaList(panel.requiredCapabilitiesText),
        strategyMode: panel.strategyMode,
        fallback: panel.fallback,
        meteringPolicy: parseJsonObjectField(panel.meteringPolicyText, 'scene.meteringPolicy'),
        auditPolicy: parseJsonObjectField(panel.auditPolicyText, 'scene.auditPolicy'),
        metadata: parseJsonObjectField(panel.metadataText, 'scene.metadata'),
        bindings: panel.bindings
          .map((row, index) => ({ row, index }))
          .filter(({ row }) => row.providerId && row.capability.trim())
          .map(({ row, index }) => ({
            providerId: row.providerId,
            capability: row.capability.trim(),
            model: row.model.trim() || undefined,
            priority: Number(row.priority) || 100,
            weight: row.weightText.trim() ? Number(row.weightText) : undefined,
            status: row.status,
            constraints: parseJsonObjectField(row.constraintsText, `bindings[${index}].constraints`),
            metadata: parseJsonObjectField(row.metadataText, `bindings[${index}].metadata`),
          })),
      }

      await sceneObservabilityService.updateScene(scene.id, body)
      toast.success(t('dashboard.providerRegistry.scenes.updated', 'Scene updated.'))
      if (sceneEditPanels[scene.id] === panel)
        delete sceneEditPanels[scene.id]
      await refresh()
      return true
    }
    catch (err) {
      panel.error = saveFailed(err, 'dashboard.providerRegistry.errors.updateSceneFailed', 'Failed to update scene.')
      return false
    }
    finally {
      panel.saving = false
    }
  }

  async function runScene(scene: SceneRegistryRecord, dryRun: boolean) {
    const panel = getSceneRunPanel(scene)
    const pendingKey = `scene:${scene.id}:run:${dryRun ? 'dry' : 'execute'}`
    actionPending.value = pendingKey
    panel.error = null
    let requestStarted = false
    try {
      const input = parseOptionalJson(panel.inputText)
      requestStarted = true
      const result = await sceneObservabilityService.runScene(scene.id, {
        input,
        capability: panel.capability.trim() || undefined,
        providerId: panel.providerId || undefined,
        dryRun,
      })
      panel.result = result.run
      if (result.run.status === 'failed') {
        const message = result.run.error?.message || t('dashboard.providerRegistry.errors.runSceneFailed', 'Failed to run scene.')
        panel.error = message
        toast.warning(message)
      }
      else {
        toast.success(dryRun
          ? t('dashboard.providerRegistry.scenes.dryRunCompleted', 'Scene dry run completed.')
          : t('dashboard.providerRegistry.scenes.runCompleted', 'Scene run completed.'))
      }
    }
    catch (err) {
      const failedRun = extractFailedSceneRun(err)
      if (failedRun)
        panel.result = failedRun
      panel.error = failure(err, 'dashboard.providerRegistry.errors.runSceneFailed', 'Failed to run scene.')
    }
    finally {
      if (requestStarted)
        await refresh()
      actionPending.value = null
    }
  }

  async function deleteScene(scene: SceneRegistryRecord): Promise<boolean> {
    actionPending.value = `scene:${scene.id}:delete`
    try {
      await sceneObservabilityService.deleteScene(scene.id)
      await refresh()
      return true
    }
    catch (err) {
      toast.warning(failure(err, 'dashboard.providerRegistry.errors.deleteSceneFailed', 'Failed to delete scene.'))
      return false
    }
    finally {
      actionPending.value = null
    }
  }
  function toggleModelSelection(model: string, isCreate: boolean, provider?: ProviderRegistryRecord) {
    if (isCreate) {
      const current = parseProviderModels(providerForm.modelsText)
      const next = current.includes(model)
        ? current.filter(m => m !== model)
        : [...current, model]
      providerForm.modelsText = next.join('\n')
      if (providerForm.defaultModel && !next.includes(providerForm.defaultModel)) {
        providerForm.defaultModel = next[0] ?? ''
      }
    }
    else if (provider) {
      const panel = getProviderEditPanel(provider)
      const current = parseProviderModels(panel.modelsText)
      const next = current.includes(model)
        ? current.filter(m => m !== model)
        : [...current, model]
      panel.modelsText = next.join('\n')
      if (panel.defaultModel && !next.includes(panel.defaultModel)) {
        panel.defaultModel = next[0] ?? ''
      }
    }
  }

  function selectAllFetchedModels(isCreate: boolean, provider?: ProviderRegistryRecord) {
    if (isCreate) {
      const current = new Set(parseProviderModels(providerForm.modelsText))
      for (const m of fetchedFormModels.value)
        current.add(m)
      providerForm.modelsText = Array.from(current).join('\n')
      if (!providerForm.defaultModel && fetchedFormModels.value[0])
        providerForm.defaultModel = fetchedFormModels.value[0]
    }
    else if (provider) {
      const panel = getProviderEditPanel(provider)
      const current = new Set(parseProviderModels(panel.modelsText))
      for (const m of (panel.fetchedModels ?? []))
        current.add(m)
      panel.modelsText = Array.from(current).join('\n')
      if (!panel.defaultModel && (panel.fetchedModels ?? [])[0])
        panel.defaultModel = (panel.fetchedModels ?? [])[0] ?? ''
    }
  }

  function deselectAllFetchedModels(isCreate: boolean, provider?: ProviderRegistryRecord) {
    if (isCreate) {
      const fetchedSet = new Set(fetchedFormModels.value)
      const current = parseProviderModels(providerForm.modelsText).filter(m => !fetchedSet.has(m))
      providerForm.modelsText = current.join('\n')
      if (!current.includes(providerForm.defaultModel))
        providerForm.defaultModel = current[0] ?? ''
    }
    else if (provider) {
      const panel = getProviderEditPanel(provider)
      const fetchedSet = new Set(panel.fetchedModels ?? [])
      const current = parseProviderModels(panel.modelsText).filter(m => !fetchedSet.has(m))
      panel.modelsText = current.join('\n')
      if (!current.includes(panel.defaultModel))
        panel.defaultModel = current[0] ?? ''
    }
  }

  function applyProductSceneTemplate(template: ProductSceneTemplate) {
    sceneForm.id = template.id
    sceneForm.displayName = template.displayName
    sceneForm.owner = template.owner
    const existing = scenes.value.find(scene => scene.id === template.id)
    sceneForm.requiredCapabilitiesText = (existing?.requiredCapabilities ?? template.requiredCapabilities).join(', ')
    sceneForm.status = existing?.status ?? 'enabled'
    sceneForm.strategyMode = existing?.strategyMode ?? 'priority'
    sceneForm.fallback = existing?.fallback ?? 'enabled'
    bindingRows.value = existing
      ? existing.bindings.map(binding => ({ providerId: binding.providerId, capability: binding.capability, model: binding.model ?? '', priority: binding.priority }))
      : template.requiredCapabilities.map((capability, index) => ({ providerId: '', capability, model: '', priority: (index + 1) * 10 }))
  }

  return {
    /** The registry resource: `loading` (nothing yet), `refreshing`, `error`, `data`. */
    registry,
    registryLoadError,
    registryRefreshError,
    whenRegistryLoaded,
    lastSaveError,
    refresh,
    listUsageEntries: sceneObservabilityService.listUsageEntries,
    listHealthChecks: sceneObservabilityService.listHealthChecks,
    adapterCatalog,
    bindingModelOptions,
    bindingProviderOptions,
    applyProviderProtocol,
    actionPending,
    addBindingRow,
    addSceneBindingEditRow,
    authTypeOptions,
    bindingRows,
    bindingStatusOptions,
    capabilities,
    capabilityCount,
    checkProvider,
    createProvider,
    createScene,
    deleteProvider,
    deleteScene,
    enabledProviders,
    fallbackOptions,
    fetchProviderModels,
    fetchFormModels,
    fetchingFormModels,
    fetchingProviderModels,
    fetchedFormModels,
    toggleModelSelection,
    selectAllFetchedModels,
    deselectAllFetchedModels,
    applyProductSceneTemplate,
    productSceneTemplates: PRODUCT_SCENE_TEMPLATES,
    formatJson,
    formatRunJson,
    parseRequiredCapabilities,
    getProviderCheckResult,
    getProviderEditPanel,
    getProviderQuotaPanel,
    getProviderQuotaList,
    getProviderQuotaSummary,
    getHealthCheckActionHint,
    getHealthCheckReason,
    getProviderObservability,
    getProviderObservabilityActionHint,
    getSceneEditPanel,
    getSceneObservability,
    getSceneObservabilityActionHint,
    getSceneRunPanel,
    applySceneRunCapabilitySample,
    getUsageLedgerActionHint,
    getUsageLedgerReference,
    healthEntries,
    ownerScopeOptions,
    providerCreateError,
    providerEditPanels,
    providerForm,
    providerObservabilityById,
    providerOptions,
    providerAdapterOptions,
    providerStatusOptions,
    providers,
    providerQuotaPanels,
    providerQuotas,
    providerVendorOptions,
    removeBindingRow,
    removeSceneBindingEditRow,
    resetProviderEditPanel,
    resetProviderQuotaPanel,
    resetSceneEditPanel,
    runScene,
    saveProviderEdit,
    saveProviderQuota,
    saveSceneEdit,
    sceneCapabilities,
    sceneCount,
    sceneCreateError,
    sceneEditPanels,
    sceneForm,
    sceneObservabilityById,
    sceneOwnerOptions,
    sceneProviderOptions,
    scenes,
    savingProvider,
    savingScene,
    observabilityTone,
    statusTone,
    strategyOptions,
    unhealthyTotal,
    updateProviderStatus,
    updateSceneStatus,
    usageEntries,
    usageTotal,
  }
}

export type ProviderRegistryAdmin = ReturnType<typeof useProviderRegistryAdmin>
