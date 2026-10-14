import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { execFileSafe } from '@talex-touch/utils/common/utils/safe-shell'
import { iconService } from '../../../../service/icon-service'
import { readFile as readPlist } from 'simple-plist'
import { reportAppScanError } from './app-error-reporter'
import type { AppDisplayNameQuality, ScannedAppInfo } from './app-types'
import { resolveScannedAppCreatedAt } from './app-types'
import { readLocalizedStringsFile } from './localized-strings-parser'
import { createLogger } from '../../../../utils/logger'
import { getLocale } from '../../../../utils/i18n-helper'

const darwinAppLog = createLogger('AppScanner').child('Darwin')

export async function getApps(): Promise<ScannedAppInfo[]> {
  // Switch to mdfind as the primary method for discovering applications for better coverage.
  return getAppsViaMdfind()
}

// Helper to parse plist content with regex
function getValueFromPlist(content: string, key: string): string | null {
  const regex = new RegExp(`<key>${key}</key>\\s*<string>(.*?)</string>`)
  const match = content.match(regex)
  return match ? match[1] : null
}

// Promisified wrapper for simple-plist readFile (callback-based)
function readPlistAsync(filePath: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    readPlist(filePath, (err: Error | null, data: unknown) => {
      if (err) reject(err)
      else resolve((data ?? {}) as Record<string, unknown>)
    })
  })
}

export function extractLocalizedDisplayName(data: Record<string, unknown>): string | null {
  const displayName = data.CFBundleDisplayName
  if (typeof displayName === 'string' && displayName.trim()) {
    return displayName.trim()
  }

  const bundleName = data.CFBundleName
  if (typeof bundleName === 'string' && bundleName.trim()) {
    return bundleName.trim()
  }

  return null
}

function normalizeDisplayNameCandidate(rawValue: string | null | undefined): string | null {
  if (!rawValue) {
    return null
  }

  const normalizedValue = rawValue.trim()
  if (!normalizedValue || normalizedValue === '(null)') {
    return null
  }

  if (normalizedValue.endsWith('.app')) {
    return normalizedValue.slice(0, -4).trim() || null
  }

  return normalizedValue
}

function resolveDarwinDisplayName(
  localizedName: string | null,
  plistDisplayName: string | null,
  bundleName: string | null,
  fileName: string
): {
  displayName: string | null
  displayNameSource: string
  displayNameQuality: AppDisplayNameQuality
} {
  const candidates: Array<{
    value: string | null
    source: string
    quality: AppDisplayNameQuality
  }> = [
    { value: localizedName, source: 'InfoPlist.strings', quality: 'localized' },
    {
      value: normalizeDisplayNameCandidate(plistDisplayName),
      source: 'CFBundleDisplayName',
      quality: 'manifest'
    },
    {
      value: normalizeDisplayNameCandidate(bundleName),
      source: 'CFBundleName',
      quality: 'manifest'
    },
    { value: fileName, source: 'filename', quality: 'filename' }
  ]

  const matched = candidates.find((candidate) => candidate.value)
  return {
    displayName: matched?.value ?? null,
    displayNameSource: matched?.source ?? 'fallback',
    displayNameQuality: matched?.quality ?? 'fallback'
  }
}

function collectAlternateDisplayNames(
  displayName: string | null,
  candidates: Array<string | null | undefined>
): string[] {
  const normalizedDisplayName = displayName?.toLowerCase()
  const seen = new Set<string>()
  const alternateNames: string[] = []

  for (const candidate of candidates) {
    const normalized = normalizeDisplayNameCandidate(candidate)
    if (!normalized) continue

    const lookupKey = normalized.toLowerCase()
    if (lookupKey === normalizedDisplayName || seen.has(lookupKey)) continue

    seen.add(lookupKey)
    alternateNames.push(normalized)
  }

  return alternateNames
}

function isTruthyPlistFlag(value: unknown): boolean {
  if (value === true || value === 1) return true
  if (typeof value !== 'string') return false
  return ['1', 'true', 'yes'].includes(value.trim().toLowerCase())
}

function isNonUserFacingCoreServiceApp(
  appPath: string,
  plistData: Record<string, unknown>
): boolean {
  const normalizedPath = appPath.replace(/\\/g, '/').toLowerCase()
  if (!normalizedPath.startsWith('/system/library/coreservices/')) return false

  return isTruthyPlistFlag(plistData.LSBackgroundOnly) || isTruthyPlistFlag(plistData.LSUIElement)
}

