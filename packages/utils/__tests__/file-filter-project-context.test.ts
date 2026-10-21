import { describe, expect, it } from 'vitest'
import {
  CONTEXT_DEPENDENT_BLACKLISTED_DIRS,
  DEV_BLACKLISTED_DIRS,
  TEMP_BLACKLISTED_DIRS,
} from '../common/file-scan-constants'
import { fileFilterService, holdsProjectMarker } from '../common/file-filter-service'

/**
 * #1727's last acceptance criterion: a decision on whether development names apply under a user's
 * document roots.
 *
 * The decision is *not by name alone*. `node_modules` is nobody's document folder and keeps
 * excluding everywhere; `build`, `dist`, `out`, `bin`, `target`, `coverage`, `logs`, `tmp`, `temp`
 * and `cache` are ordinary English words, and they exclude only inside a project: where a project
 * marker sits beside them (free, because the traversal has already read the parent before it
 * descends) or in a folder further up.
 *
 * Both directions are asserted below, because only one of them is the silent one: a wrongly-kept
 * exclusion produces no error, no `errorCount`, and a search result identical to "file not there".
 */

/** A directory whose siblings were read and contain no project marker. */
const withoutProject = (p: string, siblings: readonly string[] = ['notes.txt']): string =>
  String(fileFilterService.getTraversalExclusionReason(p, undefined, { siblingNames: siblings }) ?? '—')

/** The same, next to a `package.json`. */
const withProject = (p: string, marker = 'package.json'): string =>
  String(
    fileFilterService.getTraversalExclusionReason(p, undefined, {
      siblingNames: [marker, 'src', 'README.md'],
    }) ?? '—',
  )

/** No context at all — every caller other than the traversal. */
const withoutContext = (p: string): string =>
  String(fileFilterService.getTraversalExclusionReason(p) ?? '—')

const ORDINARY_WORDS = [...CONTEXT_DEPENDENT_BLACKLISTED_DIRS]

describe('#1727 ordinary-word dirs under a user root', () => {
  it('has names to check, so the loops below are not vacuous', () => {
    expect(ORDINARY_WORDS.length).toBeGreaterThan(0)
  })

  /**
   * The set only ever weakens where an existing list applies. A name here that is on neither list
   * would be inventing policy in a constant nobody reads.
   */
  it('only relaxes names the two blacklists already own', () => {
    for (const name of ORDINARY_WORDS) {
      expect(
        DEV_BLACKLISTED_DIRS.has(name) || TEMP_BLACKLISTED_DIRS.has(name),
        name,
      ).toBe(true)
    }
  })

  it('indexes them when nothing beside them says "project"', () => {
    for (const name of ORDINARY_WORDS) {
      const p = `/Users/someone/Documents/${name}`
      expect(withoutProject(p), p).toBe('—')
    }
  })

  it('still excludes them beside a project marker', () => {
    for (const name of ORDINARY_WORDS) {
      const p = `/Users/someone/Projects/app/${name}`
      expect(withProject(p), p).not.toBe('—')
    }
  })

  /**
   * The half a leaf-name-only fix would have missed. `PATH_PATTERNS.DEV_PATHS` carries `/build\//`
   * unanchored, so it matches an *ancestor* segment: `~/Documents/build` would come back indexed
   * while everything under it stayed excluded.
   */
  it('indexes what is below them too, not just the folder itself', () => {
    const p = '/Users/someone/Documents/build/2026'
    expect(withoutProject(p, ['2026', 'notes.txt']), p).toBe('—')
    expect(withoutProject('/Users/someone/Documents/tmp/receipts'), 'tmp/receipts').toBe('—')
  })

  it('recognises project markers other than package.json', () => {
    for (const marker of ['Cargo.toml', 'go.mod', 'Makefile', 'pom.xml', '.git'])
      expect(withProject('/Users/someone/Documents/target', marker), marker).not.toBe('—')
  })

  /** `App.csproj` is named per project, so the marker list matches it by suffix. */
  it('recognises per-project marker names by suffix', () => {
    expect(withProject('/Users/someone/Documents/bin', 'App.csproj')).not.toBe('—')
  })

  it('matches markers case-insensitively', () => {
    expect(withProject('/Users/someone/Documents/build', 'makefile')).not.toBe('—')
  })
})

