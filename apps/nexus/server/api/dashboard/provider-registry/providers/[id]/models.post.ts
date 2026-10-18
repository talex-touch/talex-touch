import { createError, getRouterParam } from 'h3'
import { requireAdmin } from '../../../../../utils/auth'
import { fetchProviderModels } from '../../../../../utils/intelligenceModels'
import { getProviderCredential } from '../../../../../utils/providerCredentialStore'
import { getProviderRegistryEntry } from '../../../../../utils/providerRegistryStore'


export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = String(getRouterParam(event, 'id') || '').trim()

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id is required.' })
  }

  const provider = await getProviderRegistryEntry(event, id)
  if (!provider) {
    throw createError({ statusCode: 404, statusMessage: 'Provider registry entry not found.' })
  }

  const adapterKey = provider.metadata?.adapterKey
  if (adapterKey !== 'openai-compatible' && adapterKey !== 'openai-responses')
    throw createError({ statusCode: 400, statusMessage: 'Model discovery is not supported by this protocol.' })
  const type = 'custom'
  let apiKey: string | null = null

  {
    if (provider.authType !== 'api_key' || !provider.authRef) {
      throw createError({ statusCode: 400, statusMessage: 'Provider API key credential is required to fetch models.' })
    }

    const credential = await getProviderCredential(event, provider.authRef)
    apiKey = credential && 'apiKey' in credential ? credential.apiKey : null
    if (!apiKey) {
      throw createError({ statusCode: 400, statusMessage: 'Provider API key credential is missing.' })
    }
  }

  const models = await fetchProviderModels({
    type,
    baseUrl: provider.endpoint,
    apiKey,
  })

  return { models }
})
