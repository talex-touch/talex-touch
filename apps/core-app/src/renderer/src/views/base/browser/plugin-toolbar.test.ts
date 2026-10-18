import type { ITouchPlugin } from '@talex-touch/utils/plugin'
import { PluginStatus } from '@talex-touch/utils/plugin'
import { describe, expect, it } from 'vitest'
import {
  assertBrowserFeatureTriggered,
  isBrowserPluginRunnable,
  resolveBrowserPinnedPlugins
} from './plugin-toolbar'

function plugin(
  name: string,
  status: PluginStatus,
  loadState: ITouchPlugin['loadState'] = 'ready'
): ITouchPlugin {
  // Toolbar resolution only consumes identity and lifecycle fields, not host methods.
  return { name, status, loadState } as unknown as ITouchPlugin
}

describe('browser plugin shortcuts', () => {
  it('restores persisted pin order without duplicates and drops uninstalled plugins from the live list', () => {
    const first = plugin('first', PluginStatus.ENABLED)
    const second = plugin('second', PluginStatus.ACTIVE)
    const third = plugin('third', PluginStatus.ENABLED)
    const pins: unknown = JSON.parse(
      JSON.stringify(['third', 'uninstalled', 'first', 'third', '', '   ', 42])
    )

    expect(
      resolveBrowserPinnedPlugins([first, second, third], pins).map(({ name }) => name)
    ).toEqual(['third', 'first'])
    expect(resolveBrowserPinnedPlugins([first, second], pins).map(({ name }) => name)).toEqual([
      'first'
    ])
  })

  it('does not repopulate shortcuts after the user explicitly unpins every plugin', () => {
    const plugins = [plugin('first', PluginStatus.ENABLED), plugin('second', PluginStatus.ACTIVE)]
    const persistedPins: unknown = JSON.parse('[]')

    expect(resolveBrowserPinnedPlugins(plugins, persistedPins)).toEqual([])
  })

  it.each([
    { name: 'enabled', status: PluginStatus.ENABLED, loadState: 'ready', runnable: true },
    { name: 'active', status: PluginStatus.ACTIVE, loadState: 'ready', runnable: true },
    { name: 'disabled', status: PluginStatus.DISABLED, loadState: 'ready', runnable: false },
    { name: 'disabling', status: PluginStatus.DISABLING, loadState: 'ready', runnable: false },
    { name: 'crashed', status: PluginStatus.CRASHED, loadState: 'ready', runnable: false },
    { name: 'only loaded', status: PluginStatus.LOADED, loadState: 'ready', runnable: false },
    { name: 'still loading', status: PluginStatus.ENABLED, loadState: 'loading', runnable: false },
    {
      name: 'failed to load',
      status: PluginStatus.ACTIVE,
      loadState: 'load_failed',
      runnable: false
    }
  ] as const)(
    'keeps a $name pin but only allows runnable plugins to launch',
    ({ status, loadState, runnable }) => {
      const pinned = plugin('pinned', status, loadState)
      const resolved = resolveBrowserPinnedPlugins([pinned], ['pinned'])

      expect(resolved.map(({ name }) => name)).toEqual(['pinned'])
      expect(isBrowserPluginRunnable(resolved[0]!)).toBe(runnable)
    }
  )

  it.each([
    { name: 'host error', result: { error: 'PLUGIN_DISABLED' }, message: 'PLUGIN_DISABLED' },
    {
      name: 'host error despite an acceptance field',
      result: { accepted: true, error: 'FEATURE_PERMISSION_DENIED' },
      message: 'FEATURE_PERMISSION_DENIED'
    },
    { name: 'rejected feature', result: { accepted: false }, message: 'Feature launch rejected' },
    { name: 'missing acceptance', result: {}, message: 'Feature launch rejected' }
  ])(
    'surfaces a resolved $name instead of treating transport resolution as success',
    ({ result, message }) => {
      expect(() => assertBrowserFeatureTriggered(result, 'Feature launch rejected')).toThrow(
        message
      )
    }
  )
})
