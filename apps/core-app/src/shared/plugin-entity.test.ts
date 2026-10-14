import type { TuffItem } from '@talex-touch/utils'
import type { PluginEntitySnapshot, PluginEntityState } from './plugin-entity'
import { describe, expect, it } from 'vitest'
import {
  PLUGIN_ENTITY_ACTION_IDS,
  readPluginEntitySnapshot,
  resolvePluginEntityPrimaryAction,
  resolvePluginEntityRunnableFeature
} from './plugin-entity'

function featureItem(id: string): TuffItem {
  return {
    id,
    kind: 'feature',
    source: { id: 'touch-notes', type: 'plugin' },
    render: { mode: 'default', basic: { title: id } }
  }
}

function snapshot(overrides: Partial<PluginEntitySnapshot> = {}): PluginEntitySnapshot {
  return {
    name: 'touch-notes',
    displayName: 'Notes',
    version: '1.2.3',
    description: 'Write notes',
    state: 'enabled',
    primaryAction: PLUGIN_ENTITY_ACTION_IDS.runFeature,
    dev: false,
    features: [{ id: 'write', name: 'Write', desc: 'Write a note', item: featureItem('write') }],
    ...overrides
  }
}

function entityItem(candidate: unknown, kind: TuffItem['kind'] = 'plugin'): TuffItem {
  return {
    id: 'plugin-entity:touch-notes',
    kind,
    source: { id: 'plugin-entities', type: 'system' },
    render: { mode: 'default', basic: { title: 'Notes' } },
    meta: { extension: { pluginEntity: candidate } }
  } as TuffItem
}

describe('plugin entity Enter contract', () => {
  it.each([
    ['enabled', true, PLUGIN_ENTITY_ACTION_IDS.runFeature],
    ['enabled', false, PLUGIN_ENTITY_ACTION_IDS.openDetail],
    ['disabled', true, PLUGIN_ENTITY_ACTION_IDS.enable],
    ['disabled', false, PLUGIN_ENTITY_ACTION_IDS.enable],
    ['loading', true, PLUGIN_ENTITY_ACTION_IDS.openDetail],
    ['failed', true, PLUGIN_ENTITY_ACTION_IDS.reload],
    ['crashed', false, PLUGIN_ENTITY_ACTION_IDS.reload],
    ['dev-disconnected', true, PLUGIN_ENTITY_ACTION_IDS.reload]
  ] as const)(
    'offers %s with runnable=%s the actionable Enter target',
    (state, runnable, action) => {
      expect(resolvePluginEntityPrimaryAction(state, runnable)).toBe(action)
    }
  )

  it('skips unavailable features and runs the first available one in manifest order', () => {
    const first = featureItem('first')
    const second = featureItem('second')
    const entity = snapshot({
      features: [
        { id: 'hidden', name: 'Unavailable', desc: '' },
        { id: 'first', name: 'First', desc: '', item: first },
        { id: 'second', name: 'Second', desc: '', item: second }
      ]
    })

    expect(resolvePluginEntityRunnableFeature(entity)).toEqual(first)
  })

  it.each(['disabled', 'loading', 'failed', 'crashed', 'dev-disconnected'] as PluginEntityState[])(
    'does not run stale feature rows after the plugin becomes %s',
    (state) => {
      expect(resolvePluginEntityRunnableFeature(snapshot({ state }))).toBeNull()
    }
  )

  it('returns no runnable feature when every feature is unavailable', () => {
    expect(
      resolvePluginEntityRunnableFeature(
        snapshot({ features: [{ id: 'write', name: 'Write', desc: '' }] })
      )
    ).toBeNull()
  })
})

describe('plugin entity IPC snapshot boundary', () => {
  it('preserves the executable feature when reading an IPC-serialized plugin row', () => {
    const entity = snapshot()
    const row = JSON.parse(JSON.stringify(entityItem(entity))) as TuffItem
    const read = readPluginEntitySnapshot(row)

    expect(read).toEqual(entity)
    expect(resolvePluginEntityRunnableFeature(read!)).toEqual(featureItem('write'))
  })

  it('does not interpret a feature result as an installed plugin even if its metadata contains a snapshot', () => {
    expect(readPluginEntitySnapshot(entityItem(snapshot(), 'feature'))).toBeNull()
  })

  it.each([
    ['null snapshot', null],
    ['primitive snapshot', 'touch-notes'],
    ['missing name', { ...snapshot(), name: undefined }],
    ['empty name', { ...snapshot(), name: '' }],
    ['unknown state', { ...snapshot(), state: 'ACTIVE' }],
    ['prototype state', { ...snapshot(), state: 'toString' }],
    ['foreign action', { ...snapshot(), primaryAction: 'open' }],
    ['prototype action', { ...snapshot(), primaryAction: 'constructor' }],
    ['non-array features', { ...snapshot(), features: {} }],
    ['null feature entry', { ...snapshot(), features: [null] }]
  ])(
    'rejects %s rather than exposing malformed data to the pane or Enter handler',
    (_name, candidate) => {
      expect(readPluginEntitySnapshot(entityItem(candidate))).toBeNull()
    }
  )
})