describe('#1727 what the relaxation must not touch', () => {
  it('keeps node_modules excluded with or without a project beside it', () => {
    const p = '/Users/someone/Documents/node_modules'
    expect(withoutProject(p)).toBe('development-path')
    expect(withProject(p)).toBe('development-path')
    expect(withoutContext(p)).toBe('development-path')
  })

  /**
   * `bin` is on the macOS system list *and* the dev list. Relaxing the dev half must not hand back
   * `/usr/bin`, and it does not: `PATH_PATTERNS.SYSTEM_PATHS` is the one of the three pattern sets
   * left unconditional, precisely because it catches what the per-level name rule cannot.
   */
  it('keeps real system paths excluded once bin and tmp are relaxed', () => {
    if (process.platform === 'win32') return
    for (const p of ['/usr/bin', '/var/tmp', '/usr/local/bin'])
      expect(withoutProject(p, ['lib', 'share']), p).toBe('system-path')
  })

  it('keeps hidden and bundle rules ahead of the relaxation', () => {
    expect(withoutProject('/Users/someone/Documents/.cache')).toBe('hidden-name')
    expect(withoutProject('/Users/someone/Pictures/Photos Library.photoslibrary')).toBe(
      'bundle-internal',
    )
  })

  it('still honours an explicit custom blacklist', () => {
    const reason = fileFilterService.getTraversalExclusionReason(
      '/Users/someone/Documents/build',
      { customBlacklistedDirs: new Set(['build']) },
      { siblingNames: ['notes.txt'] },
    )
    expect(reason).toBe('excluded-path')
  })
})

describe('#1727 callers that supply no context are unchanged', () => {
  /**
   * The regression guard for every folder classification that is not the traversal. Such a caller
   * cannot see siblings, so it keeps the pre-#1727 answer rather than being handed a guess. File
   * admission is not one of them: see the next block.
   */
  it('gives the strict answer when siblings were never read', () => {
    expect(withoutContext('/Users/x/Documents/tmp')).toBe('cache-path')
    expect(withoutContext('/Users/x/Downloads/cache')).toBe('development-path')
    expect(withoutContext('/Users/x/Documents/build')).toBe('development-path')
    expect(withoutContext('/Users/x/Documents/build/2026')).toBe('development-path')
  })

  /**
   * Read-and-found-nothing is a different statement from never-looked, and an empty directory is a
   * real thing to be standing in. Collapsing the two would make an empty parent strict again.
   */
  it('treats an empty sibling list as read, not as unknown', () => {
    expect(withoutProject('/Users/x/Documents/build', [])).toBe('—')
  })
})

/**
 * Every file reaching admission came from a walk that already decided its folders with their
 * siblings in hand. Admission used to classify the folder again without them, got the strict
 * answer, and dropped the file the walk had just admitted -- so a document under
 * `~/Documents/build` never reached the index even though #1727 had relaxed the folder.
 */
describe('#1727 file admission leaves ordinary-word folders to the walk', () => {
  const admit = (p: string): string =>
    String(
      fileFilterService.getIndexExclusionReason({
        path: p,
        name: p.slice(p.lastIndexOf('/') + 1),
        extension: p.slice(p.lastIndexOf('.')),
      }) ?? '—',
    )

  it('admits files below them, at any depth', () => {
    for (const name of ORDINARY_WORDS) {
      const p = `/Users/someone/Documents/${name}/notes.txt`
      expect(admit(p), p).toBe('—')
    }
    expect(admit('/Users/someone/Documents/build/2026/q3/notes.txt')).toBe('—')
    expect(admit('/Users/someone/Documents/tmp/receipts/march.pdf')).toBe('—')
  })

  it('still rejects files under the folders every context excludes', () => {
    expect(admit('/Users/someone/Projects/app/node_modules/pkg/index.js')).toBe('development-path')
    expect(admit('/Users/someone/Projects/app/node_modules/build/index.js')).toBe('development-path')
    expect(admit('/Users/someone/Documents/.cache/notes.txt')).toBe('hidden-name')
    expect(admit('/Users/someone/Pictures/Photos Library.photoslibrary/database/a.txt')).toBe(
      'bundle-internal',
    )
  })

  it('leaves the folder classification itself strict', () => {
    expect(withoutContext('/Users/someone/Documents/build')).toBe('development-path')
    expect(
      fileFilterService.getIndexExclusionReason({
        path: '/Users/someone/Documents/build',
        name: 'build',
        isDirectory: true,
      }),
    ).toBe('development-path')
  })
})

