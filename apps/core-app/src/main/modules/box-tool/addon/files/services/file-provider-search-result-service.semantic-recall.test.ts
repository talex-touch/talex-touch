import type { TuffItem, TuffQuery } from '@talex-touch/utils'
import type { Mock } from 'vitest'
import { describe, expect, it, vi } from 'vitest'
import { hashFileContentChunk } from './file-content-match'
import {
  FileProviderSearchResultService,
  type FileProviderSearchResultServiceDeps
} from './file-provider-search-result-service'

interface FakeRow {
  id: number
  path: string
  extension?: string
  content?: string
  chunks?: Array<{ text: string; pageNumber?: number; startLine?: number; endLine?: number }>
}

function makeService(opts: {
  semanticMatches: Array<{ sourceId: string; score: number; contentHash?: string }>
  rows: FakeRow[]
  isPathAdmitted?: (path: string) => boolean
  semanticReady?: Promise<void>
  onSemanticQuery?: () => void
  contentEnabled?: boolean
}): { service: FileProviderSearchResultService; semanticSearch: Mock } {
  const dbRows = opts.rows.map((row) => ({
    file: {
      id: row.id,
      path: row.path,
      name: row.path.split('/').at(-1) ?? row.path,
      type: 'file',
      extension: row.extension ?? '.txt',
      isDir: false,
      mtime: new Date(0),
      content: row.content ?? null
    },
    extensionKey: row.chunks ? 'content_chunks' : null,
    extensionValue: row.chunks ? JSON.stringify(row.chunks) : null
  }))

  // Minimal drizzle-style awaitable query chain.
  const getDb = (): unknown => ({
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => Promise.resolve(dbRows)
        })
      })
    })
  })

  const semanticSearch = vi.fn(async () => {
    opts.onSemanticQuery?.()
    await opts.semanticReady
    return opts.semanticMatches
  })

  const deps: FileProviderSearchResultServiceDeps = {
    providerId: 'files',
    // Split off in unit tests: getFileIndexReadDb falls back to the primary
    // handle, mirroring createDbUtils' flag-off behavior.
    getDbUtils: () => ({ getDb, getFileIndexReadDb: getDb }) as never,
    getSearchIndex: () => null,
    isContentIndexingEnabled: () => opts.contentEnabled ?? true,
    isPathAdmitted:
      opts.isPathAdmitted ?? ((path) => path.startsWith('/') && !path.endsWith('.itdb')),
    buildItem: (file) =>
      ({
        id: file.path,
        kind: 'file',
        source: { type: 'file', id: 'files', name: 'Files' },
        render: { mode: 'default', basic: { title: file.path } },
        meta: {}
      }) as TuffItem,
    normalizeItem: (item) => item,
    sanitizeExtensions: (extensions) => extensions,
    cleanupStaleCandidates: () => {},
    semanticSearch,
    logDebug: () => {},
    formatDuration: (ms) => `${ms}ms`,
    now: () => 0
  }

  return { service: new FileProviderSearchResultService(deps), semanticSearch }
}

