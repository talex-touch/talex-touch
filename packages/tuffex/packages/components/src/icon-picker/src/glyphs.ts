import type { TxIconConfig, TxIconGlyph } from '../../icon/src/types'
import type { IconPickerCatalogSection } from './types'
import { inject, onMounted, provide, ref, shallowReactive } from 'vue'
import { TX_ICON_CONFIG_KEY } from '../../icon/src/types'
import { AI_CATALOG, BRAND_CATALOG, ICON_CATALOG } from './catalog'
import { GLYPH_CHUNKS } from './generated/chunks'

/**
 * Path data for the bundled catalog's classes, so the picker draws them
 * whether or not the host's stylesheet defines the class.
 *
 * Rendered as a class, a catalog row is only visible on a host whose utility
 * CSS generated it. Everywhere else it is whatever the host's preflight makes
 * of an empty `<i>` — on the Nexus docs, which install four collections and
 * none of them Remix, a box filled with the text color.
 *
 * Loaded per section, the first time the section is drawn: all three are
 * ~200 KiB of path data, and most opens look at one.
 */

const SECTION_OF_CLASS: ReadonlyMap<string, IconPickerCatalogSection> = new Map([
  ...ICON_CATALOG.map(entry => [entry.icon.value, 'icon'] as const),
  ...BRAND_CATALOG.map(entry => [entry.icon.value, 'brand'] as const),
  ...AI_CATALOG.map(entry => [entry.icon.value, 'ai'] as const),
])

const glyphs = shallowReactive(new Map<string, TxIconGlyph>())
const failed = shallowReactive(new Set<IconPickerCatalogSection>())
const loads = new Map<IconPickerCatalogSection, Promise<void>>()

const PENDING: TxIconGlyph = Object.freeze({ d: '' })

/**
 * Loads a section's path data; resolves once its classes can be drawn. Safe to
 * call repeatedly. A no-op outside a browser, so a server render never holds
 * data the client's first render does not.
 *
 * A failed load is not retried: browsers keep a failed dynamic import's
 * result for the URL, so a second attempt fails the same way.
 */
export function loadIconPickerGlyphs(section: IconPickerCatalogSection): Promise<void> {
  if (typeof window === 'undefined')
    return Promise.resolve()

  let load = loads.get(section)
  if (!load) {
    load = Promise.all(GLYPH_CHUNKS[section].map(chunk => chunk())).then(
      (modules) => {
        for (const { default: paths } of modules) {
          for (const [className, d] of Object.entries(paths))
            glyphs.set(className, Object.freeze({ d }))
        }
      },
      (error: unknown) => {
        failed.add(section)
        throw error
      },
    )
    loads.set(section, load)
  }
  return load
}

/**
 * `TxIconConfig.classGlyph` for the bundled catalog: its classes resolve to
 * path data, every other class to `null`.
 *
 * A class whose section has not loaded yet resolves to an empty glyph and
 * starts the load. Falling back to the class for the length of an import
 * would flash a filled box on every host without the CSS; it does fall back
 * once a load has failed, since the host's CSS is then all there is.
 */
export function resolveIconPickerGlyph(className: string): TxIconGlyph | null {
  const section = SECTION_OF_CLASS.get(className)
  if (!section)
    return null

  const glyph = glyphs.get(className)
  if (glyph)
    return glyph
  if (failed.has(section))
    return null

  loadIconPickerGlyphs(section).catch(() => {})
  return PENDING
}

/**
 * Provides the bundled glyphs to the picker's subtree, layered over the icon
 * config the host provided: its URL resolver, fetcher and file protocol still
 * apply inside the picker, and its own `classGlyph` is asked first.
 *
 * Catalog classes draw empty until the picker has mounted. Path data only
 * loads in a browser, so a server render cannot draw them, and a client that
 * already holds the data from an earlier picker would draw them while
 * hydrating — markup the server never sent.
 */
export function provideIconPickerGlyphs(): void {
  const host = inject(TX_ICON_CONFIG_KEY, {})
  const mounted = ref(false)
  onMounted(() => {
    mounted.value = true
  })

  const config: TxIconConfig = {
    get urlResolver() {
      return host.urlResolver
    },
    get svgFetcher() {
      return host.svgFetcher
    },
    get fileProtocol() {
      return host.fileProtocol
    },
    classGlyph(className) {
      const own = host.classGlyph?.(className)
      if (own)
        return own
      if (!mounted.value)
        return SECTION_OF_CLASS.has(className) ? PENDING : null
      return resolveIconPickerGlyph(className)
    },
  }
  provide(TX_ICON_CONFIG_KEY, config)
}