/**
 * A marker beside the folder is not the only way to be inside a project: a monorepo package's
 * `dist` or an app folder's `out` sits below a project whose marker is further up. On 2026-10-20,
 * 761 of the 844 files a sibling-only check admitted from ordinary-word folders under one
 * workspace folder were such build output.
 */
describe('#1727 a project marker further up counts too', () => {
  const insideProject = (p: string): string =>
    String(
      fileFilterService.getTraversalExclusionReason(p, undefined, {
        siblingNames: ['src', 'notes.txt'],
        insideProject: true,
      }) ?? '—',
    )

  it('excludes ordinary-word folders below a project even with no marker beside them', () => {
    for (const name of ORDINARY_WORDS) {
      const p = `/Users/someone/Workspace/app/packages/lib/${name}`
      expect(insideProject(p), p).not.toBe('—')
    }
  })

  it('leaves every other folder name alone', () => {
    expect(insideProject('/Users/someone/Workspace/app/packages/lib/src')).toBe('—')
    expect(insideProject('/Users/someone/Workspace/app/docs')).toBe('—')
  })

  const tree: Record<string, string[]> = {
    '/Users/someone': ['.git', 'package.json', 'Documents', 'Workspace'],
    '/Users/someone/Documents': ['build', 'notes.txt'],
    '/Users/someone/Workspace': ['app'],
    '/Users/someone/Workspace/app': ['package.json', 'packages'],
    '/Users/someone/Workspace/app/packages': ['lib'],
    '/Users/someone/Workspace/app/packages/lib': ['dist', 'src'],
    'C:/Users/someone/repo': ['Cargo.toml', 'crates'],
    'C:/Users/someone/repo/crates': ['core'],
  }
  const reads: string[] = []
  const readdir = async (directory: string): Promise<string[]> => {
    reads.push(directory)
    const names = tree[directory.replace(/\\/g, '/')]
    if (!names) throw new Error(`ENOENT ${directory}`)
    return names
  }

  it('finds a marker in any folder above', async () => {
    expect(
      await fileFilterService.isInsideProject('/Users/someone/Workspace/app/packages/lib', readdir),
    ).toBe(true)
    expect(await fileFilterService.isInsideProject('C:\\Users\\someone\\repo\\crates', readdir)).toBe(
      true,
    )
  })

  it('stops at the home directory without reading it', async () => {
    reads.length = 0
    expect(await fileFilterService.isInsideProject('/Users/someone/Documents', readdir)).toBe(false)
    expect(reads).toEqual(['/Users/someone/Documents'])
  })

  it('treats a folder it cannot read as holding no marker and keeps going', async () => {
    expect(
      await fileFilterService.isInsideProject('/Users/someone/Workspace/app/unreadable', readdir),
    ).toBe(true)
    expect(await fileFilterService.isInsideProject('/Volumes/Backup/old/build', readdir)).toBe(false)
  })

  it('never makes a home directory or a filesystem root a project root', () => {
    expect(holdsProjectMarker('/Users/someone', ['.git'])).toBe(false)
    expect(holdsProjectMarker('C:/Users/someone', ['package.json'])).toBe(false)
    expect(holdsProjectMarker('/', ['package.json'])).toBe(false)
    expect(holdsProjectMarker('/Users/someone/Workspace/app', ['package.json'])).toBe(true)
  })
})
