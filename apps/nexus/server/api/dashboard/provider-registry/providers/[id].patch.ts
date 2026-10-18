import { createError, getRouterParam, readBody } from 'h3'
import { randomUUID } from 'node:crypto'
import { requireAdmin } from '../../../../utils/auth'
import { assertNoPlainProviderSecrets, getProviderRegistryEntry, updateProviderRegistryEntry } from '../../../../utils/providerRegistryStore'
import { resolveProviderProtocol } from '../../../../../shared/provider-registry'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const id = String(getRouterParam(event, 'id') || '').trim()

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'id is required.' })
  }

  const body = await readBody(event)
  assertNoPlainProviderSecrets(body)
  if (body?.authRef !== undefined)
    throw createError({ statusCode: 400, statusMessage: 'Provider credential references are server-owned.' })
  const protocol = body?.metadata?.adapterKey === undefined
    ? undefined
    : resolveProviderProtocol(String(body.metadata.adapterKey))
  if (body?.metadata?.adapterKey !== undefined && !protocol)
    throw createError({ statusCode: 400, statusMessage: 'A supported provider protocol is required.' })
  const existing = await getProviderRegistryEntry(event, id)
  if (!existing)
    throw createError({ statusCode: 404, statusMessage: 'Provider registry entry not found.' })

  const provider = await updateProviderRegistryEntry(event, id, {
    name: body?.name,
    displayName: body?.displayName,
    vendor: protocol?.vendor,
    status: body?.status,
    authType: protocol?.authType,
    authRef: protocol?.authType === 'none' ? null : existing.authRef ?? `secure://providers/${randomUUID()}`,
    ownerScope: body?.ownerScope,
    ownerId: body?.ownerId,
    description: body?.description,
    endpoint: body?.endpoint,
    region: body?.region,
    metadata: body?.metadata,
    capabilities: protocol ? [] : undefined,
  })

  if (!provider) {
    throw createError({ statusCode: 404, statusMessage: 'Provider registry entry not found.' })
  }

  return { provider }
})
