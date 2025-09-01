import {
  IFeatureCommand,
  ITouchPlugin,
  IPluginFeature,
  IPluginIcon
} from '@talex-touch/utils/plugin'
import {
  IExecuteArgs,
  ISearchProvider,
  TuffItem,
  TuffQuery,
  TuffSearchResult,
  TuffSourceType
} from '../box-tool/search-engine/types'
import { IProviderActivate } from '@talex-touch/utils'
import { genPluginManager, TouchPlugin } from '../../plugins'
import { TuffFactory } from '@talex-touch/utils'
import searchEngineCore from '../box-tool/search-engine/search-core';
import { PluginViewLoader } from './plugin-view-loader';

// Manually define the strict type for TuffItem icons based on compiler errors.
type TuffIconType = 'url' | 'emoji' | 'base64' | 'fluent' | 'component';

/**
 * Checks if a feature's command matches the given query text.
 * @param command - The feature command to check.
 * @param queryText - The user's input query.
 * @returns True if the command matches, false otherwise.
 */
function isCommandMatch(command: IFeatureCommand, queryText: string): boolean {
  console.debug(
    `[PluginFeaturesAdapter] isCommandMatch: query="${queryText}", command=`,
    JSON.stringify(command)
  )
  if (!command.type) {
    return true
  }
  if (!queryText && command.type !== 'over') {
    return false
  }

  switch (command.type) {
    case 'over':
      return true
    case 'match':
      if (Array.isArray(command.value)) {
        return command.value.some((value) => queryText.startsWith(value))
      }
      return queryText.startsWith(command.value as string)
    case 'contain':
      if (Array.isArray(command.value)) {
        return command.value.some((value) => queryText.includes(value))
      }
      return queryText.includes(command.value as string)
    case 'regex':
      return (command.value as RegExp).test(queryText)
    default:
      console.debug(
        `[PluginFeaturesAdapter] isCommandMatch: Unknown type "${command.type}", returning false.`
      )
      return false
  }
}

/**
 * Maps the legacy plugin icon type to the new TuffIconType.
 * @param type - The icon type from IPluginIcon.
 * @returns The corresponding TuffIconType.
 */
function mapIconType(type: string): TuffIconType {
  switch (type) {
    case 'file':
      return 'base64'
    case 'remixicon':
      return 'fluent' // Assuming remixicon can be mapped to a font icon like fluent
    case 'class':
      return 'fluent' // Assuming class-based icons are font icons
    default:
      // Fallback for any other type to a default icon type.
      return 'fluent'
  }
}

/**
 * An adapter that exposes features from the legacy plugin system
 * as a modern ISearchProvider.
 */
export class PluginFeaturesAdapter implements ISearchProvider {
  public readonly id = 'plugin-features'
  public readonly type: TuffSourceType = 'plugin'
  public readonly name = 'Plugin Features'

  public async onExecute(args: IExecuteArgs): Promise<IProviderActivate | null> {
    const { item } = args

    // If `defaultAction` exists, it's an "Action Item" for a plugin to handle.
    if (item.meta?.defaultAction) {
      const pluginName = item.meta?.pluginName
      if (!pluginName) {
        console.error(
          '[PluginFeaturesAdapter] onExecute (Action): Missing pluginName in item.meta.'
        )
        return null
      }

      const pluginManager = genPluginManager()
      const plugin = pluginManager.plugins.get(pluginName) as TouchPlugin | undefined

      if (plugin?.pluginLifecycle?.onItemAction) {
        console.debug(
          `[PluginFeaturesAdapter] Routing to ${pluginName}.onItemAction for default action.`
        )
        await plugin.pluginLifecycle.onItemAction(item)
        // Simple actions should not activate a provider.
        return null
      } else {
        console.warn(
          `[PluginFeaturesAdapter] Plugin ${pluginName} has defaultAction but no onItemAction handler.`
        )
        return null
      }
    }

    // Otherwise, it's a "Feature Item" intended to activate a feature.
    console.debug(`[PluginFeaturesAdapter] Executing as a Feature Item.`)
    const meta = item.meta || {}
    const extension = meta.extension || {}
    // For feature items, the plugin name is in the payload of the 'trigger-feature' action.
    const pluginName =
      meta.pluginName || extension.pluginName || item.actions?.[0]?.payload?.pluginName
    const featureId = meta.featureId || extension.featureId || item.actions?.[0]?.payload?.featureId

    if (!pluginName || !featureId) {
      console.error(
        '[PluginFeaturesAdapter] onExecute (Feature): Missing pluginName or featureId.',
        item
      )
      return null
    }

    const pluginManager = genPluginManager()
    const plugin = pluginManager.plugins.get(pluginName)
    if (!plugin || !this.isPluginActive(plugin)) {
      console.error(
        `[PluginFeaturesAdapter] Plugin not found or not active: ${pluginName} (status: ${plugin?.status})`
      )
      return null
    }

    const feature = plugin.getFeature(featureId)
    if (!feature) {
      console.error(
        `[PluginFeaturesAdapter] Feature not found: ${featureId} in plugin ${pluginName}`
      )
      return null
    }

    // Handle webcontent interaction
    if (feature.interaction && feature.interaction.type === 'webcontent') {
      // Delegate view loading to the unified PluginViewLoader.
      // The loader will add issues to plugin.issues if an error occurs.
      await PluginViewLoader.loadPluginView(plugin as TouchPlugin, feature);

      // Check if the loader added an INVALID_VIEW_PATH issue to the plugin.
      // If so, it means the view could not be loaded due to a security concern.
      if (plugin.issues.some(issue => issue.code === 'INVALID_VIEW_PATH' && issue.source === `feature:${feature.id}`)) {
         return null;
      }

      // Return an activation object to keep the plugin active
      return {
        id: this.id,
        name: plugin.name,
        icon: {
          type: mapIconType((plugin.icon as IPluginIcon).type),
          value: (plugin.icon as IPluginIcon).value
        },
        meta: {
          pluginName,
          featureId,
          pluginIcon: plugin.icon,
          feature: item
        }
      }
    }

    // Default feature execution
    plugin.triggerFeature(feature, args.searchResult?.query.text)

    if (feature.push) {
      return {
        id: this.id,
        meta: {
          pluginName,
          featureId,
          pluginIcon: plugin.icon,
          feature: item
        }
      }
    }

    return null
  }

