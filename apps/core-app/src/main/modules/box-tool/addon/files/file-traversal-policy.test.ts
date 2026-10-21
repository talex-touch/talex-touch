import { describe, expect, it } from 'vitest'
import {
  findLinkedWorktreeHolding,
  findLinkedWorktreeRootBelow,
  getDirectoryLevelExclusionReason,
  getFileTraversalExclusionReason,
  getScanChildExclusionReason,
  isLinkedWorktreeRoot
} from './file-traversal-policy'

/**
 * The bottom-up half of the #1727 rule, shared by the fd backend, the watcher's incremental path
 * and the excluded-path cleanup. The legacy walker carries the same answer top-down; both must
 * agree, or a file the snapshot skipped would arrive through the watcher and the other way round.
 */
const tree: Record<string, string[]> = {
  '/Users/someone': ['.git', 'Documents', 'Workspace'],
  '/Users/someone/Documents': ['build', 'notes.txt'],
  '/Users/someone/Documents/build': ['notes.txt'],
  '/Users/someone/Workspace': ['app'],
  '/Users/someone/Workspace/app': ['package.json', 'build', 'packages'],
  '/Users/someone/Workspace/app/packages': ['lib'],
  '/Users/someone/Workspace/app/packages/lib': ['dist', 'src'],
  '/Users/someone/Workspace/app/packages/lib/dist': ['out.js']
}

function recordingReaddir() {
  const reads: string[] = []
  const readdir = async (directory: string): Promise<string[]> => {
    reads.push(directory)
    const names = tree[directory]
    if (!names) throw new Error(`ENOENT ${directory}`)
    return names
  }
  return { reads, readdir }
}

describe('ordinary-word folders inside a project', () => {
  it('excludes a package build folder whose project marker is further up', async () => {
    const { readdir } = recordingReaddir()
    expect(
      await getDirectoryLevelExclusionReason(
        '/Users/someone/Workspace/app/packages/lib/dist',
        readdir
      )
    ).toBe('development-path')
  })

  it('stops at a marker beside the folder without reading further up', async () => {
    const { reads, readdir } = recordingReaddir()
    expect(
      await getDirectoryLevelExclusionReason('/Users/someone/Workspace/app/build', readdir)
    ).toBe('development-path')
    expect(reads).toEqual(['/Users/someone/Workspace/app'])
  })

  it('indexes a document folder, a dotfiles repository in the home directory notwithstanding', async () => {
    const { reads, readdir } = recordingReaddir()
    expect(await getDirectoryLevelExclusionReason('/Users/someone/Documents/build', readdir)).toBe(
      null
    )
    expect(reads).not.toContain('/Users/someone')
  })

  it('gives the watcher the same answers for the files below them', async () => {
    const { readdir } = recordingReaddir()
    expect(
      await getFileTraversalExclusionReason(
        '/Users/someone/Workspace/app/packages/lib/dist/out.js',
        readdir
      )
    ).toBe('development-path')
    expect(
      await getFileTraversalExclusionReason('/Users/someone/Documents/build/notes.txt', readdir)
    ).toBe(null)
  })
})

describe('linked worktrees', () => {
  const worktrees = new Set(['/Users/someone/Workspace/app-feature', '/Users/someone/Picked'])
  const isWorktreeRoot = async (directory: string): Promise<boolean> => worktrees.has(directory)

  it('finds the worktree between a file and the root holding it', async () => {
    expect(
      await findLinkedWorktreeRootBelow(
        '/Users/someone/Workspace/app-feature/src/index.ts',
        ['/Users/someone'],
        isWorktreeRoot
      )
    ).toBe('/Users/someone/Workspace/app-feature')
  })

  it('keeps a worktree picked as a root, and files outside every root', async () => {
    // The deepest root holding the file is the worktree itself, so nothing below it is checked.
    expect(
      await findLinkedWorktreeRootBelow(
        '/Users/someone/Picked/notes.txt',
        ['/Users/someone', '/Users/someone/Picked'],
        isWorktreeRoot
      )
    ).toBeNull()
    expect(
      await findLinkedWorktreeRootBelow(
        '/Volumes/Backup/notes.txt',
        ['/Users/someone'],
        isWorktreeRoot
      )
    ).toBeNull()
  })

  it('counts a directory a walk would start at, but never a root', async () => {
    const home = ['/Users/someone']
    const feature = '/Users/someone/Workspace/app-feature'
    expect(await findLinkedWorktreeHolding(feature, home, isWorktreeRoot)).toBe(feature)
    expect(await findLinkedWorktreeHolding(`${feature}/src`, home, isWorktreeRoot)).toBe(feature)
    expect(
      await findLinkedWorktreeHolding(
        '/Users/someone/Picked',
        ['/Users/someone', '/Users/someone/Picked'],
        isWorktreeRoot
      )
    ).toBeNull()
  })

  it('refuses a linked worktree as a unit of a full scan, on top of the per-level filter', async () => {
    const context = { siblingNames: ['app', 'app-feature', 'node_modules', 'package.json'] }
    const isFeature = async (directory: string): Promise<boolean> =>
      directory === '/Users/someone/app-feature'
    expect(
      await getScanChildExclusionReason('/Users/someone/app-feature', context, isFeature)
    ).toBe('development-path')
    expect(await getScanChildExclusionReason('/Users/someone/app', context, isFeature)).toBeNull()
    expect(
      await getScanChildExclusionReason('/Users/someone/node_modules', context, isFeature)
    ).toBe('development-path')
  })

  it('reads a .git file and treats a .git folder or a submodule as no worktree', async () => {
    const files: Record<string, string> = {
      '/w/linked/.git': 'gitdir: /repo/.git/worktrees/linked\n',
      '/w/submodule/.git': 'gitdir: ../.git/modules/submodule\n'
    }
    const readFile = async (filePath: string): Promise<string> => {
      if (filePath === '/w/folder/.git')
        throw Object.assign(new Error('EISDIR'), { code: 'EISDIR' })
      const contents = files[filePath]
      if (contents === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      return contents
    }
    expect(await isLinkedWorktreeRoot('/w/linked', readFile)).toBe(true)
    expect(await isLinkedWorktreeRoot('/w/submodule', readFile)).toBe(false)
    expect(await isLinkedWorktreeRoot('/w/folder', readFile)).toBe(false)
    expect(await isLinkedWorktreeRoot('/w/none', readFile)).toBe(false)
  })

  it('leaves the existing per-folder rules alone when no roots are given', async () => {
    const { readdir } = recordingReaddir()
    expect(
      await getFileTraversalExclusionReason('/Users/someone/Documents/build/notes.txt', readdir)
    ).toBeNull()
  })
})
