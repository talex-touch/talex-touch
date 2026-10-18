import { createError, readBody } from 'h3'
import { randomUUID } from 'node:crypto'
import { resolveProviderProtocol } from '../../../../shared/provider-registry'
import { requireAdmin } from '../../../utils/auth'
import { assertNoPlainProviderSecrets, createProviderRegistryEntry } from '../../../utils/providerRegistryStore'

export default defineEventHandler(async (event) => {
  const { userId } = await requireAdmin(event)
  const body = await readBody(event)

  assertNoPlainProviderSecrets(body)
  if (body?.authRef !== undefined)
    throw createError({ statusCode: 400, statusMessage: 'Provider credential references are server-owned.' })
  const protocol = resolveProviderProtocol(String(body?.metadata?.adapterKey ?? ''))
  if (!protocol)
    throw createError({ statusCode: 400, statusMessage: 'A supported provider protocol is required.' })

  const provider = await createProviderRegistryEntry(event, {
    name: body?.name,
    displayName: body?.displayName,
    vendor: protocol.vendor,
    status: body?.status,
    authType: protocol.authType,
    authRef: protocol.authType === 'none' ? null : `secure://providers/${randomUUID()}`,
    ownerScope: body?.ownerScope,
    ownerId: body?.ownerId,
    description: body?.description,
    endpoint: body?.endpoint,
    region: body?.region,
    metadata: body?.metadata,
    capabilities: [],
  }, userId)

  return { provider }
})
