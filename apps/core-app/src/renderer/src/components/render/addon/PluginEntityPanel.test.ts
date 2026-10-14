// @vitest-environment jsdom
import type { TuffItem } from '@talex-touch/utils'
import type { PluginEntitySnapshot } from '../../../../../shared/plugin-entity'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_ENTITY_ACTION_IDS as actions } from '../../../../../shared/plugin-entity'
import PluginEntityPanel from './PluginEntityPanel.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('~/modules/platform/renderer-platform', () => ({
  getCurrentRendererPlatformState: () => ({ isMac: false })
}))
vi.mock('@talex-touch/tuffex/button', () => ({
  TxButton: {
    props: ['disabled', 'loading'],
    template: '<button :disabled="disabled"><slot /></button>'
  }
}))
vi.mock('@talex-touch/tuffex/icon', () => ({ TxIcon: { template: '<i />' } }))
vi.mock('@talex-touch/tuffex/scroll', () => ({ TxScroll: { template: '<div><slot /></div>' } }))

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

function entityItem(overrides: Partial<PluginEntitySnapshot> = {}): TuffItem {
  return {
    id: 'plugin-entity:notes',
    kind: 'plugin',
    source: { id: 'plugin-entities', type: 'system' },
    render: { mode: 'default', basic: { title: 'Notes' } },
    actions: [
      { id: actions.runFeature, type: 'execute', label: 'Run feature' },
      { id: actions.disable, type: 'execute', label: 'Disable' },
      { id: actions.reload, type: 'execute', label: 'Reload' },
      { id: 'copy-title', type: 'copy', label: 'Copy title' }
    ],
    meta: {
      extension: {
        pluginEntity: {
          name: 'notes',
          displayName: 'Notes',
          version: '1.0.0',
          description: '',
          dev: false,
          state: 'enabled',
          primaryAction: actions.runFeature,
          features: [],
          ...overrides
        }
      }
    }
  } as TuffItem
}

describe('installed plugin management pane', () => {
  it("shows only the row's management actions, and updates them when the row changes", async () => {
    wrapper = mount(PluginEntityPanel, { props: { item: entityItem(), runAction: async () => {} } })
    expect(
      wrapper.findAll('button').map((button) => button.attributes('data-plugin-entity-action'))
    ).toEqual([actions.disable, actions.reload])
    const disabled = entityItem({ state: 'disabled', primaryAction: actions.enable })
    disabled.actions = [{ id: actions.enable, type: 'execute', label: 'Enable' }]
    await wrapper.setProps({ item: disabled })
    expect(
      wrapper.findAll('button').map((button) => button.attributes('data-plugin-entity-action'))
    ).toEqual([actions.enable])
    expect(wrapper.get('[data-state]').attributes('data-state')).toBe('disabled')
  })

  it('blocks duplicate management actions until the pending action settles, then permits a new action', async () => {
    const pending = Promise.withResolvers<void>()
    const completed: string[] = []
    wrapper = mount(PluginEntityPanel, {
      props: {
        item: entityItem(),
        runAction: async (actionId) => {
          completed.push(actionId)
          if (actionId === actions.disable) await pending.promise
        }
      }
    })
    await wrapper.get(`[data-plugin-entity-action="${actions.disable}"]`).trigger('click')
    expect(wrapper.findAll('button').map((button) => button.element.disabled)).toEqual([true, true])
    await wrapper.get(`[data-plugin-entity-action="${actions.reload}"]`).trigger('click')
    expect(completed).toEqual([actions.disable])
    pending.resolve()
    await flushPromises()
    expect(wrapper.findAll('button').map((button) => button.element.disabled)).toEqual([
      false,
      false
    ])
    await wrapper.get(`[data-plugin-entity-action="${actions.reload}"]`).trigger('click')
    expect(completed).toEqual([actions.disable, actions.reload])
  })

  it('offers Run only for executable feature rows and emits the selected feature, not the plugin entity', async () => {
    const runnable = {
      id: 'notes/write',
      kind: 'feature',
      source: { id: 'plugin-features', type: 'plugin' },
      render: { mode: 'default', basic: { title: 'Write' } }
    } as TuffItem
    wrapper = mount(PluginEntityPanel, {
      props: {
        runAction: async () => {},
        item: entityItem({
          features: [
            { id: 'write', name: 'Write', desc: '', item: runnable },
            { id: 'unavailable', name: 'Unavailable', desc: '' }
          ]
        })
      }
    })
    expect(wrapper.get('[data-plugin-entity-feature="unavailable"]').find('button').exists()).toBe(
      false
    )
    await wrapper.get('[data-plugin-entity-feature="write"] button').trigger('click')
    expect(wrapper.emitted('runFeature')).toEqual([[runnable]])
    await wrapper.setProps({
      item: entityItem({
        state: 'disabled',
        primaryAction: actions.enable,
        features: [{ id: 'write', name: 'Write', desc: '' }]
      })
    })
    expect(wrapper.get('[data-plugin-entity-feature="write"]').find('button').exists()).toBe(false)
  })

  it('draws no management pane for a malformed IPC snapshot', () => {
    const item = entityItem()
    item.meta!.extension!.pluginEntity = {
      name: 'notes',
      state: 'enabled',
      primaryAction: actions.runFeature,
      features: [null]
    }
    wrapper = mount(PluginEntityPanel, { props: { item, runAction: async () => {} } })
    expect(wrapper.find('.PluginEntityPanel').exists()).toBe(false)
    expect(wrapper.findAll('button')).toEqual([])
  })
})
