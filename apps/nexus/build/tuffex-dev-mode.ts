export type TuffexDevMode = 'source' | 'dist'

export interface ResolveTuffexDevModeOptions {
  isDev: boolean
  env?: Record<string, string | undefined>
  distEntryExists: boolean
  autoFallback?: boolean
}

function isEnabled(value?: string): boolean {
  if (!value)
    return false

  const normalized = value.trim().toLowerCase()
  return normalized === '1'
    || normalized === 'true'
    || normalized === 'yes'
    || normalized === 'on'
}

export function isTuffexSourceRequested(
  isDev: boolean,
  env: Record<string, string | undefined> = {},
): boolean {
  return isDev && isEnabled(env.NUXT_TUFFEX_SOURCE)
}

/**
 * Resolve how Nexus should consume TuffEx during development.
 *
 * Production always consumes the built package. Development defaults to the same
 * path so the docs app does not transform the whole TuffEx source tree; source
 * mode is an explicit escape hatch for editing TuffEx itself.
 */
export function resolveTuffexDevMode({
  isDev,
  env = {},
  distEntryExists,
  autoFallback = false,
}: ResolveTuffexDevModeOptions): TuffexDevMode {
  if (!isDev)
    return 'dist'

  if (isTuffexSourceRequested(isDev, env))
    return 'source'

  if (!distEntryExists) {
    if (autoFallback) {
      console.warn(
        '[nexus] tuffex dist is missing; automatically falling back to NUXT_TUFFEX_SOURCE=true to develop against tuffex source.',
      )
      return 'source'
    }

    throw new Error(
      '[nexus] tuffex dist is missing. Run `pnpm -C packages/tuffex run build`, '
      + 'or set NUXT_TUFFEX_SOURCE=true to develop against tuffex source.',
    )
  }

  return 'dist'
}
