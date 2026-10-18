import { describe, expect, it } from 'vitest'
import { TuffInputType, type IProviderActivate, type TuffQuery } from '@talex-touch/utils'
import {
  buildSearchCacheKey,
  isDeferredSemanticQueryEligible,
  matchesProviderFilter,
  parseProviderFilter,
  roundDuration,
  toQueryHash
} from './search-core-utils'

describe('search-core-utils', () => {
  describe('buildSearchCacheKey (C3 audit defense)', () => {
    it('produces strictly identical cache keys for identical queries across invocations', () => {
      const query1: TuffQuery = { text: 'tuff search', inputs: [] }
      const query2: TuffQuery = { text: 'tuff search', inputs: [] }

      const key1 = buildSearchCacheKey(query1, undefined, null)
      const key2 = buildSearchCacheKey(query2, undefined, null)

      expect(key1).toBe(key2)
      expect(typeof key1).toBe('string')
      expect(key1.length).toBe(16)
    })

    it('produces identical cache key regardless of object key insertion order in inputs', () => {
      const queryA: TuffQuery = {
        text: 'file analysis',
        inputs: [
          {
            type: TuffInputType.Files,
            content: JSON.stringify({ path: '/a/b.txt', size: 1024, mime: 'text/plain' })
          }
        ]
      }

      const queryB: TuffQuery = {
        text: 'file analysis',
        inputs: [
          {
            type: TuffInputType.Files,
            content: JSON.stringify({ mime: 'text/plain', size: 1024, path: '/a/b.txt' })
          }
        ]
      }

      const keyA = buildSearchCacheKey(queryA, undefined, null)
      const keyB = buildSearchCacheKey(queryB, undefined, null)

      expect(keyA).toBe(keyB)
    })

    it('produces identical cache key regardless of activatedProviders insertion order in Map', () => {
      const query: TuffQuery = { text: 'test query', inputs: [] }

      const map1 = new Map<string, IProviderActivate>([
        ['provider-a', { id: 'provider-a' } as IProviderActivate],
        ['provider-b', { id: 'provider-b' } as IProviderActivate]
      ])

      const map2 = new Map<string, IProviderActivate>([
        ['provider-b', { id: 'provider-b' } as IProviderActivate],
        ['provider-a', { id: 'provider-a' } as IProviderActivate]
      ])

      const key1 = buildSearchCacheKey(query, undefined, map1)
      const key2 = buildSearchCacheKey(query, undefined, map2)

      expect(key1).toBe(key2)
    })

    it('produces distinct cache keys for different search text or provider filters', () => {
      const q1: TuffQuery = { text: 'hello', inputs: [] }
      const q2: TuffQuery = { text: 'world', inputs: [] }

      expect(buildSearchCacheKey(q1, undefined, null)).not.toBe(
        buildSearchCacheKey(q2, undefined, null)
      )
      expect(buildSearchCacheKey(q1, 'file', null)).not.toBe(buildSearchCacheKey(q1, 'app', null))
    })

    it('produces distinct cache keys when legitimate query options differ', () => {
      const base: TuffQuery = { text: 'query', inputs: [] }
      const withType: TuffQuery = { text: 'query', type: 'image', inputs: [] }
      const withSort: TuffQuery = { text: 'query', sort: 'date', inputs: [] }

      const kBase = buildSearchCacheKey(base, undefined, null)
      const kType = buildSearchCacheKey(withType, undefined, null)
      const kSort = buildSearchCacheKey(withSort, undefined, null)

      expect(kBase).not.toBe(kType)
      expect(kBase).not.toBe(kSort)
      expect(kType).not.toBe(kSort)
    })

    it('ignores ephemeral session and request metadata to protect cache hit rate', () => {
      const cleanQuery: TuffQuery = { text: 'cache me', inputs: [] }
      const requestWithDynamicMetadata = {
        text: 'cache me',
        inputs: [],
        sessionId: 'session_123456',
        requestId: 'req_abc_789',
        timestamp: 1729234567890,
        _traceId: 'trace-xyz-999'
      } as unknown as TuffQuery

      const cleanKey = buildSearchCacheKey(cleanQuery, undefined, null)
      const dynamicKey = buildSearchCacheKey(requestWithDynamicMetadata, undefined, null)

      expect(dynamicKey).toBe(cleanKey)
    })
  })

  describe('parseProviderFilter', () => {
    it('extracts @provider filter prefix from raw input', () => {
      expect(parseProviderFilter('@file report.pdf')).toEqual({
        raw: '@file report.pdf',
        providerFilter: 'file',
        text: 'report.pdf'
      })
      expect(parseProviderFilter('plain text query')).toEqual({
        raw: 'plain text query',
        text: 'plain text query'
      })
    })
  })

  describe('matchesProviderFilter', () => {
    it('matches provider IDs directly or by alias', () => {
      expect(matchesProviderFilter('file-provider', 'file')).toBe(true)
      expect(matchesProviderFilter('everything-provider', 'file')).toBe(true)
      expect(matchesProviderFilter('app-provider', 'app')).toBe(true)
      expect(matchesProviderFilter('app-provider', 'file')).toBe(false)
    })
  })

  describe('isDeferredSemanticQueryEligible', () => {
    it('admits short Han queries while enforcing length for Latin text', () => {
      expect(isDeferredSemanticQueryEligible('猫')).toBe(true)
      expect(isDeferredSemanticQueryEligible('宠物')).toBe(true)
      expect(isDeferredSemanticQueryEligible('猫咪狗狗')).toBe(true)

      expect(isDeferredSemanticQueryEligible('cat')).toBe(true)
      expect(isDeferredSemanticQueryEligible('a')).toBe(false)
      expect(isDeferredSemanticQueryEligible('  ')).toBe(false)
    })
  })

  describe('utilities', () => {
    it('rounds duration and hashes queries reliably', () => {
      expect(roundDuration(12.6)).toBe(13)
      expect(roundDuration(undefined)).toBeUndefined()
      expect(roundDuration(NaN)).toBeUndefined()

      expect(toQueryHash('test')).toBe(toQueryHash('test'))
      expect(toQueryHash('test')).not.toBe(toQueryHash('other'))
    })
  })
})
