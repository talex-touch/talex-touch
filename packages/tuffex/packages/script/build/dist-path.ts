import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/** The directory consumers resolve `@talex-touch/tuffex` from. */
export const publishedDistPath = resolve(packageRoot, 'dist')

/**
 * The directory build steps write into.
 *
 * The full build points `TUFFEX_DIST_DIR` at a staging directory and moves it
 * over `dist` only once every step has passed (see `index.ts`); the component
 * package's `vite build` runs as a child process and inherits the variable. A
 * step run on its own writes straight to `dist`.
 */
export function distPath(): string {
  return process.env.TUFFEX_DIST_DIR || publishedDistPath
}