describe('FileProviderSearchResultService.semanticRecall', () => {
  const signal = new AbortController().signal

  it('按分数降序返回、排除已渲染 id、并写入真实 semanticScore', async () => {
    const { service } = makeService({
      semanticMatches: [
        { sourceId: '1', score: 0.9 },
        { sourceId: '2', score: 0.7 },
        { sourceId: '3', score: 0.5 }
      ],
      rows: [
        { id: 1, path: '/a.txt' },
        { id: 2, path: '/b.txt' },
        { id: 3, path: '/c.txt' }
      ]
    })

    const result = await service.semanticRecall(
      { text: 'report' } as TuffQuery,
      new Set(['/b.txt']), // b 已在主结果里，应被排除
      signal
    )

    expect(result.map((item) => item.id)).toEqual(['/a.txt', '/c.txt'])
    const search = (
      result[0].meta?.extension as { search?: { semanticScore?: number } } | undefined
    )?.search
    expect(search?.semanticScore).toBe(0.9)
    expect(result[0].scoring?.match_details?.type).toBe('semantic')
    expect(result[0].scoring?.match).toBe(0)
    expect(result[0].meta?.deepMatch).toMatchObject({ kind: 'semantic', score: 0.9 })
  })

  it('过滤旧索引中的内部数据库召回项', async () => {
    const { service } = makeService({
      semanticMatches: [
        { sourceId: '1', score: 0.9 },
        { sourceId: '2', score: 0.8 }
      ],
      rows: [
        { id: 1, path: '/Users/demo/Music/Genius.itdb', extension: '.itdb' },
        { id: 2, path: '/Users/demo/Documents/report.txt' }
      ]
    })

    const result = await service.semanticRecall({ text: 'report' } as TuffQuery, new Set(), signal)

    expect(result.map((item) => item.id)).toEqual(['/Users/demo/Documents/report.txt'])
  })

  it('query 过短时不触发语义查询', async () => {
    const { service, semanticSearch } = makeService({
      semanticMatches: [{ sourceId: '1', score: 0.9 }],
      rows: [{ id: 1, path: '/a.txt' }]
    })

    const result = await service.semanticRecall({ text: 'ab' } as TuffQuery, new Set(), signal)

    expect(result).toEqual([])
    expect(semanticSearch).not.toHaveBeenCalled()
  })

  it('语义结果为空时返回空数组', async () => {
    const { service } = makeService({ semanticMatches: [], rows: [] })

    const result = await service.semanticRecall({ text: 'report' } as TuffQuery, new Set(), signal)

    expect(result).toEqual([])
  })

  it('召回数量受上限约束', async () => {
    const semanticMatches = Array.from({ length: 12 }, (_, index) => ({
      sourceId: String(index + 1),
      score: 1 - index * 0.05
    }))
    const rows = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      path: `/f${index + 1}.txt`
    }))
    const { service } = makeService({ semanticMatches, rows })

    const result = await service.semanticRecall({ text: 'report' } as TuffQuery, new Set(), signal)

    expect(result.length).toBe(8)
    // 最高分优先
    expect(result[0].id).toBe('/f1.txt')
  })

  it('aborted 时直接返回空', async () => {
    const { service, semanticSearch } = makeService({
      semanticMatches: [{ sourceId: '1', score: 0.9 }],
      rows: [{ id: 1, path: '/a.txt' }]
    })
    const controller = new AbortController()
    controller.abort()

    const result = await service.semanticRecall(
      { text: 'report' } as TuffQuery,
      new Set(),
      controller.signal
    )

    expect(result).toEqual([])
    expect(semanticSearch).not.toHaveBeenCalled()
  })
})

describe('semantic recall current watch-root admission', () => {
  it('does not expose an indexed semantic candidate outside the current root', async () => {
    const { service } = makeService({
      semanticMatches: [
        { sourceId: '1', score: 0.9 },
        { sourceId: '2', score: 0.8 }
      ],
      rows: [
        { id: 1, path: '/current/report.txt' },
        { id: 2, path: '/withdrawn/report.txt' }
      ],
      isPathAdmitted: (path) => path.startsWith('/current/')
    })
    const result = await service.semanticRecall(
      { text: 'report' } as TuffQuery,
      new Set(),
      new AbortController().signal
    )
    expect(result.map((item) => item.id)).toEqual(['/current/report.txt'])
  })

  it('applies a root withdrawal that arrives while the semantic backend is still answering', async () => {
    const queried = Promise.withResolvers<void>()
    const answered = Promise.withResolvers<void>()
    let admitted = true
    const { service } = makeService({
      semanticMatches: [{ sourceId: '1', score: 0.9 }],
      rows: [{ id: 1, path: '/current/report.txt' }],
      isPathAdmitted: (path) => admitted && path.startsWith('/current/'),
      onSemanticQuery: () => queried.resolve(),
      semanticReady: answered.promise
    })
    const operation = service.semanticRecall(
      { text: 'report' } as TuffQuery,
      new Set(),
      new AbortController().signal
    )
    try {
      await queried.promise
      admitted = false
      answered.resolve()
      expect(await operation).toEqual([])
      admitted = true
      expect(
        (
          await service.semanticRecall(
            { text: 'report' } as TuffQuery,
            new Set(),
            new AbortController().signal
          )
        ).map((item) => item.id)
      ).toEqual(['/current/report.txt'])
    } finally {
      answered.resolve()
      await operation
    }
  })
})

