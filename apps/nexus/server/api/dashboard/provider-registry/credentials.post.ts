import { randomUUID } from 'node:crypto'
import { createError, readBody } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { storeProviderCredential } from '../../../utils/providerCredentialStore'
import { getProviderRegistryEntry, updateProviderRegistryEntry } from '../../../utils/providerRegistryStore'

export default defineEventHandler(async (event) => {
  const { userId } = await requireAdmin(event)
  const body = await readBody(event)

  const provider = typeof body?.providerId === 'string'
    ? await getProviderRegistryEntry(event, body.providerId)
    : null
  if (!provider)
    throw createError({ statusCode: 404, statusMessage: 'Provider registry entry not found.' })

  // Rotate into a fresh slot: legacy channels may share their old name-based authRef.
  // Never overwrite that slot, even when only one of those channels is being edited.
  const authRef = `secure://providers/${randomUUID()}`
  await storeProviderCredential(event, {
    authRef,
    authType: provider.authType,
    credentials: body?.credentials,
  }, userId)
  await updateProviderRegistryEntry(event, provider.id, { authRef })
  return { success: true, hasCredential: true }
})
