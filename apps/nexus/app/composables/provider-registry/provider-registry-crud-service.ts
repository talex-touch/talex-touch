import { $fetch as rawFetch } from 'ofetch'
import type {
  ProviderCheckResult,
  ProviderQuotaRecord,
  ProviderRegistryRecord,
  SceneCapabilityAdapterCatalogEntry,
} from '~/utils/provider-registry-admin'


export function createProviderRegistryCrudService(fetcher: typeof rawFetch = rawFetch) {
  async function listProviders(vendor?: string) {
    return await fetcher<{ providers: ProviderRegistryRecord[], adapters: SceneCapabilityAdapterCatalogEntry[] }>('/api/dashboard/provider-registry/providers', {
      query: vendor ? { vendor } : undefined,
    })
  }

  async function createProvider(body: Record<string, unknown>) {
    return await fetcher<{ provider: ProviderRegistryRecord }>('/api/dashboard/provider-registry/providers', { method: 'POST', body })
  }

  async function createCredential(body: Record<string, unknown>) {
    await fetcher('/api/dashboard/provider-registry/credentials', { method: 'POST', body })
  }

  async function updateProvider(providerId: string, body: Record<string, unknown>) {
    await fetcher(`/api/dashboard/provider-registry/providers/${encodeURIComponent(providerId)}`, {
      method: 'PATCH',
      body,
    })
  }

  async function deleteProvider(providerId: string) {
    await fetcher(`/api/dashboard/provider-registry/providers/${encodeURIComponent(providerId)}`, {
      method: 'DELETE',
    })
  }

  async function checkProvider(providerId: string, capability: string) {
    return await fetcher<ProviderCheckResult>(`/api/dashboard/provider-registry/providers/${encodeURIComponent(providerId)}/check`, {
      method: 'POST',
      body: { capability },
    })
  }

  async function fetchProviderModels(providerId: string) {
    return await fetcher<{ models: string[] }>(`/api/dashboard/provider-registry/providers/${encodeURIComponent(providerId)}/models`, {
      method: 'POST',
    })
  }
  async function fetchModelsProbe(body: { type: string, baseUrl?: string, apiKey?: string }) {
    return await fetcher<{ models: string[] }>('/api/dashboard/intelligence/models', {
      method: 'POST',
      body,
    })
  }


  async function fetchProviderQuota(providerId: string) {
    return await fetcher<{ quota: ProviderQuotaRecord | null, quotas?: ProviderQuotaRecord[] }>(`/api/dashboard/provider-registry/providers/${encodeURIComponent(providerId)}/quota`)
  }

  async function saveProviderQuota(providerId: string, body: Record<string, unknown>) {
    return await fetcher<{ quota: ProviderQuotaRecord }>(`/api/dashboard/provider-registry/providers/${encodeURIComponent(providerId)}/quota`, {
      method: 'POST',
      body,
    })
  }


  return {
    checkProvider,
    createCredential,
    createProvider,
    deleteProvider,
    fetchProviderModels,
    fetchModelsProbe,
    fetchProviderQuota,
    listProviders,
    saveProviderQuota,
    updateProvider,
  }
}