// Helper to get localized display names from .lproj directories (both Chinese and English)
interface LocalizedNameCandidates {
  zh: string | null
  en: string | null
  primary: string | null
}

async function getLocalizedDisplayNames(appPath: string): Promise<LocalizedNameCandidates> {
  const resourcesPath = path.join(appPath, 'Contents', 'Resources')
  const zhLprojs = ['zh-Hans.lproj', 'zh_CN.lproj', 'zh-Hant.lproj', 'zh_TW.lproj']
  const enLprojs = ['en.lproj', 'en_US.lproj', 'en_GB.lproj', 'Base.lproj']

  let zhName: string | null = null
  let enName: string | null = null
  try {
    // 1. Prioritize modern macOS system application InfoPlist.loctable
    const loctablePath = path.join(resourcesPath, 'InfoPlist.loctable')
    try {
      const loctable = await readPlistAsync(loctablePath)
      if (loctable && typeof loctable === 'object') {
        const zhKeys = ['zh_CN', 'zh-Hans', 'zh_Hans', 'zh_HK', 'zh_TW', 'zh-Hant']
        const enKeys = ['en', 'en_US', 'en_GB', 'en_AU', 'en_CA', 'Base']
        for (const key of zhKeys) {
          const entry = loctable[key] as Record<string, unknown> | undefined
          if (entry && typeof entry === 'object') {
            const name = extractLocalizedDisplayName(entry)
            if (name) {
              zhName = name
              break
            }
          }
        }
        for (const key of enKeys) {
          const entry = loctable[key] as Record<string, unknown> | undefined
          if (entry && typeof entry === 'object') {
            const name = extractLocalizedDisplayName(entry)
            if (name) {
              enName = name
              break
            }
          }
        }
      }
    } catch {
      // InfoPlist.loctable does not exist or failed to parse, continue to lproj directories
    }

    // 2. Check traditional .lproj directories if names were not found in loctable
    if (!zhName || !enName) {
      const files = await fs.readdir(resourcesPath).catch(() => [])
      const availableLprojs = files.filter((f) => f.endsWith('.lproj'))

      const readLprojName = async (lprojs: string[]): Promise<string | null> => {
        for (const lproj of lprojs) {
          if (!availableLprojs.includes(lproj)) continue
          const stringsPath = path.join(resourcesPath, lproj, 'InfoPlist.strings')
          try {
            const data = await readPlistAsync(stringsPath)
            const name = extractLocalizedDisplayName(data)
            if (name) return name
          } catch {
            try {
              const parsed = await readLocalizedStringsFile(stringsPath)
              const name = extractLocalizedDisplayName(parsed)
              if (name) return name
            } catch {
              // continue
            }
          }
        }
        return null
      }

      if (!zhName) zhName = await readLprojName(zhLprojs)
      if (!enName) enName = await readLprojName(enLprojs)
    }
  } catch {
    // Resources directory doesn't exist
  }

  const isZh = (() => {
    try {
      return getLocale().startsWith('zh')
    } catch {
      return true
    }
  })()

  const primary = isZh ? zhName || enName : enName || zhName
  return { zh: zhName, en: enName, primary }
}

