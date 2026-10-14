import { describe, expect, it, vi } from 'vitest'
import {
  CONTEXT_ACTIONS_PROVIDER_ID,
  TuffInputType,
  type ISearchProvider,
  type TuffQuery
} from '@talex-touch/utils'
import { APP_DESTINATION_PROVIDER_ID } from '../../../../shared/app-destinations'

vi.mock('../addon/files/everything-provider', () => ({
  everythingProvider: {
    buildUnavailableNotice: vi.fn(() => null),
    id: 'everything-provider',
    isSearchReady: vi.fn(() => false),
    onSearch: vi.fn(),
    supportedInputTypes: [TuffInputType.Text, TuffInputType.Files],
    type: 'file'
  }
}))

vi.mock('../addon/files/file-provider', () => ({
  fileProvider: {
    buildStartupDegradedNotice: vi.fn(() => null),
    hasSearchFilters: vi.fn(() => false),
    id: 'file-provider',
    onSearch: vi.fn(),
    supportedInputTypes: [TuffInputType.Text, TuffInputType.Files],
    type: 'file'
  }
}))

import { SearchQueryOrchestrator } from './search-query-orchestrator'
import type { ProviderContext } from './types'

function createMockProvider(
  overrides: Partial<ISearchProvider<ProviderContext>>
): ISearchProvider<ProviderContext> {
  return {
    id: 'mock-provider',
    name: 'Mock Provider',
    type: 'plugin',
    supportedInputTypes: [TuffInputType.Text],
    priority: 'fast',
    onSearch: vi.fn(),
    ...overrides
  } as unknown as ISearchProvider<ProviderContext>
}

describe('SearchQueryOrchestrator provider aggregation', () => {
  const orchestrator = new SearchQueryOrchestrator({
    getProviderConfigSignature: () => 'sig',
    getActivations: () => null,
    shouldSkipProvider: () => false
  })

  const appProvider = createMockProvider({
    id: 'app-provider',
    name: 'App Provider',
    type: 'application',
    supportedInputTypes: [TuffInputType.Text]
  })

  const appDestinationProvider = createMockProvider({
    id: APP_DESTINATION_PROVIDER_ID,
    name: 'App Destinations',
    type: 'system',
    supportedInputTypes: [TuffInputType.Text]
  })

  const windowsShellFileProvider = createMockProvider({
    id: 'windows-shell-file-provider',
    name: 'Windows Shell File Entries',
    type: 'file',
    supportedInputTypes: [TuffInputType.Text]
  })

  const pluginFeaturesProvider = createMockProvider({
    id: 'plugin-features',
    name: 'Plugin Features',
    type: 'plugin',
    supportedInputTypes: [TuffInputType.Text, TuffInputType.Image, TuffInputType.Files]
  })

  const contextActionsProvider = createMockProvider({
    id: CONTEXT_ACTIONS_PROVIDER_ID,
    name: 'Context Actions',
    type: 'system',
    supportedInputTypes: [TuffInputType.Text, TuffInputType.Image]
  })

  const fileProvider = createMockProvider({
    id: 'file-provider',
    name: 'File Provider',
    type: 'file',
    supportedInputTypes: [TuffInputType.Text, TuffInputType.Files]
  })

  const allProviders = [
    appProvider,
    appDestinationProvider,
    windowsShellFileProvider,
    pluginFeaturesProvider,
    contextActionsProvider,
    fileProvider
  ]

  it('retains app providers when searching with plain text query', () => {
    const query: TuffQuery = {
      text: 'tuff settings',
      inputs: []
    }

    const { providers } = orchestrator.aggregate(allProviders, query, {})
    const ids = providers.map((p) => p.id)

    expect(ids).toContain('app-provider')
    expect(ids).toContain(APP_DESTINATION_PROVIDER_ID)
    expect(ids).toContain('plugin-features')
  })

  it('excludes application and destination providers when an image input is present', () => {
    const query: TuffQuery = {
      text: 'ocr',
      inputs: [
        {
          type: TuffInputType.Image,
          content: 'data:image/png;base64,mock'
        }
      ]
    }

    const { providers } = orchestrator.aggregate(allProviders, query, {})
    const ids = providers.map((p) => p.id)

    expect(ids).not.toContain('app-provider')
    expect(ids).not.toContain(APP_DESTINATION_PROVIDER_ID)
    expect(ids).not.toContain('windows-shell-file-provider')
    expect(ids).not.toContain('file-provider')
    expect(ids).toContain('plugin-features')
    expect(ids).toContain(CONTEXT_ACTIONS_PROVIDER_ID)
  })

  it('excludes application providers when a file input is present', () => {
    const query: TuffQuery = {
      text: 'compress',
      inputs: [
        {
          type: TuffInputType.Files,
          content: JSON.stringify(['/path/to/file.png'])
        }
      ]
    }

    const { providers } = orchestrator.aggregate(allProviders, query, {})
    const ids = providers.map((p) => p.id)

    expect(ids).not.toContain('app-provider')
    expect(ids).not.toContain(APP_DESTINATION_PROVIDER_ID)
    expect(ids).not.toContain('windows-shell-file-provider')
    expect(ids).toContain('plugin-features')
    expect(ids).toContain('file-provider')
  })
})
