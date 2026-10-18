import type { IPluginFeature, ITouchPlugin } from '@talex-touch/utils/plugin'
import { PluginStatus } from '@talex-touch/utils'

/** null preserves the first-use defaults; an explicit empty list must stay empty. */
export function normalizeBrowserPluginPins(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return [
    ...new Set(
      value.filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
    )
  ]
}

export function isBrowserPluginRunnable(plugin: ITouchPlugin): boolean {
  return (
    (plugin.status === PluginStatus.ENABLED || plugin.status === PluginStatus.ACTIVE) &&
    plugin.loadState !== 'loading' &&
    plugin.loadState !== 'load_failed'
  )
}

/** The store already carries the host's platform-filtered feature list. */
export function browserPluginFeatures(plugin: ITouchPlugin): IPluginFeature[] {
  return (plugin.features ?? [])
    .filter((feature) => !feature.experimental || plugin.dev?.enable)
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
}

/** Resolve against the live, visibility-filtered store, never cached plugin snapshots. */
export function resolveBrowserPinnedPlugins(
  plugins: readonly ITouchPlugin[],
  storedPins: unknown
): ITouchPlugin[] {
  const names = normalizeBrowserPluginPins(storedPins)
  if (names === null) return plugins.filter(isBrowserPluginRunnable).slice(0, 3)
  const byName = new Map(plugins.map((plugin) => [plugin.name, plugin]))
  return names.flatMap((name) => {
    const plugin = byName.get(name)
    return plugin ? [plugin] : []
  })
}

/** The transport resolves host failures as { error }; promise resolution alone is not success. */
export function assertBrowserFeatureTriggered(result: unknown, fallbackMessage: string): void {
  if (result && typeof result === 'object') {
    if ('error' in result && typeof result.error === 'string' && result.error) {
      throw new Error(result.error)
    }
    if ('accepted' in result && result.accepted === true) return
  }
  throw new Error(fallbackMessage)
}
