import { describe, expect, it } from 'vitest'
import { CONTEXT_DEPENDENT_BLACKLISTED_DIRS } from '../common/file-scan-constants'
import { fileFilterService } from '../common/file-filter-service'

/** `[nN][oO]_x/` → `no_x`, `*[aA][pP][pP]/` → `Example.app` -- the directory name a glob prunes. */
function prunedName(glob: string): string {
  const literal = glob.replace(/\/$/, '').replace(/\[(.)(.)\]/g, '$1')
  return literal.startsWith('*') ? `Example${literal.slice(1)}` : literal
}

const reason = (directoryPath: string, siblingNames?: string[]) =>
  fileFilterService.getTraversalExclusionReason(directoryPath, undefined, { siblingNames })

/**
 * fd prunes these before the scanner sees a path, so each must be a directory the walk rejects
 * whatever sits beside it. One that is rejected only in some context would silently drop files
 * the scanner would have admitted.
 */
describe('traversal prune globs', () => {
  const workspaceGlobs = fileFilterService.getTraversalPruneGlobs('/Users/someone/Workspace')

  it('prunes only directories the walk rejects in every context', () => {
    const unanchored = workspaceGlobs.filter((glob) => glob !== '.*')
    expect(unanchored.length).toBeGreaterThan(0)

    for (const glob of unanchored) {
      const directory = `/Users/someone/Documents/project/${prunedName(glob)}`
      expect(reason(directory, []), glob).not.toBeNull()
      expect(reason(directory, ['package.json']), glob).not.toBeNull()
    }
    expect(reason('/Users/someone/Documents/.config', [])).not.toBeNull()
  })

  it('leaves the names that depend on a project marker to the scanner', () => {
    const names = new Set(workspaceGlobs.map(prunedName))
    for (const name of CONTEXT_DEPENDENT_BLACKLISTED_DIRS) {
      expect(names.has(name)).toBe(false)
    }
    // The one the user saw: a document folder called `build` is walked when nothing marks a project.
    expect(reason('/Users/someone/Documents/build', ['notes.txt'])).toBeNull()
  })

  it('anchors home-level system folders and toolchain caches to a home root only', () => {
    const homeGlobs = fileFilterService.getTraversalPruneGlobs('/Users/someone')
    expect(homeGlobs).toEqual(
      expect.arrayContaining(['/[gG][oO]/[pP][kK][gG]/', '/[oO][rR][bB][sS][tT][aA][cC][kK]/'])
    )
    // `Library` is a system folder only where the platform says so, which the walk itself decides.
    expect(homeGlobs.includes('/[lL][iI][bB][rR][aA][rR][yY]/')).toBe(
      reason('/Users/someone/Library') !== null
    )

    expect(fileFilterService.getTraversalPruneGlobs('C:/Users/someone')).toContain(
      '/[gG][oO]/[pP][kK][gG]/'
    )
    expect(workspaceGlobs.filter((glob) => glob.startsWith('/'))).toEqual([])
  })
})