describe('semantic recall persisted chunk locators', () => {
  it.each([
    {
      name: 'PDF page',
      target: { text: 'Tenant shall not keep any pets without written consent.', pageNumber: 4 },
      location: { pageNumber: 4 }
    },
    {
      name: 'code line',
      target: { text: '// policy\nconst petsAllowed = false;', startLine: 120, endLine: 121 },
      location: { lineNumber: 121 }
    }
  ])(
    'renders the hash-selected $name instead of unrelated first-300 file text',
    async ({ target, location }) => {
      const cover = { text: 'UNRELATED COVER '.repeat(40), pageNumber: 1 }
      const { service } = makeService({
        semanticMatches: [
          { sourceId: '1', score: 0.93, contentHash: hashFileContentChunk(target) }
        ],
        rows: [
          { id: 1, path: '/policy.txt', content: cover.text + target.text, chunks: [cover, target] }
        ]
      })
      const result = await service.semanticRecall(
        { text: 'pets' } as TuffQuery,
        new Set(),
        new AbortController().signal
      )
      expect(result.map((item) => item.id)).toEqual(['/policy.txt'])
      expect(result[0]?.meta?.deepMatch).toMatchObject({
        kind: 'semantic',
        snippet: target.text,
        score: 0.93,
        ...location
      })
      expect(result[0]?.meta?.deepMatch?.snippet).not.toContain('UNRELATED COVER')
      const match = result[0]!.meta!.deepMatch!
      expect(
        match.highlightRanges?.map((range) => match.snippet!.slice(range.start, range.end))
      ).toEqual(['pets'])
    }
  )

  it.each([
    { name: 'legacy whole-file vector', contentHash: undefined },
    { name: 'obsolete removed chunk', contentHash: 'aaaaaaaaaaaaaaaa' }
  ])('does not invent a snippet or location for a $name', async ({ contentHash }) => {
    const { service } = makeService({
      semanticMatches: [{ sourceId: '1', score: 0.9, contentHash }],
      rows: [
        {
          id: 1,
          path: '/lease.pdf',
          content: 'Not the matching page.',
          chunks: [{ text: 'Revised page.', pageNumber: 2 }]
        }
      ]
    })
    const result = await service.semanticRecall(
      { text: 'pets' } as TuffQuery,
      new Set(),
      new AbortController().signal
    )
    expect(result.map((item) => item.id)).toEqual(['/lease.pdf'])
    expect(result[0]?.meta?.deepMatch?.snippet).toBeUndefined()
    expect(result[0]?.meta?.deepMatch?.pageNumber).toBeUndefined()
    expect(result[0]?.meta?.deepMatch?.lineNumber).toBeUndefined()
  })
})

describe('semantic recall content privacy gate', () => {
  it('does not expose persisted page text while content indexing is disabled', async () => {
    const chunk = { text: 'Private tenant pets policy.', pageNumber: 4 }
    const { service } = makeService({
      contentEnabled: false,
      semanticMatches: [{ sourceId: '1', score: 0.99, contentHash: hashFileContentChunk(chunk) }],
      rows: [{ id: 1, path: '/private-lease.pdf', content: chunk.text, chunks: [chunk] }]
    })
    expect(
      await service.semanticRecall(
        { text: 'pets policy' } as TuffQuery,
        new Set(),
        new AbortController().signal
      )
    ).toEqual([])
  })
})

describe('semantic recall repeated page text', () => {
  it('distinguishes identical text on different pages using the chunk locator hash', async () => {
    const cover = { text: 'Tenant pets policy.', pageNumber: 1 }
    const target = { text: cover.text, pageNumber: 4 }
    const { service } = makeService({
      semanticMatches: [{ sourceId: '1', score: 0.95, contentHash: hashFileContentChunk(target) }],
      rows: [{ id: 1, path: '/repeated.pdf', chunks: [cover, target] }]
    })
    const result = await service.semanticRecall(
      { text: 'pets' } as TuffQuery,
      new Set(),
      new AbortController().signal
    )
    expect(result[0]?.meta?.deepMatch).toMatchObject({ snippet: target.text, pageNumber: 4 })
  })
})

describe('semantic recall image identity', () => {
  it.each(['猫', '宠物'])(
    'recalls a content-null image for the Han query %s without invented text',
    async (text) => {
      const path = '/Downloads/IMG_2048.png'
      const { service } = makeService({
        semanticMatches: [{ sourceId: '17', score: 0.91, contentHash: 'image-fingerprint' }],
        rows: [{ id: 17, path, extension: '.png' }]
      })
      const result = await service.semanticRecall(
        { text } as TuffQuery,
        new Set(),
        new AbortController().signal
      )
      expect(result.map((item) => item.id)).toEqual([path])
      expect(result[0]?.meta?.deepMatch).toEqual({ kind: 'semantic', score: 0.91 })
      expect(result[0]?.scoring?.match_details?.type).toBe('semantic')
    }
  )

  it.each(['a', 'ab', '12', '🐈'])(
    'does not lower the non-Han query boundary for %s',
    async (text) => {
      const { service } = makeService({
        semanticMatches: [{ sourceId: '17', score: 0.91 }],
        rows: [{ id: 17, path: '/Downloads/IMG_2048.png', extension: '.png' }]
      })
      expect(
        await service.semanticRecall({ text } as TuffQuery, new Set(), new AbortController().signal)
      ).toEqual([])
    }
  )
})
