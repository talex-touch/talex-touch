import type { ProviderRegistryOwnerScope, ProviderRegistryStatus, ProviderRegistryVendor } from '../../../utils/providerRegistryStore'
import { getQuery } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { listProviderRegistryEntries } from '../../../utils/providerRegistryStore'
import { hasProviderCredential } from '../../../utils/providerCredentialStore'
import { listSceneCapabilityAdapterCatalog, resolveSceneCapabilityAdapterReadiness } from '../../../utils/sceneCapabilityAdapterRegistry'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = getQuery(event)

  const providers = await listProviderRegistryEntries(event, {
    vendor: typeof query.vendor === 'string' ? query.vendor as ProviderRegistryVendor : undefined,
    status: typeof query.status === 'string' ? query.status as ProviderRegistryStatus : undefined,
    ownerScope: typeof query.ownerScope === 'string' ? query.ownerScope as ProviderRegistryOwnerScope : undefined,
  })

  const providersWithAdapterReadiness = await Promise.all(providers.map(async (provider) => {
    const { authRef: _authRef, ...safeProvider } = provider
    return {
      ...safeProvider,
      hasCredential: provider.authRef ? await hasProviderCredential(event, provider.authRef) : false,
      capabilities: provider.capabilities.map(capability => ({
        ...capability,
        adapter: resolveSceneCapabilityAdapterReadiness(provider, capability.capability),
      })),
    }
  }))

  return {
    providers: providersWithAdapterReadiness,
    adapters: listSceneCapabilityAdapterCatalog(),
  }
})