// The core logic for fetching app info, designed to throw errors on failure.
async function getAppInfoUnstable(appPath: string): Promise<ScannedAppInfo | null> {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist')

  // Pre-check if Info.plist exists before proceeding
  try {
    await fs.access(plistPath, fs.constants.F_OK)
  } catch (err) {
    // If Info.plist doesn't exist, this is not a valid/complete app bundle.
    // Preserve the original error code so retrier can detect ENOENT
    const error = new Error(`Info.plist not found at ${plistPath}`) as Error & { code?: string }
    error.code = (err as NodeJS.ErrnoException).code
    throw error
  }

  const stats = await fs.stat(appPath)
  const plistContent = await fs.readFile(plistPath, 'utf-8')
  const plistData: Record<string, unknown> = await readPlistAsync(plistPath).catch(() => ({}))
  if (isNonUserFacingCoreServiceApp(appPath, plistData)) {
    return null
  }

  // Get names from Info.plist
  const plistDisplayName = getValueFromPlist(plistContent, 'CFBundleDisplayName')
  const bundleName = getValueFromPlist(plistContent, 'CFBundleName')
  const fileName = path.basename(appPath, '.app')

  // Try to get localized display names (both Chinese and English)
  const localized = await getLocalizedDisplayNames(appPath)
  const localizedName = localized.primary

  // mdls display-name corrections are handled by the background mdls scan.
  const displayNameMeta = resolveDarwinDisplayName(
    localizedName,
    plistDisplayName,
    bundleName,
    fileName
  )
  const displayName = displayNameMeta.displayName
  const alternateNames = collectAlternateDisplayNames(displayName, [
    localized.zh,
    localized.en,
    plistDisplayName,
    bundleName,
    fileName
  ])

  // `name` is always the file name
  const name = fileName

  const bundleId = getValueFromPlist(plistContent, 'CFBundleIdentifier') || ''
  const version =
    getValueFromPlist(plistContent, 'CFBundleShortVersionString') ||
    getValueFromPlist(plistContent, 'CFBundleVersion') ||
    undefined
  // Scans only read the cache. Missing icons hydrate after indexing completes.
  const icon = (await iconService.getCachedAppIcon(appPath, bundleId)) ?? ''

  return {
    name,
    displayName: displayName || undefined,
    displayNameSource: displayNameMeta.displayNameSource,
    displayNameQuality: displayNameMeta.displayNameQuality,
    identityKind: 'macos-path',
    fileName,
    alternateNames: alternateNames.length > 0 ? alternateNames : undefined,
    path: appPath,
    icon,
    bundleId,
    ...(version ? { version } : {}),
    uniqueId: bundleId || appPath,
    stableId: appPath,
    launchKind: 'path',
    launchTarget: appPath,
    displayPath: appPath,
    lastModified: stats.mtime,
    createdAt: resolveScannedAppCreatedAt(stats)
  }
}

export async function getAppInfo(appPath: string): Promise<ScannedAppInfo | null> {
  // Pre-condition check, no need to retry this
  if (!appPath || !appPath.endsWith('.app')) {
    return null
  }

  try {
    return await getAppInfoUnstable(appPath)
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : typeof error === 'string' ? error : String(error)
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: string }).code
        : undefined
    if (code === 'ENOENT') {
      darwinAppLog.debug('Skipping invalid app bundle without Info.plist', {
        meta: { pathLength: appPath.length, message: errorMessage, code }
      })
    } else {
      darwinAppLog.warn('Failed to get app info', {
        error,
        meta: { pathLength: appPath.length, message: errorMessage, code }
      })
    }
    if (code !== 'ENOENT') {
      reportAppScanError({
        platform: process.platform,
        path: appPath,
        message: errorMessage,
        timestamp: Date.now(),
        cause: error
      })
    }
    return null
  }
}

export async function getAppsViaMdfind(): Promise<ScannedAppInfo[]> {
  const query = 'kMDItemContentType == "com.apple.application-bundle"'
  const searchRoots = [
    '/Applications',
    '/System/Applications',
    '/System/Library/CoreServices',
    path.join(os.homedir(), 'Applications')
  ]

  const existingRoots: string[] = []
  for (const root of searchRoots) {
    try {
      await fs.access(root)
      existingRoots.push(root)
    } catch {
      // ignore missing roots
    }
  }

  const args = existingRoots.flatMap((root) => ['-onlyin', root])
  args.push(query)

  const { stdout } = await execFileSafe('mdfind', args, { maxBuffer: 1024 * 1024 * 10 })
  const appPaths = Array.from(
    new Set(
      stdout
        .split('\n')
        .map((p) => p.trim())
        .filter((p) => p.endsWith('.app'))
    )
  )

  const appInfos = await mapWithConcurrency(appPaths, 4, async (appPath) => {
    try {
      return await getAppInfo(appPath)
    } catch {
      return null
    }
  })

  return appInfos.filter((app): app is ScannedAppInfo => !!app)
}

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return []
  }

  const results: R[] = Array.from({ length: items.length })
  let nextIndex = 0

  const workerCount = Math.min(Math.max(concurrency, 1), items.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const currentIndex = nextIndex++
      if (currentIndex >= items.length) {
        return
      }

      results[currentIndex] = await mapper(items[currentIndex])
      // Yield to the event loop every 5 items to prevent blocking
      if (currentIndex % 5 === 0) {
        await yieldToEventLoop()
      }
    }
  })

  await Promise.all(workers)
  return results
}
