import { createError, readBody } from 'h3'
import { requireAdmin } from '../../../utils/auth'
import { createSceneRegistryEntry, withSceneRegistryReadiness } from '../../../utils/sceneRegistryStore'
import { PRODUCT_SCENE_TEMPLATES } from '../../../../shared/provider-registry'

export default defineEventHandler(async (event) => {
  const { userId } = await requireAdmin(event)
  const body = await readBody(event)
  const definition = PRODUCT_SCENE_TEMPLATES.find(scene => scene.id === body?.id)
  if (!definition)
    throw createError({ statusCode: 400, statusMessage: 'Choose a code-defined product function.' })

  const scene = await createSceneRegistryEntry(event, {
    id: definition.id,
    displayName: definition.displayName,
    owner: definition.owner,
    ownerScope: 'system',
    status: body?.status,
    requiredCapabilities: definition.requiredCapabilities,
    strategyMode: body?.strategyMode,
    fallback: body?.fallback,
    meteringPolicy: definition.meteringPolicy,
    auditPolicy: { persistInput: false, persistOutput: false, persistTrace: true },
    metadata: { source: 'product-function-catalog' },
    bindings: body?.bindings,
  }, userId)

  return { scene: await withSceneRegistryReadiness(event, scene) }
})
