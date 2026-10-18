import { AI_CATALOG } from './catalog-ai'
import { BRAND_CATALOG } from './catalog-brand'
import { EMOJI_CATALOG } from './catalog-emoji'
import { ICON_CATALOG } from './catalog-icon'

/**
 * The bundled catalog: what the picker offers when a host supplies no rows of
 * its own, split into one module per section.
 *
 * It is curated, not generated. Remix Icon alone is 3,229 glyphs and Simple
 * Icons 3,722; nobody browses that many, and every row costs twice — once as
 * the path data the picker draws it with (`generated/`), and once more in any
 * host stylesheet that renders the picked class outside the picker.
 *
 * Keywords are bilingual. Written English-only, a zh-CN user typing 火箭 gets
 * an empty grid and concludes the search is broken; pinyin for the Chinese
 * words is generated alongside the glyphs, so `huojian` and `hj` work too.
 *
 * Every module here is plain data with type-only imports, because a host's
 * utility-CSS config evaluates them (core-app's `uno.config.ts` does) and a
 * config loader cannot evaluate Vue.
 */
export { AI_CATALOG, BRAND_CATALOG, EMOJI_CATALOG, ICON_CATALOG }

/**
 * Every class the bundled catalog can render, for a host whose own icons
 * render through a utility-CSS engine: the picker draws these from bundled
 * path data, but a picked value shown anywhere else is just a class, and
 * none of them appear in a template the extractor scans. Spread into the
 * host safelist rather than copied, so a new row cannot ship invisible.
 */
export const ICON_CATALOG_CLASSES: readonly string[] = Object.freeze(
  [...ICON_CATALOG, ...BRAND_CATALOG, ...AI_CATALOG].map(entry => entry.icon.value),
)

/**
 * Category headings for the bundled catalog, keyed by `IconPickerEntry.category`.
 * One table for every section: a category name that two sections share
 * (`people`, `development`) means the same thing in both.
 */
export const ICON_PICKER_CATEGORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'smileys': 'Smileys',
  'people': 'People',
  'animals': 'Animals & nature',
  'food': 'Food & drink',
  'travel': 'Travel & places',
  'activities': 'Activities',
  'objects': 'Objects',
  'symbols': 'Symbols',
  'essentials': 'Essentials',
  'system': 'System',
  'communication': 'Communication',
  'development': 'Development',
  'document': 'Documents',
  'media': 'Media',
  'design': 'Design',
  'business': 'Business',
  'nature': 'Nature',
  'device': 'Devices',
  'lifestyle': 'Lifestyle',
  'frameworks': 'Languages & frameworks',
  'platforms': 'Platforms',
  'cloud': 'Cloud',
  'productivity': 'Productivity',
  'social': 'Social & media',
  'payment': 'Payments',
  'models': 'Models',
  'ai-tools': 'AI tools',
  'ai-glyphs': 'AI glyphs',
})
