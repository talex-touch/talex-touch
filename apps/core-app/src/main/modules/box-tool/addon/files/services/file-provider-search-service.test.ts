import type { FileTypeTag } from '../constants'
import { describe, expect, it } from 'vitest'
import { FileProviderSearchResultService } from './file-provider-search-result-service'
import {
  buildFtsQuery,
  buildSearchIndexItem,
  resolveExtensionsForTypeFilters,
  resolveTypeTag
} from './file-provider-search-service'

describe('file-provider-search-service', () => {
  it('resolves type aliases and plural aliases', () => {
    expect(resolveTypeTag('images')).toBe('image')
    expect(resolveTypeTag('video')).toBe('video')
  })

  it.each(['folder', 'directory', '文件夹', '目录'])(
    'resolves the folder type alias %s',
    (alias) => {
      expect(resolveTypeTag(alias)).toBe('folder')
    }
  )

  it.each([
    'kind:folder',
    'type:folder',
    'kind:directory',
    'type:directory',
    'kind:文件夹',
    'type:文件夹',
    'kind:目录',
    'type:目录'
  ])('extracts %s as a folder filter without consuming the search text', (filter) => {
    const filters = FileProviderSearchResultService.prototype.extractFilters(
      `quarterly ${filter} reports`
    )

    expect(Array.from(filters.typeFilters)).toEqual(['folder'])
    expect(filters.text).toBe('quarterly reports')
    expect(filters.extensionFilters).toEqual([])
  })

  it.each([
    { name: 'directory flag', isDir: true, type: 'file' },
    { name: 'directory type', isDir: false, type: 'directory' }
  ])('indexes a $name as a folder rather than its image-like extension', ({ isDir, type }) => {
    const indexed = buildSearchIndexItem(
      {
        path: '/tmp/demo/archive.png',
        name: 'archive.png',
        extension: '.png',
        isDir,
        type
      } as Parameters<typeof buildSearchIndexItem>[0],
      'file',
      'files'
    )

    expect(indexed.tags).toEqual(['folder'])
    expect(indexed.keywords).toContainEqual({ value: 'folder', priority: 1.05 })
  })

  it('limits fts query tokens to 5', () => {
    const query = buildFtsQuery(['one two three four five six seven'])
    expect(query.split(' ')).toHaveLength(5)
  })

  it('resolves extensions for type filters', () => {
    const extensions = resolveExtensionsForTypeFilters(new Set<FileTypeTag>(['image', 'video']))
    expect(extensions.length).toBeGreaterThan(0)
  })

  it('builds search index item with provider metadata', () => {
    const item = buildSearchIndexItem(
      {
        path: '/tmp/demo/readme.md',
        name: 'readme.md',
        displayName: 'README',
        extension: '.md',
        content: 'hello world'
      } as Parameters<typeof buildSearchIndexItem>[0],
      'file',
      'files'
    )

    expect(item.providerId).toBe('file')
    expect(item.type).toBe('files')
    expect(item.path).toBe('/tmp/demo/readme.md')
    expect((item.keywords ?? []).length).toBeGreaterThan(0)
  })
})
