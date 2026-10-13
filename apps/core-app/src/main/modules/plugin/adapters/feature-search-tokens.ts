import type { IPluginFeature, ITouchPlugin } from '@talex-touch/utils/plugin'
import type { FeatureSearchToken } from '@talex-touch/utils/search'
import {
  addSimpleTextSearchTokens,
  addTitlePinyinSearchTokens,
  addTitleSearchTokens
} from '@talex-touch/utils/search'
import { pinyin } from 'pinyin-pro'
import { createLogger } from '../../../utils/logger'

const featureSearchTokensLog = createLogger('PluginSystem').child('FeatureSearchTokens')

function getPinyinSyllables(text: string): string[] {
  return pinyin(text, { toneType: 'none' })
    .split(/\s+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

function collectCommandTokens(commands: IPluginFeature['commands']): string[] {
  const values: string[] = []
  for (const cmd of commands) {
    if (typeof cmd.value === 'string') {
      values.push(cmd.value)
    } else if (Array.isArray(cmd.value)) {
      values.push(...cmd.value.filter((value): value is string => typeof value === 'string'))
    }
  }
  return values
}

export function buildFeatureSearchTokens(feature: IPluginFeature): FeatureSearchToken[] {
  const tokens: FeatureSearchToken[] = []

  addSimpleTextSearchTokens(tokens, feature.id, 'id', feature.id)
  addTitleSearchTokens(tokens, feature.name)
  addTitlePinyinSearchTokens(tokens, feature.name, {
    getSyllables: getPinyinSyllables,
    onError: (error) => featureSearchTokensLog.warn('Failed to generate pinyin tokens', { error })
  })
  addSimpleTextSearchTokens(tokens, feature.desc, 'description', feature.desc)

  feature.keywords?.forEach((keyword) =>
    addSimpleTextSearchTokens(tokens, keyword, 'keyword', keyword)
  )
  collectCommandTokens(feature.commands).forEach((cmd) =>
    addSimpleTextSearchTokens(tokens, cmd, 'command', cmd)
  )

  return tokens
}

/**
 * Tokens for a plugin row: what a user calls the plugin, not what it does. The folder name and the
 * display name (with its pinyin) match; the description is a weak token so a word from it still
 * finds the plugin, below any name hit.
 */
export function buildPluginEntitySearchTokens(
  plugin: Pick<ITouchPlugin, 'name' | 'displayName' | 'desc'>
): FeatureSearchToken[] {
  const tokens: FeatureSearchToken[] = []
  const displayName = plugin.displayName?.trim() || plugin.name

  addSimpleTextSearchTokens(tokens, plugin.name, 'id', plugin.name)
  addTitleSearchTokens(tokens, displayName)
  addTitlePinyinSearchTokens(tokens, displayName, {
    getSyllables: getPinyinSyllables,
    onError: (error) => featureSearchTokensLog.warn('Failed to generate pinyin tokens', { error })
  })
  addSimpleTextSearchTokens(tokens, plugin.desc, 'description', plugin.desc)

  return tokens
}
