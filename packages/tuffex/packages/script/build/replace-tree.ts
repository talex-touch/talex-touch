import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'

/** Every entry under `root` by relative path, mapped to whether it is a directory. */
async function listTree(root: string): Promise<Map<string, boolean>> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT')
      return []
    throw error
  })
  return new Map(entries.map(entry => [relative(root, resolve(entry.parentPath, entry.name)), entry.isDirectory()]))
}

/**
 * Moves every file of `source` over its counterpart in `target`, then deletes
 * whatever `source` did not have.
 *
 * Each rename replaces one file atomically, so a reader gets the old copy or the
 * new one and never a missing or half-written file. Renaming the whole
 * directory would be a single step, but a dev server watches the files it has
 * served, not their parent: it sees no event and keeps serving the old modules
 * until it restarts.
 *
 * New files land before existing ones are replaced, so a file that was just
 * replaced never points at one that is not there yet, and stale files go last.
 * While the loop runs, a reader can still see some files new and others old.
 */
export async function replaceTree(source: string, target: string): Promise<void> {
  const next = await listTree(source)
  const current = await listTree(target)

  // A path that turns from a file into a directory, or back, has to be cleared
  // before the new entry can take it.
  for (const [path, isDirectory] of current) {
    if (next.has(path) && next.get(path) !== isDirectory)
      await rm(resolve(target, path), { recursive: true, force: true })
  }

  const files = [...next].filter(([, isDirectory]) => !isDirectory).map(([path]) => path)
  const replacesFile = (path: string) => current.get(path) === false
  for (const path of [...files.filter(path => !replacesFile(path)), ...files.filter(replacesFile)]) {
    await mkdir(dirname(resolve(target, path)), { recursive: true })
    await rename(resolve(source, path), resolve(target, path))
  }

  // Only the topmost stale entries: removing one takes everything below it along,
  // and the entries below a directory that became a file went with it above.
  for (const path of current.keys()) {
    const parent = dirname(path)
    if (!next.has(path) && (parent === '.' || next.get(parent) === true))
      await rm(resolve(target, path), { recursive: true, force: true })
  }
}
