import type { FileScanOptions } from '@talex-touch/utils/common/file-scan-constants'
import type { FileFilterReason } from '@talex-touch/utils/common/file-filter-service'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CONTEXT_DEPENDENT_BLACKLISTED_DIRS } from '@talex-touch/utils/common/file-scan-constants'
import {
  fileFilterService,
  isLinkedWorktreeGitFile,
  isProjectMarker
} from '@talex-touch/utils/common/file-filter-service'

/**
 * One level of the file index's directory rule. Context-dependent names such as `build` and
 * `dist` are excluded only inside a project: a marker beside them or in a folder further up.
 * Unconditional names need no directory read. Kept in a worker-safe module because the
 * full-scan worker cannot import Electron-facing utils.
 */
export async function getDirectoryLevelExclusionReason(
  directoryPath: string,
  readdir: (directoryPath: string) => Promise<string[]> = (target) => fs.readdir(target),
  options?: FileScanOptions
): Promise<FileFilterReason | null> {
  const directoryName = path.basename(directoryPath).toLowerCase()
  let siblingNames: string[] | undefined = []
  let insideProject = false
  if (CONTEXT_DEPENDENT_BLACKLISTED_DIRS.has(directoryName)) {
    const parentPath = path.dirname(directoryPath)
    try {
      siblingNames = await readdir(parentPath)
    } catch {
      siblingNames = undefined
    }
    if (siblingNames && !siblingNames.some(isProjectMarker)) {
      insideProject = await fileFilterService.isInsideProject(path.dirname(parentPath), readdir)
    }
  }
  return fileFilterService.getTraversalExclusionReason(directoryPath, options, {
    siblingNames,
    insideProject
  })
}

/**
 * `roots` adds the linked-worktree rule, which applies only below the root holding the file, as
 * in the scan: a root the user picked inside a worktree stays in.
 */
export async function getFileTraversalExclusionReason(
  filePath: string,
  readdir?: (directoryPath: string) => Promise<string[]>,
  roots?: readonly string[]
): Promise<FileFilterReason | null> {
  let directoryPath = path.dirname(filePath)
  while (true) {
    const reason = await getDirectoryLevelExclusionReason(directoryPath, readdir)
    if (reason) return reason

    const parent = path.dirname(directoryPath)
    if (parent === directoryPath) break
    directoryPath = parent
  }
  if (roots && (await findLinkedWorktreeRootBelow(filePath, roots))) return 'development-path'
  return null
}

/**
 * Whether this folder is a linked worktree: its `.git` is a file pointing into
 * `<repository>/worktrees/<name>` (`isLinkedWorktreeGitFile`). A `.git` folder fails the read.
 */
export async function isLinkedWorktreeRoot(
  directoryPath: string,
  readFile: (filePath: string) => Promise<string> = (target) => fs.readFile(target, 'utf8')
): Promise<boolean> {
  try {
    return isLinkedWorktreeGitFile(await readFile(path.join(directoryPath, '.git')))
  } catch {
    return false
  }
}

/** The linked worktree between `filePath` and the deepest of `roots` that holds it, if any. */
export async function findLinkedWorktreeRootBelow(
  filePath: string,
  roots: readonly string[],
  isWorktreeRoot: (directoryPath: string) => Promise<boolean> = (directoryPath) =>
    isLinkedWorktreeRoot(directoryPath)
): Promise<string | null> {
  return await findLinkedWorktreeHolding(path.dirname(filePath), roots, isWorktreeRoot)
}

/**
 * As `findLinkedWorktreeRootBelow` for a directory, which may be the worktree itself. A walk
 * that starts below a root, such as a watched subtree, never checks its own start.
 */
export async function findLinkedWorktreeHolding(
  directoryPath: string,
  roots: readonly string[],
  isWorktreeRoot: (directoryPath: string) => Promise<boolean> = (target) =>
    isLinkedWorktreeRoot(target)
): Promise<string | null> {
  let root: string | null = null
  for (const candidate of roots) {
    const trimmed = candidate.length > 1 ? candidate.replace(/[\\/]+$/, '') : candidate
    const prefix = trimmed.endsWith(path.sep) ? trimmed : `${trimmed}${path.sep}`
    const inside = directoryPath === trimmed || directoryPath.startsWith(prefix)
    if (inside && (root === null || trimmed.length > root.length)) root = trimmed
  }
  if (root === null) return null
  let current = directoryPath
  while (current.length > root.length && current.startsWith(root)) {
    if (await isWorktreeRoot(current)) return current
    current = path.dirname(current)
  }
  return null
}

/**
 * The rule for a child of a root that a full scan walks as a unit of its own. Besides the
 * walker's per-level filter it refuses a linked worktree, because a walk never refuses the
 * folder it starts at.
 */
export async function getScanChildExclusionReason(
  directoryPath: string,
  context: { siblingNames: readonly string[] },
  isWorktreeRoot: (directoryPath: string) => Promise<boolean> = (target) =>
    isLinkedWorktreeRoot(target)
): Promise<FileFilterReason | null> {
  return (
    fileFilterService.getTraversalExclusionReason(directoryPath, undefined, context) ??
    ((await isWorktreeRoot(directoryPath)) ? 'development-path' : null)
  )
}
