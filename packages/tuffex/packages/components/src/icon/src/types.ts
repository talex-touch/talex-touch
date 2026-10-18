import type { InjectionKey } from 'vue'

export type TxIconType = 'emoji' | 'url' | 'file' | 'class' | 'builtin'

export type TxIconStatus = 'normal' | 'loading' | 'error'

export interface TxIconSource {
  type: TxIconType
  value: string
  status?: TxIconStatus
  /** Icon color for monochrome rendering */
  color?: string
  /** Preserve source colors for addressable SVG icons */
  colorful?: boolean
  /** Error message (when status is error) */
  error?: string
}

/**
 * Path data a `class` icon is drawn with instead of its class: `d` filled with
 * the icon color inside `viewBox` (default `0 0 24 24`). An empty `d` draws
 * nothing, which is what a glyph whose data is still loading should look like.
 */
export interface TxIconGlyph {
  d: string
  viewBox?: string
}

/**
 * Supplies path data for a `class` icon. `null` or `undefined` renders the
 * class itself.
 */
export type TxIconClassGlyphResolver = (className: string) => TxIconGlyph | null | undefined

/**
 * URL resolver function type
 * @param url - Original URL/path value
 * @param type - Icon type ('url' | 'file')
 * @returns Resolved URL string
 */
export type TxIconUrlResolver = (url: string, type: 'url' | 'file') => string

/**
 * SVG fetcher function type for custom fetch logic (e.g., with retry, transport)
 * @param url - Resolved URL to fetch
 * @returns Promise resolving to SVG content string
 */
export type TxIconSvgFetcher = (url: string) => Promise<string>

export interface TxIconConfig {
  /** Custom URL resolver (e.g., for tfile:// protocol) */
  urlResolver?: TxIconUrlResolver
  /** Custom SVG fetcher (e.g., with retry logic) */
  svgFetcher?: TxIconSvgFetcher
  /** Default file protocol prefix (e.g., 'tfile://') */
  fileProtocol?: string
  /**
   * Draws `class` icons from path data. A class only renders where the host's
   * stylesheet defines it, and a utility-CSS engine defines what it finds in
   * scanned source — a class picked at runtime, or one from a collection the
   * host does not install, appears in neither.
   */
  classGlyph?: TxIconClassGlyphResolver
}

export const TX_ICON_CONFIG_KEY: InjectionKey<TxIconConfig> = Symbol('tx-icon-config')