  private isPluginActive(plugin: ITouchPlugin): boolean {
    return plugin.status === PluginStatus.ENABLED || plugin.status === PluginStatus.ACTIVE
  }

  private createTuffItem(plugin: ITouchPlugin, feature: IPluginFeature): TuffItem {
    return {
      id: `${plugin.name}/${feature.id}`,
      source: {
        type: this.type,
        id: this.id,
        name: this.name
      },
      kind: 'feature',
      render: {
        mode: 'default',
        basic: {
          title: feature.name,
          subtitle: feature.desc,
          icon: {
            type: mapIconType((feature.icon as IPluginIcon).type),
            value: (feature.icon as IPluginIcon).value
          }
        }
      },
      actions: [
        {
          id: 'trigger-feature',
          type: 'execute',
          label: 'Execute',
          primary: true,
          payload: {
            pluginName: plugin.name,
            featureId: feature.id
          }
        }
      ],
      meta: {
        pluginName: plugin.name,
        featureId: feature.id,
        extension: {
          commands: feature.commands
        }
      }
    }
  }

  public async onSearch(query: TuffQuery, signal: AbortSignal): Promise<TuffSearchResult> {
    const activationState = searchEngineCore.getActivationState()

    // --- Activated Mode ---
    // If there is an active feature, route the input directly to it.
    if (activationState) {
      const activeFeatureActivation = activationState.find((a) => a.id === this.id)
      if (activeFeatureActivation?.meta?.pluginName) {
        const { pluginName, featureId } = activeFeatureActivation.meta
        const pluginManager = genPluginManager()
        const plugin = pluginManager.plugins.get(pluginName) as TouchPlugin
        const feature = plugin?.getFeature(featureId)

        if (plugin && feature && this.isPluginActive(plugin)) {
          // If query is empty, return all features of the activated plugin
          if (!query.text) {
            const allFeatures = plugin.getFeatures()
            const items = allFeatures.map((f) => this.createTuffItem(plugin, f))
            return TuffFactory.createSearchResult(query)
              .setItems(items)
              .setActivate(activationState)
              .build()
          }

          console.debug(
            `[PluginFeaturesAdapter] Activated search: Routing query "${query.text}" to feature "${feature.id}" of plugin "${plugin.name}"`
          )
          // Trigger the input change handler for the specific feature.
          // The feature itself is responsible for pushing results back.
          plugin.triggerInputChanged(feature, query.text)

          // In activated mode, the result is delivered via a side-channel (pushItems),
          // so we return an empty result here.
          return TuffFactory.createSearchResult(query)
            .setActivate(activationState) // Preserve activation state
            .build()
        }
      }
    }

    // --- Global Search Mode ---
    // If no feature is active, perform a global search across all plugin features.
    console.debug(`[PluginFeaturesAdapter] Global search with query: "${query.text}"`)
    const pluginManager = genPluginManager()
    if (!pluginManager) {
      return TuffFactory.createSearchResult(query).build()
    }

    const queryText = query.text.trim()
    const matchedItems: TuffItem[] = []
    const plugins = pluginManager.plugins.values()

    for (const plugin of plugins as Iterable<ITouchPlugin>) {
      if (signal.aborted) {
        return TuffFactory.createSearchResult(query).build()
      }

      if (!this.isPluginActive(plugin)) {
        continue
      }

      const features = plugin.getFeatures()
      for (const feature of features as IPluginFeature[]) {
        const isMatch = feature.commands.some((cmd) => isCommandMatch(cmd, queryText))
        if (isMatch) {
          matchedItems.push(this.createTuffItem(plugin, feature))
        }
      }
    }

    return TuffFactory.createSearchResult(query).setItems(matchedItems).build()
  }
}

export default new PluginFeaturesAdapter()
